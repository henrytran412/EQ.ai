// Streams camera frames and mic audio to the on-device perception service (services/perception)
// and receives its face/voice readings. Protocol: binary 0x01+JPEG, 0x02+Float32LE 16 kHz PCM; JSON readings back.

export type Estimate = { label: string; confidence: number; probs: Record<string, number> }
export type Reading = { face: (Estimate & { box: [number, number, number, number] | null }) | null; voice: Estimate | null }

const WS_URL: string = import.meta.env?.VITE_PERCEPTION_URL ?? ''
export const perceptionOn = !!WS_URL

export const VIDEO = 0x01
export const AUDIO = 0x02
const MAX_FRAME_BYTES = 500_000 // server closes the socket above this
const SAMPLE_RATE = 16000
const CHUNK_SAMPLES = SAMPLE_RATE / 4 // 250 ms = 16 KB, under the 64 KB limit

export function pack(tag: number, payload: ArrayBuffer): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(payload.byteLength + 1)
  out[0] = tag
  out.set(new Uint8Array(payload), 1)
  return out
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function estimate(e: any): Estimate | null {
  if (typeof e?.label !== 'string' || num(e.confidence) === null) return null
  const probs: Record<string, number> = {}
  for (const [k, v] of Object.entries(e.probs ?? {})) if (num(v) !== null) probs[k] = v as number
  return { label: e.label, confidence: e.confidence, probs }
}

// Untrusted server data: keep only well-formed fields.
export function parseReading(text: string): Reading | null {
  let d: any
  try {
    d = JSON.parse(text)
  } catch {
    return null
  }
  if (d?.type !== 'reading') return null
  const face = estimate(d.face)
  const box = Array.isArray(d.face?.box) && d.face.box.length === 4 && d.face.box.every((v: unknown) => num(v) !== null) ? d.face.box : null
  return { face: face && { ...face, box }, voice: estimate(d.voice) }
}

export function connectPerception(sessionId: string, onReading: (r: Reading) => void, onStatus: (open: boolean) => void) {
  // shortcut: no auto-reconnect; reload the page if the perception service restarts.
  const ws = new WebSocket(`${WS_URL}/ws/${encodeURIComponent(sessionId)}`)
  ws.binaryType = 'arraybuffer'
  ws.onopen = () => onStatus(true)
  ws.onclose = () => onStatus(false)
  ws.onmessage = (e) => {
    const r = typeof e.data === 'string' ? parseReading(e.data) : null
    if (r) onReading(r)
  }
  const send = (tag: number, payload: ArrayBuffer) => {
    if (ws.readyState === WebSocket.OPEN && payload.byteLength > 0) ws.send(pack(tag, payload))
  }
  return { send, close: () => ws.close() }
}

// Sends one JPEG (≤640 px wide) of the video every `everyMs`. Returns a stop function.
export function streamFrames(video: HTMLVideoElement, send: (tag: number, b: ArrayBuffer) => void, everyMs = 500): () => void {
  const canvas = document.createElement('canvas')
  const id = setInterval(() => {
    if (!video.videoWidth) return
    const scale = Math.min(1, 640 / video.videoWidth)
    canvas.width = Math.round(video.videoWidth * scale)
    canvas.height = Math.round(video.videoHeight * scale)
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height)
    canvas.toBlob(async (blob) => {
      if (blob && blob.size <= MAX_FRAME_BYTES) send(VIDEO, await blob.arrayBuffer())
    }, 'image/jpeg', 0.7)
  }, everyMs)
  return () => clearInterval(id)
}

// Copies each 128-sample render block to the main thread; outputs nothing, so the student hears nothing.
const WORKLET = `class Tap extends AudioWorkletProcessor {
  process(inputs) { const ch = inputs[0][0]; if (ch) this.port.postMessage(ch.slice(0)); return true }
}
registerProcessor('tap', Tap)`

// Captures the chosen mic at 16 kHz mono and sends 250 ms Float32 chunks. Returns a stop function.
export async function streamMic(micId: string, send: (tag: number, b: ArrayBuffer) => void): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: micId ? { deviceId: { exact: micId } } : true })
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE }) // the browser resamples the mic to 16 kHz
  await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' })))
  const node = new AudioWorkletNode(ctx, 'tap')
  let chunk = new Float32Array(CHUNK_SAMPLES)
  let n = 0
  node.port.onmessage = ({ data }: MessageEvent<Float32Array>) => {
    for (const sample of data) {
      chunk[n++] = sample
      if (n === CHUNK_SAMPLES) {
        send(AUDIO, chunk.buffer) // typed arrays are little-endian on every browser platform, matching "<f4"
        chunk = new Float32Array(CHUNK_SAMPLES)
        n = 0
      }
    }
  }
  ctx.createMediaStreamSource(stream).connect(node)
  node.connect(ctx.destination) // keeps the node pulled by the audio graph
  return () => {
    node.disconnect()
    void ctx.close()
    stream.getTracks().forEach((t) => t.stop())
  }
}
