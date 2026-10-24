import { useEffect, useRef, useState, type FormEvent, type PointerEvent } from 'react'
import Bear from './Bear'
import EmotionNetwork from './EmotionNetwork'
import Landing from './Landing'
import { askAssistant, isDemo, summarizeHandoff } from './api'
import CaseNoteFields from './CaseNoteView'
import { publish, subscribe, type Handoff } from './handoff'
import { connectPerception, perceptionOn, streamFrames, type Estimate, type Reading } from './perception'
import { TOPICS, type ChatResponse, type EmotionEstimate, type Expression } from './policy'
import type { Tone } from './cartesia'
import { canListen, cartesiaVoice, listen, speak, stopSpeaking } from './speech'

type IO = 'voice' | 'text'
type Settings = {
  name: string
  topic: string
  input: IO
  output: IO
  camera: MediaStream | null
  camId: string // '' = system default
  micId: string
}
type Update = (s: Partial<Settings>) => void

let cameraBusy = false // overlapping requests would leak a stream and keep the camera light on

// Returns an error message, or '' on success (or when a request is already running).
async function setCamera(on: boolean, current: MediaStream | null, update: Update, camId: string): Promise<string> {
  if (cameraBusy) return ''
  cameraBusy = true
  try {
    current?.getTracks().forEach((t) => t.stop())
    update({ camera: null })
    if (!on) return ''
    for (let attempt = 0; ; attempt++) {
      try {
        update({ camera: await navigator.mediaDevices.getUserMedia({ video: camId ? { deviceId: { exact: camId } } : true }) })
        return ''
      } catch (e) {
        if ((e as DOMException).name === 'NotAllowedError')
          return 'Camera access was blocked. You can allow it from the icon in the address bar.'
        if (attempt === 1) return "Couldn't start the camera. Close other apps that use it, or pick another camera."
        await new Promise((r) => setTimeout(r, 500)) // the camera is often still releasing right after "off"
      }
    }
  } finally {
    cameraBusy = false
  }
}

export default function App() {
  const [screen, setScreen] = useState<'landing' | 'login' | 'setup' | 'chat'>('landing')
  const [settings, setSettings] = useState<Settings>({
    name: '',
    topic: TOPICS[0].id,
    input: canListen ? 'voice' : 'text',
    output: 'voice',
    camera: null,
    camId: '',
    micId: '',
  })
  const update: Update = (s) => setSettings((prev) => ({ ...prev, ...s }))

  if (screen === 'chat') return <Chat settings={settings} update={update} />
  return (
    <>
      <nav className={screen === 'landing' ? 'nav landing-nav' : 'nav'} aria-label="Main navigation">
        <span className="wordmark">EQ.ai</span>
        {screen === 'landing' && (
          <div className="landing-nav-links">
            <a href="#results">Results</a>
            <a className="nav-secondary" href="#story">Our story</a>
            <a className="nav-secondary" href="#process">The build</a>
          <button className="btn btn-outline btn-small" onClick={() => setScreen('login')}>
            Log in
          </button>
          </div>
        )}
      </nav>
      {screen === 'landing' ? (
        <Landing onStart={() => setScreen('login')} />
      ) : (
        <main className="page">
          {screen === 'login' && (
            <Login
              name={settings.name}
              onSubmit={(name) => {
                update({ name })
                setScreen('setup')
              }}
            />
          )}
          {screen === 'setup' && <Setup settings={settings} update={update} onStart={() => setScreen('chat')} />}
        </main>
      )}
    </>
  )
}

function Login({ name, onSubmit }: { name: string; onSubmit: (name: string) => void }) {
  const [value, setValue] = useState(name)
  return (
    <form
      className="login card"
      onSubmit={(e) => {
        e.preventDefault()
        if (value.trim()) onSubmit(value.trim())
      }}
    >
      <h2>Welcome</h2>
      <p className="muted">Demo login. No password, and nothing is saved.</p>
      <div className="field">
        <label htmlFor="name">Your first name</label>
        <input
          id="name"
          className="input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
          autoComplete="given-name"
          maxLength={40}
        />
      </div>
      <button className="btn btn-primary" disabled={!value.trim()}>
        Continue
      </button>
    </form>
  )
}

