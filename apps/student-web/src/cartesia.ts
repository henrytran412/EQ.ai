// Cartesia message formats for the bear's voice: Ink 2 speech-to-text with turn detection, Sonic text-to-speech.
// The dialogue service mints a short-lived access token (POST /voice/token), so the API key never reaches the page.
// Formats follow cartesia-js 4.2.0 and were checked against the live API on 2026-10-24.

export type VoiceConfig = {
  token: string
  expires_in: number
  cartesia_version: string
  tts: { url: string; model_id: string; voice_id: string; output_format: { container: string; encoding: string; sample_rate: number } }
  stt: { url: string; model: string; encoding: string; sample_rate: number; language: string; keyterms?: string[] }
}
export type Tone = { speed: number; emotion: string }

function socketUrl(base: string, cfg: VoiceConfig, params: Record<string, string | number | string[]> = {}): string {
  const url = new URL(base)
  for (const [key, value] of Object.entries(params)) for (const one of [value].flat()) url.searchParams.append(key, String(one))
  url.searchParams.set('access_token', cfg.token) // browsers can't set headers on a WebSocket
  url.searchParams.set('cartesia_version', cfg.cartesia_version)
  return url.toString()
}

export const ttsUrl = (cfg: VoiceConfig) => socketUrl(cfg.tts.url, cfg)
export const sttUrl = (cfg: VoiceConfig) =>
  socketUrl(cfg.stt.url, cfg, {
    model: cfg.stt.model,
    encoding: cfg.stt.encoding,
    sample_rate: cfg.stt.sample_rate,
    language: cfg.stt.language,
    keyterm: cfg.stt.keyterms ?? [],
  })

// Float32 in [-1, 1] to 16-bit PCM; typed arrays are little-endian on every browser platform, matching pcm_s16le.
export function toPcm16(samples: Float32Array): ArrayBuffer {
  const out = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out.buffer
}

export function ttsRequest(cfg: VoiceConfig, text: string, tone: Tone, contextId: string) {
  const speed = Number.isFinite(tone.speed) ? Math.min(1.5, Math.max(0.6, tone.speed)) : 1 // Cartesia accepts 0.6-1.5
  return {
    context_id: contextId,
    model_id: cfg.tts.model_id,
    voice: cfg.tts.voice_id,
    transcript: text,
    language: 'en',
    output_format: cfg.tts.output_format,
    generation_config: tone.emotion ? { speed, emotion: tone.emotion } : { speed },
  }
}

export type SttEvent =
  | { type: 'turn.start' | 'turn.resume' }
  | { type: 'turn.update' | 'turn.eager_end' | 'turn.end'; transcript: string }
  | { type: 'error'; message: string }

const parse = (text: string): any => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

// Untrusted network data: keep only the fields we use. Turn transcripts are cumulative within one turn.
export function parseSttEvent(text: string): SttEvent | null {
  const d = parse(text)
  if (d?.type === 'turn.start' || d?.type === 'turn.resume') return { type: d.type }
  if ((d?.type === 'turn.update' || d?.type === 'turn.eager_end' || d?.type === 'turn.end') && typeof d.transcript === 'string')
    return { type: d.type, transcript: d.transcript }
  if (d?.type === 'error') return { type: 'error', message: String(d.message ?? d.title ?? 'speech-to-text error') }
  return null // "connected" and anything newer
}

// Cartesia sends no separator between turns, so join them with one space.
export const joinTurns = (turns: string[]) => turns.map((t) => t.trim()).filter(Boolean).join(' ')

export type TtsEvent = { type: 'chunk'; audio: Float32Array<ArrayBuffer> } | { type: 'done' } | { type: 'error'; message: string }

export function parseTtsEvent(text: string): TtsEvent | null {
  const d = parse(text)
  if (d?.type === 'chunk' && typeof d.data === 'string') {
    const bytes = Uint8Array.from(atob(d.data), (c) => c.charCodeAt(0)) // base64 pcm_f32le
    return { type: 'chunk', audio: new Float32Array(bytes.buffer, 0, bytes.byteLength >> 2) }
  }
  if (d?.type === 'done') return { type: 'done' }
  if (d?.type === 'error') return { type: 'error', message: String(d.message ?? d.title ?? 'text-to-speech error') }
  return null // timestamps, flush_done
}

let cached: { cfg: VoiceConfig; until: number } | null = null

// One token serves every socket until a minute before it expires (the server rate-limits minting).
export async function voiceConfig(apiUrl: string): Promise<VoiceConfig> {
  if (cached && Date.now() < cached.until) return cached.cfg
  const res = await fetch(`${apiUrl}/voice/token`, { method: 'POST' })
  if (res.status === 429) throw new Error('Voice is busy right now. Wait a few minutes, or switch Talk to Text.')
  if (!res.ok) throw new Error('Voice is unavailable right now. Switch Talk to Text.')
  const cfg = (await res.json()) as VoiceConfig
  if (typeof cfg?.token !== 'string' || !cfg.tts?.url || !cfg.stt?.url) throw new Error('Voice is unavailable right now. Switch Talk to Text.')
  cached = { cfg, until: Date.now() + Math.max(0, cfg.expires_in - 60) * 1000 }
  return cfg
}
