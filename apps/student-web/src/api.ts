import { localNote, normalizeNote, type CaseNote, type NoteSource } from './caseNote'
import { demoRespond, normalizeResponse, type ChatRequest, type ChatResponse } from './policy'

const API_URL: string = import.meta.env.VITE_API_URL ?? ''
export const isDemo = !API_URL

export async function askAssistant(req: ChatRequest): Promise<ChatResponse> {
  if (isDemo) {
    await new Promise((r) => setTimeout(r, 700)) // lets the "thinking" face show, like a real round trip
    return demoRespond(req)
  }
  const res = await fetch(`${API_URL}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  if (res.status === 429) throw new Error('busy') // per-visitor limit: shown as 'wait a few minutes'
  if (!res.ok) throw new Error(`chat API ${res.status}`)
  return normalizeResponse(await res.json())
}

// Claude writes the advisor's case note from the chat; if the service can't, the note is the student's own words.
export async function summarizeHandoff(req: {
  session_id: string
  topic: string
  history: ChatRequest['history']
}): Promise<{ note: CaseNote; source: NoteSource }> {
  const history = req.history.slice(-40) // the service accepts up to 40 turns
  const said = history.filter((t) => t.role === 'student').map((t) => t.text)
  if (isDemo) return { note: localNote(said), source: 'fallback' }
  try {
    const res = await fetch(`${API_URL}/handoff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...req, history }),
    })
    if (res.ok) return normalizeNote(await res.json(), said)
  } catch {} // network error: fall through to the student's own words
  return { note: localNote(said), source: 'fallback' }
}
