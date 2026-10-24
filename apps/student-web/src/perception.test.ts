import test from 'node:test'
import assert from 'node:assert/strict'
import { AUDIO, pack, parseReading } from './perception.ts'

test('pack prefixes the type byte', () => {
  const out = pack(AUDIO, new Float32Array([0.5]).buffer)
  assert.equal(out[0], 0x02)
  assert.equal(out.length, 5)
  assert.equal(new DataView(out.buffer).getFloat32(1, true), 0.5) // little-endian, as the server reads it
})

test('parseReading keeps well-formed readings and drops junk', () => {
  const r = parseReading(
    JSON.stringify({
      type: 'reading',
      face: { label: 'sad', confidence: 0.7, probs: { sad: 0.7, happy: 'x' }, box: [0.1, 0.2, 0.3, 0.4] },
      voice: null,
    }),
  )
  assert.deepEqual(r?.face, { label: 'sad', confidence: 0.7, probs: { sad: 0.7 }, box: [0.1, 0.2, 0.3, 0.4] })
  assert.equal(r?.voice, null)
  assert.equal(parseReading(JSON.stringify({ type: 'reading', face: { label: 'sad', confidence: 0.5, box: [1, 2] }, voice: null }))?.face?.box, null)
  assert.equal(parseReading('not json'), null)
  assert.equal(parseReading(JSON.stringify({ type: 'other' })), null)
  assert.equal(parseReading(JSON.stringify({ type: 'reading', face: { label: 5 }, voice: {} }))?.face, null)
})
