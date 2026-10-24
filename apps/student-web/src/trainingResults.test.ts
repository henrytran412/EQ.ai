import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { FACE_EMOTIONS, FACE_MODEL, MODELS, VOICE_EMOTIONS, VOICE_MODEL } from './trainingResults.ts'

const repo = fileURLToPath(new URL('../../../', import.meta.url))

for (const [model, rows] of [[FACE_MODEL, FACE_EMOTIONS], [VOICE_MODEL, VOICE_EMOTIONS]] as const) {
  test(`${model.id}: class results reconcile with the displayed test scores`, () => {
    assert.equal(rows.length, 7)
    assert.equal(rows.reduce((total, row) => total + row.support, 0), model.samples)
    const macroF1 = rows.reduce((total, row) => total + row.f1, 0) / rows.length
    const accuracy = rows.reduce((total, row) => total + row.recall * row.support, 0) / model.samples
    assert.ok(Math.abs(macroF1 - model.kaggle.macroF1) < 1e-12)
    assert.ok(Math.abs(accuracy - model.kaggle.accuracy) < 1e-12)
  })
}

for (const model of MODELS) {
  const source = resolve(repo, model.source)
  test(`${model.id}: published snapshot matches the saved training artifact`, {
    skip: !existsSync(source) && 'Training artifacts are local and gitignored',
  }, () => {
    const saved = JSON.parse(readFileSync(source, 'utf8')).test
    assert.equal(model.kaggle.accuracy, saved.accuracy)
    assert.equal(model.kaggle.macroF1, saved.macro_f1)
    const rows = model.id === FACE_MODEL.id ? FACE_EMOTIONS : model.id === VOICE_MODEL.id ? VOICE_EMOTIONS : []
    for (const row of rows) {
      const original = saved.per_class[row.emotion.toLowerCase()]
      assert.equal(row.f1, original.f1)
      assert.equal(row.recall, original.recall)
      assert.equal(row.support, original.support)
    }
  })
}

test('ONNX snapshot matches the separately recorded local re-scores', () => {
  const source = readFileSync(resolve(repo, 'training/RESULTS.md'), 'utf8')
  const labels = ['**face_convnext**', 'MobileNetV3-Large (baseline)', '**voice_wavlm**', 'voice_mel']
  MODELS.forEach((model, i) => {
    const line = source.split('\n').find((row) => row.startsWith(`| ${labels[i]}`))
    assert.ok(line, `${model.name}: missing source row`)
    const column = line.split('|')[model.id === 'face_mnv3' ? 4 : 5]
    assert.ok(column.includes(`${model.onnx.accuracy.toFixed(3)} / ${model.onnx.macroF1.toFixed(3)}`), model.name)
  })
})
