import type { CaseNote } from './caseNote'

// The advisor's case note, shown on the student's handoff screen and in the staff console.
export default function CaseNoteFields({ note }: { note: CaseNote }) {
  return (
    <dl className="case-note">
      <dt>Problem</dt>
      <dd>{note.problem}</dd>
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
      <dt>First step for the advisor</dt>
      <dd>{note.next_step}</dd>
    </dl>
  )
}
