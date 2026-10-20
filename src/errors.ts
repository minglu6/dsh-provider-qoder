/**
 * Shared HTTP-status classification for Qoder CN failures.
 *
 * One classifier serves every surface that turns a Qoder CN HTTP status into
 * a stable `LlmError` code — the chat HTTP path, the model-listing path, and
 * the in-band SSE envelope path — so they all agree that 401/403 means `AUTH`
 * and auth-classified failures can drive job-token invalidation and retry.
 *
 * @module dsh-llm-qoder/errors
 */

import {
  CONTEXT_WINDOW_EXCEEDED_CODE,
  isContextWindowExceededError,
  isQuotaExceededError,
  QUOTA_EXCEEDED_CODE,
} from '@deepseek-ai/dsh-llm'

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

/**
 * Whether an HTTP status marks the credential or job-token session as
 * rejected by the gateway (401/403, including Qoder's in-band
 * `403 {"code":"105","message":"Login expired"}` envelopes).
 * @param status - a provider HTTP status, when known.
 * @returns true when the status identifies an auth-expired session.
 */
export function isAuthExpiredStatus(status: number | undefined): boolean {
  return status === 401 || status === 403
}
