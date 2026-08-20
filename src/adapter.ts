/**
 * `QoderAdapter`: COSY-signed, WAF-encoded streaming against the Qoder CN
 * agent_chat_generation endpoint, emitting harness StreamChunks. The adapter
 * is transport + auth only: endpoint facts arrive through a thunk resolved
 * once per operation, the PAT through a per-request resolver, and the job
 * token / identity through process-local caches keyed by the PAT, so the
 * registering plugin owns validation, layering, and credential policy.
 *
 * @module dsh-llm-qoder/adapter
 */

import crypto from 'node:crypto'
import { attributionHeaders, CONTEXT_WINDOW_EXCEEDED_CODE, isContextWindowExceededError, isQuotaExceededError, LlmAdapter, LlmError, QUOTA_EXCEEDED_CODE, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type {
  GenerateOptions,
  LlmModelInfo,
  LlmProviderInfo,
  LlmResolvedModelInfo,
  ResolvedRetryPolicy,
  StreamChunk,
} from '@deepseek-ai/dsh-llm'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import { idleWatchdog, timeoutOf } from '@deepseek-ai/dsh-timeout'
import { buildQoderAuthHeaders, getQoderCNDirectModel, qoderChatUrl, type CosyCredentials, type QoderCnEndpoints } from './cosy.ts'
import { qoderEncodeBody } from './qoder-encoding.ts'
import { exchangeJobToken, fetchUserInfo, refreshJobToken, type QoderJobTokenSession } from './pat.ts'
import { serializeMessages, transformTools, lastUserText } from './serialize.ts'
import { parseQoderSse, DONE, parseEnvelope } from './sse.ts'
import { translate } from './translate.ts'

/** One catalog model entry advertised by the adapter. */
export interface QoderCatalogModel {
  /** Deployment-facing model id (e.g. `deepseek-v4-pro`). */
  id: string
  /** Selector label; defaults to {@link id}. */
  name?: string
  /** Optional selector detail. */
  description?: string
  /** Known combined request/response context capacity. */
  contextWindow?: number
  /** Per-request output cap; omission falls back to the connection default. */
  maxTokens?: number
  /** Accepted request modalities; absent means text. */
  inputModalities?: ('text' | 'image')[]
  /** Whether the wire model is a reasoning model (thinking enabled). */
  reasoning?: boolean
}

/** Validated connection facts for one operation. */
export interface QoderConnectionOptions {
  /** Resolved CN endpoints (public or VPC-derived). */
  endpoints: QoderCnEndpoints
  /** Credential reference resolved per request. */
  apiKeyEnv: CredentialRef
  /** Default per-request output cap. */
  maxTokens: number
  /** Positive context capacity used when the selected model has no exact value. */
  defaultContextWindow: number
  /** Advisory models exposed to discovery consumers; requests remain unrestricted. */
  models: readonly QoderCatalogModel[]
  /** Maximum provider idle time while one stream read is outstanding. */
  streamIdleTimeoutMs: number
  /** Provider-owned model-request retry policy, already resolved. */
  retryPolicy: ResolvedRetryPolicy
  /** Machine id shared with the qodercli/pi installs, generated once under the harness home. */
  machineId: string
}

/** Constructor options for {@link QoderAdapter}. */
export interface QoderAdapterOptions {
  /** Current validated connection facts; called once per operation. */
  options: () => QoderConnectionOptions
  /**
   * Resolve the Qoder CN PAT for one request. Throws `LlmError`
   * `MISSING_CREDENTIAL` when no key is available anywhere.
   */
  resolveApiKey: (connection: QoderConnectionOptions) => Promise<string>
  /** Durable byte resolver for image references, when the seam is mounted. */
  resolveAttachments: () => AttachmentStore | undefined
}

/** Default maximum idle interval while an adapter stream read is outstanding. */
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300_000
/** Default combined request/response context capacity. */
export const DEFAULT_CONTEXT_WINDOW = 1_000_000
/** Default per-request output-token cap. */
export const DEFAULT_MAX_TOKENS = 32_768
const STREAM_IDLE_TIMEOUT_CODE = 'LLM_STREAM_IDLE_TIMEOUT'

const OFF_REASONING_EFFORT = ReasoningEffortId('off')
const HIGH_REASONING_EFFORT = ReasoningEffortId('high')
const MAX_REASONING_EFFORT = ReasoningEffortId('max')
const REASONING_EFFORTS = [
  { id: OFF_REASONING_EFFORT, name: 'Off' },
  { id: HIGH_REASONING_EFFORT, name: 'High' },
  { id: MAX_REASONING_EFFORT, name: 'Max' },
] as const

/** Process-local job-token cache keyed by PAT hash, so one exchange per PAT per process. */
const jobTokenCache = new Map<string, QoderJobTokenSession>()
/** Process-local identity cache keyed by PAT hash. */
const identityCache = new Map<string, { userID: string; email: string; name: string }>()

function hashCredential(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

/**
 * Map an HTTP status to a stable LlmError code.
 * @param status - status of a non-2xx provider response.
 * @param detail - provider error body text, when available.
 * @returns the normalized harness error code.
 */
export function httpErrorCode(status: number, detail: string): string {
  if (status === 401 || status === 403) return 'AUTH'
  if (isQuotaExceededError(detail)) return QUOTA_EXCEEDED_CODE
  if (status === 429) return 'RATE_LIMIT'
  if (status === 400) {
    if (isContextWindowExceededError(detail)) return CONTEXT_WINDOW_EXCEEDED_CODE
    return 'INVALID_REQUEST'
  }
  if (status >= 500) return 'SERVER'
  return `HTTP_${status}`
}

function modelInfo(provider: string, model: QoderCatalogModel): LlmModelInfo {
  return {
    provider,
    id: model.id,
    name: model.name ?? model.id,
    ...model.description === undefined ? {} : { description: model.description },
    ...model.inputModalities === undefined ? {} : { inputModalities: model.inputModalities },
  }
}

/**
 * The Qoder CN `LlmAdapter`. One instance serves every model name it was
 * registered under; the deployment-facing model id maps to the wire key at
 * request time.
 */
export class QoderAdapter extends LlmAdapter {
  constructor(private readonly config: QoderAdapterOptions) {
    super()
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: provider }
  }

  override providerRetryPolicy(_provider: string): ResolvedRetryPolicy {
    return this.config.options().retryPolicy
  }

  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve(this.config.options().models.map(model => modelInfo(provider, model)))
  }

  override resolveModel(
    provider: string,
    model: string,
    _signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo> {
    const connection = this.config.options()
    const configured = connection.models.find(entry => entry.id === model)
    const contextWindow = configured?.contextWindow ?? connection.defaultContextWindow
    const reasoning = configured?.reasoning === true
    return Promise.resolve({
      ...configured === undefined
        ? { provider, id: model, name: model, inputModalities: ['text' as const] }
        : modelInfo(provider, configured),
      context: { contextWindow },
      defaultMaxTokens: configured?.maxTokens ?? connection.maxTokens,
      ...reasoning
        ? {
          reasoning: {
            efforts: REASONING_EFFORTS,
            defaultEffort: OFF_REASONING_EFFORT,
          },
        }
        : {},
    })
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const connection = this.config.options()
    const rawPat = await this.config.resolveApiKey(connection)
    const consumer = new AbortController()
    const upstream = options.signal === undefined
      ? consumer.signal
      : AbortSignal.any([options.signal, consumer.signal])
    using watchdog = idleWatchdog(upstream, connection.streamIdleTimeoutMs, STREAM_IDLE_TIMEOUT_CODE)
    const iterator = this.request(
      options,
      watchdog.signal,
      connection,
      rawPat,
      () => { watchdog.pulse() },
    )[Symbol.asyncIterator]()
    let exhausted = false
    try {
      while (true) {
        const result = await watchdog.next(iterator)
        if (result.done) {
          exhausted = true
          return
        }
        yield result.value
      }
    } catch (error: unknown) {
      if (timeoutOf(watchdog.signal, STREAM_IDLE_TIMEOUT_CODE) !== undefined) {
        throw new LlmError(
          `Qoder CN stream idle timeout after ${connection.streamIdleTimeoutMs}ms`,
          'TIMEOUT',
          { cause: error },
        )
      }
      if (options.signal?.aborted) {
        throw new LlmError('Qoder CN request aborted by caller', 'ABORTED', { cause: error })
      }
      if (error instanceof LlmError) throw error
      throw new LlmError('Qoder CN API stream failed', 'TRANSPORT', { cause: error })
    } finally {
      consumer.abort('Qoder CN stream consumer stopped')
      if (!exhausted && iterator.return !== undefined) {
        try {
          await iterator.return()
        } catch (_abortedTransportTeardown) {
          // The consumer controller already owns termination.
        }
      }
    }
  }

  private async * request(
    options: GenerateOptions,
    signal: AbortSignal,
    connection: QoderConnectionOptions,
    rawPat: string,
    onComment: () => void,
  ): AsyncIterable<StreamChunk> {
    // 1. PAT → job token (cached; refreshed through the jrt when expired).
    const jobToken = await this.ensureJobToken(rawPat, connection.endpoints)
    // 2. Identity (userID required by the COSY envelope).
    const identity = await this.ensureIdentity(rawPat, jobToken, connection.endpoints)
    const machineId = connection.machineId

    // 3. Serialize messages + build the wire body.
    const qoderModel = getQoderCNDirectModel(options.model)
    const attachments = this.config.resolveAttachments()
    const messages = await serializeMessages(options, attachments)
    const tools = transformTools(options)
    const system = options.system ?? ''
    const originalContent = lastUserText(options.messages)

    const requestId = crypto.randomUUID()
    const sessionID = crypto
      .createHash('sha256')
      .update(`qoder-session\0${identity.userID}\0${qoderModel}`)
      .digest('hex').slice(0, 16)
    const recordID = stableChatRecordID(qoderModel, options)
    const maxTokens = options.maxTokens ?? connection.maxTokens
    const reasoningEnabled = options.reasoningEffort !== undefined && options.reasoningEffort !== 'off'

    const reqBody: Record<string, unknown> = {
      request_id: requestId,
      request_set_id: recordID,
      chat_record_id: recordID,
      session_id: sessionID,
      stream: true,
      chat_task: 'FREE_INPUT',
      is_reply: true,
      is_retry: false,
      source: 1,
      version: '3',
      session_type: 'qodercli',
      agent_id: 'agent_common',
      task_id: 'common',
      code_language: '',
      chat_prompt: '',
      image_urls: null,
      aliyun_user_type: '',
      system,
      messages,
      tools: tools ?? [],
      parameters: {
        max_tokens: maxTokens,
        ...reasoningEnabled ? { reasoning_effort: options.reasoningEffort } : {},
      },
      chat_context: {
        chatPrompt: '',
        imageUrls: null,
        extra: {
          context: [],
          modelConfig: {
            key: qoderModel,
            is_reasoning: reasoningEnabled,
          },
          originalContent,
        },
        features: [],
        text: originalContent,
      },
      model_config: {
        key: qoderModel,
        is_reasoning: reasoningEnabled,
        max_output_tokens: maxTokens,
        source: 'system',
      },
      business: {
        product: 'cli',
        version: '1.0.0',
        type: 'agent',
        stage: 'start',
        id: crypto.randomUUID(),
        name: originalContent.substring(0, 30),
        begin_at: Date.now(),
      },
    }

    // 4. WAF-encode + COSY-sign.
    const bodyBytes = Buffer.from(JSON.stringify(reqBody))
    const encodedBody = qoderEncodeBody(bodyBytes)
    const encodedBytes = Buffer.from(encodedBody, 'utf8')
    const chatURL = qoderChatUrl(connection.endpoints)
    const cosyCreds: CosyCredentials = {
      userID: identity.userID,
      authToken: jobToken,
      name: identity.name,
      email: identity.email,
      machineID: machineId,
    }
    const headers = buildQoderAuthHeaders(encodedBytes, chatURL, cosyCreds)

    // 5. POST and stream.
    let response: Response
    try {
      response = await fetch(chatURL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Accept-Encoding': 'identity',
          'X-Model-Key': qoderModel,
          'X-Model-Source': 'system',
          ...headers,
          ...attributionHeaders(),
        },
        body: encodedBytes,
        signal,
      })
    } catch (error: unknown) {
      if (signal.aborted) throw error
      throw new LlmError(
        `Qoder CN API request to ${chatURL} failed`,
        'TRANSPORT',
        { cause: error },
      )
    }

    if (!response.ok) {
      let message = `Qoder CN API error (HTTP ${response.status})`
      let bodyText = ''
      try {
        bodyText = await response.text()
        if (bodyText.length > 0) message = bodyText.slice(0, 200)
      } catch {
        // Only swallow error-body parsing: the HTTP status still identifies the failure.
      }
      throw new LlmError(message, httpErrorCode(response.status, bodyText), {
        status: response.status,
      })
    }
    if (!response.body) {
      throw new LlmError('Qoder CN API returned no response body', 'EMPTY_RESPONSE')
    }

    const envelopes = parseQoderSse(response.body)
    // Feed the translator with decoded envelopes; the translator owns the
    // envelope → chunk mapping and the [DONE] flush.
    yield* translate(mapEnvelopes(envelopes, onComment), reasoningEnabled)
  }

  /** Exchange or refresh the job token for one PAT, caching per process. */
  private async ensureJobToken(
    rawPat: string,
    endpoints: QoderCnEndpoints,
  ): Promise<string> {
    const key = hashCredential(rawPat)
    const cached = jobTokenCache.get(key)
    if (cached !== undefined && cached.expiresAt > Date.now() + 5 * 60 * 1000) {
      return cached.jobToken
    }
    if (cached !== undefined && cached.jobRefreshToken.length > 0) {
      try {
        const refreshed = await refreshJobToken(cached.jobRefreshToken, endpoints)
        jobTokenCache.set(key, refreshed)
        return refreshed.jobToken
      } catch {
        // Fall through to a fresh PAT exchange.
      }
    }
    try {
      const exchanged = await exchangeJobToken(rawPat, endpoints)
      jobTokenCache.set(key, exchanged)
      return exchanged.jobToken
    } catch (error: unknown) {
      // A rejected exchange is a credential problem (bad PAT, wrong tenant
      // host) or a transport problem (endpoint unreachable). Only the former
      // is AUTH; transport errors surface as-is so the outer stream() maps
      // them to TRANSPORT and retry policy can treat them as transient.
      if (error instanceof Error && /failed:\s*\d{3}/.test(error.message)) {
        throw new LlmError(
          `Qoder CN PAT exchange failed: ${error.message}`,
          'AUTH',
          { cause: error },
        )
      }
      throw error
    }
  }

  /** Resolve the server identity for one PAT, caching per process. */
  private async ensureIdentity(
    rawPat: string,
    jobToken: string,
    endpoints: QoderCnEndpoints,
  ): Promise<{ userID: string; email: string; name: string }> {
    const key = hashCredential(rawPat)
    const cached = identityCache.get(key)
    if (cached?.userID) return cached
    const info = await fetchUserInfo(jobToken, endpoints)
    if (!info.userID) {
      throw new LlmError(
        'Qoder CN identity unavailable: /userinfo did not return a userID. Check the PAT and VPC routing (QODER_VPC_INSTANCE), then retry.',
        'AUTH',
      )
    }
    const resolved = {
      userID: info.userID,
      email: info.email || 'user@qoder.com.cn',
      name: info.name || 'Qoder CN User',
    }
    identityCache.set(key, resolved)
    return resolved
  }
}

