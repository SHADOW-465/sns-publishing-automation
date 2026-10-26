import { useState } from 'react'
import { download } from './shared.tsx'
import { Icon } from './icons.tsx'
import { HOW_LABEL, leftNote, mergeNotes, reviewNotesName, tally, type DecisionNote, type NotesInput } from '../engine/review/decisions.ts'
import { isInput, type Need } from './needs.ts'

// The decisions report ("<name>_REVIEW_NOTES.txt"): what the tool decided or left unsure on every step, kept while the person works
// and shown on the last step. It goes out beside the file, never inside it (an extra file in the EPUB package could fail EPUBCheck).

export function useReviewNotes() {
  const [notes, setNotes] = useState<DecisionNote[]>([])
  const add = (n: DecisionNote[]) => setNotes((c) => mergeNotes(c, n))
  return {
    notes,
    add,
    clear: () => setNotes([]),
    /**
     * The `StepNav` props of one step. Fix with AI runs `fix` and goes on with what it returns (`over` carries the new values to the
     * next build, which cannot see state set a moment ago); undefined means it failed: the person stays, and can try again or
     * Continue anyway. Continue anyway writes the unsure items as "left" and goes on.
     */
    choices: <O,>(step: string, needs: Need[], fix: () => Promise<{ notes: DecisionNote[]; over?: O } | undefined> | { notes: DecisionNote[]; over?: O } | undefined, go: (over?: O) => void) => ({
      needs,
      onFix: async () => {
        const made = await fix()
        if (!made) return
        add(made.notes)
        go(made.over)
      },
      onContinueAnyway: () => {
        add(needs.filter((n) => !isInput(n)).map((n) => leftNote(step, n)))
        go()
      },
    }),
  }
}

/** The button beside Download: the notes as their own file. */
export function NotesButton({ file, text }: { file: string; text: () => string }) {
  return (
    <button onClick={() => download(text(), reviewNotesName(file), 'text/plain')} title="What the tool decided on its own and what it left unsure, as a text file">
      <Icon name="download" size={16} /> Download the review notes
    </button>
  )
}

/** On-screen summary on the last step. */
export function ReviewSummary({ notes, missing = [], build }: { notes: DecisionNote[]; missing?: string[]; build?: Pick<NotesInput, 'file' | 'kind'> }) {
  const t = tally(notes)
  return (
    <details className="panel review-notes" open={notes.length + missing.length > 0}>
      <summary>Review notes: what the tool decided ({notes.length}{missing.length ? `, ${missing.length} missing detail${missing.length === 1 ? '' : 's'}` : ''})</summary>
      <p className="muted small">
        {t.ai} decided by the picture AI · {t.guess} decided with the tool’s best guess · {t.left} left as guessed (still unsure). The same list goes out as a text file beside the download{build ? `: ${reviewNotesName(build.file)}` : ''}.
      </p>
      {notes.length === 0 && missing.length === 0 && <p className="muted small">Nothing was decided for you and nothing is missing.</p>}
      <ul className="findings">
        {notes.map((n, i) => (
          <li key={i} className={n.how === 'left' ? 'warn' : 'pass'}>
            <span className="lvl">{n.step}</span> {n.item} <strong>→ {n.chosen}</strong> <span className="muted small">({HOW_LABEL[n.how]})</span> {n.where && <code>{n.where}</code>}
          </li>
        ))}
        {missing.map((m) => (
          <li key={m} className="warn">
            <span className="lvl">Book details</span> {m}
          </li>
        ))}
      </ul>
    </details>
  )
}
