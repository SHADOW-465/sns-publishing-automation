// "Never block": when the tool is unsure, the person may let it decide (Fix with AI), decide themselves, or go on anyway. Whatever
// the tool decided or left unsure is written down here, step by step, and goes out beside the file as <name>_REVIEW_NOTES.txt.
// Pure: the screens, the tests and the headless runs all use it.
import type { CheckItem } from './confidence.ts'
import type { ExportGate, GateOverride } from '../check/exportgate.ts'
import { isbn13Valid } from '../epub/package.ts'

export type How = 'ai' | 'guess' | 'left'

export interface DecisionNote {
  /** the step it happened on: "Structure", "Pictures" … */
  step: string
  /** what it is, in the words the screen used */
  item: string
  /** what was chosen, or that it was left as the tool guessed */
  chosen: string
  how: How
  /** page, part or chapter, picture file */
  where?: string
}

export const HOW_LABEL: Record<How, string> = {
  ai: 'Decided by AI (Groq llama-3.3-70b, or the picture AI)',
  guess: 'Decided with the tool’s best guess',
  left: 'Left as guessed (still unsure)',
}

const key = (n: DecisionNote) => `${n.step}\u0000${n.item}`

/** Later notes replace earlier ones for the same item, so deciding twice is written once. */
export function mergeNotes(cur: DecisionNote[], add: DecisionNote[]): DecisionNote[] {
  const m = new Map(cur.map((n) => [key(n), n]))
  for (const n of add) m.set(key(n), n)
  return [...m.values()]
}

/** Items still unsure when the file is made: added only where the item was not already decided. */
export function withLeft(cur: DecisionNote[], left: DecisionNote[]): DecisionNote[] {
  const seen = new Set(cur.map(key))
  return [...cur, ...left.filter((n) => !seen.has(key(n)))]
}

export const leftNote = (step: string, n: { label: string; where?: string }): DecisionNote => ({ step, item: n.label, chosen: 'Left as the tool guessed; it is still unsure.', how: 'left', where: n.where })

/** `<epub-basename>_REVIEW_NOTES.txt` */
export const reviewNotesName = (file: string) => file.replace(/\.[^./\\]+$/, '') + '_REVIEW_NOTES.txt'

const base = (p: string) => p.split('/').pop() ?? p

