import type { CaseNote, NoteSource } from './caseNote'

// The advisor's case note, shown on the student's handoff screen and in the staff console.
// A fallback note is only the student's own words, so it can't know the deadline or what was tried.
export default function CaseNoteFields({ note, source }: { note: CaseNote; source?: NoteSource }) {
  const extracted = source === 'claude'
  return (
    <dl className="case-note">
      <dt>{extracted ? 'Problem' : 'In their words'}</dt>
      <dd>{note.problem}</dd>
      {extracted && (
        <>
          <dt>Deadline</dt>
          <dd>{note.deadline ?? 'Not mentioned'}</dd>
          <dt>Already tried</dt>
          <dd>
            {note.tried.length ? (
              <ul>
                {note.tried.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            ) : (
              'Nothing yet'
            )}
          </dd>
        </>
      )}
      <dt>First step for the advisor</dt>
      <dd>{note.next_step}</dd>
    </dl>
  )
}
