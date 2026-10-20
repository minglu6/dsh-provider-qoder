/**
 * Register a {@link QoderAdapter} for the `qoder-cn` provider route on
 * `ctx.llm`. Loader commits validated live configuration from the plugin form;
 * each request captures the latest connection snapshot and resolves its PAT
 * through the optional credential seam (`ctx.credentials`). An in-flight
 * stream retains the endpoint, VPC instance, and credential reference it
 * started with.
 * @module dsh-provider-qoder
 */

import type { Context, Fiber, Volatile } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import z from '@deepseek-ai/schemastery'
import { assertUsableApiKey, LlmError, resolveRetryPolicy, RetryPolicySchema } from '@deepseek-ai/dsh-llm'
import type { RetryPolicyConfig } from '@deepseek-ai/dsh-llm'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf, type LaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-settings'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { deepEqualJson } from '@deepseek-ai/dsh-util-values'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_TOKENS,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  QoderAdapter,
} from './adapter.ts'
import type { QoderCatalogModel, QoderConnectionOptions } from './adapter.ts'
import { getMachineId, isQoderPatValue, parseVpcInstanceFromEnvironment, qoderCnEndpoints } from './cosy.ts'

export {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_TOKENS,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  parseQoderModelCatalog,
  QoderAdapter,
} from './adapter.ts'
export type { QoderAdapterOptions, QoderCatalogModel, QoderConnectionOptions } from './adapter.ts'
export { qoderEncodeBody } from './qoder-encoding.ts'
export { buildQoderAuthHeaders, qoderCnEndpoints } from './cosy.ts'
export { exchangeJobToken, refreshJobToken, fetchUserInfo } from './pat.ts'

export const name = 'llm-qoder'
export const inject = ['llm']

const NS = 'llm-qoder'
const DEFAULT_API_KEY_ENV = 'QODERCN_PERSONAL_ACCESS_TOKEN'
/** The single provider route this plugin owns. */
const PROVIDER = 'qoder-cn'

/** Plain persisted options; a profile inherits every omitted root field. */
export interface Options {
  /** Credential reference resolved per request; defaults to `QODERCN_PERSONAL_ACCESS_TOKEN`. */
  apiKeyEnv?: string
  /** Enterprise VPC tenant instance (`<instance>.vpc.qoder.com.cn`); absent selects the public cloud. */
  vpcInstance?: string
  /** Gateway origin override (`https://gateway.qoder.com.cn` default, or VPC-derived). */
  baseURL?: string
  /** OpenAPI origin override (`https://openapi.qoder.com.cn` default, or VPC-derived). */
  openApiUrl?: string
  /** Default per-request output cap (default 32,768); a model's own cap and explicit request values win. */
  maxTokens?: number
  /** Positive context capacity used when the selected model has no exact value (default 1,000,000). */
  defaultContextWindow?: number
  /** Optional complete static catalog override; absence discovers Qoder's live catalog. */
  models?: QoderCatalogModel[]
  /** Maximum provider idle time while one stream read is outstanding (default five minutes). */
  streamIdleTimeoutMs?: number
  /** Provider-owned model-request retry policy; omission uses normal defaults. */
  retryPolicy?: RetryPolicyConfig
  /** User-added `qoder-cn` profile; absence keeps the route in Add provider. */
  providers?: Record<string, Omit<Options, 'providers'>>
}

/** Loader-owned live references; consumers capture values once per operation. */
export type Config = { [K in keyof Options]-?: Volatile<Options[K]> }

const catalogModel: z<QoderCatalogModel> = z.object({
  id: z.string().required(),
  name: z.string(),
  description: z.string(),
  contextWindow: z.number().step(1).min(1),
  maxTokens: z.number().step(1).min(1),
  inputModalities: z.array(z.union(['text', 'image'])),
  reasoning: z.boolean(),
})

const connectionFields = {
  apiKeyEnv: z.string().role('credential-ref').pattern(/^[A-Za-z_][A-Za-z0-9_]*$/),
  vpcInstance: z.string().pattern(/^$|^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/),
  baseURL: z.string(),
  openApiUrl: z.string(),
  maxTokens: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER),
  defaultContextWindow: z.number().step(1).min(1),
  // Schemastery arrays otherwise materialize [], which would disable live discovery.
  models: z.array(catalogModel).default(undefined as never),
  streamIdleTimeoutMs: z.number().min(Number.MIN_VALUE).max(MAX_TIMER_DELAY_MS),
  retryPolicy: RetryPolicySchema,
}

