import { useEffect, useRef, useState, type FormEvent } from 'react'
import Bear from './Bear'
import { askAssistant, isDemo } from './api'
import { publish, subscribe, type Handoff } from './handoff'
import { TOPICS, type ChatResponse, type EmotionEstimate, type Expression } from './policy'
import { canListen, listen, speak, stopSpeaking } from './speech'

type IO = 'voice' | 'text'
type Settings = { name: string; topic: string; input: IO; output: IO; camera: MediaStream | null }
type Update = (s: Partial<Settings>) => void

export default function App() {
  const [screen, setScreen] = useState<'landing' | 'login' | 'setup' | 'chat'>('landing')
  const [settings, setSettings] = useState<Settings>({
    name: '',
    topic: TOPICS[0].id,
    input: canListen ? 'voice' : 'text',
    output: 'voice',
    camera: null,
  })
  const update: Update = (s) => setSettings((prev) => ({ ...prev, ...s }))

  if (screen === 'chat') return <Chat settings={settings} update={update} />
  return (
    <>
      <nav className="nav">
        <span className="wordmark">EQ.ai</span>
        {screen === 'landing' && (
          <button className="btn btn-outline btn-small" onClick={() => setScreen('login')}>
            Log in
          </button>
        )}
      </nav>
      <main className="page">
        {screen === 'landing' && <Landing onStart={() => setScreen('login')} />}
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
    </>
  )
}