/** Where an item of "Check these first" is in the book: the picture file and printed page, the part, the style, the book detail. */
export function whereOfItem(it: Pick<CheckItem, 'id' | 'area' | 'ref' | 'title'>, sections: { nav: string; file?: string }[] = []): string {
  if (it.area === 'picture') {
    const page = it.title.match(/printed page ([^\s(:]+)/)?.[1]
    return `picture file ${base(String(it.ref ?? it.id.replace(/^picture:/, '')))}${page ? `, printed page ${page}` : ''}`
  }
  if (it.area === 'section' && typeof it.ref === 'number') {
    const s = sections[it.ref]
    return `part ${it.ref + 1}${s?.nav?.trim() ? ` (“${s.nav.trim()}”)` : ''}${s?.file ? `, file ${s.file}` : ''}`
  }
  if (it.area === 'style') return `style “${it.ref}”`
  if (it.area === 'meta') return `Book details › ${it.ref ?? it.id.replace(/^meta:/, '')}`
  return it.title.slice(0, 80)
}

/** What "Fix with AI" does to the items that would hold Next: keep the tool's best reading of each, and say so. No model reads a style or a section, so these are best guesses. */
export function decideStructure(items: CheckItem[], o: { roleOf: (style: string) => string | undefined; typeOf: (part: number) => string | undefined; valueOf: (field: string) => string | undefined; sections?: { nav: string; file?: string }[] }): { ack: string[]; keepStyles: string[]; notes: DecisionNote[] } {
  const ack: string[] = []
  const keepStyles: string[] = []
  const notes: DecisionNote[] = items.map((it) => {
    const where = whereOfItem(it, o.sections)
    const pct = `${Math.round(it.score * 100)}% sure`
    let chosen: string
    let how: How = 'guess'
    ack.push(it.id) // an item that is kept no longer holds the step
    if (it.area === 'style') {
      keepStyles.push(String(it.ref))
      chosen = `Kept as “${o.roleOf(String(it.ref)) ?? 'what the tool read'}” (${pct})`
    } else if (it.area === 'meta') {
      const v = o.valueOf(String(it.ref))?.trim()
      chosen = v ? `Kept “${v}” (${pct})` : 'Left empty: the book does not say.'
      if (!v) how = 'left'
    } else {
      chosen = it.area === 'section' && typeof it.ref === 'number' ? `Kept as “${o.typeOf(it.ref) ?? 'the kind the tool chose'}” (${pct})` : it.area === 'picture' ? `Kept where the tool placed it (${pct})` : `Accepted as the tool read it (${pct})`
    }
    return { step: 'Structure', item: it.title, chosen, how, where }
  })
  return { ack, keepStyles, notes }
}

/** "Fix with AI" on Book details: an empty title takes the file's name; the rest cannot be guessed and stays empty, written in the notes. */
export function decideDetails<M extends { title: string; authors: string; publisher: string; eisbn: string }>(m: M, fileName?: string): { meta: M; notes: DecisionNote[] } {
  const notes: DecisionNote[] = []
  let meta = m
  const stem = fileName?.replace(/\.[^./\\]+$/, '').replace(/[_-]+/g, ' ').trim()
  const step = 'Book details'
  if (!m.title.trim()) {
    if (stem) {
      meta = { ...m, title: stem }
      notes.push({ step, item: 'The title is missing', chosen: `Used the file name: “${stem}”`, how: 'guess', where: 'Book details › title' })
    } else notes.push({ step, item: 'The title is missing', chosen: 'Left empty.', how: 'left', where: 'Book details › title' })
  }
  for (const [f, label, v] of [['authors', 'The author is missing', m.authors], ['publisher', 'The publisher is missing', m.publisher]] as const) if (!v.trim()) notes.push({ step, item: label, chosen: 'Left empty: the book does not say, and the tool cannot guess it.', how: 'left', where: `Book details › ${f}` })
  if (!isbn13Valid(m.eisbn)) notes.push({ step, item: m.eisbn.trim() ? 'The e-book ISBN is not a valid 13-digit number' : 'The e-book ISBN is missing (the file is named NO-ISBN_…)', chosen: 'Left as it is; the file name starts with NO-ISBN until one is added.', how: 'left', where: 'Book details › eisbn' })
  return { meta, notes }
}

/** Book details the file will go out without. They never stop the export; they are listed so someone can add them later. */
export function missingDetails(m: { title?: string; authors?: string; publisher?: string; language?: string; eisbn?: string }): string[] {
  const out: string[] = []
  if (!m.title?.trim()) out.push('Title: not given.')
  if (!m.authors?.trim()) out.push('Author: not given.')
  if (!m.publisher?.trim()) out.push('Publisher: not given.')
  if (!m.language?.trim()) out.push('Language: not given.')
  if (!m.eisbn?.trim()) out.push('E-book ISBN: not given (the file name starts with NO-ISBN).')
  else if (!isbn13Valid(m.eisbn)) out.push(`E-book ISBN: “${m.eisbn}” is not a valid 13-digit ISBN.`)
  return out
}

/** For each step: how many were decided by the AI, by best guess, and left. */
export function tally(notes: DecisionNote[]): Record<How, number> {
  const t: Record<How, number> = { ai: 0, guess: 0, left: 0 }
  for (const n of notes) t[n.how]++
  return t
}

export interface NotesInput {
  /** the file the notes go with, e.g. "My Book.epub" */
  file: string
  /** "Accessible EPUB", "Accessible PDF" … */
  kind: string
  notes: DecisionNote[]
  /** book details missing at export (missingDetails) */
  missing?: string[]
  gate?: ExportGate
  override?: GateOverride
  at?: Date
}

const entry = (n: DecisionNote) => [`- [${n.step}] ${n.item.replace(/\s+/g, ' ')}`, `    Chosen: ${n.chosen.replace(/\s+/g, ' ')}`, ...(n.where ? [`    Where: ${n.where}`] : [])]

/** The readable list that goes with the file. Plain text, so any computer opens it. */
export function reviewNotes(p: NotesInput): string {
  const t = tally(p.notes)
  const ofHow = (h: How) => p.notes.filter((n) => n.how === h)
  const section = (title: string, list: DecisionNote[], none: string) => [`${title} (${list.length})`, '-'.repeat(40), ...(list.length ? list.flatMap(entry) : [none]), '']
  const g = p.gate
  return [
    `REVIEW NOTES for ${p.file}`,
    `${p.kind} · ${(p.at ?? new Date()).toISOString()}`,
    '',
    'What the tool decided on its own, and what it left unsure, while this file was made.',
    `${t.ai} decided by the picture AI · ${t.guess} decided with the tool’s best guess · ${t.left} left as guessed (still unsure)${g ? ` · ${g.fixes.length} problem${g.fixes.length === 1 ? '' : 's'} still open in the file` : ''}`,
    '',
    ...section('Decided by the picture AI', ofHow('ai'), 'Nothing.'),
    ...section('Decided with the tool’s best guess', ofHow('guess'), 'Nothing.'),
    ...section('Left as guessed (still unsure): please look at these', ofHow('left'), 'Nothing.'),
    `Missing book details (${p.missing?.length ?? 0})`,
    '-'.repeat(40),
    ...(p.missing?.length ? p.missing.map((m) => `- ${m}`) : ['Nothing.']),
    '',
    ...(g
      ? [
          `Problems still open in the file (${g.fixes.length})`,
          '-'.repeat(40),
          ...(g.fixes.length ? g.fixes.map((f) => `- ${f.source}: ${f.msg.replace(/\s+/g, ' ')}${f.where ? ` (${f.where})` : ''}`) : ['Nothing.']),
          '',
          ...(p.override ? [`Exported anyway by ${p.override.actor} on ${p.override.at}. Reason: ${p.override.reason}`, ''] : []),
          `Things to look at (${g.checks.length})`,
          '-'.repeat(40),
          ...(g.checks.length ? g.checks.slice(0, 100).map((f) => `- ${f.source}: ${f.msg.replace(/\s+/g, ' ')}${f.where ? ` (${f.where})` : ''}`) : ['Nothing.']),
          ...(g.checks.length > 100 ? [`- … and ${g.checks.length - 100} more (see the check report)`] : []),
          '',
          ...(g.skipped.length ? ['Checks that could not run here', '-'.repeat(40), ...g.skipped.map((s) => `- ${s}`), ''] : []),
        ]
      : []),
  ].join('\n')
}
