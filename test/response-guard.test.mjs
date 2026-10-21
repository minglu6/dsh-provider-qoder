import assert from 'node:assert/strict'
import test from 'node:test'
import { QoderAdapter } from '../dist/index.js'

const checkpoint = '<analysis>Review the prior conversation.</analysis><summary>\n## Primary Request and Intent\nFix the report.\n## Key Technical Concepts\nEvidence.\n## Files and Code Sections\nreport.py\n## Current Work\nStill pending.\n</summary>'
const tool = { name: 'lookup', description: 'Read a value', parameters: { type: 'object', properties: {} } }

function options(overrides = {}) {
  return {
    provider: 'qoder-cn', model: 'dfmodel', sessionId: 'host-session-a',
    tools: [tool], messages: [{ role: 'user', content: [{ type: 'text', text: 'Fix the report.' }] }],
    ...overrides,
  }
}

function decode(encoded) {
  const custom = '_doRTgHZBKcGVjlvpC,@aFSx#DPuNJme&i*MzLOEn)sUrthbf%Y^w.(kIQyXqWA!'
  const standard = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const rearranged = [...encoded.toString()].map(c => c === '$' ? '=' : standard[custom.indexOf(c)]).join('')
  const n = rearranged.length, a = Math.floor(n / 3)
  return JSON.parse(Buffer.from(rearranged.slice(n - a) + rearranged.slice(a, n - a) + rearranged.slice(0, a), 'base64').toString())
}

function response(deltas, finish = 'stop') {
  const frames = deltas.map(delta => ({ choices: [{ delta }] }))
  frames.push({ choices: [{ finish_reason: finish }] })
  return new Response(frames.map(body => `data: ${JSON.stringify({ statusCodeValue: 200, body: JSON.stringify(body) })}\n\n`).join('') + 'data: [DONE]\n\n')
}

function mockQoder(t, replies) {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  const bodies = []
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/jobToken/exchange')) return Response.json({ token: 'jt-test', refresh_token: 'jrt-test', expires_in: 86_400_000 })
    if (String(url).endsWith('/userinfo')) return Response.json({ id: 'test-user', email: 'test@example.com', name: 'Test' })
    bodies.push(decode(init.body))
    const next = replies[bodies.length - 1]
    assert(next, 'Unexpected extra model generation')
    return next()
  }
  const adapter = new QoderAdapter({
    options: () => ({
      endpoints: { gateway: 'https://guard-gateway.test', openapi: 'https://guard-openapi.test', manage: 'https://guard.test' },
      apiKeyEnv: 'QODERCN_PERSONAL_ACCESS_TOKEN', maxTokens: 32768, defaultContextWindow: 1_000_000,
      streamIdleTimeoutMs: 300_000, retryPolicy: {}, machineId: 'test-machine',
    }),
    resolveApiKey: async () => `pt-test-${t.name}`,
    resolveAttachments: () => undefined,
  })
  return { bodies, adapter }
}

async function collect(stream) {
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}
const visible = chunks => chunks.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.text).join('')

test('quarantines fragmented checkpoint and native reasoning, then recovers once in a fresh remote session', async t => {
  const { adapter, bodies } = mockQoder(t, [
    () => response([{ reasoning_content: 'Rejected private reasoning' }, ...[...checkpoint].map(content => ({ content }))]),
    () => response([{ content: 'The report is fixed.' }]),
  ])
  const chunks = await collect(adapter.stream(options()))
  assert.equal(visible(chunks), 'The report is fixed.')
  assert(!JSON.stringify(chunks).includes('Rejected private reasoning'))
  assert(!JSON.stringify(chunks).includes('<summary>'))
  assert.equal(chunks.filter(chunk => chunk.type === 'finish').length, 1)
  assert.equal(chunks.at(-1).reason.kind, 'stop')
  assert.equal(bodies.length, 2)
  assert.notEqual(bodies[0].session_id, bodies[1].session_id)
  assert.notEqual(bodies[0].chat_record_id, bodies[1].chat_record_id)
  assert.deepEqual(bodies[0].messages, bodies[1].messages)
  assert.deepEqual(bodies[0].tools, bodies[1].tools)
})