function Landing({ onStart }: { onStart: () => void }) {
  return (
    <section className="hero">
      <div className="hero-copy">
        <p className="eyebrow">For international students at SJSU</p>
        <h1>Explain it once.</h1>
        <p className="lead">
          Stuck on a financial aid hold, a scholarship, or a visa question? Talk or type. EQ.ai slows down when you seem
          confused, answers from official school pages, and hands you to a person when it can't help.
        </p>
        <button className="btn btn-primary" onClick={onStart}>
          Get started
        </button>
        <p className="muted">
          It estimates how you might be feeling from your words, your voice, and your camera if you turn it on. It is not a
          counselor.
        </p>
      </div>
      <div className="hero-bear">
        <Bear expression="happy" />
      </div>
    </section>
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

  async function toggleCamera(on: boolean) {
    settings.camera?.getTracks().forEach((t) => t.stop())
    if (!on) return update({ camera: null })
    try {
      update({ camera: await navigator.mediaDevices.getUserMedia({ video: true }) })
    } catch {
      setError('Camera access was blocked. You can allow it from the icon in the address bar.')
    }
  }

  async function start() {
    if (settings.input === 'voice') {
      try {
        // Ask for the mic now so the browser prompt appears on a clear user action.
        const s = await navigator.mediaDevices.getUserMedia({ audio: true })
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
          Turn on camera (optional). Video stays on this device and is never recorded.
        </label>
        {settings.input === 'voice' && (
          <p className="note">
            For now, voice input uses your browser's speech recognition, which sends your audio to Google. Choose Text if
            you'd rather not.
          </p>
        )}
        {!canListen && <p className="note">This browser has no speech recognition. Use Chrome or Edge for voice input.</p>}
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

type Msg = {
  from: 'student' | 'assistant' | 'staff' | 'system'
  text: string
  citations?: ChatResponse['reply']['citations']
  uncertainty?: string
}
type Status = 'idle' | 'listening' | 'thinking' | 'speaking'

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
  const sessionId = useRef(crypto.randomUUID()).current
  const stopListening = useRef(() => {})
  const endRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  // Latest values for async callbacks (speech results, other tabs), which would otherwise see stale state.
  const live = useRef({ settings, handoff, msgs, send })
  live.current = { ...live.current, settings, msgs, send }

  function say(text: string, expr: Expression, rate = 1, from: Msg['from'] = 'assistant', extra: Partial<Msg> = {}) {
    setMsgs((m) => [...m, { from, text, ...extra }])
    if (from === 'system') return
    setExpression(expr)
    // The bear's mouth only moves for its own words, not when reading out the advisor's.
    const onStart = from === 'staff' ? () => {} : () => setStatus('speaking')
    if (live.current.settings.output === 'voice') speak(text, rate, onStart, () => setStatus('idle'))
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
  }, [msgs, askConfirm, offerHandoff, consentOpen])

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = settings.camera
  }, [settings.camera])

  useEffect(
    () =>
      subscribe(
        (h) => {
          const prev = live.current.handoff
          if (!prev || h.id !== prev.id) return
          live.current.handoff = h
          setHandoff(h)
          if (prev.status === 'waiting' && h.status === 'active') say(`${h.staff_id ?? 'An advisor'} joined the chat.`, 'happy', 1, 'system')
          h.messages
            .slice(prev.messages.length)
            .filter((m) => m.from === 'staff')
            .forEach((m) => say(m.text, 'neutral', 1, 'staff'))
          if (h.status === 'resolved' && prev.status !== 'resolved') {
            say('The advisor closed this chat. I hope that helped!', 'happy', 1, 'system')
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
    try {
      const res = await askAssistant({ session_id: sessionId, topic: topic.id, text, history, awaiting_confirmation: askConfirm })
      setEstimates((e) => [...e, { label: res.tone.state, confidence: res.tone.confidence }])
      setAskConfirm(res.tone.ask_confirmation)
      setOfferHandoff(res.behavior.offer_handoff)
      if (res.behavior.mode === 'distress') setDistress(true)
      say(res.reply.text, res.tone.avatar_expression, res.tone.tts_params.speed, 'assistant', {
        citations: res.reply.citations,
        uncertainty: res.reply.uncertainty,
      })
    } catch {
      say("Sorry, I couldn't reach the assistant just now. You can try again, or talk to a person.", 'concerned')
      setOfferHandoff(true)
    }
  }

  function toggleMic() {
    if (status === 'listening') return stopListening.current()
    stopSpeaking()
    setStatus('listening')
    setExpression('listening')
    stopListening.current = listen(
      (t) => live.current.send(t),
      () => {
        setStatus((s) => (s === 'listening' ? 'idle' : s))
        setExpression((e) => (e === 'listening' ? 'neutral' : e))
      },
    )
  }

  function requestHandoff() {
    setOfferHandoff(false)
    setAskConfirm(false)
    setConsentOpen(true)
    say(
      "I'm sorry I couldn't solve this for you. Let me connect you with a person. I'll pass along what you told me, so you only have to explain it once.",
      'sad',
      0.95,
    )
  }

  function confirmHandoff() {
    const said = msgs.filter((m) => m.from === 'student').map((m) => m.text)
    setConsentOpen(false)
    updateHandoff({
      id: crypto.randomUUID(),
      student_name: settings.name,
      topic: topic.label,
      // shortcut: summary is the student's last messages; the dialogue service will write a real Claude summary.
      summary: said.slice(-4).join(' / ') || 'The student has not described the problem yet.',
      emotion: shareEmotion ? estimates.at(-1) : undefined,
      status: 'waiting',
      messages: [],
      created_at: Date.now(),
    })
    say("Thanks. You're in the queue, and a person will join this chat soon.", 'neutral')
  }

  function cameraOff() {
    settings.camera?.getTracks().forEach((t) => t.stop())
    update({ camera: null })
  }

  const latest = estimates.at(-1)
  const withPerson = !!handoff && handoff.status !== 'resolved'
  const statusText = handoff && withPerson
    ? handoff.status === 'waiting'
      ? 'Waiting for a person to join…'
      : `You're chatting with ${handoff.staff_id ?? 'an advisor'}`
    : { idle: settings.input === 'voice' ? 'Tap the mic to talk, or type below' : 'Type your message below', listening: 'Listening…', thinking: 'Thinking…', speaking: 'Speaking…' }[status]

  return (
    <div className="chat">
      <header className="chat-top">
        <div className="row" style={{ gap: 12 }}>
          <span className="wordmark">EQ.ai</span>
          <span className="muted">{topic.label}</span>
          {isDemo && <span className="badge">Demo mode</span>}
        </div>
        <div className="row" style={{ gap: 12 }}>
          <IOChoice label="Talk" value={settings.input} onChange={(input) => update({ input })} voiceDisabled={!canListen} />
          <IOChoice
            label="Replies"
            value={settings.output}
            onChange={(output) => {
              if (output === 'text') stopSpeaking()
              update({ output })
            }}
          />
          {!handoff && !consentOpen && (
            <button className="btn btn-outline btn-small" onClick={requestHandoff}>
              Talk to a person
            </button>
          )}
        </div>
      </header>

      <section className="stage-wrap">
        <div className="stage">
          <Bear expression={expression} speaking={status === 'speaking'} listening={status === 'listening'} />
        </div>
        <p className="status" aria-live="polite">
          {statusText}
        </p>
        {latest && !withPerson && (
          <div className="estimate">
            <span>
              Estimate: <strong>{latest.label}</strong> ({Math.round(latest.confidence * 100)}%)
            </span>
            <span className="timeline" aria-hidden="true">
              {estimates.map((e, i) => (
                <span key={i} className={`dot dot-${e.label}`} title={e.label} />
              ))}
            </span>
          </div>
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
        <div ref={endRef} />
      </main>

      <form
        className="composer"
        onSubmit={(e: FormEvent) => {
          e.preventDefault()
          send(draft)
        }}
      >
        <input
          className="input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={withPerson ? 'Message the advisor' : 'Type a message'}
          aria-label="Message"
          maxLength={1000}
        />
        {settings.input === 'voice' && (
          <button
            type="button"
            className="mic"
            aria-pressed={status === 'listening'}
            aria-label={status === 'listening' ? 'Stop listening' : 'Talk'}
            onClick={toggleMic}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
            </svg>
          </button>
        )}
        <button className="btn btn-secondary" disabled={!draft.trim()}>
          Send
        </button>
      </form>

      {settings.camera && (
        <div className="camera">
          <video ref={videoRef} autoPlay muted playsInline />
          <p>Camera on · stays on this device</p>
          <button className="btn btn-outline btn-small camera-off" onClick={cameraOff} aria-label="Turn camera off">
            Off
          </button>
        </div>
      )}
    </div>
  )
}
