import { useEffect, useState, type FormEvent } from 'react'
import { publish, requestSync, subscribe, type Handoff } from './handoff'

const STAFF_ID = 'Advisor (demo)'
const upsert = (list: Handoff[], h: Handoff) =>
  list.some((x) => x.id === h.id) ? list.map((x) => (x.id === h.id ? h : x)) : [h, ...list]
const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

export default function Staff() {
  const [list, setList] = useState<Handoff[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    const off = subscribe((h) => setList((l) => upsert(l, h)))
    requestSync() // student tabs re-send handoffs created before this console opened
    return off
  }, [])

  const current = list.find((h) => h.id === selected) ?? null

  function change(h: Handoff) {
    setList((l) => upsert(l, h))
    publish(h)
  }

  function reply(e: FormEvent) {
    e.preventDefault()
    const text = draft.trim()
    if (!current || !text) return
    setDraft('')
    change({ ...current, messages: [...current.messages, { from: 'staff', text, at: Date.now() }] })
  }

  return (
    <div className="staff">
      <aside className="queue">
        <h2>Handoffs</h2>
        {list.length === 0 && <p className="muted" style={{ padding: '0 20px 20px' }}>No one is waiting. New handoffs appear here live.</p>}
        {list.map((h) => (
          <button key={h.id} className="queue-item" aria-current={h.id === selected} onClick={() => setSelected(h.id)}>
            <span className={`status-chip status-${h.status}`}>{h.status}</span>
            <strong>{h.student_name}</strong>
            <span className="muted">
              {h.topic} · {time(h.created_at)}
            </span>
          </button>
        ))}
      </aside>

      {current ? (
        <section className="detail">
          <div className="detail-head">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <p className="eyebrow">{current.topic}</p>
                <h2 style={{ fontSize: 32 }}>{current.student_name}</h2>
              </div>
              {current.status === 'waiting' && (
                <button className="btn btn-primary btn-small" onClick={() => change({ ...current, status: 'active', staff_id: STAFF_ID })}>
                  Take this chat
                </button>
              )}
              {current.status === 'active' && (
                <button className="btn btn-outline btn-small" onClick={() => change({ ...current, status: 'resolved' })}>
                  Mark resolved
                </button>
              )}
            </div>
            <div className="card" style={{ padding: 16, display: 'grid', gap: 8 }}>
              <p className="eyebrow">What the student already told EQ.ai</p>
              <p style={{ fontSize: 16 }}>{current.summary}</p>
              <p className="muted">
                {current.emotion
                  ? `Emotion estimate, shared by the student: ${current.emotion.label} (${Math.round(current.emotion.confidence * 100)}%)`
                  : 'Emotion estimate: not shared by the student.'}
              </p>
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
