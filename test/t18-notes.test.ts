// T18 (OPUS_DESIGN2 §b.9): REVIEW_NOTES gets a "Structure corrected by the page reader" section and DECISIONS.jsonl is written beside it.
// Every applied, refused and reverted op appears once in each. The label for the page reader says nothing about a vendor or "AI".
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { PageEvidence } from '../src/engine/pdf/evidence.ts'
import type { PageDecision } from '../src/engine/pdf/decision.ts'
import type { PageReply, PageRequest } from '../src/engine/pdf/page-model.ts'
import { validate } from '../src/engine/pdf/validate.ts'
import { runRounds, type Check } from '../src/engine/pdf/page-rounds.ts'
import { HOW_LABEL, decisionsJsonl, decisionsName, reviewNotes } from '../src/engine/review/decisions.ts'

const ev = (page: number): PageEvidence => ({
  page, printed: String(page + 10), w: 400, h: 600, columns: [[60, 340]],
  blocks: [
    { id: `p${page}.b01`, kind: 'text', bbox: [60, 200, 200, 214], size: 11, bodySize: 11, lines: 1, text: 'Chapter One', lineIds: [`p${page}.l01`], role: 'P' },
    { id: `p${page}.b02`, kind: 'text', bbox: [60, 230, 340, 244], size: 11, bodySize: 11, lines: 1, text: 'Some body text.', lineIds: [`p${page}.l02`], role: 'P' },
  ],
  engineOrder: [`p${page}.b01`, `p${page}.b02`], engineConfidence: 0.6,
})
const lineText = (page: number) => new Map([[`p${page}.l01`, 'Chapter One'], [`p${page}.l02`, 'Some body text.']])
const check = (e: PageEvidence, ops: PageDecision['ops']) => validate(e, ops, { lineText: lineText(e.page) })
const req = (page: number): PageRequest => ({ ev: ev(page), images: [], hints: [] })
// b01 becomes H2 (applied); b02 is made an artifact mid-page (a guard refuses it, the rest of the answer stands)
const answer = (page: number): PageReply => ({
  status: 'ok', raw: '{}',
  answer: { page, confidence: 0.9, ops: [{ op: 'role', id: `p${page}.b01`, role: 'H2' }, { op: 'role', id: `p${page}.b02`, role: 'Artifact' }], reasons: [{ op: 0, why: 'short line, set apart (PHD-001)', rule: 'PHD-001' }] },
})
const ask = async (r: PageRequest) => answer(r.ev.page)
// page 1 gets better with the edit, page 2 gets worse
const rebuild = async (ds: PageDecision[]): Promise<Check> => {
  const has = (p: number) => ds.some((d) => d.page === p)
  return { errors: new Map([[1, has(1) ? [] : ['x']], [2, has(2) ? ['a', 'b', 'c'] : ['a']]]) }
}

test('T18: every applied, refused and reverted op is once in REVIEW_NOTES and once in DECISIONS.jsonl', async () => {
  const r = await runRounds({ pages: [req(1), req(2)], ask, validate: check, rebuild, model: 'qwen-test', keyOf: (p) => `key${p}` })
  const lines = r.log
  const by = (s: string) => lines.filter((l) => l.status === s)
  assert.deepEqual([by('applied').length, by('refused').length, by('reverted').length], [1, 2, 1])
  assert.deepEqual(by('applied').map((l) => l.page), [1])
  assert.deepEqual(by('reverted').map((l) => l.page), [2])
  assert.equal(by('applied')[0].key, 'key1')
  assert.equal(by('applied')[0].model, 'qwen-test')
  assert.equal(by('applied')[0].rule, 'PHD-001')
  assert.equal(by('applied')[0].before, 'P “Chapter One”')
  assert.equal(by('applied')[0].after, 'H2 “Chapter One”')
  assert.equal(by('applied')[0].validator, 'passed')
  assert.equal(by('refused')[0].validator, 'guard')

  const jsonl = decisionsJsonl(lines)
  const parsed = jsonl.trim().split('\n').map((l) => JSON.parse(l))
  assert.equal(parsed.length, 4)
  assert.deepEqual(parsed.map((p) => p.status).sort(), ['applied', 'refused', 'refused', 'reverted'])
  assert.ok(parsed.every((p) => p.page && p.op?.op && p.key && p.model))

  const text = reviewNotes({ file: 'b.pdf', kind: 'Accessible PDF', notes: r.notes })
  assert.match(text, /Structure corrected by the page reader \(1 edit on 1 page; 2 refused; 1 reverted\)/)
  assert.ok(text.indexOf('Structure corrected by the page reader') < text.indexOf('Decided with the tool’s best guess'))
  assert.match(text, /Before: P “Chapter One”\n {4}After: {2}H2 “Chapter One”/)
  assert.match(text, /Status: applied · Key: key1/)
  assert.match(text, /Status: reverted/)
  assert.match(text, /Status: refused/)
  // once each: one entry per op, none repeated in another section
  assert.equal(text.match(/^- \[Page reader\]/gm)?.length, 4)
  assert.equal(r.notes.filter((n) => n.status).length, 4)
})

test('T18: with no page reader edits the notes have no such section, and the file name sits beside REVIEW_NOTES', () => {
  const text = reviewNotes({ file: 'b.pdf', kind: 'Accessible PDF', notes: [] })
  assert.doesNotMatch(text, /page reader/)
  assert.equal(decisionsName('9781234567897.epub'), '9781234567897_DECISIONS.jsonl')
})

test('T18: the label for the page reader names no vendor and does not say "AI"', () => {
  assert.equal(HOW_LABEL.ai, 'Decided by the page reader / picture describer')
  assert.ok(Object.values(HOW_LABEL).every((l) => !/\bAI\b|Groq|llama/i.test(l)))
  assert.ok('person' in HOW_LABEL)
})
