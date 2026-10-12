import assert from 'node:assert/strict'
import test from 'node:test'
import { createDraft, connection, saveDraft } from '../src/client/operations.ts'

function fixture(config, credential = 'existing-pat') {
  const state = { config: structuredClone(config), revision: 3, credential, writable: true, rejectCredential: false }
  const snapshot = { status: 'ready', writable: true, mode: 'host' }
  const operations = {
    async describe() { return { writable: state.writable } },
    async mutate(ops, revision) {
      if (revision !== state.revision) return { ok: false, error: { code: 'settings/conflict' } }
      for (const { path, value } of ops) {
        let target = state.config
        for (const segment of path.slice(0, -1)) target = target[segment] ??= {}
        target[path.at(-1)] = value
      }
      if (ops.length > 0) state.revision++
      return { ok: true, value: { value: structuredClone(state.config), revision: state.revision } }
    },
    async store(_ref, pat) {
      if (state.rejectCredential) return false
      state.credential = pat
      return true
    },
  }
  return { state, snapshot, operations, draft: createDraft(config, state.revision) }
}

test('saving connection changes with a blank PAT preserves the credential and model overrides', async () => {
  const config = {
    apiKeyEnv: 'SHARED_QODER_PAT',
    vpcInstance: 'root-tenant',
    providers: { 'qoder-cn': { models: [{ id: 'pinned' }] } },
  }
  const { state, snapshot, operations, draft } = fixture(config)
  assert.equal(draft.ref, 'SHARED_QODER_PAT')
  assert.equal(draft.vpcInstance, 'root-tenant')
  const saved = await saveDraft({ ...draft, vpcInstance: 'card-tenant' }, snapshot, operations)
  assert.equal(saved.error, undefined)
  assert.equal(state.credential, 'existing-pat')
  assert.equal(connection(state.config).vpcInstance, 'card-tenant')
  assert.equal(state.config.vpcInstance, 'root-tenant')
  assert.deepEqual(state.config.providers['qoder-cn'].models, [{ id: 'pinned' }])
})

test('a stale PAT-only form cannot overwrite a credential after another configuration edit', async () => {
  const { state, snapshot, operations, draft } = fixture({ apiKeyEnv: 'OLD_REF' })
  state.config.apiKeyEnv = 'NEW_REF'
  state.revision++
  const saved = await saveDraft({ ...draft, pat: 'pt-replacement' }, snapshot, operations)
  assert.equal(saved.error, 'conflict')
  assert.equal(state.credential, 'existing-pat')
  assert.equal(state.config.apiKeyEnv, 'NEW_REF')
  assert.equal(saved.draft.pat, 'pt-replacement')
})

test('retry after a credential refusal retains the committed configuration revision', async () => {
  const { state, snapshot, operations, draft } = fixture({})
  state.rejectCredential = true
  const failed = await saveDraft({ ...draft, pat: 'pt-replacement', vpcInstance: 'tenant' }, snapshot, operations)
  assert.equal(failed.error, 'credentialFailed')
  assert.equal(failed.settingsSaved, true)
  assert.equal(state.config.vpcInstance, 'tenant')
  assert.equal(state.credential, 'existing-pat')
  state.rejectCredential = false
  const saved = await saveDraft(failed.draft, snapshot, operations)
  assert.equal(saved.error, undefined)
  assert.equal(state.credential, 'pt-replacement')
  assert.equal(saved.draft.pat, '')
  assert.equal(state.revision, 4)
})

test('environment-owned credentials refuse replacement before any connection change', async () => {
  const { state, snapshot, operations, draft } = fixture({ vpcInstance: 'original' })
  state.writable = false
  const saved = await saveDraft({ ...draft, pat: 'pt-replacement', vpcInstance: 'changed' }, snapshot, operations)
  assert.equal(saved.error, 'credentialReadOnly')
  assert.equal(state.config.vpcInstance, 'original')
  assert.equal(state.credential, 'existing-pat')
})

test('clearing an inherited VPC or endpoint stores an explicit public-cloud override', async () => {
  const { state, snapshot, operations, draft } = fixture({
    vpcInstance: 'inherited-tenant',
    baseURL: 'https://inherited-gateway.example',
    providers: { 'qoder-cn': {} },
  })
  const saved = await saveDraft({ ...draft, vpcInstance: '', baseURL: '' }, snapshot, operations)
  assert.equal(saved.error, undefined)
  assert.equal(connection(state.config).vpcInstance, '')
  assert.equal(connection(state.config).baseURL, '')
  assert.equal(state.config.vpcInstance, 'inherited-tenant')
})
