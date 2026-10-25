import test from 'node:test'
import assert from 'node:assert/strict'
import { parseHandoff } from './handoff.ts'

const stored = {
  id: 'abc123',
  student_name: 'Mai',
  topic: 'financial_aid_hold',
  note: {
    problem: 'A hold blocks registration.',
    deadline: 'Friday',
    tried: ['Uploaded the form'],
    next_step: 'Check the To Do list.',
    mood: 'Seemed calm, then frustrated.',
    hard_moments: [{ quote: 'the hold is still there', estimate: 'frustrated', reason: 'Still blocked after uploading.' }],
  },
  note_source: 'claude',
  timeline: [
    { turn: 0, label: 'neutral', confidence: 0.6 },
    { turn: 2, label: 'frustrated', confidence: 0.75 },
  ],
  transcript: [
    { role: 'student', text: 'I have a hold.' },
    { role: 'assistant', text: 'Check MySJSU.' },
    { role: 'student', text: 'I uploaded it and the hold is still there!' },
  ],
  created_at: 1700000000000,
}

test('a stored handoff from the service is kept as is', () => {
  const h = parseHandoff(stored)!
  assert.equal(h.note?.deadline, 'Friday')
  assert.equal(h.note_source, 'claude')
  assert.equal(h.mood, 'Seemed calm, then frustrated.')
  assert.deepEqual(h.hard_moments, stored.note.hard_moments)
  assert.deepEqual(h.timeline, stored.timeline)
  assert.deepEqual(h.transcript, stored.transcript)
})

test('malformed handoff data is rejected or cleaned', () => {
  assert.equal(parseHandoff(null), null)
  assert.equal(parseHandoff({ ...stored, transcript: 'x' }), null)
  const h = parseHandoff({
    ...stored,
    note: { ...stored.note, mood: 5, hard_moments: [{ quote: '', reason: 'x' }, 'bad'] },
    timeline: [
      { turn: 1, label: 'confused', confidence: 0.5 }, // EQ.ai's message, not the student's
      { turn: 7, label: 'sad', confidence: 0.5 }, // no such message
      { turn: 2, label: 'frustrated', confidence: 'high' },
      { turn: 0, label: 'neutral', confidence: 0.6 },
    ],
  })!
  assert.equal(h.mood, undefined)
  assert.deepEqual(h.hard_moments, [])
  assert.deepEqual(h.timeline, [{ turn: 0, label: 'neutral', confidence: 0.6 }])
})

test('without a usable note, the advisor gets the student own words', () => {
  const h = parseHandoff({ ...stored, note: null, note_source: 'claude' })!
  assert.equal(h.note_source, 'fallback')
  assert.match(h.note!.problem, /I have a hold/)
})