test('a repeated checkpoint fails explicitly without exposing either response or looping', async t => {
  const { adapter, bodies } = mockQoder(t, [() => response([{ content: checkpoint }]), () => response([{ content: checkpoint }])])
  const chunks = await collect(adapter.stream(options()))
  assert.equal(bodies.length, 2)
  assert.equal(visible(chunks), '')
  assert(!chunks.some(chunk => chunk.type === 'block-start' || chunk.type === 'block-end'))
  assert.equal(chunks.at(-1).reason.kind, 'error')
  assert.equal(chunks.at(-1).reason.failure.code, 'QODER_UNEXPECTED_SUMMARY')
})

test('recovery retains completed tool history and emits the new structured tool call only once', async t => {
  const { adapter, bodies } = mockQoder(t, [
    () => response([{ content: checkpoint }]),
    () => response([{ tool_calls: [{ index: 0, id: 'new-call', function: { name: 'lookup', arguments: '{}' } }] }], 'tool_calls'),
  ])
  const request = options({ messages: [
    { role: 'user', content: [{ type: 'text', text: 'Read the next value.' }] },
    { role: 'assistant', content: [{ type: 'tool-call', id: 'old-call', name: 'lookup', arguments: '{}' }] },
    { role: 'tool', toolCallId: 'old-call', content: [{ type: 'text', text: 'Already executed: 19' }] },
  ] })
  const chunks = await collect(adapter.stream(request))
  assert.equal(chunks.filter(chunk => chunk.type === 'block-start' && chunk.blockType === 'tool-call').length, 1)
  assert.equal(chunks.at(-1).reason.kind, 'tool-calls')
  assert.deepEqual(bodies[1].messages, bodies[0].messages)
  assert.equal(bodies[1].messages.at(-1).tool_call_id, 'old-call')
  assert.equal(bodies[1].messages.at(-1).content, 'Already executed: 19')
})

test('the recovery request does not retry upstream failures', async t => {
  const { adapter, bodies } = mockQoder(t, [() => response([{ content: checkpoint }]), () => new Response('rate limited', { status: 429 })])
  const chunks = []
  await assert.rejects(async () => {
    for await (const chunk of adapter.stream(options())) chunks.push(chunk)
  }, error => error.failure?.status === 429)
  assert.equal(bodies.length, 2)
  assert(!JSON.stringify(chunks).includes('<summary>'))
})

test('cancellation stops recovery before a second generation and discards the quarantined prefix', async t => {
  const controller = new AbortController()
  const { adapter, bodies } = mockQoder(t, [() => {
    controller.abort()
    return response([{ content: checkpoint }])
  }])
  const chunks = []
  await assert.rejects(async () => {
    for await (const chunk of adapter.stream(options({ signal: controller.signal }))) chunks.push(chunk)
  }, error => error.code === 'ABORTED')
  assert.equal(bodies.length, 1)
  assert.equal(visible(chunks), '')
})

for (const purpose of ['compaction', 'session-title']) {
  test(`preserves explicitly classified ${purpose} requests even with tool declarations`, async t => {
    const { adapter, bodies } = mockQoder(t, [() => response([{ content: checkpoint }])])
    const chunks = await collect(adapter.stream(options({ purpose })))
    assert.equal(visible(chunks), checkpoint)
    assert.equal(chunks.at(-1).reason.kind, 'stop')
    assert.equal(bodies.length, 1)
  })
}

for (const text of ['Summarize our conversation.', '请总结这次排查', '输出 <summary> 格式']) {
  test(`preserves an explicitly requested summary behind injected user-role context: ${text}`, async t => {
    const { adapter, bodies } = mockQoder(t, [() => response([{ content: checkpoint }])])
    const chunks = await collect(adapter.stream(options({ messages: [
      { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] },
      { role: 'user', source: { kind: 'time-context' }, content: [{ type: 'text', text: 'Current time: 2026-10-21.' }] },
    ] })))
    assert.equal(visible(chunks), checkpoint)
    assert.equal(bodies.length, 1)
  })
}

test('mentioning a summary bug is not itself a summary request', async t => {
  const { adapter, bodies } = mockQoder(t, [() => response([{ content: checkpoint }]), () => response([{ content: 'Fixed.' }])])
  const chunks = await collect(adapter.stream(options({ messages: [{ role: 'user', content: [{ type: 'text', text: 'Fix the <summary> leakage bug.' }] }] })))
  assert.equal(visible(chunks), 'Fixed.')
  assert.equal(bodies.length, 2)
})

