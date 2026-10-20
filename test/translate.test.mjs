import assert from 'node:assert/strict'
import test from 'node:test'
import { translate } from '../src/translate.ts'
import { EMPTY_RESPONSE_CODE } from '@deepseek-ai/dsh-llm'
import { DONE } from '../src/sse.ts'

async function translated(deltas, finishReason = 'stop') {
  async function* envelopes() {
    for (const delta of deltas) {
      yield { statusCodeValue: 200, body: { choices: [{ delta }] } }
    }
    if (finishReason !== null) {
      yield { statusCodeValue: 200, body: { choices: [{ finish_reason: finishReason }] } }
    }
    yield { statusCodeValue: 200, body: { usage: { prompt_tokens: 3, completion_tokens: 7 } } }
    yield DONE
  }
  const chunks = []
  for await (const chunk of translate(envelopes())) chunks.push(chunk)
  assert.equal(chunks.at(-1)?.type, 'finish')
  assert.equal(chunks.filter(chunk => chunk.type === 'finish').length, 1)
  return {
    chunks,
    blocks: chunks.filter(chunk => chunk.type === 'block-end').map(chunk => chunk.block),
    reason: chunks.at(-1).reason,
  }
}

const contentDeltas = chunks => chunks.map(content => ({ content }))
const structuredTool = {
  tool_calls: [{ index: 0, id: 'call-1', function: { name: 'lookup', arguments: '{"query":"qoder"}' } }],
}

async function failure(status, body) {
  async function* envelopes() {
    yield { statusCodeValue: status, body }
  }
  for await (const chunk of translate(envelopes())) {
    assert.fail(`Unexpected successful chunk: ${chunk.type}`)
  }
}

test('nested provider failures expose the actionable message and gateway request ID', async () => {
  const message = "Messages with role 'tool' must be a response to a preceding message with 'tool_calls'"
  const body = {
    code: 'provider_error',
    message: 'Error in upstream response',
    request_id: '27af492d-72af-4b35-a7ef-085a7a405b8d',
    type: 'provider_error',
    details: JSON.stringify({ error: { message, type: 'invalid_request_error' } }),
  }
  for (const input of [body, JSON.stringify(body)]) {
    await assert.rejects(failure(400, input), error => {
      assert.equal(error.code, 'INVALID_REQUEST')
      assert.equal(error.failure.status, 400)
      assert.ok(error.message.includes(message))
      assert.ok(error.message.includes(body.request_id))
      return true
    })
  }
})

test('malformed nested details retain the provider error instead of throwing a parse error', async () => {
  const body = JSON.stringify({ message: 'Provider rejected the request', details: '{invalid' })
  await assert.rejects(failure(400, body), error => {
    assert.equal(error.code, 'INVALID_REQUEST')
    assert.ok(error.message.includes(body))
    return true
  })
})

test('plain-text failures and login expiry keep their classification and explanation', async () => {
  for (const [status, body, code, message] of [
    [500, 'Upstream service unavailable', 'SERVER', 'Upstream service unavailable'],
    [403, JSON.stringify({ code: '105', message: 'Login expired' }), 'AUTH', 'Login expired'],
  ]) {
    await assert.rejects(failure(status, body), error => {
      assert.equal(error.code, code)
      assert.equal(error.failure.status, status)
      assert.ok(error.message.includes(message))
      return true
    })
  }
})

test('single-character tagged reasoning becomes reasoning plus an intact final answer', async () => {
  const result = await translated(contentDeltas([...'<thinking>reason</thinking>\n\nanswer']))
  assert.deepEqual(result.blocks, [
    { type: 'reasoning', text: 'reason' },
    { type: 'text', text: '\n\nanswer' },
  ])
  assert.equal(result.reason.kind, 'stop')
})

test('ordinary thinking and response words are never parsed as protocol', async () => {
  const text = 'I am thinking about the response, not a protocol tag.'
  const result = await translated(contentDeltas([...text]))
  assert.deepEqual(result.blocks, [{ type: 'text', text }])
  assert.equal(result.reason.kind, 'stop')
})

test('unclosed thinking and orphan DSML stay reasoning evidence and finish as incomplete', async () => {
  const parts = ['<', 'thinking', '>', 'Confirmed', ' live', '.</', '｜｜DSML｜｜', ' parameter', '>']
  const result = await translated(contentDeltas(parts))
  assert.deepEqual(result.blocks, [{ type: 'reasoning', text: 'Confirmed live.</｜｜DSML｜｜ parameter>' }])
  assert.equal(result.reason.kind, 'error')
  assert.equal(result.reason.failure.code, 'QODER_INCOMPLETE_RESPONSE')
})

