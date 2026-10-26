// What a wizard step still needs before Next can go on, in plain words. Pure: the dialog, the status line and the tests use it.
// Rule (Showmik, Oct 25; client, Oct 26): Next is never disabled, and never a dead end. A step that is not complete says what
// is unsure and offers three ways on: Fix with AI, I'll fix it myself, Continue anyway.

import { isbn13Valid } from '../engine/epub/package.ts'

export interface Need {
  id: string
  /** what the person sees in the list, e.g. 'Style “tital”: choose what it is' */
  label: string
  /** the short name used in the status line, grouped and counted: 'style', 'publisher name', 'picture' */
  group: string
  /** a needs-a-choice item cannot be accepted in bulk; an acceptable one can */
  kind: 'choice' | 'acceptable'
  /** DOM id of the element "Go to it" scrolls to */
  target?: string
  /** page, part or chapter, picture file: goes into the review notes */
  where?: string
}

/** A missing input file (nothing was added to read) is not a decision: there is nothing for the tool to guess. Its id starts with "file:". */
export const isInput = (n: Pick<Need, 'id'>) => n.id.startsWith('file:')

/**
 * What the Next button does. Rule (client, Oct 26): the app never blocks. Only a job that is really running greys it out;
 * unsure items open the three choices (Fix with AI, I'll fix it myself, Continue anyway) and every one of them lets the person on.
 */
export function nextPlan(o: { busy?: boolean; needs?: Need[] }) {
  const needs = o.needs ?? []
  const decisions = needs.filter((n) => !isInput(n))
  return {
    disabled: !!o.busy,
    opens: needs.length ? ('dialog' as const) : ('go' as const),
    /** the three ways on, offered whenever something is unsure */
    choices: decisions.length ? (['fix', 'myself', 'anyway'] as const) : ([] as const),
    missingInput: needs.filter(isInput),
  }
}

/** DOM id for a "Check these first" item (ids like "picture:OEBPS/image/1.jpg" are not valid fragment ids). */
export const targetId = (itemId: string) => 'check-' + itemId.replace(/[^A-Za-z0-9_-]/g, '_')

const plural = (n: number, word: string) => (n === 1 || /(name|title)$/.test(word) ? word : /s$/.test(word) ? word : word.replace(/y$/, 'ie') + 's')

/** "1 style, publisher name, 83 pictures": groups in first-seen order, counted when more than one or countable. */
export function needsSummary(needs: Need[]): string {
  const groups = new Map<string, number>()
  for (const n of needs) groups.set(n.group, (groups.get(n.group) ?? 0) + 1)
  return [...groups].map(([g, c]) => (/(name|title)$/.test(g) && c === 1 ? g : `${c} ${plural(c, g)}`)).join(', ')
}

/** Dialog heading: "2 things are unsure. How do you want to go on?" */
export function needsHeadline(needs: Need[]): string {
  const n = needs.length
  return n === 1 ? '1 thing is unsure. How do you want to go on?' : `${n} things are unsure. How do you want to go on?`
}

export const acceptableNeeds = (needs: Need[]) => needs.filter((n) => n.kind === 'acceptable')
export const choiceNeeds = (needs: Need[]) => needs.filter((n) => n.kind === 'choice')

/** Structure step: the blocking "Check these first" items as needs. */
export function structureNeeds<T extends { id: string; area: string; title: string }>(items: T[], isAcceptable: (it: T) => boolean, whereOf?: (it: T) => string): Need[] {
  return items.map((it) => {
    const meta = it.area === 'meta' ? it.id.replace(/^meta:/, '') : ''
    const group = it.area === 'style' ? 'style' : meta ? ({ title: 'book title', authors: 'author name', publisher: 'publisher name' } as Record<string, string>)[meta] ?? `${meta} name` : it.area === 'section' ? 'section' : it.area === 'picture' ? 'picture' : 'note'
    return { id: it.id, label: it.title, group, kind: isAcceptable(it) ? 'acceptable' : 'choice', target: targetId(it.id), where: whereOf?.(it) }
  })
}

/** "Keep as it is" on a style the tool was unsure of: the reviewer confirms the tool's reading. Without it the only way to
 *  keep the guess was to pick another meaning and back, and Next asked again and again (dinamicas "subtitulo-1"). */
export const keepStylePatch = <R extends string>(role: R) => ({ role, reason: 'kept as read by the reviewer' })

/** Book details step: what is missing or doubtful. None of it stops anything; it is listed so the person can add it, or let the tool go on. */
export function detailNeeds(m: { title: string; authors: string; publisher: string; eisbn: string }): Need[] {
  const need = (field: string, label: string, group: string): Need => ({ id: `meta:${field}`, label, group, kind: 'choice', target: `meta-${field}`, where: `Book details › ${field}` })
  return [
    ...(!m.title.trim() ? [need('title', 'The title is missing', 'book title')] : []),
    ...(!m.authors.trim() ? [need('authors', 'The author is missing', 'author name')] : []),
    ...(!m.publisher.trim() ? [need('publisher', 'The publisher is missing', 'publisher name')] : []),
    ...(!isbn13Valid(m.eisbn) ? [need('eisbn', m.eisbn.trim() ? 'The e-book ISBN is not a valid 13-digit number' : 'The e-book ISBN is missing (the file is named NO-ISBN_…)', 'e-book ISBN')] : []),
  ]
}
