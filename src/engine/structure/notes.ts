// What kind of notes a book has, and whether every reference has its note (design §3.4).
// Readers list references and notes; matching, confidence and flags are the same for every source.
import { actionOf } from './score.ts'

export type NoteKind = 'indesign-footnote' | 'indesign-endnote' | 'typed-endnote' | 'pdf-footnote'

/** A reference in the text, or a note body. `scope` is where its number is unique: the book, or one printed page. */
export interface NoteMark { label: string; scope: string; where: string; id?: string }

export interface NoteFinding {
  kind: NoteKind
  /** how sure the tool is that these are notes of this kind, lowered by every reference or note left without a partner */
  confidence: number
  action: 'silent' | 'listed' | 'blocked'
  evidence: string[]
  refs: number
  notes: number
  unmatchedRefs: NoteMark[]
  unmatchedNotes: NoteMark[]
}

const KIND_NAME: Record<NoteKind, string> = {
  'indesign-footnote': 'InDesign footnotes', 'indesign-endnote': 'InDesign endnotes', 'typed-endnote': 'typed endnote section', 'pdf-footnote': 'PDF footnotes',
}
export const kindName = (k: NoteKind) => KIND_NAME[k]

/** Match each reference to its note by id, or by number within the scope. `base` is the confidence of the kind itself. */
export function matchNotes(kind: NoteKind, base: number, evidence: string[], refs: NoteMark[], notes: NoteMark[]): NoteFinding {
  const key = (m: NoteMark) => (m.id ? `#${m.id}` : `${m.scope}|${m.label}`)
  const noteKeys = new Set(notes.map(key))
  const refKeys = new Set(refs.map(key))
  const unmatchedRefs = refs.filter((r) => !noteKeys.has(key(r)))
  const unmatchedNotes = notes.filter((n) => !refKeys.has(key(n)))
  const total = Math.max(1, refs.length + notes.length)
  const bad = unmatchedRefs.length + unmatchedNotes.length
  const confidence = Math.round(base * (1 - (bad / total) * 1.5) * 100) / 100
  const ok = refs.length - unmatchedRefs.length
  return {
    kind, confidence: Math.max(0, confidence), action: actionOf(Math.max(0, confidence)),
    evidence: [...evidence, `${ok} of ${refs.length} references have their note`],
    refs: refs.length, notes: notes.length, unmatchedRefs, unmatchedNotes,
  }
}

/** One line per problem for the review list: a reference with no note, a note nobody refers to. */
export function noteProblems(f: NoteFinding): { id: string; confidence: number; title: string; why: string }[] {
  const at = (m: NoteMark) => (m.where ? ` (${m.where})` : '')
  return [
    ...f.unmatchedRefs.map((m) => ({ id: `note-ref:${f.kind}:${m.scope}:${m.label}`, confidence: 0.4, title: `Note number ${m.label}${at(m)} has no note text`, why: `${kindName(f.kind)}: the reference is in the text but no note carries that number.` })),
    ...f.unmatchedNotes.map((m) => ({ id: `note-body:${f.kind}:${m.scope}:${m.label}`, confidence: 0.5, title: `Note ${m.label}${at(m)} is not referenced in the text`, why: `${kindName(f.kind)}: no number in the text points to it, so it would be dropped.` })),
  ]
}
