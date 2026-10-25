import { useEffect, useState, type FormEvent } from 'react'
import CaseNoteFields from './CaseNoteView'
import { listHandoffs, poll, sendHandoffMessage, setHandoffStatus, type Handoff } from './handoff'
import { TOPICS } from './policy'

// The advisor console (/staff): students who asked for a person, with the case note and their chat with EQ.ai, so the
// advisor can reply without making them explain it again. Needs the advisor access code (STAFF_CODE on the server).
const STAFF_ID = 'Advisor (demo)'
const CODE_KEY = 'eqai-advisor-code' // this tab only
const ERRORS: Record<string, string> = {
  unauthorized: 'That access code is not right.',
  'not-configured': 'The advisor console is not set up on this server yet.',
  closed: 'This chat is already closed.',
  busy: 'Too many requests. Please wait a minute.',
}
const topicLabel = (id: string) => TOPICS.find((t) => t.id === id)?.label ?? id
const newer = (old: Handoff | undefined, h: Handoff) => (old && old.version > h.version ? old : h)
const upsert = (list: Handoff[], h: Handoff) =>
  list.some((x) => x.id === h.id) ? list.map((x) => (x.id === h.id ? newer(x, h) : x)) : [h, ...list]
const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

function savedCode() {
  try {
    return sessionStorage.getItem(CODE_KEY) ?? ''
  } catch {
    return '' // storage blocked: the advisor types the code again
  }
}

function Login({ error, onSubmit }: { error: string; onSubmit: (code: string) => void }) {
  const [value, setValue] = useState('')
  return (
    <main className="page">
      <form
        className="login card"
        onSubmit={(e) => {
          e.preventDefault()
          if (value.trim()) onSubmit(value.trim())
        }}
      >
        <h2>Advisor console</h2>
        <p className="muted">Enter the advisor access code to see students who asked for a person.</p>
        <div className="field">
          <label htmlFor="code">Access code</label>
          <input id="code" className="input" type="password" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
        {error && (
          <p className="note" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn-primary" disabled={!value.trim()}>
          Open the console
        </button>
      </form>
    </main>
  )
}

export default function Staff() {
  const [code, setCode] = useState(savedCode)
  const [list, setList] = useState<Handoff[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')

  function signIn(next: string) {
    try {
      if (next) sessionStorage.setItem(CODE_KEY, next)
      else sessionStorage.removeItem(CODE_KEY)
    } catch {}
    setCode(next)
    if (!next) setList([])
  }

  function fail(e: unknown) {
    const reason = e instanceof Error ? e.message : ''
    if (reason === 'unauthorized' || reason === 'not-configured') signIn('')
    setError(ERRORS[reason] ?? "Can't reach the EQ.ai service. Trying again…")
  }

  useEffect(() => {
    if (!code) return
    return poll(async () => {
      try {
        const fresh = await listHandoffs(code)
        setError('')
        setList((prev) => fresh.map((h) => newer(prev.find((x) => x.id === h.id), h)))
      } catch (e) {
        fail(e)
      }
    })
  }, [code])

  if (!code)
    return (
      <Login
        error={error}
        onSubmit={(c) => {
          setError('')
          signIn(c)
        }}
      />
    )

  const current = list.find((h) => h.id === selected) ?? null

  async function act(change: Promise<Handoff>) {
    try {
      const h = await change
      setList((l) => upsert(l, h))
    } catch (e) {
      fail(e)
    }
  }

  function reply(e: FormEvent) {
    e.preventDefault()
    const text = draft.trim()
    if (!current || !text) return
    setDraft('')
    void act(sendHandoffMessage(current.id, text, code))
  }

  return (
    <div className="staff">
      <aside className="queue">
        <div className="row" style={{ justifyContent: 'space-between', paddingRight: 16 }}>
          <h2>Handoffs</h2>
          <button className="btn btn-outline btn-small" onClick={() => signIn('')}>
            Sign out
          </button>
        </div>
        {error && (
          <p className="note" role="alert" style={{ margin: '0 20px 12px' }}>
            {error}
          </p>
        )}
        {list.length === 0 && <p className="muted" style={{ padding: '0 20px 20px' }}>No one is waiting. New handoffs appear here within a few seconds.</p>}
        {list.map((h) => (
          <button key={h.id} className="queue-item" aria-current={h.id === selected} onClick={() => setSelected(h.id)}>
            <span className={`status-chip status-${h.status}`}>{h.status}</span>
            <strong>{h.student_name}</strong>
            <span className="muted">
              {topicLabel(h.topic)} · {time(h.created_at)}
            </span>
          </button>
        ))}
      </aside>

      {current ? (
        <section className="detail">
          <div className="detail-head">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <p className="eyebrow">{topicLabel(current.topic)}</p>
                <h2 style={{ fontSize: 32 }}>{current.student_name}</h2>
              </div>
              {current.status === 'waiting' && (
                <button className="btn btn-primary btn-small" onClick={() => void act(setHandoffStatus(current.id, 'active', code, STAFF_ID))}>
                  Take this chat
                </button>
              )}
              {current.status === 'active' && (
                <button className="btn btn-outline btn-small" onClick={() => void act(setHandoffStatus(current.id, 'resolved', code, STAFF_ID))}>
                  Mark resolved
                </button>
              )}
            </div>
            <div className="card" style={{ padding: 16, display: 'grid', gap: 8 }}>
              <p className="eyebrow">What the student already told EQ.ai</p>
              {current.note && <CaseNoteFields note={current.note} source={current.note_source} />}
              <p className="muted">
                {current.emotion
                  ? `Emotion estimate, shared by the student: ${current.emotion.label} (${Math.round(current.emotion.confidence * 100)}%)`
                  : 'Emotion estimate: not shared by the student.'}
              </p>
              {current.transcript.length > 0 && (
                <details className="transcript">
                  <summary>Full chat with EQ.ai ({current.transcript.length} messages)</summary>
                  <ol>
                    {current.transcript.map((t, i) => (
                      <li key={i}>
                        <strong>{t.role === 'student' ? current.student_name : 'EQ.ai'}:</strong> {t.text}
                      </li>
                    ))}
                  </ol>
                </details>
              )}
            </div>
          </div>

          <div className="messages">
            {current.messages.map((m, i) => (
              <div key={i} className={`msg ${m.from === 'staff' ? 'msg-student' : 'msg-assistant'}`}>
                {m.text}
                <small>{time(m.at)}</small>
              </div>
            ))}
          </div>

          {current.status === 'active' && (
            <form className="composer" onSubmit={reply}>
              <input className="input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={`Reply to ${current.student_name}`} aria-label="Reply" maxLength={1000} />
              <button className="btn btn-secondary" disabled={!draft.trim()}>
                Send
              </button>
            </form>
          )}
        </section>
      ) : (
        <div className="empty">Select a handoff to see the summary and reply.</div>
      )}
    </div>
  )
}