test('reasoning without a final answer is incomplete for explicit and implicit stop', async () => {
  for (const finish of ['stop', null]) {
    for (const deltas of [
      [{ reasoning_content: 'considering the request' }],
      [{ reasoning_content: 'considering the request', content: ' \n' }],
      [{ reasoning_content: ' ' }],
      [{ content: '<think>reason</think>' }],
      [{ content: '<thought></thought>' }],
      [{ content: 'preface<thinking>unfinished' }],
    ]) {
      const result = await translated(deltas, finish)
      assert.equal(result.reason.kind, 'error')
      assert.equal(result.reason.failure.code, 'QODER_INCOMPLETE_RESPONSE')
    }
  }
})

test('native reasoning and tagged reasoning preserve the final text and first-seen block indexes', async () => {
  const result = await translated([
    { content: 'preface ' },
    { reasoning_content: 'native ' },
    { content: '<think>tagged</think>answer' },
    structuredTool,
  ], 'tool_calls')
  assert.deepEqual(result.chunks.filter(chunk => chunk.type === 'block-start').map(chunk => [chunk.index, chunk.blockType]), [
    [0, 'text'], [1, 'reasoning'], [2, 'tool-call'],
  ])
  assert.deepEqual(result.chunks.filter(chunk => chunk.type === 'block-end').map(chunk => chunk.index), [0, 1, 2])
  assert.equal(result.blocks[0].text, 'preface answer')
  assert.equal(result.blocks[1].text, 'native tagged')
  assert.equal(result.blocks[2].arguments, '{"query":"qoder"}')
  assert.equal(result.reason.kind, 'tool-calls')
})

test('pending tag prefixes flush before block ends, usage and finish', async () => {
  for (const [content, type, expected, finish] of [
    ['answer<thi', 'text', 'answer<thi', 'stop'],
    ['<think>reason</thi', 'reasoning', 'reason</thi', 'error'],
  ]) {
    const result = await translated([{ content }])
    assert.deepEqual(result.blocks, [{ type, text: expected }])
    const lastDelta = result.chunks.findLastIndex(chunk => chunk.type.endsWith('-delta'))
    const firstEnd = result.chunks.findIndex(chunk => chunk.type === 'block-end')
    const usage = result.chunks.findIndex(chunk => chunk.type === 'usage')
    assert.ok(lastDelta < firstEnd && firstEnd < usage && usage < result.chunks.length - 1)
    assert.equal(result.reason.kind, finish)
  }
})

test('real structured tools remain usable even with unclosed or answerless reasoning', async () => {
  for (const finish of ['stop', null, 'tool_calls']) {
    for (const thinking of [{ content: '<think>unfinished' }, { reasoning_content: 'use lookup' }]) {
      const result = await translated([thinking, structuredTool], finish)
      const tool = result.blocks.find(block => block.type === 'tool-call')
      assert.equal(tool.name, 'lookup')
      assert.equal(tool.id, 'call-1')
      assert.equal(tool.arguments, '{"query":"qoder"}')
      assert.equal(result.reason.kind, finish === 'tool_calls' ? 'tool-calls' : 'stop')
    }
  }
})

test('tool_calls finish without a structured call is explicitly incomplete', async () => {
  for (const deltas of [[], [{ content: 'I will use a tool' }], [{ content: '<think>call lookup' }]]) {
    const result = await translated(deltas, 'tool_calls')
    assert.equal(result.blocks.some(block => block.type === 'tool-call'), false)
    assert.equal(result.reason.kind, 'error')
    assert.equal(result.reason.failure.code, 'QODER_INCOMPLETE_RESPONSE')
  }
})

test('truncation and existing error finishes take precedence over incomplete reasoning', async () => {
  for (const deltas of [[{ content: '<think>unfinished' }], [{ reasoning_content: 'unfinished' }]]) {
    assert.equal((await translated(deltas, 'length')).reason.kind, 'max-tokens')
    const failed = await translated(deltas, 'content_filter')
    assert.equal(failed.reason.kind, 'error')
    assert.equal(failed.reason.failure.code, 'CONTENT_FILTER')
  }
})

test('empty responses preserve the existing empty-response failure', async () => {
  for (const finish of ['stop', null]) {
    const result = await translated([], finish)
    assert.equal(result.reason.kind, 'error')
    assert.equal(result.reason.failure.code, EMPTY_RESPONSE_CODE)
  }
})

test('transport errors and cancellation are not replaced by incomplete-response errors', async () => {
  for (const error of [new Error('upstream disconnected'), new DOMException('cancelled', 'AbortError')]) {
    async function* envelopes() {
      yield { statusCodeValue: 200, body: { choices: [{ delta: { content: '<think>unfinished' } }] } }
      throw error
    }
    await assert.rejects(async () => {
      for await (const chunk of translate(envelopes())) {
        assert.notEqual(chunk.type, 'finish')
      }
    }, thrown => thrown === error)
  }
})