/** Live connection fields validated and persisted by the Host Loader. */
export const Config = z.object({
  apiKeyEnv: connectionFields.apiKeyEnv.volatile(),
  vpcInstance: connectionFields.vpcInstance.volatile(),
  baseURL: connectionFields.baseURL.volatile(),
  openApiUrl: connectionFields.openApiUrl.volatile(),
  maxTokens: connectionFields.maxTokens.volatile(),
  defaultContextWindow: connectionFields.defaultContextWindow.volatile(),
  models: connectionFields.models.volatile(),
  streamIdleTimeoutMs: connectionFields.streamIdleTimeoutMs.volatile(),
  retryPolicy: connectionFields.retryPolicy.volatile(),
  providers: z.dict(z.object(connectionFields)).default({}).volatile(),
})

function plainOptions(config: Config): Options {
  return {
    apiKeyEnv: config.apiKeyEnv.get(),
    vpcInstance: config.vpcInstance.get(),
    baseURL: config.baseURL.get(),
    openApiUrl: config.openApiUrl.get(),
    maxTokens: config.maxTokens.get(),
    defaultContextWindow: config.defaultContextWindow.get(),
    models: config.models.get() as Options['models'],
    streamIdleTimeoutMs: config.streamIdleTimeoutMs.get(),
    retryPolicy: config.retryPolicy.get() as Options['retryPolicy'],
    providers: config.providers.get() as Options['providers'],
  }
}

function endpointOverride(value: string | undefined, field: string): string | undefined {
  if (value === undefined || value === '') return undefined
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error(`llm-qoder: ${field} must be an HTTP(S) URL without credentials, query, or fragment`)
  }
  return value.replace(/\/+$/, '')
}

/** Public gateway origin; used when no override and no VPC instance are configured. */
export const PUBLIC_GATEWAY_URL = 'https://gateway.qoder.com.cn'

/** Resolve, validate, and detach an optional static model-catalog override. */
function resolveModels(
  models: readonly QoderCatalogModel[] | undefined,
): QoderCatalogModel[] | undefined {
  if (models === undefined) return undefined
  const seen = new Set<string>()
  return models.map((model) => {
    if (model.id.length === 0) throw new Error('llm-qoder: catalog model ids must be non-empty')
    if (model.name !== undefined && model.name.length === 0) {
      throw new Error(`llm-qoder: catalog model "${model.id}" has an empty name`)
    }
    if (model.contextWindow !== undefined
      && (!Number.isInteger(model.contextWindow) || model.contextWindow <= 0)) {
      throw new Error(
        `llm-qoder: catalog model "${model.id}" contextWindow must be a positive integer`,
      )
    }
    if (model.maxTokens !== undefined
      && (!Number.isInteger(model.maxTokens) || model.maxTokens <= 0)) {
      throw new Error(
        `llm-qoder: catalog model "${model.id}" maxTokens must be a positive integer`,
      )
    }
    if (seen.has(model.id)) throw new Error(`llm-qoder: duplicate catalog model "${model.id}"`)
    seen.add(model.id)
    return {
      id: model.id,
      ...model.name === undefined ? {} : { name: model.name },
      ...model.description === undefined ? {} : { description: model.description },
      ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
      ...model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens },
      ...model.inputModalities === undefined ? {} : { inputModalities: [...model.inputModalities] },
      ...model.reasoning === undefined ? {} : { reasoning: model.reasoning },
    }
  })
}

/** One resolution's complete request facts. */
export type ResolvedQoderOptions = QoderConnectionOptions

/**
 * The one explicit resolve step from raw config to validated connection
 * facts. Endpoint overrides and the VPC instance resolve from configuration
 * first, then the trusted environment layers, then the public CN cloud.
 * @param config - raw plugin config or resolved settings snapshot.
 * @param environment - this run's environment layers, or `undefined` outside
 *   the product CLI.
 * @returns validated connection facts plus the credential reference.
 */
export function resolveAdapterOptions(config: Options, environment?: LaunchEnvironmentSnapshot): ResolvedQoderOptions {
  return { ...resolveConnectionOptions(config, environment), machineId: getMachineId(dshHomePath()) }
}

