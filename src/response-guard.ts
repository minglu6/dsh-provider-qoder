import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'

/** Only the unsolicited conversation-checkpoint scaffold is rejected, not XML in general. */
export function isConversationCheckpoint(text: string): boolean {
  const match = /^\s*<analysis>[\s\S]*?<\/analysis>[\s>]*<summary>([\s\S]*)$/i.exec(text)
  const body = match?.[1]
  if (body === undefined) return false
  const closing = body.toLowerCase().indexOf('</summary>')
  if (closing !== -1 && body.slice(closing + '</summary>'.length).trim()) return false
  const summary = closing === -1 ? body : body.slice(0, closing)
  const headings = [
    /Primary Request and Intent|主要请求与意图/i,
    /Key Technical Concepts|关键技术概念/i,
    /Files and Code(?: Sections)?|文件与代码段/i,
    /All User Messages|所有用户消息/i,
    /Pending Tasks|Pending Jobs|待办任务/i,
    /Current Work|当前工作/i,
    /Optional Next Step|Next Step|可选的下一步/i,
  ]
  return headings.filter(heading => heading.test(summary)).length >= 3
}

function requestsSummary(options: GenerateOptions): boolean {
  for (let i = options.messages.length - 1; i >= 0; i--) {
    const message = options.messages[i]
    if (message === undefined || message.role !== 'user'
      || (message.source !== undefined && message.source.kind !== 'user')) continue
    const text = message.content.filter(block => block.type === 'text').map(block => block.text).join('')
    return /\b(?:summari[sz]e|recap|compact|handoff|handover)\b|\b(?:write|provide|give|create|produce|output)\b[^\n]{0,40}\bsummary\b|(?:请|帮我|麻烦)?(?:总结|概括|汇总|压缩)(?:一下|这|本|当前|对话|会话|此前)|(?:输出|生成|提供|给我|写)[^\n]{0,30}(?:summary|摘要|总结)/i.test(text)
  }
  return false
}

/**
 * Hold undecided prefixes until ordinary text or a tool call proves the output
 * is not a checkpoint. Auxiliary host requests and requested summaries bypass
 * this guard, even when compaction reuses the conversation's tool declarations.
 * A rejected generation gets one fresh-session retry; tools are never executed here.
 */
export async function* recoverCheckpoint(
  createAttempt: (recovery: boolean) => AsyncIterable<StreamChunk>,
  options: GenerateOptions,
): AsyncGenerator<StreamChunk> {
  if (options.purpose !== undefined || requestsSummary(options)) {
    yield* createAttempt(false)
    return
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    options.signal?.throwIfAborted()
    const pending: StreamChunk[] = []
    let text = ''
    let released = false
    let finish: Extract<StreamChunk, { type: 'finish' }> | undefined
    try {
      for await (const chunk of createAttempt(attempt > 0)) {
        if (released) {
          yield chunk
          continue
        }
        pending.push(chunk)
        if (chunk.type === 'finish') finish = chunk
        if (chunk.type === 'text-delta') text += chunk.text
        const prefix = text.trimStart().toLowerCase()
        if ((chunk.type === 'block-start' && chunk.blockType === 'tool-call')
          || (chunk.type === 'text-delta' && !'<analysis>'.startsWith(prefix) && !prefix.startsWith('<analysis>'))) {
          yield* pending
          pending.length = 0
          released = true
        }
      }
    } catch (error: unknown) {
      // Never leak a rejected checkpoint on transport failure or cancellation.
      if (!released && !options.signal?.aborted && !isConversationCheckpoint(text)) yield* pending
      throw error
    }
    if (released) return
    options.signal?.throwIfAborted()
    if (isConversationCheckpoint(text)) {
      if (finish?.reason.kind === 'error' || finish?.reason.kind === 'aborted') {
        yield finish
        return
      }
      if (attempt === 0) continue
      yield {
        type: 'finish',
        reason: {
          kind: 'error',
          failure: {
            code: 'QODER_UNEXPECTED_SUMMARY',
            message: 'Qoder returned an unsolicited conversation checkpoint after one recovery attempt. No answer or tool call was accepted. Retry in a new session or switch models.',
          },
        },
      }
      return
    }
    yield* pending
    return
  }
}
