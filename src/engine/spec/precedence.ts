// =============================================================================================
// Spec vs rulebook (OPUS_DESIGN2 §a.3, T22). The order, highest first: locked standards > the book's instruction > the requirements spec >
// the client rulebook > house > assumptions. layers.ts applies it; one exception lives there too: a rulebook value that is a client
// correction dated after the spec document beats the spec (an undated spec is older than every correction).
// Here: what a conflict becomes (REVIEW_NOTES lines, open questions for the client), two rows of one file that disagree on one level,
// and the instruction overrides that recur on 3 books of one client. Pure: no node imports.
// =============================================================================================
import type { DecisionNote } from '../review/decisions.ts'
import type { Conflict, Resolved } from './layers.ts'
import { houseDefault, needsWaiver, ruleById, show, type RuleValue } from './rules.ts'
import type { Requirement } from './requirements.ts'

/** REVIEW_NOTES lines for the conflicts a person should know about. The instruction's overrides are written by `instructionNotes`. */
export const conflictNotes = (r: Pick<Resolved, 'conflicts'>): DecisionNote[] =>
  r.conflicts.map((c) => ({ step: 'Rules', item: c.item, chosen: c.chosen, how: 'left', rule: c.ruleId }))

/** The conflicts that need the client's word, as rows for the "Open questions" sheet of the spec workbook. */
export const conflictQuestions = (cs: Conflict[]): Requirement[] => cs.flatMap((c) => (c.ask ? [{ text: c.ask, where: `Rule ${c.ruleId}, ${c.kind === 'correction' ? 'dated correction' : c.kind === 'locked' ? 'locked standard' : 'two rows disagree'}` }] : []))

export interface Row {
  ruleId: string
  value: RuleValue
  quote: string
  where: string
}

/**
 * Two rows of one file that give one rule different values on the same level: take the accessible value (one that needs no waiver), else
 * the rulebook's, else the house default, else the first row; and ask the client, with both quotes. A value stated twice is not a conflict.
 */
export function settleSameSource<T extends Row>(rows: T[], rulebook: Record<string, RuleValue> = {}): { kept: T[]; conflicts: Conflict[] } {
  const by = new Map<string, T[]>()
  for (const x of rows) by.set(x.ruleId, [...(by.get(x.ruleId) ?? []), x])
  const kept: T[] = []
  const conflicts: Conflict[] = []
  for (const [id, group] of by) {
    const distinct = group.filter((x, i) => group.findIndex((y) => same(y.value, x.value)) === i)
    if (distinct.length === 1) {
      kept.push(distinct[0])
      continue
    }
    const r = ruleById.get(id)
    const wanted = r ? [(x: T) => !needsWaiver(r, x.value), (x: T) => id in rulebook && same(x.value, rulebook[id]), (x: T) => same(x.value, houseDefault(r))] : []
    const pick = wanted.map((f) => distinct.filter(f)).find((m) => m.length === 1)?.[0] ?? distinct[0]
    kept.push(pick)
    const said = distinct.map((x) => `“${x.quote}” (${x.where})`).join(' and ')
    const title = r ? `${r.title} (${id})` : id
    conflicts.push({
      kind: 'same-source', ruleId: id, quotes: distinct.map((x) => x.quote),
      item: `Two rows disagree on ${title}: ${said}`,
      chosen: `Used ${r ? show(r, pick.value) : String(pick.value)} (${pick.where}) and asked the client.`,
      ask: `${title}: your file says ${said}. We used ${r ? show(r, pick.value) : String(pick.value)} (${pick.where}). Which do you want?`,
    })
  }
  return { kept, conflicts }
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

export interface Override {
  client: string
  book: string
  ruleId: string
  value: RuleValue
}
export interface Promotion {
  client: string
  ruleId: string
  value: RuleValue
  books: string[]
}

/** The same instruction override on `min` or more books of one client: suggested for the client layer, which a person approves. */
export function promotionSuggestions(overrides: Override[], min = 3): Promotion[] {
  const m = new Map<string, Promotion>()
  for (const o of overrides) {
    const k = JSON.stringify([o.client, o.ruleId, o.value])
    const p = m.get(k) ?? { client: o.client, ruleId: o.ruleId, value: o.value, books: [] }
    if (!p.books.includes(o.book)) p.books.push(o.book)
    m.set(k, p)
  }
  return [...m.values()].filter((p) => p.books.length >= min)
}
