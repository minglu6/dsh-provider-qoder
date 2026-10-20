import assert from 'node:assert/strict'
import test from 'node:test'
import { translate } from '../src/translate.ts'

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
