// The weekly learning report (OPUS_DESIGN2 §c.6, T28): from the DECISIONS.jsonl of many books and the pages a person overrode, the rules whose
// ops people reverted (a weak card or prompt) and the instructions typed on 3 or more books of one client (to promote to the client layer).
// It only proposes: a person approves each edit, and approval triggers an eval run. Pure: no node imports.
import type { DecisionLine } from './decisions.ts'
import { promotionSuggestions, type Override } from '../spec/precedence.ts'

export interface BookLog {
  client: string
  book: string
  lines: DecisionLine[]
}
export interface HotSpot {
  client: string
  rule: string
  /** ops reverted by the round check, plus applied ops on a page a person overrode */
  reverted: number
  /** every op of the rule, whatever became of it */
  total: number
  /** the books with a reverted op */
  books: string[]
}
export interface LearningInput {
  books: BookLog[]
  /** the instructions typed, one per book and rule (the same shape the promotion check reads) */
  instructions: Override[]
  /** pages where a person replaced the page reader's ops */
  overridden?: { book: string; page: number }[]
}

/** DECISIONS.jsonl back into lines; a blank or broken line is skipped */
export function parseDecisions(text: string): DecisionLine[] {
  const out: DecisionLine[] = []
  for (const l of text.split('\n')) {
    try {
      if (l.trim()) out.push(JSON.parse(l) as DecisionLine)
    } catch {
      // ponytail: a half-written line is not worth stopping a weekly tally for
    }
  }
  return out
}

export function learningTally(i: LearningInput) {
  const person = new Set((i.overridden ?? []).map((o) => `${o.book}\u0000${o.page}`))
  const by = new Map<string, HotSpot>()
  for (const b of i.books)
    for (const l of b.lines) {
      const rule = l.rule ?? '(no rule given)'
      const h = by.get(`${b.client}\u0000${rule}`) ?? { client: b.client, rule, reverted: 0, total: 0, books: [] }
      h.total++
      if (l.status === 'reverted' || (l.status === 'applied' && person.has(`${b.book}\u0000${l.page}`))) {
        h.reverted++
        if (!h.books.includes(b.book)) h.books.push(b.book)
      }
      by.set(`${b.client}\u0000${rule}`, h)
    }
  const hotSpots = [...by.values()].filter((h) => h.reverted).sort((a, b) => b.reverted - a.reverted || b.reverted / b.total - a.reverted / a.total || a.client.localeCompare(b.client) || a.rule.localeCompare(b.rule))
  return { hotSpots, promotions: promotionSuggestions(i.instructions) }
}

export function learningReport(i: LearningInput): string {
  const { hotSpots, promotions } = learningTally(i)
  const section = (title: string, rows: string[]) => [`${title} (${rows.length})`, '-'.repeat(40), ...(rows.length ? rows : ['Nothing.']), '']
  return [
    'WEEKLY LEARNING REPORT',
    'Proposals only. A person approves each one, and approval triggers an eval run; nothing changes on its own.',
    '',
    ...section('Weak spots: ops people reverted', hotSpots.map((h) => `- ${h.client} · ${h.rule}: ${h.reverted} of ${h.total} ops reverted on ${h.books.length} book${h.books.length === 1 ? '' : 's'} (${h.books.join(', ')}). Look at the rule card and its prompt line.`)),
    ...section('Instructions typed on 3 or more books of one client', promotions.map((p) => `- ${p.client} · ${p.ruleId} = ${JSON.stringify(p.value)} on ${p.books.join(', ')}. Suggest adding it to the client layer.`)),
  ].join('\n')
}
