import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply, Config } from '../dist/index.js'

const previousHome = process.env.DSH_HOME
const testHome = mkdtempSync(join(tmpdir(), 'qoder-live-config-'))
process.env.DSH_HOME = testHome
test.after(() => {
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  rmSync(testHome, { recursive: true, force: true })
})

function mount(raw, resolveCredential = async () => undefined) {
  let parsed = Config(structuredClone(raw))
  // Stable references expose newly validated snapshots, as Loader does.
  const config = Object.fromEntries(Object.keys(parsed).map(key => [key, {
    get: () => parsed[key].get(),
  }]))
  const listeners = new Map()
  let adapter
  let retryPolicy
  const fiber = { entry: { options: { id: 'llm-qoder' } } }
  const ctx = {
    fiber,
    inject() {},
    on(event, listener) { listeners.set(event, listener) },
    get(name) { return name === 'credentials' ? { resolve: resolveCredential } : undefined },
    llm: {
      registerConfigurableProviders() {},
      registerAdapter(_providers, value) {
        adapter = value
        retryPolicy = adapter.providerRetryPolicy('qoder-cn')
        return { replace() { retryPolicy = adapter.providerRetryPolicy('qoder-cn') } }
      },
    },
  }
  apply(ctx, config)
  return {
    adapter,
    policy: () => retryPolicy,
    update(next) {
      const candidate = structuredClone(next)
      listeners.get('internal/config').call(fiber, candidate, () => candidate)
      parsed = Config(candidate)
      listeners.get('loader/volatile-update')([])
    },
  }
}

test('new discovery uses changed credentials and URLs while an already-started operation keeps its snapshot', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const requests = []
  const refs = []
  let release
  const oldCredential = new Promise(resolve => { release = resolve })
  globalThis.fetch = async (input) => {
    const url = new URL(String(input))
    requests.push(url.href)
    if (url.pathname.endsWith('/jobToken/exchange')) {
      return Response.json({ token: `jt-${url.hostname}`, refresh_token: 'jrt-live-config', expires_in: 86_400_000 })
    }
    if (url.pathname.endsWith('/userinfo')) {
      return Response.json({ id: 'live-config-user', email: 'test@example.com', name: 'Test' })
    }
    if (url.pathname.endsWith('/model/list')) {
      return Response.json({ chat: [{ key: url.hostname, display_name: url.hostname, enable: true }] })
    }
    throw new Error(`Unexpected URL: ${url}`)
  }
  const host = mount({
    apiKeyEnv: 'QODER_OLD_CARD_PAT',
    vpcInstance: '',
    baseURL: 'http://old-gateway.test:3199',
    openApiUrl: 'http://old-openapi.test:3199',
  }, async (ref) => {
    refs.push(ref)
    if (ref === 'QODER_OLD_CARD_PAT') await oldCredential
    return { value: `pt-live-config-${ref}` }
  })
  const started = host.adapter.listModels('qoder-cn')
  host.update({
    apiKeyEnv: 'QODER_NEW_CARD_PAT',
    vpcInstance: '',
    baseURL: 'http://new-gateway.test:3199',
    openApiUrl: 'http://new-openapi.test:3199',
    retryPolicy: { mode: 'normal', maxRetries: 2 },
  })
  release()
  assert.equal((await started)[0].id, 'old-gateway.test')
  assert.equal((await host.adapter.listModels('qoder-cn'))[0].id, 'new-gateway.test')
  assert.deepEqual(refs, ['QODER_OLD_CARD_PAT', 'QODER_NEW_CARD_PAT'])
  assert.ok(requests.some(url => url.startsWith('http://old-openapi.test:3199/')))
  assert.ok(requests.some(url => url.startsWith('http://new-openapi.test:3199/')))
  assert.equal(host.policy().maxRetries, 2)
})

test('profile omissions inherit root settings and explicit profile values override them', async () => {
  const root = {
    apiKeyEnv: 'QODER_ROOT_PAT',
    maxTokens: 4096,
    defaultContextWindow: 123456,
    models: [{ id: 'pinned', name: 'Root model' }],
    retryPolicy: { mode: 'normal', maxRetries: 1 },
    providers: { 'qoder-cn': { vpcInstance: 'tenant' } },
  }
  const host = mount(root)
  const inherited = await host.adapter.resolveModel('qoder-cn', 'pinned')
  assert.equal(inherited.name, 'Root model')
  assert.equal(inherited.defaultMaxTokens, 4096)
  assert.equal(inherited.context.contextWindow, 123456)
  assert.equal(host.policy().maxRetries, 1)
  host.update({ ...root, providers: { 'qoder-cn': { maxTokens: 8192 } } })
  assert.equal((await host.adapter.resolveModel('qoder-cn', 'pinned')).defaultMaxTokens, 8192)
  assert.equal(host.policy().maxRetries, 1)
})

test('invalid edits fail before changing the consumer configuration', async () => {
  const initial = { models: [{ id: 'pinned', name: 'Unchanged' }], maxTokens: 1024 }
  const host = mount(initial)
  for (const change of [
    { maxTokens: 0 },
    { apiKeyEnv: 'not a reference' },
    { vpcInstance: 'tenant.example.com' },
    { baseURL: 'file:///tmp/not-an-api' },
    { openApiUrl: 'https://user:password@example.com' },
    { models: [{ id: 'duplicate' }, { id: 'duplicate' }] },
    { retryPolicy: { mode: 'normal', backoff: { initialDelayMs: -1 } } },
  ]) {
    assert.throws(() => host.update({ ...initial, ...change }))
    const resolved = await host.adapter.resolveModel('qoder-cn', 'pinned')
    assert.equal(resolved.name, 'Unchanged')
    assert.equal(resolved.defaultMaxTokens, 1024)
  }
})

test('an existing profile inherits the PAT reference and can clear inherited private endpoints', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const origins = new Set()
  const refs = []
  globalThis.fetch = async (input) => {
    const url = new URL(String(input))
    origins.add(url.origin)
    if (url.pathname.endsWith('/jobToken/exchange')) {
      return Response.json({ token: 'jt-cleared-profile', refresh_token: 'jrt-cleared-profile', expires_in: 86_400_000 })
    }
    if (url.pathname.endsWith('/userinfo')) {
      return Response.json({ id: 'cleared-profile-user', email: 'test@example.com', name: 'Test' })
    }
    return Response.json({ chat: [{ key: 'public-model', enable: true }] })
  }
  const host = mount({
    apiKeyEnv: 'QODER_INHERITED_PAT',
    vpcInstance: 'private-tenant',
    baseURL: 'https://private-gateway.test',
    openApiUrl: 'https://private-openapi.test',
    providers: { 'qoder-cn': { vpcInstance: '', baseURL: '', openApiUrl: '' } },
  }, async (ref) => {
    refs.push(ref)
    return { value: 'pt-cleared-profile-test' }
  })
  assert.equal((await host.adapter.listModels('qoder-cn'))[0].id, 'public-model')
  assert.deepEqual(refs, ['QODER_INHERITED_PAT'])
  assert.deepEqual(origins, new Set(['https://openapi.qoder.com.cn', 'https://gateway.qoder.com.cn']))
})
