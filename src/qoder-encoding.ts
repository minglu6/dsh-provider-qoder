/**
 * Qoder WAF-bypass body encoder: standard base64 is rearranged in thirds and
 * its alphabet permuted before the bytes reach the gateway (`Encode=1`).
 * Ported verbatim from `pi-provider-qoder`; the two alphabets are wire facts
 * of the qodercli client and must not be "improved".
 *
 * @module dsh-llm-qoder/qoder-encoding
 */

const qoderCustomAlphabet = '_doRTgHZBKcGVjlvpC,@aFSx#DPuNJme&i*MzLOEn)sUrthbf%Y^w.(kIQyXqWA!'
const qoderStdAlphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/**
 * Encode a JSON request body for the WAF-protected chat endpoint.
 * @param plaintext - the UTF-8 request body (string or bytes).
 * @returns the encoded string sent as the request body.
 */
export function qoderEncodeBody(plaintext: string | Buffer): string {
  const std = Buffer.isBuffer(plaintext) ? plaintext.toString('base64') : Buffer.from(plaintext).toString('base64')
  const n = std.length
  const a = Math.floor(n / 3)
  const rearranged = std.slice(n - a) + std.slice(a, n - a) + std.slice(0, a)
  let out = ''
  for (let i = 0; i < n; i++) {
    const c = rearranged[i] as string
    if (c === '=') {
      out += '$'
    } else {
      const idx = qoderStdAlphabet.indexOf(c)
      /* v8 ignore next -- input is always standard base64, so every char is in the alphabet */
      out += idx >= 0 ? qoderCustomAlphabet[idx] as string : c
    }
  }
  return out
}