function resolveConnectionOptions(
  config: Options,
  environment?: LaunchEnvironmentSnapshot,
): Omit<ResolvedQoderOptions, 'machineId'> {
  const profile = config.providers?.[PROVIDER]
  if (profile !== undefined) {
    config = {
      apiKeyEnv: profile.apiKeyEnv ?? config.apiKeyEnv,
      vpcInstance: profile.vpcInstance ?? config.vpcInstance,
      baseURL: profile.baseURL ?? config.baseURL,
      openApiUrl: profile.openApiUrl ?? config.openApiUrl,
      maxTokens: profile.maxTokens ?? config.maxTokens,
      defaultContextWindow: profile.defaultContextWindow ?? config.defaultContextWindow,
      models: profile.models ?? config.models,
      streamIdleTimeoutMs: profile.streamIdleTimeoutMs ?? config.streamIdleTimeoutMs,
      retryPolicy: profile.retryPolicy ?? config.retryPolicy,
    }
  }
  if (config.defaultContextWindow !== undefined
    && (!Number.isInteger(config.defaultContextWindow) || config.defaultContextWindow <= 0)) {
    throw new Error('llm-qoder: defaultContextWindow must be a positive integer')
  }
  if (config.maxTokens !== undefined
    && (!Number.isSafeInteger(config.maxTokens) || config.maxTokens <= 0)) {
    throw new Error('llm-qoder: maxTokens must be a positive safe integer')
  }
  const streamIdleTimeoutMs = config.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS
  if (!Number.isFinite(streamIdleTimeoutMs)
    || streamIdleTimeoutMs <= 0
    || streamIdleTimeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(
      `llm-qoder: streamIdleTimeoutMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`,
    )
  }

  const get = (name: string): { value: string } | undefined => environment?.get(name)
  const vpcInstance = config.vpcInstance
    ?? parseVpcInstanceFromEnvironment(get)
  if (vpcInstance !== undefined && vpcInstance !== '' && !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(vpcInstance)) {
    throw new Error('llm-qoder: vpcInstance must be a tenant instance name')
  }
  const endpoints = qoderCnEndpoints(vpcInstance)
  const finalEndpoints = {
    gateway: endpointOverride(config.baseURL, 'baseURL') ?? endpoints.gateway,
    openapi: endpointOverride(config.openApiUrl, 'openApiUrl') ?? endpoints.openapi,
    manage: endpoints.manage,
  }

  return {
    endpoints: finalEndpoints,
    apiKeyEnv: credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV),
    maxTokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
    defaultContextWindow: config.defaultContextWindow ?? DEFAULT_CONTEXT_WINDOW,
    models: resolveModels(config.models),
    streamIdleTimeoutMs,
    retryPolicy: resolveRetryPolicy(config.retryPolicy, 'llm-qoder: retryPolicy'),
  }
}

/**
 * Register the adapter and update its connection snapshot after live configuration commits.
 * @param ctx - Host context providing the LLM registry and optional credentials.
 * @param config - Loader-owned live configuration references.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })
  const settingsNs = ctx.fiber.entry?.options.id ?? NS
  const environment = launchEnvironmentOf(ctx)
  const initial = resolveConnectionOptions(plainOptions(config), environment)
  const machineId = getMachineId(dshHomePath())
  let current = { ...initial, machineId }
  const options = (): ResolvedQoderOptions => current
  ctx.on('internal/config', function (this: Fiber, _raw, next) {
    const raw: unknown = next()
    if (this === ctx.fiber) {
      resolveConnectionOptions(plainOptions(Config(raw as Options)), environment)
    }
    return raw
  })

  const resolveApiKey = async (connection: ResolvedQoderOptions): Promise<string> => {
    const ref = connection.apiKeyEnv
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) {
      const hit = await credentials.resolve(ref)
      if (hit !== undefined) return assertUsableApiKey(hit.value, 'llm-qoder', ref)
    } else {
      const ambient = launchEnvironmentOf(ctx).get(ref)
      if (ambient !== undefined && ambient.value.length > 0) {
        return assertUsableApiKey(ambient.value, 'llm-qoder', ref)
      }
    }
    // QODERCN_PAT is an accepted alias. QODER_API_KEY is accepted only when
    // its value is a PAT (`pt-...`), never an opaque job token or other key.
    const patAlias = launchEnvironmentOf(ctx).get('QODERCN_PAT')
    if (patAlias !== undefined && patAlias.value.length > 0) {
      return assertUsableApiKey(patAlias.value, 'llm-qoder', ref)
    }
    const apiKeyAlias = launchEnvironmentOf(ctx).get('QODER_API_KEY')
    if (apiKeyAlias !== undefined && isQoderPatValue(apiKeyAlias.value)) {
      return assertUsableApiKey(apiKeyAlias.value.trim(), 'llm-qoder', ref)
    }
    throw new LlmError(
      `llm-qoder: no PAT for provider route "${PROVIDER}"; store ${ref} through the credentials`
      + ` service (the web Models page writes it), or export ${ref} in the launching environment`,
      'MISSING_CREDENTIAL',
    )
  }

  const adapter = new QoderAdapter({
    options,
    resolveApiKey,
    resolveAttachments: () => ctx.get('attachments'),
  })
  ctx.llm.registerConfigurableProviders([
    { provider: PROVIDER, displayName: PROVIDER, settingsNs, settingsPath: ['providers', PROVIDER] },
  ])
  const registration = ctx.llm.registerAdapter([PROVIDER], adapter)
  let registeredPolicy = options().retryPolicy
  ctx.on('loader/volatile-update', () => {
    current = { ...resolveConnectionOptions(plainOptions(config), environment), machineId }
    const policy = current.retryPolicy
    if (deepEqualJson(policy, registeredPolicy)) return
    registration.replace([PROVIDER])
    registeredPolicy = policy
  })
}
