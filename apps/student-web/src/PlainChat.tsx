// Plain mode (/plain): EQ.ai with its emotion features off, for the side-by-side demo video. Same Claude answers
// from the same official pages and the same Cartesia voice, but no camera, no emotion estimate, one neutral voice at
// 1.0x for every reply, no check-ins and no advisor handoff. main.tsx loads it as its own chunk, apart from App.
import { useEffect, useRef, useState, type FormEvent } from 'react'
import Bear from './Bear'
import { normalizeResponse, type ChatRequest, type ChatResponse } from './policy'
import { canListen, listen, speak, stopSpeaking, unlockAudio } from './speech'
import './chat.css'
import './plain.css'

const API_URL: string = import.meta.env.VITE_API_URL ?? ''
const TONE = { speed: 1, emotion: 'neutral' } // every reply sounds the same, whatever the student's mood
const TOPIC = 'financial_aid_hold'
const STATUS = {
  idle: 'Tap the mic to talk, or type below',
  listening: 'Listening… tap the mic again to send',
  thinking: 'Thinking…',
  speaking: 'Speaking…',
}

type Msg = { from: 'student' | 'assistant'; text: string; citations?: ChatResponse['reply']['citations'] }

async function askPlain(req: ChatRequest): Promise<ChatResponse> {
  const res = await fetch(`${API_URL}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...req, plain: true }),
  })
  if (res.status === 429) throw new Error('busy')
  if (!res.ok) throw new Error(`chat API ${res.status}`)
  return normalizeResponse(await res.json())
}

export default function PlainChat() {
  const [msgs, setMsgs] = useState<Msg[]>([
    { from: 'assistant', text: 'Hi! I can help with your financial aid hold. You can talk or type.' },
  ])
  const [status, setStatus] = useState<keyof typeof STATUS>('idle')
  const [draft, setDraft] = useState('')
  const [interim, setInterim] = useState('')
  const [notice, setNotice] = useState(API_URL ? '' : 'Plain mode needs the EQ.ai service (VITE_API_URL is not set).')
  const sessionId = useRef(crypto.randomUUID()).current
  const stopListening = useRef(() => {})
  const micOn = useRef(false)
  const endRef = useRef<HTMLDivElement>(null)
  // Latest values for speech callbacks, which would otherwise see stale state.
  const live = useRef({ msgs, send })
  live.current = { msgs, send }

  useEffect(() => {
    document.title = 'EQ.ai · Plain mode'
  }, [])
  useEffect(() => endRef.current?.scrollIntoView({ block: 'end' }), [msgs, interim])

  async function send(raw: string) {
    const text = raw.trim()
    if (!text || status === 'thinking' || !API_URL) return
    setDraft('')
    setNotice('')
    stopSpeaking()
    unlockAudio() // a Send tap counts as the user action phones need before sound
    const history = live.current.msgs.slice(-40).map((m) => ({ role: m.from, text: m.text })) // the service takes 40 turns
    setMsgs((m) => [...m, { from: 'student', text }])
    setStatus('thinking')
    try {
      const res = await askPlain({ session_id: sessionId, topic: TOPIC, text, history, awaiting_confirmation: false })
      setMsgs((m) => [...m, { from: 'assistant', text: res.reply.text, citations: res.reply.citations }])
      setStatus('idle')
      speak(res.reply.text, TONE, () => setStatus('speaking'), () => setStatus((s) => (s === 'speaking' ? 'idle' : s)))
    } catch (e) {
      setStatus('idle')
      setNotice(e instanceof Error && e.message === 'busy' ? 'Too many requests. Please wait a few minutes.' : "Sorry, I couldn't reach the assistant. Please try again.")
    }
  }

  function toggleMic() {
    if (micOn.current) return stopListening.current() // sends what was heard so far
    if (status === 'thinking') return
    unlockAudio()
    micOn.current = true
    stopSpeaking()
    setNotice('')
    setInterim('')
    setStatus('listening')
    stopListening.current = listen(
      {
        onInterim: setInterim,
        onFinal: (t) => live.current.send(t),
        onEnd: (error) => {
          micOn.current = false
          setInterim('')
          if (error) setNotice(error)
          setStatus((s) => (s === 'listening' ? 'idle' : s))
        },
      },
      { micId: '' }, // the browser's default mic: pick a headset from the mic icon in the address bar
    )
  }

  return (
    <div className="chat plain" data-view="conversation">
      <header className="chat-top">
        <div className="chat-brand">
          <span className="wordmark">EQ.ai</span>
          <span className="chat-brand-divider" />
          <div>
            <h1>Financial aid hold</h1>
            <p>Plain mode · emotion features off (comparison demo)</p>
          </div>
        </div>
        <div className="chat-actions">
          <a className="btn btn-outline btn-small" href="/">Open EQ.ai</a>
        </div>
      </header>
      <div className="chat-body">
        <div className="chat-col">
          <section className="stage-wrap" aria-label="Assistant status">
            <div className="stage"><Bear expression="neutral" speaking={status === 'speaking'} listening={status === 'listening'} /></div>
            <div className="assistant-presence">
              <h2>Plain mode</h2>
              <p className="status" aria-live="polite"><span className={`presence-dot presence-${status}`} aria-hidden="true" />{STATUS[status]}</p>
            </div>
          </section>
          {notice && <p className="chat-notice note" role="alert">{notice}</p>}
          <main className="chat-main" aria-label="Conversation">
            <div className="messages" role="log" aria-label="Messages" aria-live="polite" aria-relevant="additions text">
              {msgs.map((m, i) => (
                <div key={i} className={`msg msg-${m.from}`}>
                  <span className="message-author">{m.from === 'student' ? 'You' : 'Assistant'}</span>
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
                </div>
              ))}
              {interim && <div className="msg msg-student msg-interim" aria-hidden="true">{interim}</div>}
            </div>
            <div ref={endRef} />
          </main>
          <form
            className="composer"
            aria-label="Send a message"
            onSubmit={(e: FormEvent) => {
              e.preventDefault()
              send(draft)
            }}
          >
            <button
              type="button"
              className="mic"
              disabled={!canListen || status === 'thinking'}
              aria-pressed={status === 'listening'}
              aria-label={status === 'listening' ? 'Stop listening and send' : 'Talk'}
              onClick={toggleMic}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
              </svg>
            </button>
            <input className="input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Type a message" aria-label="Message" maxLength={1000} />
            <button className="btn btn-primary" disabled={!draft.trim() || status === 'thinking'}>
              Send <span aria-hidden="true">↑</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