for (const text of [
  '<analysis>Example</analysis><summary>A normal short example.</summary>',
  '<analysis>Reasoning about XML.</analysis>The answer is 42.',
  'Here is an XML example: ' + checkpoint,
  checkpoint + '\nThe actual answer follows.',
]) {
  test(`preserves ordinary answers and XML examples: ${text.slice(0, 55)}`, async t => {
    const { adapter, bodies } = mockQoder(t, [() => response([...text].map(content => ({ content })))])
    const chunks = await collect(adapter.stream(options()))
    assert.equal(visible(chunks), text)
    assert.equal(chunks.at(-1).reason.kind, 'stop')
    assert.equal(bodies.length, 1)
  })
}

test('already accepted tool calls are not replayed even when checkpoint-looking text follows', async t => {
  const { adapter, bodies } = mockQoder(t, [() => response([
    { tool_calls: [{ index: 0, id: 'real-call', function: { name: 'lookup', arguments: '{}' } }] },
    { content: checkpoint },
  ], 'tool_calls')])
  const chunks = await collect(adapter.stream(options()))
  assert.equal(chunks.filter(chunk => chunk.type === 'block-start' && chunk.blockType === 'tool-call').length, 1)
  assert.equal(chunks.at(-1).reason.kind, 'tool-calls')
  assert.equal(bodies.length, 1)
})

test('truncated checkpoints can recover while ordinary output limits and thinking failures retain their semantics', async t => {
  const { adapter, bodies } = mockQoder(t, [
    () => response([{ content: checkpoint.replace('</summary>', '') }], 'length'),
    () => response([{ content: 'Recovered.' }]),
    () => response([{ content: 'Partial answer.' }], 'length'),
    () => response([{ reasoning_content: 'Unfinished reasoning.' }]),
  ])
  assert.equal(visible(await collect(adapter.stream(options()))), 'Recovered.')
  assert.equal((await collect(adapter.stream(options()))).at(-1).reason.kind, 'max-tokens')
  const thinking = await collect(adapter.stream(options()))
  assert.equal(thinking.at(-1).reason.failure.code, 'QODER_INCOMPLETE_RESPONSE')
  assert.equal(bodies.length, 4)
})

test('remote conversations are isolated by host session, purpose and provider, with fresh one-shot sessions', async t => {
  const { adapter, bodies } = mockQoder(t, Array.from({ length: 8 }, () => () => response([{ content: 'OK' }])))
  for (const change of [{}, {}, { sessionId: 'host-session-b' }, { purpose: 'compaction' }, { purpose: 'session-title' }, { provider: 'another-route' }, { sessionId: undefined }, { sessionId: undefined }]) {
    await collect(adapter.stream(options(change)))
  }
  assert.equal(bodies[0].session_id, bodies[1].session_id)
  assert.equal(bodies[0].chat_record_id, bodies[1].chat_record_id)
  assert.equal(new Set([bodies[0], ...bodies.slice(2)].map(body => body.session_id)).size, 7)
  assert.equal(new Set([bodies[0], ...bodies.slice(2)].map(body => body.chat_record_id)).size, 7)
})

test('changed tool schemas and prompts do not alias request records inside one host session', async t => {
  const { adapter, bodies } = mockQoder(t, Array.from({ length: 3 }, () => () => response([{ content: 'OK' }])))
  await collect(adapter.stream(options()))
  await collect(adapter.stream(options({ tools: [{ ...tool, parameters: { type: 'object', properties: { key: { type: 'string' } } } }] })))
  await collect(adapter.stream(options({ system: 'A different instruction.' })))
  assert.equal(new Set(bodies.map(body => body.session_id)).size, 1)
  assert.equal(new Set(bodies.map(body => body.chat_record_id)).size, 3)
})

test('quarantines a checkpoint with Markdown quote separators between the closing analysis and summary', async t => {
  const { adapter, bodies } = mockQoder(t, [
    () => response([...checkpoint.replace('</analysis>', '</analysis>>\n>')].map(content => ({ content }))),
    () => response([{ content: 'Recovered.' }]),
  ])
  const chunks = await collect(adapter.stream(options()))
  assert.equal(visible(chunks), 'Recovered.')
  assert.equal(chunks.at(-1).reason.kind, 'stop')
  assert.equal(bodies.length, 2)
})
