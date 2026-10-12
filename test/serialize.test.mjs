import assert from 'node:assert/strict'
import test from 'node:test'
import { serializeMessages, lastUserText } from '../src/serialize.ts'

test('preserves tool-call/result ordering and ids in official request messages', async () => {
  const messages = [
    { role: 'user', content: [{ type: 'text', text: 'Inspect the file' }] },
    { role: 'assistant', content: [{ type: 'tool-call', id: 'call-1', name: 'read', arguments: '{"path":"file.txt"}' }] },
    { role: 'tool', toolCallId: 'call-1', isError: false, content: [{ type: 'text', text: 'file contents' }] },
    { role: 'tool', toolCallId: 'call-2', isError: false, content: [] },
  ]
  const wire = await serializeMessages({ messages })
  assert.deepEqual(wire, [
    { role: 'user', content: 'Inspect the file' },
    { role: 'assistant', content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'read', arguments: '{"path":"file.txt"}' } }] },
    { role: 'tool', tool_call_id: 'call-1', content: 'file contents' },
    { role: 'tool', tool_call_id: 'call-2', content: '(no output)' },
  ])
  assert.equal(lastUserText(messages), 'Inspect the file')
})