function IOChoice(props: { label: string; value: IO; onChange: (v: IO) => void; voiceDisabled?: boolean }) {
  return (
    <div className="row">
      <span className="muted">{props.label}</span>
      <div className="pill-group" role="group" aria-label={props.label}>
        {(['voice', 'text'] as const).map((v) => (
          <button
            key={v}
            type="button"
            className="pill"
            aria-pressed={props.value === v}
            disabled={v === 'voice' && props.voiceDisabled}
            onClick={() => props.onChange(v)}
          >
            {v === 'voice' ? 'Voice' : 'Text'}
          </button>
        ))}
      </div>
    </div>
  )
}

function Setup({ settings, update, onStart }: { settings: Settings; update: Update; onStart: () => void }) {
  const [error, setError] = useState('')
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const toggleCamera = async (on: boolean, camId = settings.camId) => setError(await setCamera(on, settings.camera, update, camId))

  const loadDevices = () => navigator.mediaDevices.enumerateDevices().then(setDevices, () => {})
  useEffect(() => {
    loadDevices()
    navigator.mediaDevices.addEventListener('devicechange', loadDevices)
    return () => navigator.mediaDevices.removeEventListener('devicechange', loadDevices)
  }, [settings.camera]) // names appear only after a permission grant, so reload when the camera turns on

  // Browsers hide device names until the site has mic/camera permission.
  async function showNames() {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: true })
      s.getTracks().forEach((t) => t.stop())
    } catch {}
    loadDevices()
  }

  async function start() {
    if (settings.input === 'voice') {
      try {
        // Ask for the mic now so the browser prompt appears on a clear user action.
        const s = await navigator.mediaDevices.getUserMedia({ audio: settings.micId ? { deviceId: { exact: settings.micId } } : true })
        s.getTracks().forEach((t) => t.stop())
      } catch {
        update({ input: 'text' })
        return setError('Microphone access was blocked, so I switched you to typing. You can allow it from the address bar.')
      }
    }
    onStart()
  }

  return (
    <section className="setup">
      <div>
        <p className="eyebrow">Hi {settings.name}</p>
        <h2>What do you need help with?</h2>
      </div>

      <div className="topics" role="group" aria-label="Topic">
        {TOPICS.map((t) => (
          <button key={t.id} className="topic" aria-pressed={settings.topic === t.id} onClick={() => update({ topic: t.id })}>
            <strong>{t.label}</strong>
            <span className="muted">{t.blurb}</span>
          </button>
        ))}
      </div>

      <div className="card" style={{ display: 'grid', gap: 20 }}>
        <IOChoice
          label="I want to"
          value={settings.input}
          onChange={(input) => update({ input })}
          voiceDisabled={!canListen}
        />
        <IOChoice label="Replies by" value={settings.output} onChange={(output) => update({ output })} />
        <label className="toggle">
          <input type="checkbox" checked={!!settings.camera} onChange={(e) => toggleCamera(e.target.checked)} />
          Turn on camera (optional). Video goes only to EQ.ai's own emotion computer (not a cloud service), is analyzed
          live, and is never stored.
        </label>
        <div className="devices">
          <DeviceSelect
            label="Camera"
            kind="videoinput"
            devices={devices}
            value={settings.camId}
            onChange={(camId) => {
              update({ camId })
              if (settings.camera) toggleCamera(true, camId) // switch the live preview to the new camera
            }}
          />
          <DeviceSelect label="Microphone" kind="audioinput" devices={devices} value={settings.micId} onChange={(micId) => update({ micId })} />
          {devices.some((d) => !d.label) && (
            <button type="button" className="btn btn-outline btn-small" onClick={showNames}>
              Show device names
            </button>
          )}
        </div>
        {settings.input === 'voice' && cartesiaVoice && (
          <p className="note">
            While you talk, the microphone you pick is sent to Cartesia, a speech service, to turn your words into text,
            and to EQ.ai's own emotion computer. EQ.ai doesn't store your audio. Choose Text if you'd rather not.
          </p>
        )}
        <p className="note">
          Your messages and the short emotion estimates (like "confused") go to Claude, Anthropic's AI, to write the bear's
          replies. EQ.ai doesn't keep a copy of your chat.
        </p>
        {settings.input === 'voice' && !cartesiaVoice && (
          <p className="note">
            Demo mode: voice input uses your browser's speech recognition, which sends your audio to Google, and your
            system default mic. Choose Text if you'd rather not.
          </p>
        )}
        {!canListen && <p className="note">This browser has no speech recognition. Use Chrome for voice input.</p>}
        {error && (
          <p className="note" role="alert">
            {error}
          </p>
        )}
      </div>

      <button className="btn btn-primary" style={{ justifySelf: 'start' }} onClick={start}>
        Start chat
      </button>
    </section>
  )
}

