import assert from 'node:assert/strict'
import test from 'node:test'
import { ThinkingParser } from '../src/thinking-parser.ts'

function parse(chunks) {
  const parser = new ThinkingParser()
  const pieces = chunks.flatMap(chunk => parser.feed(chunk)).concat(parser.flush())
  return {
    parser,
    text: pieces.filter(piece => piece.kind === 'text').map(piece => piece.text).join(''),
    reasoning: pieces.filter(piece => piece.kind === 'reasoning').map(piece => piece.text).join(''),
  }
}

test('all thinking tags survive every split boundary and single-character streaming', () => {
  for (const tag of ['thinking', 'think', 'reasoning', 'thought']) {
    const input = `before<${tag}>reason</${tag}>\n\nanswer`
    const variants = [[...input]]
    for (let split = 0; split <= input.length; split++) {
      variants.push([input.slice(0, split), input.slice(split)])
    }
    for (const chunks of variants) {
      const result = parse(chunks)
      assert.equal(result.reasoning, 'reason')
      assert.equal(result.text, 'before\n\nanswer')
      assert.equal(result.parser.hasThinking, true)
      assert.equal(result.parser.hasUnclosedThinking, false)
    }
  }
})

test('ordinary English and non-protocol angle brackets remain visible verbatim', () => {
  const input = 'I am thinking about the response. Use <thoughtful> prose, a < b, and </think> literally.'
  const result = parse([...input])
  assert.equal(result.text, input)
  assert.equal(result.reasoning, '')
  assert.equal(result.parser.hasThinking, false)
})

test('only the matching closing tag ends reasoning and multiple sections retain order', () => {
  const result = parse([...'a<think>x</thought>y</think>b<thought>z</thought>c'])
  assert.equal(result.reasoning, 'x</thought>yz')
  assert.equal(result.text, 'abc')
  assert.equal(result.parser.hasUnclosedThinking, false)
})

test('flush retains incomplete tag prefixes in their channel and is idempotent', () => {
  for (const prefix of ['<', '<thi', '<thinking']) {
    const result = parse([...`answer${prefix}`])
    assert.equal(result.text, `answer${prefix}`)
    assert.equal(result.reasoning, '')
    assert.equal(result.parser.hasUnclosedThinking, false)
    assert.deepEqual(result.parser.flush(), [])
  }
  for (const prefix of ['<', '</thi', '</thinking']) {
    const result = parse([...`<thinking>reason${prefix}`])
    assert.equal(result.reasoning, `reason${prefix}`)
    assert.equal(result.text, '')
    assert.equal(result.parser.hasUnclosedThinking, true)
    assert.deepEqual(result.parser.flush(), [])
  }
})
