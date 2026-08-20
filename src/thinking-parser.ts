/**
 * Fallback reasoning extraction: when the Qoder gateway folds thinking into
 * the visible text channel as HTML-style tags (` thinking` / ` response`,
 * `<thinking>` / `</thinking>`, …), this module splits each content chunk into
 * reasoning and visible-text pieces. The native `delta.reasoning_content`
 * channel is preferred; this only runs when that channel is absent.
 *
 * @module dsh-llm-qoder/thinking-parser
 */

const THINKING_TAG_VARIANTS: Array<{ open: string; close: string }> = [
  { open: '<thinking>', close: '</thinking>' },
  { open: ' thinking', close: ' response' },
  { open: '<reasoning>', close: '</reasoning>' },
  { open: '<thought>', close: '</thought>' },
]

/** One split piece of a content chunk. */
export interface ThinkingPiece {
  kind: 'reasoning' | 'text'
  text: string
}

/**
 * Split one content chunk into reasoning and text pieces. The fallback works
 * on whole chunks; streaming boundaries are handled by the caller keeping
 * piece text until a closing tag arrives.
 * @param chunk - one visible-content delta.
 * @returns alternating text/reasoning pieces in order.
 */
export function splitThinking(chunk: string): ThinkingPiece[] {
  const pieces: ThinkingPiece[] = []
  let cursor = 0
  let currentKind: 'reasoning' | 'text' = 'text'
  let current: string[] = []

  const flush = (kind: ThinkingPiece['kind']): void => {
    const text = current.join('')
    if (text.length > 0) pieces.push({ kind, text })
    current = []
  }

  while (cursor < chunk.length) {
    let matched = false
    for (const variant of THINKING_TAG_VARIANTS) {
      const open = currentKind === 'text' ? variant.open : variant.close
      if (chunk.startsWith(open, cursor)) {
        flush(currentKind)
        currentKind = currentKind === 'text' ? 'reasoning' : 'text'
        cursor += open.length
        matched = true
        break
      }
    }
    if (matched) continue
    current.push(chunk.charAt(cursor))
    cursor++
  }
  flush(currentKind)
  return pieces
}
