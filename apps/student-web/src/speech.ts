// The bear's voice. With the dialogue service configured, Cartesia does both directions: Ink 2 turns the student's
// speech into text (their audio goes to Cartesia's cloud, which the setup screen discloses) and Sonic speaks each
// reply with the emotion and speed the tone policy picked. Without a service (demo mode) the browser's own speech
// is used instead; Chrome's SpeechRecognition sends audio to Google, which the setup screen also discloses.
import { joinTurns, parseSttEvent, parseTtsEvent, sttUrl, toPcm16, ttsRequest, ttsUrl, voiceConfig, type Tone } from './cartesia'
import { streamMic } from './perception'

const API_URL: string = import.meta.env.VITE_API_URL ?? ''
export const cartesiaVoice = !!API_URL

type Result = { isFinal: boolean; 0: { transcript: string } }
type Recognizer = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: (e: { resultIndex: number; results: ArrayLike<Result> }) => void
  onend: () => void
  onerror: (e: { error: string }) => void
  start: () => void
  stop: () => void
}
const w = window as unknown as { SpeechRecognition?: new () => Recognizer; webkitSpeechRecognition?: new () => Recognizer }
const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition

export const canListen = cartesiaVoice ? !!navigator.mediaDevices?.getUserMedia && typeof AudioWorkletNode !== 'undefined' : !!SR

const FATAL: Record<string, string> = {
  'not-allowed': 'Microphone is blocked. Allow it from the icon in the address bar.',
  'service-not-allowed': 'This browser blocked speech recognition. Try Chrome, or switch Talk to Text.',
  'audio-capture': 'No microphone was found.',
  network: "Speech recognition couldn't reach its service. Try Chrome, or switch Talk to Text.",
  'language-not-supported': 'Speech recognition does not support this language here.',
}
const MIC_BLOCKED = "Couldn't open the microphone. Allow it from the icon in the address bar, or switch Talk to Text."
const MAX_LISTEN_MS = 60_000 // safety stop if no end of turn is ever detected (constant background noise)

type Handlers = { onInterim: (text: string) => void; onFinal: (text: string) => void; onEnd: (error?: string) => void }
// The selected mic; while listening its audio also goes to `onAudio` (the on-device voice emotion service).
export type Mic = { micId: string; onAudio?: (tag: number, payload: ArrayBuffer) => void }

// One tap: wait up to `noSpeechMs` for speech, then listen until the student's turn ends.
// While `held()` is true (push-to-talk) it keeps listening across pauses; the caller stops it on release.
// The returned function stops listening early and sends whatever was heard.
export function listen(handlers: Handlers, mic: Mic, held = () => false, noSpeechMs = 5000): () => void {
  return cartesiaVoice ? listenCartesia(handlers, mic, held, noSpeechMs) : listenBrowser(handlers, mic, held, noSpeechMs)
}

