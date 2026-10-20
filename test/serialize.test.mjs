import assert from 'node:assert/strict'
import test from 'node:test'
import { serializeMessages } from '../src/serialize.ts'

test('pure tool-call turns retain their assistant and all paired results on the Qoder wire', async () => {
  const calls = [
    { type: 'tool-call', id: 'call-1', name: 'read', arguments: '{"path":"file.txt"}' },
    { type: 'tool-call', id: 'call-2', name: 'read', arguments: '{"path":"empty.txt"}' },
  ]
  const messages = [
    { role: 'user', content: [{ type: 'text', text: 'Inspect the files' }] },
    { role: 'assistant', content: calls },
    { role: 'tool', toolCallId: 'call-1', content: [{ type: 'text', text: 'file contents' }] },
    { role: 'tool', toolCallId: 'call-2', content: [] },
  ]
  const original = structuredClone(messages)
  const wire = await serializeMessages({ messages })
  // The gateway must not discard the assistant before forwarding its tool results.
  assert.equal(typeof wire[1].content, 'string')
  assert.ok(wire[1].content.trim().length > 0)
  assert.deepEqual(wire.map(message => message.role), ['user', 'assistant', 'tool', 'tool'])
  assert.deepEqual(wire[1].tool_calls, calls.map(call => ({
    id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments },
  })))
  assert.deepEqual(wire.slice(2), [
    { role: 'tool', tool_call_id: 'call-1', content: 'file contents' },
    { role: 'tool', tool_call_id: 'call-2', content: '(no output)' },
  ])
  assert.deepEqual(messages, original)
})

test('tool-call compatibility does not replace existing assistant text or reasoning', async () => {
  const call = { type: 'tool-call', id: 'call-1', name: 'read', arguments: '{}' }
  const wire = await serializeMessages({ messages: [
    { role: 'assistant', content: [{ type: 'text', text: 'Reading now.' }, call] },
    { role: 'assistant', content: [{ type: 'reasoning', text: 'Need the file.' }, call] },
    { role: 'assistant', content: [{ type: 'text', text: 'Finished.' }] },
  ] })
  assert.deepEqual(wire.map(message => message.content), [
    'Reading now.', '<thinking>Need the file.</thinking>\n\n', 'Finished.',
  ])
  assert.equal(wire[2].tool_calls, undefined)
})
