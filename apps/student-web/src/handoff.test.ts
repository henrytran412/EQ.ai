import test from 'node:test'
import assert from 'node:assert/strict'
import { parseHandoff } from './handoff.ts'

const stored = {
  id: 'abc123',
  version: 3,
  student_name: 'Mai',
  topic: 'financial_aid_hold',
  note: { problem: 'A hold blocks registration.', deadline: 'Friday', tried: ['Uploaded the form'], next_step: 'Check the To Do list.' },
  note_source: 'claude',
  emotion: null,
  transcript: [
    { role: 'student', text: 'I have a hold.' },
    { role: 'assistant', text: 'Check MySJSU.' },
  ],
  status: 'active',
  staff_id: 'Advisor (demo)',
  messages: [{ from: 'staff', text: 'Hi Mai', at: 1700000000000 }],
  created_at: 1700000000000,
}

test('a stored handoff from the service is kept as is', () => {
  const h = parseHandoff(stored)!
  assert.equal(h.version, 3)
  assert.equal(h.note?.deadline, 'Friday')
  assert.equal(h.note_source, 'claude')
  assert.equal(h.emotion, undefined) // not shared
  assert.deepEqual(h.transcript, stored.transcript)
  assert.deepEqual(h.messages, stored.messages)
})

test('malformed handoff data is rejected or cleaned', () => {
  assert.equal(parseHandoff(null), null)
  assert.equal(parseHandoff({ ...stored, status: 'deleted' }), null)
  assert.equal(parseHandoff({ ...stored, messages: 'x' }), null)
  const h = parseHandoff({
    ...stored,
    messages: [{ from: 'hacker', text: 'x' }, { from: 'student', text: 5 }, { from: 'student', text: 'ok' }],
    transcript: [{ role: 'system', text: 'x' }, { role: 'student', text: 'I have a hold.' }],
    emotion: { label: 'frustrated', confidence: 'high' },
  })!
  assert.deepEqual(h.messages.map((m) => m.text), ['ok'])
  assert.deepEqual(h.transcript, [{ role: 'student', text: 'I have a hold.' }])
  assert.equal(h.emotion, undefined)
})

test('without a usable note, the advisor gets the student own words', () => {
  const h = parseHandoff({ ...stored, note: null, note_source: 'claude' })!
  assert.equal(h.note_source, 'fallback')
  assert.match(h.note!.problem, /I have a hold/)
})
