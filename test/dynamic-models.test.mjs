import assert from 'node:assert/strict'
import test from 'node:test'
import { Config, parseQoderModelCatalog, QoderAdapter } from '../dist/index.js'

const endpoints = {
  gateway: 'https://tenant-gateway.vpc.qoder.com.cn',
  openapi: 'https://tenant-openapi.vpc.qoder.com.cn',
  manage: 'https://tenant.vpc.qoder.com.cn',
}

function connection(models) {
  return {
    endpoints,
    apiKeyEnv: 'QODERCN_PERSONAL_ACCESS_TOKEN',
    maxTokens: 32_768,
    defaultContextWindow: 1_000_000,
    ...(models === undefined ? {} : { models }),
    streamIdleTimeoutMs: 300_000,
    retryPolicy: {},
    machineId: 'test-machine',
  }
}

function gmodel() {
  return {
    key: 'gmodel',
    enable: true,
    display_name: 'GLM-5.3',
    is_vl: true,
    is_reasoning: true,
    max_input_tokens: 180_000,
    max_output_tokens: 32_768,
    context_config: {
      '1M': { token_count: 1_000_000 },
      '200K': { token_count: 200_000, is_default: true },
    },
    thinking_config: {
      enabled: { efforts: { high: {}, low: {}, max: { is_default: true } } },
    },
  }
}

test('keeps an omitted catalog absent after Schemastery resolves defaults', () => {
  const resolved = new Config({
    providers: {
      'qoder-cn': {
        apiKeyEnv: 'QODER_CN_API_KEY',
        vpcInstance: 'tenant',
      },
    },
  })
  assert.equal(resolved.models, undefined)
  assert.equal(resolved.providers['qoder-cn'].models, undefined)
})

test('parses enabled live models and rejects unusable listings', () => {
  assert.deepEqual(parseQoderModelCatalog({
    chat: [
      gmodel(),
      { key: 'gm51model', enable: true, display_name: 'GLM-5.2', max_input_tokens: 180_000 },
      { key: '', enable: true },
      { key: 'disabled', enable: false },
    ],
  }), [
    {
      id: 'gmodel',
      name: 'GLM-5.3',
      contextWindow: 200_000,
      maxTokens: 32_768,
      inputModalities: ['text', 'image'],
      reasoning: true,
    },
    {
      id: 'glm-5.2',
      name: 'GLM 5.2',
      contextWindow: 180_000,
      inputModalities: ['text'],
      reasoning: false,
    },
  ])
  assert.throws(
    () => parseQoderModelCatalog({ models: [] }),
    error => error?.code === 'DISCOVERY_FAILED',
  )
  assert.throws(
    () => parseQoderModelCatalog({ chat: [{ key: 'disabled', enable: false }] }),
    error => error?.code === 'DISCOVERY_FAILED',
  )
})

test('refreshes the signed live catalog and reuses it for exact-model resolution', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  let catalogCalls = 0
  let liveChat = [gmodel()]
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input)
    if (url.endsWith('/api/v1/jobToken/exchange')) {
      return Response.json({ token: 'jt-test', refresh_token: 'jrt-test', expires_in: 86_400_000 })
    }
    if (url.endsWith('/api/v1/userinfo')) {
      return Response.json({ id: 'user-test', email: 'user@example.com', name: 'Test User' })
    }
    if (url.endsWith('/algo/api/v2/model/list')) {
      catalogCalls += 1
      const authorization = new Headers(init.headers).get('authorization')
      assert.match(authorization ?? '', /^Bearer COSY\./)
      assert.equal(init.method, 'GET')
      return Response.json({ chat: liveChat })
    }
    throw new Error(`Unexpected URL: ${url}`)
  }

  const adapter = new QoderAdapter({
    options: () => connection(),
    resolveApiKey: async () => 'pt-dynamic-model-test',
    resolveAttachments: () => undefined,
  })
  const first = await adapter.listModels('qoder-cn')
  assert.deepEqual(first, [{
    provider: 'qoder-cn',
    id: 'gmodel',
    name: 'GLM-5.3',
    inputModalities: ['text', 'image'],
  }])
  const resolved = await adapter.resolveModel('qoder-cn', 'gmodel')
  assert.equal(resolved.context.contextWindow, 200_000)
  assert.equal(resolved.defaultMaxTokens, 32_768)
  assert.deepEqual(resolved.reasoning?.efforts.map(effort => effort.id), ['off', 'high', 'max'])
  assert.equal(catalogCalls, 1)

  liveChat = [...liveChat, {
    key: 'new-wire-model',
    enable: true,
    display_name: 'NewModel-Preview',
    max_input_tokens: 256_000,
  }]
  const refreshed = await adapter.listModels('qoder-cn')
  assert.deepEqual(refreshed.map(model => model.id), ['gmodel', 'new-wire-model'])
  assert.equal(catalogCalls, 2)
})

test('uses an explicit static catalog without contacting Qoder discovery', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  globalThis.fetch = async () => { throw new Error('unexpected discovery request') }
  const adapter = new QoderAdapter({
    options: () => connection([{ id: 'pinned', name: 'Pinned' }]),
    resolveApiKey: async () => 'pt-static-model-test',
    resolveAttachments: () => undefined,
  })
  assert.deepEqual(await adapter.listModels('qoder-cn'), [{
    provider: 'qoder-cn',
    id: 'pinned',
    name: 'Pinned',
  }])
})

test('cancels first-use dynamic resolution with the caller signal', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  globalThis.fetch = async (_input, init = {}) => await new Promise((_resolve, reject) => {
    const signal = init.signal
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }
    signal?.addEventListener('abort', () => { reject(signal.reason) }, { once: true })
  })
  const adapter = new QoderAdapter({
    options: () => connection(),
    resolveApiKey: async () => 'pt-aborted-model-test',
    resolveAttachments: () => undefined,
  })
  const controller = new AbortController()
  const resolution = adapter.resolveModel('qoder-cn', 'gmodel', controller.signal)
  controller.abort('test cancellation')
  await assert.rejects(resolution, error => error?.code === 'ABORTED')
})
