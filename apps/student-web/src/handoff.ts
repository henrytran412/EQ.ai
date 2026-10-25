// Handoffs live on the dialogue service (SQLite, kept 24 hours), so an advisor on any device sees the student's case
// note and chat, and replies. The student's page and the advisor console check for changes every 2 seconds.
import { localNote, normalizeNote, type CaseNote, type NoteSource } from './caseNote.ts'
import type { ChatRequest, EmotionEstimate } from './policy'

export type Handoff = {
  id: string
  version: number // goes up with every change; pages keep the newest one they have seen
  student_name: string
  topic: string // topic id, e.g. financial_aid_hold
  note?: CaseNote // the advisor's case note, once written
  note_source?: NoteSource
  emotion?: EmotionEstimate // present only if the student agreed to share it
  transcript: ChatRequest['history'] // the chat with EQ.ai before the handoff
  status: 'waiting' | 'active' | 'resolved'
  staff_id?: string
  messages: { from: 'student' | 'staff'; text: string; at: number }[]
  created_at: number
  local?: boolean // only on this page: demo mode, or the service couldn't be reached
}

const apiUrl = (): string => import.meta.env?.VITE_API_URL ?? ''
const str = (v: unknown) => (typeof v === 'string' ? v : '')

// Untrusted server data: keep only well-formed fields.
export function parseHandoff(d: any): Handoff | null {
  if (typeof d?.id !== 'string' || !['waiting', 'active', 'resolved'].includes(d.status) || !Array.isArray(d.messages)) return null
  const transcript: Handoff['transcript'] = Array.isArray(d.transcript)
    ? d.transcript.filter((t: any) => (t?.role === 'student' || t?.role === 'assistant') && typeof t.text === 'string')
        .map((t: any) => ({ role: t.role, text: t.text }))
    : []
  const said = transcript.filter((t) => t.role === 'student').map((t) => t.text)
  const { note, source } = normalizeNote({ source: d.note_source, summary: d.note }, said)
  const e = d.emotion
  return {
    id: d.id,
    version: Number.isFinite(d.version) ? d.version : 0,
    student_name: str(d.student_name),
    topic: str(d.topic),
    note,
    note_source: source,
    emotion: typeof e?.label === 'string' && Number.isFinite(e?.confidence) ? { label: e.label, confidence: e.confidence } : undefined,
    transcript,
    status: d.status,
    staff_id: str(d.staff_id) || undefined,
    messages: d.messages
      .filter((m: any) => (m?.from === 'student' || m?.from === 'staff') && typeof m.text === 'string')
      .map((m: any) => ({ from: m.from, text: m.text, at: Number.isFinite(m.at) ? m.at : 0 })),
    created_at: Number.isFinite(d.created_at) ? d.created_at : Date.now(),
  }
}

// Errors carry a short reason: unauthorized, not-configured, closed, busy, or the HTTP status.
async function call(path: string, init: RequestInit = {}, code?: string): Promise<any> {
  const res = await fetch(`${apiUrl()}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(code ? { Authorization: `Bearer ${code}` } : {}) },
  })
  const reasons: Record<number, string> = { 401: 'unauthorized', 409: 'closed', 429: 'busy', 503: 'not-configured' }
  if (!res.ok) throw new Error(reasons[res.status] ?? `handoff API ${res.status}`)
  return res.json()
}

function one(d: unknown): Handoff {
  const h = parseHandoff(d)
  if (!h) throw new Error('bad handoff data')
  return h
}

// The student clicked "Connect me". If the service can't be reached (or in demo mode), the handoff stays on this
// page with a note from the student's own words, so they can still share it with the office.
export async function createHandoff(req: {
  session_id: string
  topic: string
  student_name: string
  history: ChatRequest['history']
  emotion?: EmotionEstimate
}): Promise<Handoff> {
  const history = req.history.slice(-40) // the service accepts up to 40 turns
  if (apiUrl()) {
    try {
      return one(await call('/handoffs', { method: 'POST', body: JSON.stringify({ ...req, history, emotion: req.emotion ?? null }) }))
    } catch {} // fall through to a handoff on this page only
  }
  const said = history.filter((t) => t.role === 'student').map((t) => t.text)
  return {
    id: crypto.randomUUID(), version: 1, student_name: req.student_name, topic: req.topic, note: localNote(said),
    note_source: 'fallback', emotion: req.emotion, transcript: history, status: 'waiting', messages: [],
    created_at: Date.now(), local: true,
  }
}

const at = (id: string) => `/handoffs/${encodeURIComponent(id)}`
export const fetchHandoff = async (id: string) => one(await call(at(id)))
// With the advisor's code the message is from the advisor, without it from the student.
export const sendHandoffMessage = async (id: string, text: string, code?: string) =>
  one(await call(`${at(id)}/messages`, { method: 'POST', body: JSON.stringify({ text }) }, code))
export const setHandoffStatus = async (id: string, status: 'active' | 'resolved', code: string, staff_id: string) =>
  one(await call(`${at(id)}/status`, { method: 'POST', body: JSON.stringify({ status, staff_id }) }, code))

export async function listHandoffs(code: string): Promise<Handoff[]> {
  const d = await call('/handoffs', {}, code)
  return Array.isArray(d?.handoffs) ? d.handoffs.map(parseHandoff).filter((h: Handoff | null): h is Handoff => !!h) : []
}

// Runs `check` now and then every `ms` until stopped; a slow check never overlaps the next one.
export function poll(check: () => Promise<void>, ms = 2000): () => void {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const run = async () => {
    try {
      await check()
    } catch {} // tried again next round
    if (!stopped) timer = setTimeout(run, ms)
  }
  void run()
  return () => {
    stopped = true
    clearTimeout(timer)
  }
}