function listenCartesia({ onInterim, onFinal, onEnd }: Handlers, mic: Mic, held: () => boolean, noSpeechMs: number) {
  const turns: string[] = [] // finished turns
  let current = '' // the turn in progress (cumulative)
  let state: 'listening' | 'closing' | 'done' = 'listening'
  let error: string | undefined
  let ws: WebSocket | null = null
  let queued: ArrayBuffer[] = [] // mic audio captured before the socket opened
  let stopMic = () => {}

  const deliver = () => {
    if (state === 'done') return
    state = 'done'
    clearTimeout(noSpeech)
    clearTimeout(maxTimer)
    clearTimeout(closeTimer)
    stopMic()
    ws?.close()
    const text = joinTurns([...turns, current])
    if (text) onFinal(text)
    onEnd(error)
  }
  // Stop: no more mic audio; Cartesia transcribes what it has buffered, then closes the socket (or 4 s pass).
  const finish = () => {
    if (state !== 'listening') return
    stopMic() // first, while still listening: it sends the last partial chunk (the end of the last word)
    state = 'closing'
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'close' }))
    else if (ws && ws.readyState !== WebSocket.CONNECTING) return deliver() // socket already gone
    closeTimer = setTimeout(deliver, 4000) // no socket yet (token loading) or connecting: onopen sends close
  }
  let closeTimer: ReturnType<typeof setTimeout> | undefined
  let noSpeech = setTimeout(() => !held() && finish(), noSpeechMs)
  const maxTimer = setTimeout(finish, MAX_LISTEN_MS)

  streamMic(
    mic.micId,
    (tag, payload) => {
      mic.onAudio?.(tag, payload)
      if (state !== 'listening') return
      const pcm = toPcm16(new Float32Array(payload))
      if (ws?.readyState === WebSocket.OPEN) ws.send(pcm)
      else queued.push(pcm)
    },
    () => {
      error = 'The microphone disconnected. Tap Talk to use another one, or switch Talk to Text.'
      finish() // e.g. a Bluetooth headset turned off: send what was heard instead of waiting
    },
  ).then(
    (stop) => (state === 'listening' ? (stopMic = stop) : stop()),
    () => {
      error = MIC_BLOCKED
      deliver()
    },
  )

  voiceConfig(API_URL).then(
    (cfg) => {
      if (state === 'done') return
      const socket = new WebSocket(sttUrl(cfg))
      ws = socket
      socket.binaryType = 'arraybuffer'
      socket.onopen = () => {
        queued.forEach((pcm) => socket.send(pcm))
        queued = []
        if (state === 'closing') socket.send(JSON.stringify({ type: 'close' }))
      }
      socket.onmessage = (e) => {
        const ev = typeof e.data === 'string' && state !== 'done' ? parseSttEvent(e.data) : null
        if (!ev) return
        if (ev.type === 'error') {
          error = "Speech-to-text stopped working. Try again, or switch Talk to Text."
          return deliver()
        }
        if (ev.type === 'turn.start' || ev.type === 'turn.update') clearTimeout(noSpeech) // the student is talking
        if (ev.type === 'turn.update' || ev.type === 'turn.eager_end') {
          current = ev.transcript
          onInterim(joinTurns([...turns, current]))
        }
        if (ev.type === 'turn.end') {
          turns.push(ev.transcript)
          current = ''
          onInterim(joinTurns(turns))
          if (state === 'listening' && !held()) deliver() // Cartesia heard the end of the sentence: send it now
        }
      }
      socket.onclose = () => {
        if (state === 'listening') error = "Lost the connection to speech-to-text. Try again, or switch Talk to Text."
        deliver()
      }
    },
    (e: Error) => {
      error = e.message
      deliver()
    },
  )
  return finish
}

function listenBrowser({ onInterim, onFinal, onEnd }: Handlers, mic: Mic, held: () => boolean, noSpeechMs: number, silenceMs = 1500) {
  if (!SR) {
    onEnd('This browser has no speech recognition. Use Chrome, or switch Talk to Text.')
    return () => {}
  }
  // Recognition uses the system default mic; the selected mic still feeds the voice emotion estimate.
  let stopMic = () => {}
  let micDone = false
  if (mic.onAudio)
    streamMic(mic.micId, mic.onAudio).then(
      (stop) => (micDone ? stop() : (stopMic = stop)),
      () => {},
    )
  const r = new SR()
  r.lang = 'en-US'
  r.continuous = true
  r.interimResults = true
  let finalText = ''
  let pending = ''
  let done = false
  let error: string | undefined
  let restarts = 0

  const finish = () => {
    if (done) return
    done = true
    clearTimeout(timer)
    r.stop()
  }
  const autoStop = () => !held() && finish()
  let timer = setTimeout(autoStop, noSpeechMs)

  r.onresult = (e) => {
    pending = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) finalText += e.results[i][0].transcript + ' '
      else pending += e.results[i][0].transcript
    }
    onInterim((finalText + pending).trim())
    clearTimeout(timer)
    timer = setTimeout(autoStop, silenceMs)
  }
  r.onerror = (e) => {
    if (FATAL[e.error]) {
      error = FATAL[e.error]
      done = true
    } // "no-speech" and "aborted" are not fatal: our own timers decide when to stop
  }
  r.onend = () => {
    // Browsers sometimes end the session early; restart so the 5-second window and the student's sentence survive.
    if (!done && restarts++ < 3) {
      try {
        return r.start()
      } catch {}
    }
    clearTimeout(timer)
    micDone = true
    stopMic()
    const text = (finalText + pending).trim()
    if (text) onFinal(text)
    onEnd(error)
  }
  r.start()
  return finish // manual stop sends whatever was heard
}

