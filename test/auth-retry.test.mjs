import assert from 'node:assert/strict'
import test from 'node:test'
import { QoderAdapter } from '../dist/index.js'

/**
 * Auth-expiry behavior: when the gateway rejects a cached job token (HTTP
 * 401/403 or an in-band `code 105` envelope), the session is dropped and the
 * request retried exactly once after a fresh exchange; sessions also rotate
 * by age; caches are keyed by endpoint set + PAT.
 */

function connection(overrides = {}) {
  return {
    endpoints: {
      gateway: 'https://auth-gateway.vpc.qoder.com.cn',
      openapi: 'https://auth-openapi.vpc.qoder.com.cn',
      manage: 'https://auth.vpc.qoder.com.cn',
    },
    apiKeyEnv: 'QODERCN_PERSONAL_ACCESS_TOKEN',
    maxTokens: 32_768,
    defaultContextWindow: 1_000_000,
    streamIdleTimeoutMs: 300_000,
    retryPolicy: {},
    machineId: 'test-machine',
    ...overrides,
  }
}

function envelope(statusCodeValue, body) {
  return JSON.stringify({ statusCodeValue, body })
}

function innerDelta(text) {
  return JSON.stringify({ choices: [{ delta: { content: text } }] })
}

function innerFinish() {
  return JSON.stringify({
    choices: [{ delta: {}, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  })
}

function sseResponse(payloads) {
  const frames = payloads.map(payload => `data: ${payload}\n\n`)
  frames.push('data: [DONE]\n\n')
  return new Response(frames.join(''), {
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

const LOGIN_EXPIRED_BODY = JSON.stringify({ code: '105', message: 'Login expired' })

function adapter(connectionOptions, pat) {
  return new QoderAdapter({
    options: () => connectionOptions,
    resolveApiKey: async () => pat,
    resolveAttachments: () => undefined,
  })
}

async function collect(stream) {
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

function chatOptions() {
  return {
    model: 'gmodel',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'ping' }] }],
  }
}

test('chat auth-expired envelope on both attempts fails as AUTH with one retry', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  let chats = 0
  let exchanges = 0
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input)
    if (url.endsWith('/api/v1/jobToken/exchange')) {
      exchanges += 1
      return Response.json({
        token: `jt-auth-fail-${exchanges}`,
        refresh_token: 'jrt-auth-fail',
        expires_in: 86_400_000,
      })
    }
    if (url.endsWith('/api/v1/userinfo')) {
      return Response.json({ id: 'user-auth-fail', email: 'a@example.com', name: 'A' })
    }
    assert.equal(init.method, 'POST')
    chats += 1
    return sseResponse([envelope(403, LOGIN_EXPIRED_BODY)])
  }
  const provider = adapter(connection(), 'pt-auth-fail-test')
  await assert.rejects(
    collect(provider.stream(chatOptions())),
    error => error?.code === 'AUTH' && error?.failure?.status === 403,
  )
  assert.equal(chats, 2)
  assert.equal(exchanges, 2)
})

test('chat auth-expired envelope is retried once and then streams normally', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  let chats = 0
  let exchanges = 0
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.endsWith('/api/v1/jobToken/exchange')) {
      exchanges += 1
      return Response.json({
        token: `jt-auth-retry-${exchanges}`,
        refresh_token: 'jrt-auth-retry',
        expires_in: 86_400_000,
      })
    }
    if (url.endsWith('/api/v1/userinfo')) {
      return Response.json({ id: 'user-auth-retry', email: 'a@example.com', name: 'A' })
    }
    chats += 1
    if (chats === 1) return sseResponse([envelope(403, LOGIN_EXPIRED_BODY)])
    return sseResponse([envelope(200, innerDelta('pong')), envelope(200, innerFinish())])
  }
  const provider = adapter(connection(), 'pt-auth-retry-test')
  const chunks = await collect(provider.stream(chatOptions()))
  assert.ok(chunks.some(chunk => chunk.type === 'text-delta' && chunk.text === 'pong'))
  assert.ok(chunks.some(chunk => chunk.type === 'finish' && chunk.reason.kind === 'stop'))
  assert.equal(chats, 2)
  assert.equal(exchanges, 2)
})

