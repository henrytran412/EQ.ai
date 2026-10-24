import test from 'node:test'
import assert from 'node:assert/strict'
import { demoRespond, estimateFromText, normalizeResponse } from './policy.ts'

test('API response: unknown state/expression fall back, bad links and speeds are dropped', () => {
  const r = normalizeResponse({
    reply: { text: 'hi', citations: [{ title: 'ok', url: 'https://sjsu.edu' }, { title: 'bad', url: 'javascript:alert(1)' }] },
    tone: { state: 'nervous', avatar_expression: 'nervous', tts_params: { speed: 9 } },
  })
  assert.equal(r.tone.state, 'nervous')
  assert.equal(r.tone.avatar_expression, 'neutral')
  assert.equal(r.tone.tts_params.speed, 1)
  assert.deepEqual(r.reply.citations.map((c) => c.title), ['ok'])
  assert.equal(r.behavior.offer_handoff, false)
  assert.throws(() => normalizeResponse({}))
})

const req = (text: string, extra = {}) => ({
  session_id: 's',
  topic: 'financial_aid_hold',
  text,
  history: [],
  awaiting_confirmation: false,
  ...extra,
})

test('estimates from text', () => {
  assert.equal(estimateFromText('I have a hold on my account').label, 'neutral')
  assert.equal(estimateFromText("I don't understand what this means").label, 'confused')
  assert.equal(estimateFromText('This is ridiculous, I already called twice!!').label, 'frustrated')
  assert.equal(estimateFromText('I feel hopeless').label, 'distress')
})

test('frustration asks first and never offers handoff on the estimate alone', () => {
  const r = demoRespond(req('ugh this is not working again'))
  assert.equal(r.tone.ask_confirmation, true)
  assert.equal(r.behavior.offer_handoff, false)
})

test('confirmed frustration offers handoff, correction does not', () => {
  assert.equal(demoRespond(req('yes', { awaiting_confirmation: true })).behavior.offer_handoff, true)
  assert.equal(demoRespond(req("no, I'm okay", { awaiting_confirmation: true })).behavior.offer_handoff, false)
})

test('distress surfaces 988 and offers a person', () => {
  const r = demoRespond(req('I want to die'))
  assert.equal(r.behavior.mode, 'distress')
  assert.match(r.reply.text, /988/)
  assert.equal(r.behavior.offer_handoff, true)
})

test('confused slows the voice down', () => {
  assert.ok(demoRespond(req('what does that mean??')).tone.tts_params.speed < 1)
})
