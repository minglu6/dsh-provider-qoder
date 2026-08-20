/**
 * Translate Qoder CN inner chunk objects into the harness `StreamChunk`
 * protocol. Reasoning arrives either as `delta.reasoning_content` (native) or
 * embedded in `delta.content` as ` thinking`-style HTML tags (fallback
 * parser). Tool-call arguments are raw JSON strings end-to-end; block indexes
 * follow first-seen stream order. Usage and finish are deferred until the
 * `[DONE]` sentinel so nothing follows `finish`.
 *
 * @module dsh-llm-qoder/translate
 */

import { CallId, EMPTY_RESPONSE_CODE, LlmError } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, FinishReason, StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm'
import { DONE, type QoderEnvelope } from './sse.ts'
import { splitThinking } from './thinking-parser.ts'

/** Inner chunk shape carried inside the SSE envelope body. */
export interface QoderInnerChunk {
  choices?: Array<{
    delta?: {
      reasoning_content?: string
      content?: string
      tool_calls?: Array<{
        index?: number
        id?: string
        function?: { name?: string; arguments?: string }
      }>
    }
    finish_reason?: string
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

/** One open block under assembly. */
interface OpenBlock {
  index: number
  kind: 'text' | 'reasoning' | 'tool-call'
  text: string
  /** tool-call only */
  callId?: string
  name?: string
}

/**
 * Map the Qoder finish_reason vocabulary to the harness FinishReason.
 * @param reason - the wire `finish_reason` string.
 * @returns the mapped reason; unrecognized values become an error finish.
 */
export function mapFinishReason(reason: string): FinishReason {
  switch (reason) {
    case 'stop': return { kind: 'stop' }
    case 'tool_calls': return { kind: 'tool-calls' }
    case 'length': return { kind: 'max-tokens' }
    default:
      return {
        kind: 'error',
        failure: { message: `model stopped: ${reason}`, code: reason.toUpperCase() },
      }
  }
}

/**
 * Map inner usage fields to disjoint harness counts.
 * @param usage - the inner chunk's usage object.
 * @returns the disjoint prompt/output counts (zero-filled).
 */
export function mapUsage(usage: NonNullable<QoderInnerChunk['usage']>): TokenUsage {
  return {
    inputTokens: usage.prompt_tokens ?? 0,
    outputTokens: usage.completion_tokens ?? 0,
  }
}

/** Assemble the final ContentBlock for one open block. */
function closeBlock(block: OpenBlock): ContentBlock {
  switch (block.kind) {
    case 'text': return { type: 'text', text: block.text }
    case 'reasoning': return { type: 'reasoning', text: block.text }
    case 'tool-call': return {
      type: 'tool-call',
      id: CallId(block.callId ?? ''),
      name: block.name ?? '',
      arguments: block.text,
    }
  }
}

/** When the envelope body is an object (not a string), treat it as the inner chunk. */
function parseInnerObject(body: unknown): QoderInnerChunk {
  if (typeof body === 'object' && body !== null && !Array.isArray(body)) {
    // The gateway returns the inner chunk verbatim as an object in some feeds.
    // All chunk fields are optional, so the object is a valid projection.
    return body
  }
  return {}
}

/**
 * Consume decoded envelopes (ending with the `[DONE]` sentinel) and yield
 * StreamChunks. Reasoning, text, and tool-call deltas flow as they arrive;
 * block-ends, usage, and finish are deferred to the sentinel.
 * @param envelopes - decoded SSE envelopes, `[DONE]`-terminated.
 * @param reasoningEnabled - whether thinking is on (enables the tag fallback).
 * @returns the harness chunk stream.
 */
export async function* translate(
  envelopes: AsyncIterable<QoderEnvelope | string>,
  reasoningEnabled = true,
): AsyncGenerator<StreamChunk> {
  let nextIndex = 0
  let textBlock: OpenBlock | undefined
  let reasoningBlock: OpenBlock | undefined
  const toolBlocks = new Map<number, OpenBlock>()
  const order: OpenBlock[] = []
  let pendingFinish: FinishReason | undefined
  let pendingUsage: TokenUsage | undefined

  const open = (kind: OpenBlock['kind']): OpenBlock => {
    const block: OpenBlock = { index: nextIndex++, kind, text: '' }
    order.push(block)
    return block
  }

  for await (const item of envelopes) {
    if (item === DONE) {
      for (const block of order) {
        yield { type: 'block-end', index: block.index, block: closeBlock(block) }
      }
      if (pendingUsage) yield { type: 'usage', usage: pendingUsage }
      const reason = pendingFinish ?? { kind: 'stop' as const }
      yield {
        type: 'finish',
        reason: reason.kind === 'stop' && order.length === 0
          ? {
            kind: 'error',
            failure: { message: 'model returned a completed response with no content', code: EMPTY_RESPONSE_CODE },
          }
          : reason,
      }
      return
    }

    let envelope: QoderEnvelope
    if (typeof item === 'string') {
      envelope = JSON.parse(item) as QoderEnvelope
    } else {
      envelope = item
    }
    if (envelope.statusCodeValue !== 200) {
      throw new LlmError(
        `Qoder upstream status ${envelope.statusCodeValue}: ${String(envelope.body).slice(0, 200)}`,
        'UPSTREAM',
      )
    }

    let inner: QoderInnerChunk
    if (typeof envelope.body === 'string') {
      if (envelope.body === DONE) continue
      try {
        inner = JSON.parse(envelope.body) as QoderInnerChunk
      } catch {
        throw new LlmError(`malformed Qoder inner chunk: ${envelope.body.slice(0, 120)}`, 'MALFORMED_RESPONSE')
      }
    } else {
      inner = parseInnerObject(envelope.body)
    }

    for (const choice of inner.choices ?? []) {
      const delta = choice.delta

      // Native reasoning channel first.
      const reasoning = delta?.reasoning_content
      if (typeof reasoning === 'string' && reasoning.length > 0) {
        if (!reasoningBlock) {
          reasoningBlock = open('reasoning')
          yield { type: 'block-start', index: reasoningBlock.index, blockType: 'reasoning' }
        }
        reasoningBlock.text += reasoning
        yield { type: 'reasoning-delta', index: reasoningBlock.index, text: reasoning }
      }

      const content = delta?.content
      if (typeof content === 'string' && content.length > 0) {
        if (reasoningEnabled) {
          const pieces = splitThinking(content)
          for (const piece of pieces) {
            if (piece.kind === 'reasoning') {
              if (!reasoningBlock) {
                reasoningBlock = open('reasoning')
                yield { type: 'block-start', index: reasoningBlock.index, blockType: 'reasoning' }
              }
              reasoningBlock.text += piece.text
              yield { type: 'reasoning-delta', index: reasoningBlock.index, text: piece.text }
            } else {
              if (!textBlock) {
                textBlock = open('text')
                yield { type: 'block-start', index: textBlock.index, blockType: 'text' }
              }
              textBlock.text += piece.text
              yield { type: 'text-delta', index: textBlock.index, text: piece.text }
            }
          }
        } else {
          if (!textBlock) {
            textBlock = open('text')
            yield { type: 'block-start', index: textBlock.index, blockType: 'text' }
          }
          textBlock.text += content
          yield { type: 'text-delta', index: textBlock.index, text: content }
        }
      }

      for (const call of delta?.tool_calls ?? []) {
        const index = call.index ?? 0
        let block = toolBlocks.get(index)
        if (!block) {
          block = open('tool-call')
          toolBlocks.set(index, block)
          yield { type: 'block-start', index: block.index, blockType: 'tool-call' }
        }
        if (call.id !== undefined) block.callId = call.id
        if (call.function?.name !== undefined) block.name = call.function.name
        const fragment = call.function?.arguments ?? ''
        block.text += fragment
        yield {
          type: 'tool-call-delta',
          index: block.index,
          id: CallId(block.callId ?? ''),
          ...block.name !== undefined ? { name: block.name } : {},
          argumentsDelta: fragment,
        }
      }

      if (typeof choice.finish_reason === 'string') {
        pendingFinish = mapFinishReason(choice.finish_reason)
      }
    }

    if (inner.usage) pendingUsage = mapUsage(inner.usage)
  }

  // parseQoderSse guarantees the [DONE] sentinel (or throws); reaching here
  // means the envelope source violated that contract.
  throw new LlmError('Qoder SSE payload stream ended without [DONE]', 'STREAM_CLOSED')
}