let player: AudioContext | null = null
let stopCurrent = () => {}

// Call inside a tap or click: phones (iOS Safari) only let audio start from a user action, and the bear's reply
// arrives later, outside any tap. Creating and resuming the context here makes later playback allowed.
export function unlockAudio() {
  if (!cartesiaVoice) return
  player ??= new AudioContext()
  void player.resume()
}

// Speaks `text`; onStart when sound begins, onEnd when it finishes or is stopped. If Cartesia can't speak this
// reply, the browser voice reads it instead, so the student always hears an answer.
export function speak(text: string, tone: Tone, onStart: () => void, onEnd: () => void) {
  stopSpeaking()
  if (!cartesiaVoice) return speakBrowser(text, tone.speed, onStart, onEnd)
  let started = false
  let finished = false // all audio received
  let over = false
  let ws: WebSocket | null = null
  let nextAt = 0
  const sources = new Set<AudioBufferSourceNode>()

  const end = () => {
    if (over) return
    over = true
    ws?.close()
    onEnd()
  }
  const failed = () => {
    if (over) return
    if (started) {
      finished = true // keep what already played, then end
      if (sources.size === 0) end()
      return
    }
    over = true
    ws?.close()
    speakBrowser(text, tone.speed, onStart, onEnd)
  }
  stopCurrent = () => {
    sources.forEach((s) => {
      s.onended = null
      s.stop()
    })
    sources.clear()
    end()
  }

  voiceConfig(API_URL).then((cfg) => {
    if (over) return
    const rate = cfg.tts.output_format.sample_rate
    const ctx = (player ??= new AudioContext()) // buffers keep Cartesia's 24 kHz; the browser resamples on playback
    void ctx.resume()
    const socket = new WebSocket(ttsUrl(cfg))
    ws = socket
    socket.onopen = () => socket.send(JSON.stringify(ttsRequest(cfg, text, tone, crypto.randomUUID())))
    socket.onmessage = (e) => {
      const ev = typeof e.data === 'string' && !over ? parseTtsEvent(e.data) : null
      if (!ev) return
      if (ev.type === 'error') return failed()
      if (ev.type === 'done') {
        finished = true
        socket.close()
        if (sources.size === 0) end()
        return
      }
      if (!ev.audio.length) return
      const buffer = ctx.createBuffer(1, ev.audio.length, rate)
      buffer.copyToChannel(ev.audio, 0)
      const src = ctx.createBufferSource()
      src.buffer = buffer
      src.connect(ctx.destination)
      nextAt = Math.max(nextAt, ctx.currentTime + 0.05) // chunks play back to back
      src.start(nextAt)
      nextAt += buffer.duration
      sources.add(src)
      src.onended = () => {
        sources.delete(src)
        if (finished && sources.size === 0) end()
      }
      if (!started) {
        started = true
        onStart()
      }
    }
    socket.onclose = () => !finished && failed()
  }, failed)
}

function speakBrowser(text: string, rate: number, onStart: () => void, onEnd: () => void) {
  if (!globalThis.speechSynthesis) return onEnd() // some in-app browsers have no speech: the reply stays as text
  speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.rate = rate
  u.onstart = onStart
  u.onend = onEnd
  u.onerror = onEnd
  speechSynthesis.speak(u)
}

export function stopSpeaking() {
  stopCurrent()
  stopCurrent = () => {}
  globalThis.speechSynthesis?.cancel()
}
