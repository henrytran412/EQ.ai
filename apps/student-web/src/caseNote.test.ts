import test from 'node:test'
import assert from 'node:assert/strict'
import { localNote, normalizeNote } from './caseNote.ts'

const said = ['I have a financial aid hold.', 'The deadline is Friday.']

test('a well-formed Claude note is kept', () => {
  const r = normalizeNote(
    {
      source: 'claude',
      summary: { problem: ' Aid hold blocks registration. ', deadline: 'Friday', tried: ['Uploaded the form', 5, ''], next_step: 'Check To Do list.' },
    },
    said,
  )
  assert.equal(r.source, 'claude')
  assert.deepEqual(r.note, { problem: 'Aid hold blocks registration.', deadline: 'Friday', tried: ['Uploaded the form'], next_step: 'Check To Do list.' })
})

test('a missing or broken note falls back to the student own words', () => {
  for (const junk of [null, {}, { summary: { problem: '' } }, { summary: 'text' }]) {
    const r = normalizeNote(junk, said)
    assert.equal(r.source, 'fallback')
    assert.equal(r.note.problem, 'I have a financial aid hold. / The deadline is Friday.')
    assert.equal(r.note.deadline, null)
  }
})

test('an empty deadline becomes null and unknown sources count as fallback', () => {
  const r = normalizeNote({ source: 'other', summary: { problem: 'p', deadline: '  ', tried: 'x', next_step: '' } }, said)
  assert.equal(r.source, 'fallback')
  assert.equal(r.note.deadline, null)
  assert.deepEqual(r.note.tried, [])
  assert.ok(r.note.next_step.length > 0)
})

test('no student messages yet', () => {
  assert.match(localNote([]).problem, /hasn't described/)
  assert.equal(localNote(['a', 'b', 'c', 'd', 'e']).problem, 'b / c / d / e') // last four messages
})
