import { useEffect, useRef, useState, type FormEvent, type PointerEvent } from 'react'
import Bear from './Bear'
import EmotionInsights from './EmotionInsights'
import './chat.css'
import Landing from './Landing'
import { askAssistant, isDemo } from './api'
import CaseNoteFields from './CaseNoteView'
import { advisorUrl, createHandoff, type Handoff } from './handoff'
import { connectPerception, perceptionOn, streamFrames, type Estimate, type Reading } from './perception'
import { TOPICS, type ChatResponse, type EmotionEstimate, type Expression } from './policy'
import type { Tone } from './cartesia'
import { canListen, cartesiaVoice, listen, speak, stopSpeaking, unlockAudio } from './speech'

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
        // A preferred (not exact) id: if that camera is gone, the browser uses another one instead of failing.
        update({ camera: await navigator.mediaDevices.getUserMedia({ video: camId ? { deviceId: camId } : true }) })
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
      <p className="muted">Demo login. No password. Nothing is saved unless you ask for a person.</p>
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
    // Separately, so a computer without a webcam still gets its microphone names.
    for (const kind of [{ audio: true }, { video: true }]) {
      try {
        const s = await navigator.mediaDevices.getUserMedia(kind)
        s.getTracks().forEach((t) => t.stop())
      } catch {}
    }
    loadDevices()
  }

  async function start() {
    unlockAudio() // inside the click: phones only allow sound that starts from a tap
    if (settings.input === 'voice') {
      try {
        // Ask for the mic now so the browser prompt appears on a clear user action.
        const s = await navigator.mediaDevices.getUserMedia({ audio: settings.micId ? { deviceId: settings.micId } : true })
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
          replies. EQ.ai doesn't keep a copy of your chat, unless you ask for a person: then your first name, a summary
          and this chat are kept for 24 hours so an advisor can help.
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
  from: 'student' | 'assistant' | 'system'
  text: string
  citations?: ChatResponse['reply']['citations']
  uncertainty?: string
  estimate?: EmotionEstimate // on EQ.ai's reply: the estimated mood after the student message just before it
}
type Status = 'idle' | 'listening' | 'thinking' | 'speaking'

const VOICE_NOTE = "While you talk, your voice goes to Cartesia to become text, and to EQ.ai's own emotion computer. EQ.ai doesn't store it."
const CAMERA_NOTE = "Camera frames go only to EQ.ai's own emotion computer, are analyzed live, and are never stored."

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
  const [chatView, setChatView] = useState<'conversation' | 'map'>('conversation')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const sessionId = useRef(crypto.randomUUID()).current
  const stopListening = useRef(() => {})
  const micOn = useRef(false) // a listening session is live (status can show 'speaking' or 'thinking' meanwhile)
  const press = useRef<{ at: number; wasListening: boolean } | null>(null)
  const camPos = useRef({ x: 0, y: 0 })
  const camDrag = useRef<{ dx: number; dy: number; minX: number; maxX: number; minY: number; maxY: number } | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  // Latest values for async callbacks (speech results, other tabs), which would otherwise see stale state.
  const live = useRef({ settings, msgs, send, holding })
  live.current = { ...live.current, settings, msgs, send, holding }

  function say(text: string, expr: Expression, tone: Tone = { speed: 1, emotion: 'content' }, from: Msg['from'] = 'assistant', extra: Partial<Msg> = {}) {
    setMsgs((m) => [...m, { from, text, ...extra }])
    if (from === 'system') return
    setExpression(expr)
    const onStart = () => {
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
    // A dropped link clears the last reading, so the map never shows a stale estimate as live.
    const c = connectPerception(sessionId, setReading, (open) => {
      setPerceptionLive(open)
      if (!open) setReading(null)
    })
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

  async function send(raw: string) {
    const text = raw.trim()
    if (!text || status === 'thinking') return
    setDraft('')
    setNotice('')
    stopSpeaking()

    const history = msgs
      .filter((m) => m.from === 'student' || m.from === 'assistant')
      .map((m) => ({ role: m.from as 'student' | 'assistant', text: m.text }))
    setMsgs((m) => [...m, { from: 'student', text }])
    setStatus('thinking')
    setExpression('thinking')
    setAskConfirm(false)
    setOfferHandoff(false)
    unlockAudio() // a Send tap counts as the user action phones need before sound
    const t: { start: number; replied?: number } = { start: performance.now() }
    timing.current = t
    try {
      const res = await askAssistant({ session_id: sessionId, topic: topic.id, text, history, awaiting_confirmation: askConfirm })
      t.replied = performance.now()
      // Confidence 0 means Claude didn't answer (fallback reply): there is no estimate to show.
      if (res.tone.confidence > 0) setEstimates((e) => [...e, { label: res.tone.state, confidence: res.tone.confidence }])
      setBotTone(res.tone.tts_params)
      setAskConfirm(res.tone.ask_confirmation)
      setOfferHandoff(res.behavior.offer_handoff)
      if (res.behavior.mode === 'distress') setDistress(true)
      say(res.reply.text, res.tone.avatar_expression, res.tone.tts_params, 'assistant', {
        citations: res.reply.citations,
        uncertainty: res.reply.uncertainty,
        estimate: res.tone.confidence > 0 ? { label: res.tone.state, confidence: res.tone.confidence } : undefined,
      })
    } catch (e) {
      say(
        e instanceof Error && e.message === 'busy'
          ? 'Lots of people are using EQ.ai right now. Please wait a few minutes, or talk to a person.'
          : "Sorry, I couldn't reach the assistant just now. You can try again, or talk to a person.",
        'concerned',
      )
      setOfferHandoff(true)
    }
  }

  function toggleMic() {
    if (micOn.current) return stopListening.current() // sends what was heard so far
    if (status === 'thinking') return // one question at a time: the answer is on its way
    unlockAudio()
    micOn.current = true
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
          micOn.current = false
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
    press.current = { at: e.timeStamp, wasListening: micOn.current }
    setHolding(true)
    if (!micOn.current) toggleMic()
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
    setChatView('conversation')
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
    // Opened now, inside the click, so the browser doesn't block it as a pop-up; it shows the note once saved.
    const tab = isDemo ? null : window.open('/advisor/', '_blank')
    const turns = msgs.filter((m) => m.from === 'student' || m.from === 'assistant').slice(-40) // the service takes 40
    const history = turns.map((m) => ({ role: m.from as 'student' | 'assistant', text: m.text }))
    // Each estimate sits on EQ.ai's reply and belongs to the student message just before it.
    const timeline = shareEmotion
      ? turns.flatMap((m, i) => (m.estimate && turns[i - 1]?.from === 'student' ? [{ turn: i - 1, ...m.estimate }] : []))
      : []
    setConsentOpen(false)
    setStatus('thinking')
    // Shown while Claude writes the case note on the server.
    setHandoff({ id: 'pending', student_name: settings.name, topic: topic.id, hard_moments: [], timeline, transcript: history, created_at: Date.now(), local: true })
    const h = await createHandoff({ session_id: sessionId, topic: topic.id, student_name: settings.name, history, timeline })
    setHandoff(h)
    setStatus('idle')
    if (h.local) tab?.close()
    else if (tab) tab.location.href = advisorUrl(h.id)
    say(
      h.local
        ? `Here's a summary for an advisor, so you won't have to explain it again. ${isDemo ? "This demo isn't connected to the service" : "I couldn't save it just now"}, so please share it with the office.`
        : "Here's what an advisor would see, so you won't have to explain it again. I opened it in a new tab. In this demo, it isn't sent to SJSU staff.",
      'happy',
    )
  }

  const latest = estimates.at(-1)
  const voiceOnly = settings.input === 'voice'
  const sources = [
    { label: 'final', probs: latest ? { [latest.label]: latest.confidence } : null },
    // Raw 7-label classifier output from the on-device perception service; null while there is no reading.
    { label: 'voice', probs: probsOf(reading?.voice) },
    { label: 'face', probs: probsOf(reading?.face) },
  ]
  const face = reading?.face
  const statusText = handoff?.id === 'pending'
    ? 'Writing a summary for the advisor…'
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
    <div className="chat" data-view={chatView}>
      <header className="chat-top">
        <div className="chat-brand"><span className="wordmark">EQ.ai</span><span className="chat-brand-divider" />
          <div><h1>{topic.label}</h1><p>Student support{isDemo ? ' · Demo mode' : ''}</p></div>
        </div>
        <div className="chat-actions">
          <button type="button" className="btn btn-outline btn-small" aria-expanded={settingsOpen} aria-controls="chat-settings" onClick={() => setSettingsOpen(!settingsOpen)}>Chat settings</button>
          {!consentOpen && handoff?.id !== 'pending' && <button className="btn btn-secondary btn-small" onClick={requestHandoff}>Talk to a person <span aria-hidden="true">↗</span></button>}
        </div>
        <div className="chat-settings" id="chat-settings" hidden={!settingsOpen}>
          <IOChoice
            label="Talk"
            value={settings.input}
            onChange={(input) => {
              stopListening.current()
              // The setup-screen disclosure may have been skipped by starting in Text mode.
              setNotice(input === 'voice' && cartesiaVoice ? VOICE_NOTE : '')
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
            onClick={async () => {
              const turningOn = !settings.camera
              const error = await setCamera(turningOn, settings.camera, update, settings.camId)
              setNotice(error || (turningOn ? CAMERA_NOTE : ''))
            }}
          >
            {settings.camera ? 'Camera on' : 'Camera off'}
          </button>

          <p>Camera is optional. You can use text at any time.</p>
        </div>
      </header>
      <div className="chat-view-switch" role="group" aria-label="Chat views">
        <button type="button" aria-pressed={chatView === 'conversation'} aria-controls="conversation-panel" onClick={() => setChatView('conversation')}>Conversation</button>
        <button type="button" aria-pressed={chatView === 'map'} aria-controls="emotion-panel" onClick={() => setChatView('map')}>Emotion map</button>
      </div>
      <div className="chat-body">
      <div className="chat-col" id="conversation-panel">
        <section className="stage-wrap" aria-label="Assistant status">
          <div className="stage"><Bear expression={expression} speaking={status === 'speaking'} listening={status === 'listening'} /></div>
          <div className="assistant-presence">
            <h2>A little clarity, together.</h2>
            <p className="status" aria-live="polite"><span className={`presence-dot presence-${status}`} aria-hidden="true" />{statusText}</p>
          </div>
          <span className="session-note">One step at a time</span>
        </section>
        {notice && <p className="chat-notice note" role="alert">{notice}</p>}
      <main className="chat-main" aria-label="Conversation">
        <div className="messages" role="log" aria-label="Messages" aria-live="polite" aria-relevant="additions text">
          {msgs.map((m, i) => (
            <div key={i} className={`msg msg-${m.from}`}>
              {m.from !== 'system' && <span className="message-author">{m.from === 'student' ? 'You' : 'EQ.ai'}</span>}
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
          {interim && <div className="msg msg-student msg-interim" aria-hidden="true">{interim}</div>}
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

        {offerHandoff && !consentOpen && (
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
              Your name ({settings.name}), the topic ({topic.label}), and a summary of this chat. It's kept for 24 hours,
              then deleted. Click OK to see what the advisor gets, in a new tab.
            </p>
            <label className="toggle">
              <input type="checkbox" checked={shareEmotion} onChange={(e) => setShareEmotion(e.target.checked)} />
              Also share how my mood seemed to change during the chat (EQ.ai's estimates, which can be wrong). Off unless
              you turn it on.
            </label>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn-primary btn-small" onClick={confirmHandoff}>
                OK
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
            <p className="eyebrow">{handoff.local ? 'Summary for an advisor' : 'What the advisor gets'}</p>
            <strong>
              {handoff.student_name} · {topic.label}
            </strong>
            {handoff.note ? <CaseNoteFields note={handoff.note} source={handoff.note_source} /> : <p className="muted">Writing a short summary for the advisor…</p>}
            <p className="muted">
              {handoff.timeline.length ? 'Your mood estimates are shared with your permission.' : 'Your mood estimates are not shared.'}
              {handoff.note && (handoff.note_source === 'claude' ? ' Summary written by Claude from this chat.' : ' Summary taken from your own messages.')}
            </p>
            {!handoff.local && (
              <a href={advisorUrl(handoff.id)} target="_blank" rel="noreferrer">
                Open the advisor view <span aria-hidden="true">↗</span>
              </a>
            )}
          </section>
        )}
        <div ref={endRef} />
      </main>
      <form
        className={`composer${voiceOnly ? ' composer-voice' : ''}`}
        aria-label="Send a message"
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
            placeholder="Type a message"
            aria-label="Message"
            maxLength={1000}
          />
        )}
        {voiceOnly && (
          <button
            type="button"
            className="mic"
            disabled={status === 'thinking'}
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
              ? 'Tap to talk, or hold and release to send'
              : holding
                ? 'Let go to send'
                : 'Tap again to send now'}
          </p>
        ) : (
          <button className="btn btn-primary" disabled={!draft.trim() || status === 'thinking'}>
            Send <span aria-hidden="true">↑</span>
          </button>
        )}
        {voiceOnly && <button type="button" className="composer-type" onClick={() => { stopListening.current(); update({ input: 'text' }) }}>Type instead</button>}
        {!voiceOnly && <p className="composer-note">You’re in control. Correct an estimate or ask for a person at any time.</p>}
      </form>
      </div>
      <aside className="insight" id="emotion-panel" aria-labelledby="emotion-title">
        <EmotionInsights sources={sources} estimates={estimates} tone={botTone}
          cameraOn={!!settings.camera} voiceOn={settings.input === 'voice'}
          service={!perceptionOn ? 'unconfigured' : perceptionLive ? 'connected' : 'disconnected'}
          demo={isDemo} face={reading?.face ?? null} voice={reading?.voice ?? null} />
        {latency && (
          <p className="muted">
            Last reply: <strong>{((latency.answer + latency.voice) / 1000).toFixed(1)} s</strong> after your words were ready
            (answer {(latency.answer / 1000).toFixed(1)} s · voice {(latency.voice / 1000).toFixed(1)} s)
          </p>
        )}

      </aside>
      </div>

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
