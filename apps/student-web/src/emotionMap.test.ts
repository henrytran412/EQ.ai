import assert from 'node:assert/strict'
import test from 'node:test'
import { BLENDS, NODES, activate } from './emotionMap.ts'

test('emotion map: strongest report wins, blends need both parts', () => {
  const lit = activate([
    { label: 'words', probs: { confused: 0.8 } },
    { label: 'face', probs: { fear: 0.5, sad: 0, confused: 0.2, made_up: 0.9 } },
    { label: 'voice', probs: null },
  ])
  assert.equal(lit.confused.level, 0.8)
  assert.equal(lit.confused.why, 'words 80%, face 20%')
  assert.ok(Math.abs(lit.overwhelmed.level - Math.sqrt(0.8 * 0.5)) < 1e-9)
  assert.equal(lit.despair, undefined) // sad is 0
  assert.equal(lit.made_up, undefined)
})

test('emotion map: every blend is made of mapped emotions', () => {
  for (const { of } of Object.values(BLENDS)) for (const part of of) assert.ok(part in NODES, part)
})