test('model listing HTTP 403 is retried once after invalidating the session', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  let listings = 0
  let exchanges = 0
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.endsWith('/api/v1/jobToken/exchange')) {
      exchanges += 1
      return Response.json({
        token: `jt-list-retry-${exchanges}`,
        refresh_token: 'jrt-list-retry',
        expires_in: 86_400_000,
      })
    }
    if (url.endsWith('/api/v1/userinfo')) {
      return Response.json({ id: 'user-list-retry', email: 'a@example.com', name: 'A' })
    }
    listings += 1
    if (listings === 1) {
      return new Response(LOGIN_EXPIRED_BODY, { status: 403 })
    }
    return Response.json({
      chat: [{ key: 'gmodel', enable: true, display_name: 'GLM-5.3', max_input_tokens: 200_000 }],
    })
  }
  const provider = adapter(connection(), 'pt-list-retry-test')
  const models = await provider.listModels('qoder-cn')
  assert.deepEqual(models.map(({ id }) => id), ['gmodel'])
  assert.equal(listings, 2)
  assert.equal(exchanges, 2)
})

test('job tokens rotate by age through the refresh token', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const issuedAt = new Date(Date.now() - 40 * 60 * 1000).toISOString()
  let exchanges = 0
  let refreshes = 0
  let chats = 0
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input)
    if (url.endsWith('/api/v1/jobToken/exchange')) {
      exchanges += 1
      return Response.json({
        token: 'jt-old',
        refresh_token: 'jrt-old',
        created_at: issuedAt,
        expires_in: 86_400_000,
      })
    }
    if (url.endsWith('/api/v1/jobToken/refresh')) {
      refreshes += 1
      assert.equal(JSON.parse(String(init.body)).refresh_token, 'jrt-old')
      return Response.json({
        token: 'jt-refreshed',
        refresh_token: 'jrt-refreshed',
        created_at: new Date().toISOString(),
        expires_in: 86_400_000,
      })
    }
    if (url.endsWith('/api/v1/userinfo')) {
      return Response.json({ id: 'user-rotate', email: 'a@example.com', name: 'A' })
    }
    chats += 1
    return sseResponse([envelope(200, innerDelta('pong')), envelope(200, innerFinish())])
  }
  const provider = adapter(connection(), 'pt-rotate-test')
  for (let round = 0; round < 3; round++) {
    const chunks = await collect(provider.stream(chatOptions()))
    assert.ok(chunks.some(chunk => chunk.type === 'finish'), `round ${round} finished`)
  }
  assert.equal(exchanges, 1)
  assert.equal(refreshes, 1)
  assert.equal(chats, 3)
})

test('job-token and identity caches are keyed by endpoint set + PAT', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  let exchanges = 0
  const pat = 'pt-endpoint-keying-test'
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.endsWith('/api/v1/jobToken/exchange')) {
      exchanges += 1
      return Response.json({
        token: `jt-endpoint-${exchanges}`,
        refresh_token: 'jrt-endpoint',
        expires_in: 86_400_000,
      })
    }
    if (url.endsWith('/api/v1/userinfo')) {
      return Response.json({ id: 'user-endpoint', email: 'a@example.com', name: 'A' })
    }
    return Response.json({
      chat: [{ key: 'gmodel', enable: true, display_name: 'GLM-5.3', max_input_tokens: 200_000 }],
    })
  }
  const first = adapter(connection(), pat)
  await first.listModels('qoder-cn')
  assert.equal(exchanges, 1)
  const second = adapter(connection({
    endpoints: {
      gateway: 'https://other-gateway.vpc.qoder.com.cn',
      openapi: 'https://other-openapi.vpc.qoder.com.cn',
      manage: 'https://other.vpc.qoder.com.cn',
    },
  }), pat)
  await second.listModels('qoder-cn')
  assert.equal(exchanges, 2)
})
