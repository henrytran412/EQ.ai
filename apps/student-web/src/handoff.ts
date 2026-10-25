// The handoff an advisor would get: saved on the dialogue service (SQLite, kept 24 hours) when the student clicks OK,
// then shown in a new tab (/advisor/?id=...) with Claude's summary and, if the student shared it, how their
// estimated mood changed during the chat.
import { localNote, normalizeNote, type CaseNote, type NoteSource } from './caseNote.ts'
import type { ChatRequest } from './policy'

export type MoodPoint = { turn: number; label: string; confidence: number } // turn: index in the transcript
export type HardMoment = { quote: string; estimate: string; reason: string }
export type Handoff = {
  id: string
  student_name: string
  topic: string // topic id, e.g. financial_aid_hold
  note?: CaseNote // the advisor's case note, once written
  note_source?: NoteSource
  mood?: string // Claude: how the estimated mood changed (only if the student shared it)
  hard_moments: HardMoment[] // Claude: where it seemed hard, and why (only if shared)
  timeline: MoodPoint[] // estimated mood after each student message (only if shared)
  transcript: ChatRequest['history'] // the chat with EQ.ai
  created_at: number
  local?: boolean // only on this page: demo mode, or the service couldn't be reached
}

const apiUrl = (): string => import.meta.env?.VITE_API_URL ?? ''
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
export const advisorUrl = (id: string) => `/advisor/?id=${encodeURIComponent(id)}`

// Untrusted server data: keep only well-formed fields.
export function parseHandoff(d: any): Handoff | null {
  if (typeof d?.id !== 'string' || !Array.isArray(d.transcript)) return null
  const transcript: Handoff['transcript'] = d.transcript
    .filter((t: any) => (t?.role === 'student' || t?.role === 'assistant') && typeof t.text === 'string')
    .map((t: any) => ({ role: t.role, text: t.text }))
  const said = transcript.filter((t) => t.role === 'student').map((t) => t.text)
  const { note, source } = normalizeNote({ source: d.note_source, summary: d.note }, said)
  return {
    id: d.id,
    student_name: str(d.student_name),
    topic: str(d.topic),
    note,
    note_source: source,
    mood: str(d.note?.mood) || undefined,
    hard_moments: Array.isArray(d.note?.hard_moments)
      ? d.note.hard_moments
          .map((m: any) => ({ quote: str(m?.quote), estimate: str(m?.estimate), reason: str(m?.reason) }))
          .filter((m: HardMoment) => m.quote && m.reason)
      : [],
    timeline: Array.isArray(d.timeline)
      ? d.timeline.filter(
          (p: any) => Number.isInteger(p?.turn) && transcript[p.turn]?.role === 'student' && typeof p.label === 'string' && Number.isFinite(p.confidence),
        ).map((p: any) => ({ turn: p.turn, label: p.label, confidence: p.confidence }))
      : [],
    transcript,
    created_at: Number.isFinite(d.created_at) ? d.created_at : Date.now(),
  }
}

// The student clicked OK. `history` must be at most 40 turns (the service's limit), because `timeline` points
// into it by index. If the service can't be reached (or in demo mode), the handoff stays on this page with a note
// from the student's own words, so they can still share it with the office.
export async function createHandoff(req: {
  session_id: string
  topic: string
  student_name: string
  history: ChatRequest['history']
  timeline: MoodPoint[]
}): Promise<Handoff> {
  if (apiUrl()) {
    try {
      const res = await fetch(`${apiUrl()}/handoffs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req) })
      const h = res.ok ? parseHandoff(await res.json()) : null
      if (h) return h
    } catch {} // network error: fall through to a handoff on this page only
  }
  const said = req.history.filter((t) => t.role === 'student').map((t) => t.text)
  return {
    id: crypto.randomUUID(), student_name: req.student_name, topic: req.topic, note: localNote(said), note_source: 'fallback',
    hard_moments: [], timeline: req.timeline, transcript: req.history, created_at: Date.now(), local: true,
  }
}

// The advisor view loads the handoff by its random id. Errors: 'missing' (unknown or older than 24 hours), else HTTP.
export async function fetchHandoff(id: string): Promise<Handoff> {
  const res = await fetch(`${apiUrl()}/handoffs/${encodeURIComponent(id)}`)
  if (!res.ok) throw new Error(res.status === 404 ? 'missing' : `handoff API ${res.status}`)
  const h = parseHandoff(await res.json())
  if (!h) throw new Error('bad handoff data')
  return h
}
