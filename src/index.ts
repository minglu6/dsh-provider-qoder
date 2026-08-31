/**
 * Register a {@link QoderAdapter} for the `qoder-cn` provider route on
 * `ctx.llm`. Connection facts resolve per request instead of freezing at load:
 * the plugin layers its `cordis.yml` entry config under the optional
 * `llm-qoder` user-settings section (`ctx.settings`) and resolves the Qoder CN
 * PAT through the optional credential seam (`ctx.credentials`), so a changed
 * endpoint, VPC instance, or key reaches the very next request without
 * restarting anything, while an in-flight stream keeps the facts it started
 * with.
 * @module dsh-provider-qoder
 */

import type { Context } from '@deepseek-ai/cordis'
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
export { buildQoderAuthHeaders, qoderCnEndpoints, getQoderCNDirectModel } from './cosy.ts'
export { exchangeJobToken, refreshJobToken, fetchUserInfo } from './pat.ts'

export const name = 'llm-qoder'
export const inject = ['llm']

const NS = 'llm-qoder'
const DEFAULT_API_KEY_ENV = 'QODERCN_PERSONAL_ACCESS_TOKEN'
/** The single provider route this plugin owns. */
const PROVIDER = 'qoder-cn'

/**
 * Plugin config, validated by the same-named schemastery schema and doubling
 * as the `llm-qoder` settings-section shape. Every field is optional in yml:
 * a missing PAT resolves through {@link Config.apiKeyEnv} at each request (a
 * request without any key fails with `MISSING_CREDENTIAL`, not at plugin
 * load), and omitted endpoint facts use the public CN cloud.
 */
export interface Config {
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
  providers?: Record<string, Omit<Config, 'providers'>>
}

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
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  vpcInstance: z.string(),
  baseURL: z.string(),
  openApiUrl: z.string(),
  maxTokens: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_MAX_TOKENS),
  defaultContextWindow: z.number().step(1).min(1).default(DEFAULT_CONTEXT_WINDOW),
  // Schemastery arrays otherwise materialize [], which would disable live discovery.
  models: z.array(catalogModel).default(undefined as never),
  streamIdleTimeoutMs: z.number().min(Number.MIN_VALUE).max(MAX_TIMER_DELAY_MS).default(DEFAULT_STREAM_IDLE_TIMEOUT_MS),
  retryPolicy: RetryPolicySchema,
}

export const Config: z<Config> = z.object({
  apiKeyEnv: connectionFields.apiKeyEnv,
  vpcInstance: connectionFields.vpcInstance,
  baseURL: connectionFields.baseURL,
  openApiUrl: connectionFields.openApiUrl,
  maxTokens: connectionFields.maxTokens,
  defaultContextWindow: connectionFields.defaultContextWindow,
  models: connectionFields.models,
  streamIdleTimeoutMs: connectionFields.streamIdleTimeoutMs,
  retryPolicy: connectionFields.retryPolicy,
  providers: z.dict(z.object(connectionFields)),
})

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
export function resolveAdapterOptions(config: Config, environment?: LaunchEnvironmentSnapshot): ResolvedQoderOptions {
  const profile = config.providers?.[PROVIDER]
  if (profile !== undefined) {
    config = { ...config, ...profile }
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
  const endpoints = qoderCnEndpoints(vpcInstance)
  const finalEndpoints = {
    gateway: config.baseURL?.replace(/\/+$/, '') ?? endpoints.gateway,
    openapi: config.openApiUrl?.replace(/\/+$/, '') ?? endpoints.openapi,
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
    machineId: getMachineId(dshHomePath()),
  }
}

export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  let lastRaw: Config | undefined
  let lastGood: ResolvedQoderOptions | undefined
  const options = (): ResolvedQoderOptions => {
    const raw = current()
    if (raw === lastRaw && lastGood !== undefined) return lastGood
    try {
      const next = resolveAdapterOptions(raw, launchEnvironmentOf(ctx))
      lastRaw = raw
      lastGood = next
      return next
    } catch (error) {
      // Static composition resolves before anything registers, so this branch
      // only sees a live settings snapshot failing a beyond-schema bound:
      // keep serving the last good facts and say so once per bad snapshot.
      if (lastGood === undefined) throw error
      lastRaw = raw
      ctx.logger.error('llm-qoder: keeping the last good configuration after an invalid settings section')
      ctx.logger.error(error)
      return lastGood
    }
  }
  options()

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
    { provider: PROVIDER, displayName: PROVIDER, settingsNs: NS, settingsPath: ['providers', PROVIDER] },
  ])
  const registration = ctx.llm.registerAdapter([PROVIDER], adapter)
  let registeredPolicy = options().retryPolicy
  const ensureRegistrationFacts = (): void => {
    const policy = options().retryPolicy
    if (deepEqualJson(policy, registeredPolicy)) return
    registration.replace([PROVIDER])
    registeredPolicy = policy
  }

  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, NS, Config, config, {
      setSource: (source) => {
        current = source
      },
      onChange: ensureRegistrationFacts,
    })
  })
}
