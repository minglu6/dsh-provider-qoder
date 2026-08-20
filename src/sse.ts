/**
 * Qoder CN SSE transport: the agent_chat_generation endpoint streams
 * `data:` lines, each carrying a JSON envelope `{statusCodeValue, body}`
 * whose `body` is a JSON **string** with an OpenAI-style chunk
 * (`{choices:[...]}`) — a double-enveloped frame. The terminal payload is the
 * literal `[DONE]`. This module frames the byte stream into payload strings
 * and decodes the envelope, so the translator only sees inner chunk objects.
 *
 * @module dsh-llm-qoder/sse
 */

import { LlmError } from '@deepseek-ai/dsh-llm'

/** The terminal payload Qoder sends after the last chunk. */
export const DONE = '[DONE]'

/** One decoded SSE payload: the inner chunk object, or null for heartbeats. */
export interface QoderEnvelope {
  /** Upstream HTTP status carried in-band by the gateway. */
  statusCodeValue: number
  /** Inner chunk JSON (parsed), or the literal `[DONE]`. */
  body: unknown
}

/**
 * Decode one SSE `data:` line into the envelope. Non-`data` fields and
 * heartbeat payloads are dropped by the caller.
 * @param data - the trimmed `data:` payload.
 * @returns the parsed envelope.
 * @throws LlmError `MALFORMED_RESPONSE` when the payload is not envelope JSON.
 */
export function parseEnvelope(data: string): QoderEnvelope {
  try {
    const parsed = JSON.parse(data) as { statusCodeValue?: unknown; body?: unknown }
    const statusCodeValue = typeof parsed.statusCodeValue === 'number'
      ? parsed.statusCodeValue
      : 200
    return { statusCodeValue, body: parsed.body }
  } catch {
    throw new LlmError(`malformed Qoder SSE envelope: ${data.slice(0, 120)}`, 'MALFORMED_RESPONSE')
  }
}

/**
 * Frame a Qoder SSE byte stream into envelope payloads. Each event's
 * `data` field is a double-enveloped JSON payload. A literal `[DONE]` ends
 * the feed; a clean EOF after at least one data payload is treated as the
 * same terminal (the public CN gateway often closes without the sentinel).
 * An empty feed raises `LlmError('STREAM_CLOSED')`.
 * @param stream - raw SSE bytes; reads may split anywhere.
 * @returns each event's data payload in arrival order, `[DONE]` last.
 */
export async function* parseQoderSse(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let sawPayload = false
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let lineEnd = buffer.indexOf('\n')
      while (lineEnd !== -1) {
        const line = buffer.slice(0, lineEnd).replace(/\r$/, '').trim()
        buffer = buffer.slice(lineEnd + 1)
        if (line.startsWith('data:')) {
          const payload = line.slice(5).trim()
          sawPayload = true
          yield payload
          if (payload === DONE) return
        }
        lineEnd = buffer.indexOf('\n')
      }
    }
    // Trailing payload without a newline still counts (Qoder's final line
    // is `data: [DONE]` without a blank-line terminator in observed feeds).
    const tail = buffer.replace(/\r$/, '').trim()
    if (tail.startsWith('data:')) {
      const payload = tail.slice(5).trim()
      sawPayload = true
      yield payload
      if (payload === DONE) return
    }
  } finally {
    reader.releaseLock()
  }
  if (sawPayload) {
    yield DONE
    return
  }
  throw new LlmError('Qoder SSE stream ended without [DONE]', 'STREAM_CLOSED')
}
