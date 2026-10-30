// T28 (OPUS_DESIGN2 §c.6): the weekly learning report. From the DECISIONS.jsonl of many books and the pages a person overrode it lists
// (1) the rules whose ops people reverted, worst first, and (2) the instructions typed on 3 or more books of one client.
// Nothing changes on its own: the report only proposes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decisionsJsonl, type DecisionLine } from '../src/engine/review/decisions.ts'
import { learningReport, learningTally, parseDecisions, type BookLog } from '../src/engine/review/learning.ts'

const line = (page: number, status: DecisionLine['status'], rule?: string): DecisionLine => ({ page, op: { op: 'role', id: `p${page}.b01`, role: 'H2' }, item: `page ${page}`, status, validator: 'passed', ...(rule ? { rule } : {}) })
// client A: PHD-001 is reverted on 3 pages of 2 books and applied once; CAP-002 is applied everywhere. client B: one revert of PHD-001.
const books: BookLog[] = [
  { client: 'A', book: 'a1', lines: [line(1, 'reverted', 'PHD-001'), line(2, 'reverted', 'PHD-001'), line(3, 'applied', 'CAP-002')] },
  { client: 'A', book: 'a2', lines: [line(4, 'reverted', 'PHD-001'), line(5, 'applied', 'PHD-001'), line(6, 'applied', 'CAP-002'), line(7, 'refused', 'PHD-001')] },
  { client: 'B', book: 'b1', lines: [line(1, 'reverted', 'PHD-001'), line(2, 'applied', 'CAP-002')] },
]
const typed = (client: string, book: string, ruleId: string, value: unknown) => ({ client, book, ruleId, value: value as never })

test('T28: reverted-op hot spots are grouped by client and rule, worst first; refused ops are not reverts', () => {
  const { hotSpots } = learningTally({ books, instructions: [] })
  assert.deepEqual(hotSpots.map((h) => [h.client, h.rule, h.reverted, h.total, h.books]), [['A', 'PHD-001', 3, 5, ['a1', 'a2']], ['B', 'PHD-001', 1, 1, ['b1']]])
})

test('T28: a page a person overrode counts the applied ops on it as reverted by a person', () => {
  const { hotSpots } = learningTally({ books, instructions: [], overridden: [{ book: 'a2', page: 5 }, { book: 'a2', page: 6 }] })
  const cap = hotSpots.find((h) => h.client === 'A' && h.rule === 'CAP-002')
  assert.deepEqual([cap?.reverted, cap?.total], [1, 2])
  assert.equal(hotSpots.find((h) => h.client === 'A' && h.rule === 'PHD-001')?.reverted, 4)
})

test('T28: the same instruction on 3 or more books of one client is proposed for the client layer; 2 books is not', () => {
  const instructions = [
    typed('A', 'a1', 'CAP-001', 'below'), typed('A', 'a2', 'CAP-001', 'below'), typed('A', 'a3', 'CAP-001', 'below'), typed('A', 'a3', 'CAP-001', 'below'),
    typed('A', 'a1', 'HDG-004', true), typed('A', 'a2', 'HDG-004', true),
    typed('B', 'b1', 'CAP-001', 'below'), typed('A', 'a4', 'CAP-001', 'above'),
  ]
  const { promotions } = learningTally({ books: [], instructions })
  assert.deepEqual(promotions.map((p) => [p.client, p.ruleId, p.value, p.books]), [['A', 'CAP-001', 'below', ['a1', 'a2', 'a3']]])
})

test('T28: the report is plain words, proposes only, and says so when there is nothing', () => {
  const instructions = ['a1', 'a2', 'a3'].map((b) => typed('A', b, 'CAP-001', 'below'))
  const text = learningReport({ books, instructions })
  assert.match(text, /Weak spots: ops people reverted \(2\)/)
  assert.match(text, /A · PHD-001: 3 of 5 ops reverted on 2 books/)
  assert.match(text, /Instructions typed on 3 or more books of one client \(1\)/)
  assert.match(text, /A · CAP-001 = "below" on a1, a2, a3/)
  assert.match(text, /A person approves each one/)
  assert.doesNotMatch(text, /\bAI\b/)
  const none = learningReport({ books: [], instructions: [] })
  assert.match(none, /Weak spots: ops people reverted \(0\)\n-+\nNothing\./)
})

test('T28: DECISIONS.jsonl text is read back, skipping blank and broken lines', () => {
  const lines = [line(1, 'reverted', 'PHD-001'), line(2, 'applied')]
  assert.deepEqual(parseDecisions(decisionsJsonl(lines) + '\n{broken\n'), lines)
})
