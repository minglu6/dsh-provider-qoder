/**
 * Incrementally extract tagged reasoning from the visible content channel.
 * Native reasoning is handled separately by the stream translator.
 *
 * @module dsh-llm-qoder/thinking-parser
 */

const THINKING_TAG_VARIANTS = [
  { open: '<thinking>', close: '</thinking>' },
  { open: '<think>', close: '</think>' },
  { open: '<reasoning>', close: '</reasoning>' },
  { open: '<thought>', close: '</thought>' },
]

/** One ordered reasoning or visible-text fragment. */
export interface ThinkingPiece {
  kind: 'reasoning' | 'text'
  text: string
}

/** Retain only a possible tag prefix between chunks, never an entire response. */
export class ThinkingParser {
  private pending = ''
  private closingTag: string | undefined
  private sawThinking = false

  get hasThinking(): boolean {
    return this.sawThinking
  }

  get hasUnclosedThinking(): boolean {
    return this.closingTag !== undefined
  }

  feed(chunk: string): ThinkingPiece[] {
    const input = this.pending + chunk
    this.pending = ''
    const pieces: ThinkingPiece[] = []
    const emit = (text: string): void => {
      if (text.length === 0) return
      const kind = this.closingTag === undefined ? 'text' : 'reasoning'
      const last = pieces[pieces.length - 1]
      if (last?.kind === kind) last.text += text
      else pieces.push({ kind, text })
    }

    let cursor = 0
    while (cursor < input.length) {
      const tagStart = input.indexOf('<', cursor)
      if (tagStart === -1) {
        emit(input.slice(cursor))
        break
      }
      emit(input.slice(cursor, tagStart))
      if (this.closingTag !== undefined) {
        if (input.startsWith(this.closingTag, tagStart)) {
          cursor = tagStart + this.closingTag.length
          this.closingTag = undefined
          continue
        }
      } else {
        const variant = THINKING_TAG_VARIANTS.find(tag => input.startsWith(tag.open, tagStart))
        if (variant) {
          this.closingTag = variant.close
          this.sawThinking = true
          cursor = tagStart + variant.open.length
          continue
        }
      }
      const suffix = input.slice(tagStart)
      const isPrefix = this.closingTag !== undefined
        ? this.closingTag.startsWith(suffix)
        : THINKING_TAG_VARIANTS.some(tag => tag.open.startsWith(suffix))
      if (isPrefix) {
        this.pending = suffix
        break
      }
      emit('<')
      cursor = tagStart + 1
    }
    return pieces
  }

  /** A stream-tail prefix is literal content, not a complete protocol tag. */
  flush(): ThinkingPiece[] {
    if (this.pending.length === 0) return []
    const text = this.pending
    this.pending = ''
    return [{ kind: this.closingTag === undefined ? 'text' : 'reasoning', text }]
  }
}
