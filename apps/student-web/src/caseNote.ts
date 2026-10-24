// The advisor's case note (POST /handoff): what the student needs, so they only have to explain it once.

export type CaseNote = { problem: string; deadline: string | null; tried: string[]; next_step: string }
export type NoteSource = 'claude' | 'fallback'

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

// From the student's own messages, used when Claude or the service can't write the note.
export function localNote(said: string[]): CaseNote {
  return {
    problem: said.slice(-4).join(' / ') || "The student hasn't described the problem yet.",
    deadline: null,
    tried: [],
    next_step: "Read the student's messages and follow up with them.",
  }
}

// Untrusted server data: keep only well-formed fields; without a problem statement, use the student's words.
export function normalizeNote(data: any, said: string[]): { note: CaseNote; source: NoteSource } {
  const n = data?.summary
  const problem = text(n?.problem)
  if (!problem) return { note: localNote(said), source: 'fallback' }
  return {
    note: {
      problem,
      deadline: text(n.deadline) || null,
      tried: Array.isArray(n.tried) ? n.tried.map(text).filter(Boolean).slice(0, 8) : [],
      next_step: text(n.next_step) || localNote(said).next_step,
    },
    source: data.source === 'claude' ? 'claude' : 'fallback',
  }
}