/** Stable chat-record id for one request (session continuity on the gateway). */
function stableChatRecordID(model: string, options: GenerateOptions): string {
  const hash = crypto.createHash('sha256')
  hash.update('qoder-record')
  hash.update('\0')
  hash.update(model)
  for (const msg of options.messages) {
    hash.update('\0')
    hash.update(msg.role)
    for (const block of msg.content) {
      hash.update('\0')
      hash.update(block.type)
      if (block.type === 'text' || block.type === 'reasoning') hash.update(block.text)
      if (block.type === 'tool-call') {
        hash.update(block.name)
        hash.update(block.arguments)
      }
      if (block.type === 'tool-result') {
        hash.update(block.toolCallId)
      }
    }
  }
  if (options.system !== undefined) {
    hash.update('\0')
    hash.update(options.system)
  }
  hash.update('\0')
  hash.update(`mt=${options.maxTokens ?? 'default'}`)
  return hash.digest('hex').slice(0, 16)
}

/** Decode envelope payload strings into envelope objects, pulsing transport activity. */
async function* mapEnvelopes(
  payloads: AsyncIterable<string>,
  onComment: () => void,
): AsyncGenerator<ReturnType<typeof parseEnvelope> | string> {
  for await (const payload of payloads) {
    onComment()
    if (payload === DONE) {
      /* v8 ignore start -- v8 attributes this async-generator yield to the consumer */
      yield DONE
      return
      /* v8 ignore stop */
    }
    yield parseEnvelope(payload)
  }
}
