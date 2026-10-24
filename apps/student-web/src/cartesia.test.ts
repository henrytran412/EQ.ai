import test from 'node:test'
import assert from 'node:assert/strict'
import { joinTurns, parseSttEvent, parseTtsEvent, sttUrl, toPcm16, ttsRequest, ttsUrl, type VoiceConfig } from './cartesia.ts'

const cfg: VoiceConfig = {
  token: 'tok',
  expires_in: 600,
  cartesia_version: '2026-08-14',
  tts: {
    url: 'wss://api.cartesia.ai/tts/websocket',
    model_id: 'sonic-3.6',
    voice_id: 'voice-1',
    output_format: { container: 'raw', encoding: 'pcm_f32le', sample_rate: 24000 },
  },
  stt: {
    url: 'wss://api.cartesia.ai/stt/turns/websocket',
    model: 'ink-2',
    encoding: 'pcm_s16le',
    sample_rate: 16000,
    language: 'en',
    keyterms: ['MySJSU', 'financial aid hold'],
  },
}

test('stt url carries the model settings, repeated keyterms, and the short-lived token', () => {
  const url = new URL(sttUrl(cfg))
  assert.equal(url.origin + url.pathname, 'wss://api.cartesia.ai/stt/turns/websocket')
  assert.equal(url.searchParams.get('model'), 'ink-2')
  assert.equal(url.searchParams.get('encoding'), 'pcm_s16le')
  assert.equal(url.searchParams.get('sample_rate'), '16000')
  assert.equal(url.searchParams.get('language'), 'en')
  assert.deepEqual(url.searchParams.getAll('keyterm'), ['MySJSU', 'financial aid hold'])
  assert.equal(url.searchParams.get('access_token'), 'tok')
  assert.equal(url.searchParams.get('cartesia_version'), '2026-08-14')
})

test('tts url has only the token and version', () => {
  const url = new URL(ttsUrl(cfg))
  assert.equal(url.origin + url.pathname, 'wss://api.cartesia.ai/tts/websocket')
  assert.deepEqual([...url.searchParams.keys()].sort(), ['access_token', 'cartesia_version'])
})

test('pcm16 conversion clips to the int16 range, little-endian', () => {
  const buf = toPcm16(new Float32Array([0, 1, -1, 0.5, 2, -2]))
  const view = new DataView(buf)
  const samples = Array.from({ length: 6 }, (_, i) => view.getInt16(i * 2, true))
  assert.deepEqual(samples, [0, 32767, -32768, 16383, 32767, -32768])
})

test('tts request applies the tone and keeps speed inside what Cartesia accepts', () => {
  const r = ttsRequest(cfg, 'Hello there.', { speed: 0.85, emotion: 'calm' }, 'ctx-1')
  assert.deepEqual(r, {
    context_id: 'ctx-1',
    model_id: 'sonic-3.6',
    voice: 'voice-1',
    transcript: 'Hello there.',
    language: 'en',
    output_format: { container: 'raw', encoding: 'pcm_f32le', sample_rate: 24000 },
    generation_config: { speed: 0.85, emotion: 'calm' },
  })
  assert.equal(ttsRequest(cfg, 'x', { speed: 3, emotion: 'calm' }, 'c').generation_config.speed, 1.5)
  assert.equal(ttsRequest(cfg, 'x', { speed: Number.NaN, emotion: '' }, 'c').generation_config.speed, 1)
  assert.equal('emotion' in ttsRequest(cfg, 'x', { speed: 1, emotion: '' }, 'c').generation_config, false)
})

test('stt events: turn text is cumulative within a turn; unknown and broken messages are ignored', () => {
  assert.deepEqual(parseSttEvent('{"type":"turn.start"}'), { type: 'turn.start' })
  assert.deepEqual(parseSttEvent('{"type":"turn.update","transcript":"I have a"}'), { type: 'turn.update', transcript: 'I have a' })
  assert.deepEqual(parseSttEvent('{"type":"turn.end","transcript":"I have a hold."}'), { type: 'turn.end', transcript: 'I have a hold.' })
  assert.deepEqual(parseSttEvent('{"type":"error","title":"Bad","message":"nope","status_code":400}'), { type: 'error', message: 'nope' })
  assert.equal(parseSttEvent('{"type":"connected","request_id":"r"}'), null)
  assert.equal(parseSttEvent('{"type":"turn.update","transcript":5}'), null)
  assert.equal(parseSttEvent('not json'), null)
})

test('turns are joined with single spaces (Cartesia sends no separators between turns)', () => {
  assert.equal(joinTurns(['I have a hold.', 'The deadline is Friday.', '']), 'I have a hold. The deadline is Friday.')
  assert.equal(joinTurns([]), '')
})

test('tts chunks decode from base64 little-endian float32', () => {
  const samples = new Float32Array([0.25, -0.5])
  const data = Buffer.from(samples.buffer).toString('base64')
  const ev = parseTtsEvent(JSON.stringify({ type: 'chunk', data, done: false, context_id: 'c', status_code: 206 }))
  assert.equal(ev?.type, 'chunk')
  assert.deepEqual(ev?.type === 'chunk' ? Array.from(ev.audio) : null, [0.25, -0.5])
  assert.deepEqual(parseTtsEvent('{"type":"done","done":true,"context_id":"c","status_code":206}'), { type: 'done' })
  assert.deepEqual(parseTtsEvent('{"type":"error","title":"T","message":"m","status_code":500}'), { type: 'error', message: 'm' })
  assert.equal(parseTtsEvent('{"type":"timestamps"}'), null)
})