function DeviceSelect(props: {
  label: string
  kind: MediaDeviceKind
  devices: MediaDeviceInfo[]
  value: string
  onChange: (id: string) => void
}) {
  // Chrome lists "default"/"communications" aliases of real devices; "System default" already covers them.
  const list = props.devices.filter((d) => d.kind === props.kind && d.deviceId && !['default', 'communications'].includes(d.deviceId))
  return (
    <label className="field">
      <span>{props.label}</span>
      <select className="input" value={props.value} onChange={(e) => props.onChange(e.target.value)}>
        <option value="">System default</option>
        {list.map((d, i) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || `${props.label} ${i + 1}`}
          </option>
        ))}
      </select>
    </label>
  )
}

type Msg = {
  from: 'student' | 'assistant' | 'staff' | 'system'
  text: string
  citations?: ChatResponse['reply']['citations']
  uncertainty?: string
}
type Status = 'idle' | 'listening' | 'thinking' | 'speaking'

const probsOf = (e: Estimate | null | undefined) =>
  !e ? null : Object.keys(e.probs).length ? e.probs : { [e.label]: e.confidence }

function Chat({ settings, update }: { settings: Settings; update: Update }) {
  const topic = TOPICS.find((t) => t.id === settings.topic) ?? TOPICS[0]
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [expression, setExpression] = useState<Expression>('happy')
  const [status, setStatus] = useState<Status>('idle')
  const [estimates, setEstimates] = useState<EmotionEstimate[]>([])
  const [askConfirm, setAskConfirm] = useState(false)
  const [offerHandoff, setOfferHandoff] = useState(false)
  const [distress, setDistress] = useState(false)
  const [consentOpen, setConsentOpen] = useState(false)
  const [shareEmotion, setShareEmotion] = useState(false)
  const [handoff, setHandoff] = useState<Handoff | null>(null)
  const [draft, setDraft] = useState('')
  const [interim, setInterim] = useState('')
  const [notice, setNotice] = useState('')
  const [reading, setReading] = useState<Reading | null>(null)
  const [perceptionLive, setPerceptionLive] = useState(false)
  const perception = useRef<ReturnType<typeof connectPerception> | null>(null)
  const [botTone, setBotTone] = useState({ emotion: 'content', speed: 1 })
  const [holding, setHolding] = useState(false) // push-to-talk: the mic button is held down
  // Reply time, from the student's words being ready to the bear's first sound (CLAUDE.md asks us to measure it).
  const timing = useRef<{ start: number; replied?: number } | null>(null)
  const [latency, setLatency] = useState<{ answer: number; voice: number } | null>(null)
  const [camHidden, setCamHidden] = useState(false)
  const sessionId = useRef(crypto.randomUUID()).current
  const stopListening = useRef(() => {})
  const press = useRef<{ at: number; wasListening: boolean } | null>(null)
  const camPos = useRef({ x: 0, y: 0 })
  const camDrag = useRef<{ dx: number; dy: number; minX: number; maxX: number; minY: number; maxY: number } | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  // Latest values for async callbacks (speech results, other tabs), which would otherwise see stale state.
  const live = useRef({ settings, handoff, msgs, send, holding })
  live.current = { ...live.current, settings, msgs, send, holding }

  function say(text: string, expr: Expression, tone: Tone = { speed: 1, emotion: 'content' }, from: Msg['from'] = 'assistant', extra: Partial<Msg> = {}) {
    setMsgs((m) => [...m, { from, text, ...extra }])
    if (from === 'system') return
    setExpression(expr)
    // The bear's mouth only moves for its own words, not when reading out the advisor's.
    const onStart =
      from === 'staff'
        ? () => {}
        : () => {
            setStatus('speaking')
            const t = timing.current
            if (from === 'assistant' && t?.replied) {
              const now = performance.now()
              setLatency({ answer: t.replied - t.start, voice: now - t.replied })
              console.info(`[latency] answer ${Math.round(t.replied - t.start)} ms, voice ${Math.round(now - t.replied)} ms`)
              timing.current = null
            }
          }
    // Cancelling speech fires its end event late; only reset if nothing else (listening, thinking) took over.
    if (live.current.settings.output === 'voice') speak(text, tone, onStart, () => setStatus((s) => (s === 'speaking' ? 'idle' : s)))
    else setStatus('idle')
  }

  function updateHandoff(h: Handoff) {
    live.current.handoff = h
    setHandoff(h)
    publish(h)
  }

  const greeted = useRef(false)
  useEffect(() => {
    if (greeted.current) return
    greeted.current = true
    const intro = topic.id === 'other' ? 'What can I help with today?' : `I'm here to help with your ${topic.label.toLowerCase()}.`
    say(`Hi ${settings.name}! ${intro} You can talk or type, whichever is easier.`, 'happy')
  }, [])

  useEffect(() => {
    const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches
    endRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'end' })
  }, [msgs, askConfirm, offerHandoff, consentOpen, handoff?.note])

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = settings.camera
  }, [settings.camera])

  useEffect(() => {
    if (!perceptionOn) return
    const c = connectPerception(sessionId, setReading, setPerceptionLive)
    perception.current = c
    return () => c.close()
  }, [])

  // Frames go out only while the camera toggle is on; the face reading is cleared when it turns off.
  useEffect(() => {
    const send = perception.current?.send
    if (!settings.camera || !videoRef.current || !send) return
    const stop = streamFrames(videoRef.current, send)
    return () => {
      stop()
      setReading((r) => r && { ...r, face: null })
    }
  }, [settings.camera])

  useEffect(
    () =>
      subscribe(
        (h) => {
          const prev = live.current.handoff
          if (!prev || h.id !== prev.id) return
          live.current.handoff = h
          setHandoff(h)
          if (prev.status === 'waiting' && h.status === 'active') say(`${h.staff_id ?? 'An advisor'} joined the chat.`, 'happy', undefined, 'system')
          h.messages
            .slice(prev.messages.length)
            .filter((m) => m.from === 'staff')
            .forEach((m) => say(m.text, 'neutral', undefined, 'staff'))
          if (h.status === 'resolved' && prev.status !== 'resolved') {
            say('The advisor closed this chat. I hope that helped!', 'happy', undefined, 'system')
            setExpression('happy')
          }
        },
        () => live.current.handoff && publish(live.current.handoff),
      ),
    [],
  )

  async function send(raw: string) {
    const text = raw.trim()
    if (!text || status === 'thinking') return
    setDraft('')
    setNotice('')
    stopSpeaking()

    const h = live.current.handoff
    if (h && h.status !== 'resolved') {
      setMsgs((m) => [...m, { from: 'student', text }])
      updateHandoff({ ...h, messages: [...h.messages, { from: 'student', text, at: Date.now() }] })
      return
    }

    const history = msgs
      .filter((m) => m.from === 'student' || m.from === 'assistant')
      .map((m) => ({ role: m.from as 'student' | 'assistant', text: m.text }))
    setMsgs((m) => [...m, { from: 'student', text }])
    setStatus('thinking')
    setExpression('thinking')
    setAskConfirm(false)
    setOfferHandoff(false)
    timing.current = { start: performance.now() }
    try {
      const res = await askAssistant({ session_id: sessionId, topic: topic.id, text, history, awaiting_confirmation: askConfirm })
      timing.current.replied = performance.now()
      // Confidence 0 means Claude didn't answer (fallback reply): there is no estimate to show.
      if (res.tone.confidence > 0) setEstimates((e) => [...e, { label: res.tone.state, confidence: res.tone.confidence }])
      setBotTone(res.tone.tts_params)
      setAskConfirm(res.tone.ask_confirmation)
      setOfferHandoff(res.behavior.offer_handoff)
      if (res.behavior.mode === 'distress') setDistress(true)
      say(res.reply.text, res.tone.avatar_expression, res.tone.tts_params, 'assistant', {
        citations: res.reply.citations,
        uncertainty: res.reply.uncertainty,
      })
    } catch {
      say("Sorry, I couldn't reach the assistant just now. You can try again, or talk to a person.", 'concerned')
      setOfferHandoff(true)
    }
  }

  function toggleMic() {
    if (status === 'listening') return stopListening.current() // sends what was heard so far
    stopSpeaking()
    setNotice('')
    setInterim('')
    setStatus('listening')
    setExpression('listening')
    // The selected mic feeds speech-to-text and, only while the student is talking, the on-device voice classifier.
    stopListening.current = listen(
      {
        onInterim: setInterim,
        onFinal: (t) => live.current.send(t),
        onEnd: (error) => {
          setReading((r) => r && { ...r, voice: null })
          setInterim('')
          if (error) setNotice(error)
          setStatus((s) => (s === 'listening' ? 'idle' : s))
          setExpression((e) => (e === 'listening' ? 'neutral' : e))
        },
      },
      { micId: settings.micId, onAudio: perception.current?.send },
      () => live.current.holding,
    )
  }

  // Tap = hands-free (stops on its own after quiet); hold = push-to-talk, sends when released.
  function pressMic(e: PointerEvent<HTMLButtonElement>) {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    press.current = { at: e.timeStamp, wasListening: status === 'listening' }
    setHolding(true)
    if (status !== 'listening') toggleMic()
  }
  function releaseMic(e: PointerEvent<HTMLButtonElement>) {
    const p = press.current
    if (!p) return
    press.current = null
    setHolding(false)
    if (p.wasListening || e.timeStamp - p.at > 300) stopListening.current() // a second tap, or the end of a hold, sends
  }

  // Drag the camera preview anywhere on screen; moves set the transform directly so React doesn't re-render per frame.
  function grabCamera(e: PointerEvent<HTMLDivElement>) {
    if ((e.target as Element).closest('button')) return
    const r = e.currentTarget.getBoundingClientRect()
    const { x, y } = camPos.current
    camDrag.current = {
      dx: x - e.clientX,
      dy: y - e.clientY,
      minX: x - r.left,
      maxX: x + innerWidth - r.right,
      minY: y - r.top,
      maxY: y + innerHeight - r.bottom,
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  function dragCamera(e: PointerEvent<HTMLDivElement>) {
    const d = camDrag.current
    if (!d) return
    const x = Math.min(d.maxX, Math.max(d.minX, e.clientX + d.dx))
    const y = Math.min(d.maxY, Math.max(d.minY, e.clientY + d.dy))
    camPos.current = { x, y }
    e.currentTarget.style.transform = `translate(${x}px, ${y}px)`
  }

  function requestHandoff() {
    setOfferHandoff(false)
    setAskConfirm(false)
    setConsentOpen(true)
    const tone = { emotion: 'sad', speed: 0.95 }
    setBotTone(tone)
    say(
      "I'm sorry I couldn't solve this for you. Let me connect you with a person. I'll pass along what you told me, so you only have to explain it once.",
      'sad',
      tone,
    )
  }

  async function confirmHandoff() {
    const history = msgs
      .filter((m) => m.from === 'student' || m.from === 'assistant')
      .map((m) => ({ role: m.from as 'student' | 'assistant', text: m.text }))
    setConsentOpen(false)
    const id = crypto.randomUUID()
    updateHandoff({
      id,
      student_name: settings.name,
      topic: topic.label,
      summary: 'Writing a summary of the conversation…',
      emotion: shareEmotion ? estimates.at(-1) : undefined,
      status: 'waiting',
      messages: [],
      created_at: Date.now(),
    })
    // Claude writes the case note (only from the chat, never the emotion signals); it falls back to the student's words.
    const { note, source } = await summarizeHandoff({ session_id: sessionId, topic: topic.id, history })
    const h = live.current.handoff
    if (h?.id === id) updateHandoff({ ...h, summary: note.problem, note, note_source: source })
    say("Done. I sent this summary to an SJSU advisor, so you won't have to explain it again.", 'happy')
  }

  const latest = estimates.at(-1)
  const withPerson = !!handoff && handoff.status !== 'resolved'
  const voiceOnly = settings.input === 'voice'
  const speedWord = botTone.speed < 0.97 ? 'slower' : botTone.speed > 1.03 ? 'faster' : 'normal speed'
  const sources = [
    { label: 'words', probs: latest ? { [latest.label]: latest.confidence } : null },
    // Raw 7-label classifier output from the on-device perception service; null while there is no reading.
    { label: 'voice', probs: probsOf(reading?.voice) },
    { label: 'face', probs: probsOf(reading?.face) },
  ]
  const face = reading?.face
  const statusText = handoff && withPerson
    ? handoff.status === 'waiting'
      ? 'Waiting for a person to join…'
      : `You're chatting with ${handoff.staff_id ?? 'an advisor'}`
    : {
        idle: voiceOnly ? 'Tap the mic to talk' : 'Type your message below',
        listening: holding
          ? 'Listening… let go to send'
          : interim
            ? "Listening… pause when you're done"
            : 'Listening… (stops after 5 seconds of quiet)',
        thinking: 'Thinking…',
        speaking: 'Speaking…',
      }[status]

  return (
    <div className="chat">
      <header className="chat-top">
        <div className="row" style={{ gap: 12 }}>
          <span className="wordmark">EQ.ai</span>
          <span className="muted">{topic.label}</span>
          {isDemo && <span className="badge">Demo mode</span>}
        </div>
        <div className="row" style={{ gap: 12 }}>
          <IOChoice
            label="Talk"
            value={settings.input}
            onChange={(input) => {
              stopListening.current()
              setNotice('')
              update({ input })
            }}
            voiceDisabled={!canListen}
          />
          <IOChoice
            label="Replies"
            value={settings.output}
            onChange={(output) => {
              if (output === 'text') stopSpeaking()
              update({ output })
            }}
          />
          <button
            className="btn btn-outline btn-small"
            aria-pressed={!!settings.camera}
            onClick={async () => setNotice(await setCamera(!settings.camera, settings.camera, update, settings.camId))}
          >
            {settings.camera ? 'Camera on' : 'Camera off'}
          </button>
          {!handoff && !consentOpen && (
            <button className="btn btn-outline btn-small" onClick={requestHandoff}>
              Talk to a person
            </button>
          )}
        </div>
      </header>

      <div className="chat-body">
      <div className="chat-col">
      <section className="stage-wrap">
        <div className="stage">
          <Bear expression={expression} speaking={status === 'speaking'} listening={status === 'listening'} />
        </div>
        <p className="status" aria-live="polite">
          {statusText}
        </p>
        {!withPerson && (
          <div className="tones">
            <span className="tone-chip">
              <span className="swatch swatch-you" aria-hidden="true" />
              You (estimate): <strong>{latest ? `${latest.label} ${Math.round(latest.confidence * 100)}%` : 'not yet'}</strong>
            </span>
            <span className="tone-chip">
              <span className="swatch swatch-bear" aria-hidden="true" />
              Bear: <strong>{botTone.emotion}</strong> voice, {speedWord}
            </span>
          </div>
        )}
        {notice && (
          <p className="note" role="alert">
            {notice}
          </p>
        )}
      </section>

      <main className="chat-main">
        <div className="messages" aria-live="polite">
          {msgs.map((m, i) => (
            <div key={i} className={`msg msg-${m.from}`}>
              {m.from === 'staff' && <small style={{ marginTop: 0, marginBottom: 4 }}>{handoff?.staff_id ?? 'Advisor'}</small>}
              {m.text}
              {!!m.citations?.length && (
                <small>
                  Source:{' '}
                  {m.citations.map((c) => (
                    <a key={c.url} href={c.url} target="_blank" rel="noreferrer">
                      {c.title}
                    </a>
                  ))}
                </small>
              )}
              {m.uncertainty && <small>{m.uncertainty}</small>}
            </div>
          ))}
          {interim && <div className="msg msg-student msg-interim">{interim}</div>}
        </div>

        {askConfirm && (
          <div className="chips">
            <button className="btn btn-outline btn-small" onClick={() => send("Yes, that's right")}>
              Yes, that's right
            </button>
            <button className="btn btn-outline btn-small" onClick={() => send("No, I'm okay")}>
              No, I'm okay
            </button>
          </div>
        )}

        {distress && (
          <div className="card crisis panel" role="alert">
            <strong>You don't have to handle this alone.</strong>
            <p>
              Call or text <strong>988</strong> (Suicide &amp; Crisis Lifeline, US, 24/7). SJSU Counseling and Psychological
              Services can also help.
            </p>
          </div>
        )}

        {offerHandoff && !consentOpen && !handoff && (
          <div className="chips">
            <button className="btn btn-secondary btn-small" onClick={requestHandoff}>
              Connect me with a person
            </button>
            <button className="btn btn-outline btn-small" onClick={() => setOfferHandoff(false)}>
              Keep chatting
            </button>
          </div>
        )}

        {consentOpen && (
          <div className="card panel">
            <strong>Here's what I'll share with the advisor</strong>
            <p className="muted">
              Your name ({settings.name}), the topic ({topic.label}), and what you told me in this chat.
            </p>
            <label className="toggle">
              <input type="checkbox" checked={shareEmotion} onChange={(e) => setShareEmotion(e.target.checked)} />
              Also share my emotion estimate{latest ? ` (${latest.label})` : ''}. Off unless you turn it on.
            </label>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn-primary btn-small" onClick={confirmHandoff}>
                Connect me
              </button>
              <button
                className="btn btn-outline btn-small"
                onClick={() => {
                  setConsentOpen(false)
                  setExpression('neutral')
                }}
              >
                Not now
              </button>
            </div>
          </div>
        )}
        {handoff && (
          <section className="card panel case" aria-live="polite" aria-label="Handoff summary">
            <p className="eyebrow">What the SJSU advisor sees</p>
            <strong>
              {handoff.student_name} · {handoff.topic}
            </strong>
            {handoff.note ? <CaseNoteFields note={handoff.note} source={handoff.note_source} /> : <p className="muted">Writing a short summary for the advisor…</p>}
            <p className="muted">
              {handoff.emotion
                ? `Emotion estimate shared with your permission: ${handoff.emotion.label}.`
                : 'Your emotion estimate is not shared.'}
              {handoff.note && (handoff.note_source === 'claude' ? ' Summary written by Claude from this chat.' : ' Summary taken from your own messages.')}
            </p>
          </section>
        )}
        <div ref={endRef} />
      </main>
      </div>

      <aside className="insight" aria-label="Emotion map">
        <p className="eyebrow">Emotion map</p>
        <EmotionNetwork sources={sources} bot={botTone.emotion} />
        <div className="net-legend">
          <span>
            <span className="swatch swatch-you" aria-hidden="true" /> You (estimate)
          </span>
          <span>
            <span className="swatch swatch-bear" aria-hidden="true" /> Bear's voice
          </span>
        </div>
        <p className="muted">
          Left to right: unpleasant to pleasant. Bottom to top: low to high energy (valence and arousal, placed roughly after
          Russell's circumplex). Brighter means more likely. Ring nodes are blends that light up only when both parts show up.
        </p>
        <p className="muted">
          Reading from: <strong>{sources.filter((s) => s.probs).map((s) => s.label).join(', ') || 'nothing yet'}</strong>
        </p>
        <p className="muted">
          EQ.ai emotion service:{' '}
          <strong>{!perceptionOn ? 'not configured' : perceptionLive ? 'connected' : 'not connected'}</strong>
        </p>
        {latency && (
          <p className="muted">
            Last reply: <strong>{((latency.answer + latency.voice) / 1000).toFixed(1)} s</strong> after your words were ready
            (answer {(latency.answer / 1000).toFixed(1)} s · voice {(latency.voice / 1000).toFixed(1)} s)
          </p>
        )}
        {estimates.length > 0 && (
          <div className="history">
            <p className="eyebrow">This chat</p>
            <span className="timeline">
              {estimates.map((e, i) => (
                <span key={i} className={`dot dot-${e.label}`} title={`${e.label} ${Math.round(e.confidence * 100)}%`} />
              ))}
            </span>
          </div>
        )}
      </aside>
      </div>

      <form
        className={`composer${voiceOnly ? ' composer-voice' : ''}`}
        onSubmit={(e: FormEvent) => {
          e.preventDefault()
          send(draft)
        }}
      >
        {!voiceOnly && (
          <input
            className="input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={withPerson ? 'Message the advisor' : 'Type a message'}
            aria-label="Message"
            maxLength={1000}
          />
        )}
        {voiceOnly && (
          <button
            type="button"
            className="mic"
            aria-pressed={status === 'listening'}
            aria-label={status === 'listening' ? 'Stop listening and send' : 'Talk'}
            onPointerDown={pressMic}
            onPointerUp={releaseMic}
            onPointerCancel={releaseMic}
            onContextMenu={(e) => e.preventDefault()} // a long press on touch screens would open a menu
            onClick={(e) => e.detail === 0 && toggleMic()} // keyboard (Enter/Space); pointer presses are handled above
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
            </svg>
          </button>
        )}
        {voiceOnly ? (
          <p className="muted">
            {status !== 'listening'
              ? 'Tap to talk, or hold and let go to send · switch Talk to Text to type'
              : holding
                ? 'Let go to send'
                : 'Tap again to send now'}
          </p>
        ) : (
          <button className="btn btn-secondary" disabled={!draft.trim()}>
            Send
          </button>
        )}
      </form>

      {settings.camera && (
        <div
          className="camera"
          data-hidden={camHidden || undefined}
          style={{ transform: `translate(${camPos.current.x}px, ${camPos.current.y}px)` }}
          onPointerDown={grabCamera}
          onPointerMove={dragCamera}
          onPointerUp={() => (camDrag.current = null)}
          onPointerCancel={() => (camDrag.current = null)}
        >
          {/* Hiding keeps the video playing so frames still reach the on-device face model. */}
          <video ref={videoRef} autoPlay muted playsInline />
          {face?.box && (
            // The preview is mirrored, so flip the box horizontally.
            <div
              className="face-box"
              style={{
                left: `${(1 - face.box[0] - face.box[2]) * 100}%`,
                top: `${face.box[1] * 100}%`,
                width: `${face.box[2] * 100}%`,
                height: `${face.box[3] * 100}%`,
              }}
            >
              <span>
                {face.label} {Math.round(face.confidence * 100)}%
              </span>
            </div>
          )}
          <p>
            Camera on · analyzed by EQ.ai, never stored
            <button type="button" className="cam-btn" onClick={() => setCamHidden((h) => !h)}>
              {camHidden ? 'Show' : 'Hide'}
            </button>
          </p>
        </div>
      )}
    </div>
  )
}
