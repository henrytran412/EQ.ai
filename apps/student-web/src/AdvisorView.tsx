// The advisor view (/advisor/?id=...): what an advisor would get for one student's chat. It opens in a new tab when
// the student clicks OK on the handoff confirmation: Claude's summary, how the student's estimated mood changed, and
// the moments that seemed hard (the last two only if the student shared their mood). Read-only; not sent to SJSU.
import { useEffect, useState } from 'react'
import CaseNoteFields from './CaseNoteView'
import { fetchHandoff, type Handoff } from './handoff'
import { TOPICS } from './policy'
import './advisor.css'

const UNEASY = ['nervous', 'confused', 'frustrated', 'distress']
const topicLabel = (id: string) => TOPICS.find((t) => t.id === id)?.label ?? id
const pct = (n: number) => `${Math.round(n * 100)}%`
const when = (t: number) => new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })

export default function AdvisorView() {
  const id = new URLSearchParams(location.search).get('id')
  const [h, setH] = useState<Handoff | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    document.title = 'EQ.ai · Advisor view'
    if (!id) return // the student's page sends this tab here with an id once the summary is saved
    fetchHandoff(id).then(setH, (e) =>
      setError(e instanceof Error && e.message === 'missing' ? 'This handoff was not found. Handoffs are deleted after 24 hours.' : "Couldn't load this handoff. Please reload the page."),
    )
  }, [id])

  if (!h)
    return (
      <main className="advisor advisor-wait">
        <p className="eyebrow">EQ.ai · Advisor view</p>
        <p role={error ? 'alert' : 'status'}>{error || (id ? 'Loading…' : 'Writing the summary for the advisor…')}</p>
      </main>
    )

  const moodAt = new Map(h.timeline.map((p) => [p.turn, p]))
  const studentNo = new Map<number, number>() // transcript index -> the student's message number
  h.transcript.forEach((t, i) => t.role === 'student' && studentNo.set(i, studentNo.size + 1))
  const shared = h.timeline.length > 0
  const uneasy = h.timeline.filter((p) => UNEASY.includes(p.label))

  return (
    <main className="advisor">
      <header className="advisor-head">
        <div>
          <p className="eyebrow">EQ.ai · Advisor view (demo)</p>
          <h1>{h.student_name}</h1>
          <p className="muted">
            {topicLabel(h.topic)} · asked for a person {when(h.created_at)}
          </p>
        </div>
        <p className="advisor-demo">What an SJSU advisor would get for this chat, so the student explains it once. This demo doesn't send it to SJSU staff.</p>
      </header>

      <section className="card advisor-card">
        <h2>Summary</h2>
        {h.note && <CaseNoteFields note={h.note} source={h.note_source} />}
      </section>

      <section className="card advisor-card">
        <h2>How the student seemed to feel</h2>
        {shared ? (
          <>
            {h.mood && <p className="advisor-mood">{h.mood}</p>}
            <ol className="mood-line" aria-label="Estimated mood after each student message">
              {h.timeline.map((p) => (
                <li key={p.turn} className={`mood mood-${p.label}`}>
                  <small>Message {studentNo.get(p.turn)}</small>
                  <strong>{p.label}</strong> {pct(p.confidence)}
                </li>
              ))}
            </ol>
            <p className="muted">Estimates from EQ.ai's text, face and voice models, shared by the student. They can be wrong, especially with accents.</p>
          </>
        ) : (
          <p className="muted">No mood estimates were shared.</p>
        )}
      </section>

      {shared && (
        <section className="card advisor-card">
          <h2>Where it seemed hard</h2>
          {h.hard_moments.length > 0 ? (
            <ul className="hard-moments">
              {h.hard_moments.map((m, i) => (
                <li key={i}>
                  <q>{m.quote}</q> <span className={`mood mood-${m.estimate}`}>{m.estimate}</span>
                  <p>{m.reason}</p>
                </li>
              ))}
            </ul>
          ) : uneasy.length > 0 ? (
            <ul className="hard-moments">
              {uneasy.map((p) => (
                <li key={p.turn}>
                  <q>{h.transcript[p.turn].text}</q> <span className={`mood mood-${p.label}`}>{p.label}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No message was estimated as nervous, confused, frustrated or in distress.</p>
          )}
        </section>
      )}

      <section className="card advisor-card">
        <h2>The chat with EQ.ai</h2>
        <ol className="advisor-chat">
          {h.transcript.map((t, i) => {
            const p = moodAt.get(i)
            return (
              <li key={i} className={`advisor-msg advisor-${t.role}${p && UNEASY.includes(p.label) ? ' advisor-uneasy' : ''}`}>
                <span className="advisor-author">{t.role === 'student' ? `${h.student_name} · message ${studentNo.get(i)}` : 'EQ.ai'}</span>
                {t.text}
                {p && (
                  <span className={`mood mood-${p.label}`}>
                    {p.label} · {pct(p.confidence)}
                  </span>
                )}
              </li>
            )
          })}
        </ol>
      </section>
    </main>
  )
}
