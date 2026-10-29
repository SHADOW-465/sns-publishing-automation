// T16 (OPUS_DESIGN2 §b.7): retries, rounds and revert. No page is asked more than 3 times per round; a page whose edits raise the
// error count is reverted, and REVIEW_NOTES says so.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { PageEvidence } from '../src/engine/pdf/evidence.ts'
import type { PageDecision } from '../src/engine/pdf/decision.ts'
import type { PageReply, PageRequest } from '../src/engine/pdf/page-model.ts'
import { validate } from '../src/engine/pdf/validate.ts'
import { MAX_ASKS, MAX_ROUNDS, askWithRetries, runRounds, type Check } from '../src/engine/pdf/page-rounds.ts'
import { reviewNotes } from '../src/engine/review/decisions.ts'

const ev = (page: number): PageEvidence => ({
  page, printed: String(page), w: 400, h: 600, columns: [[60, 340]],
  blocks: [
    { id: `p${page}.b01`, kind: 'text', bbox: [60, 200, 200, 214], size: 11, bodySize: 11, lines: 1, text: 'Chapter One', lineIds: [`p${page}.l01`], role: 'P' },
    { id: `p${page}.b02`, kind: 'text', bbox: [60, 230, 340, 244], size: 11, bodySize: 11, lines: 1, text: 'Some body text.', lineIds: [`p${page}.l02`], role: 'P' },
  ],
  engineOrder: [`p${page}.b01`, `p${page}.b02`], engineConfidence: 0.6,
})
const lineText = (page: number) => new Map([[`p${page}.l01`, 'Chapter One'], [`p${page}.l02`, 'Some body text.']])
const check = (e: PageEvidence, ops: PageDecision['ops']) => validate(e, ops, { lineText: lineText(e.page) })
const req = (page: number): PageRequest => ({ ev: ev(page), images: [], hints: ['base hint'] })
const good = (page: number) => ({ page, ops: [{ op: 'role' as const, id: `p${page}.b01`, role: 'H2' as const }], confidence: 0.9, reasons: [] })
const ok = (page: number): PageReply => ({ status: 'ok', answer: good(page), raw: '{}' })
// an order that leaves a block out: fails the reference check (b.5.1)
const badOrder = (page: number): PageReply => ({ status: 'ok', answer: { page, ops: [{ op: 'order', ids: [`p${page}.b01`] }], confidence: 0.9, reasons: [] }, raw: '{}' })

/** an ask function that plays `script` per page (the last reply repeats) and counts the calls */
function fake(script: Record<number, PageReply[]>) {
  const calls: PageRequest[] = []
  const ask = async (r: PageRequest): Promise<PageReply> => {
    calls.push(r)
    const mine = calls.filter((c) => c.ev.page === r.ev.page).length
    const s = script[r.ev.page] ?? [ok(r.ev.page)]
    return s[Math.min(mine, s.length) - 1]
  }
  return { ask, calls, asked: (page: number) => calls.filter((c) => c.ev.page === page).length }
}

test('T16: an answer that keeps failing is asked 3 times, not more, and the page is left; each retry carries the validator’s words', async () => {
  const f = fake({ 1: [badOrder(1)] })
  const r = await askWithRetries(req(1), f.ask, check)
  assert.equal(MAX_ASKS, 3)
  assert.equal(f.asked(1), 3)
  assert.equal(r.status, 'left')
  assert.match(f.calls[1].hints!.join('\n'), /p1\.b02 is missing from order/)
  assert.ok(f.calls[1].hints!.includes('base hint'))
  assert.ok(!f.calls[0].hints!.join('\n').includes('missing'))
})

test('T16: a bad answer then a good one takes 2 asks and keeps the good answer', async () => {
  const f = fake({ 1: [{ status: 'invalid', why: 'The answer was not JSON.', raw: 'x' }, ok(1)] })
  const r = await askWithRetries(req(1), f.ask, check)
  assert.equal(r.status, 'ok')
  assert.equal(f.asked(1), 2)
  assert.match(f.calls[1].hints!.join('\n'), /not JSON/)
})

test('T16: a timeout is retried once, then the page is left', async () => {
  const f = fake({ 1: [{ status: 'timeout', why: 'slow' }] })
  const r = await askWithRetries(req(1), f.ask, check)
  assert.equal(f.asked(1), 2)
  assert.equal(r.status, 'left')
  if (r.status === 'left') assert.match(r.why, /timed out/)
})

test('T16: whatever mix of failures, no page is asked more than 3 times in a round', async () => {
  const f = fake({ 1: [{ status: 'timeout', why: 's' }, badOrder(1), { status: 'invalid', why: 'bad', raw: '' }, ok(1)] })
  const r = await askWithRetries(req(1), f.ask, check)
  assert.equal(f.asked(1), 3)
  assert.equal(r.status, 'left')
})

test('T16: with the server off the first page is tried twice, the others are not tried, and all are left: page reader not available', async () => {
  const f = fake({ 1: [{ status: 'unavailable', why: 'down' }], 2: [{ status: 'unavailable', why: 'down' }], 3: [{ status: 'unavailable', why: 'down' }] })
  const r = await runRounds({ pages: [req(1), req(2), req(3)], ask: f.ask, validate: check, rebuild: async () => ({ errors: new Map() }) })
  assert.equal(f.calls.length, 2)
  assert.deepEqual(r.left.map((l) => [l.page, l.why]), [1, 2, 3].map((p) => [p, 'page reader not available']))
  assert.deepEqual(r.decisions, [])
})

/** a book whose error count is the sum over `errs`, by what is laid on it */
const book = (errs: (ds: PageDecision[]) => Record<number, number>, extra: (ds: PageDecision[]) => number = () => 0) => {
  const rebuilds: PageDecision[][] = []
  const rebuild = async (ds: PageDecision[]): Promise<Check> => {
    rebuilds.push(ds)
    const e = errs(ds)
    const errors = new Map(Object.entries(e).map(([p, n]) => [Number(p), Array.from({ length: n }, (_, i) => `finding ${i + 1} on page ${p}`)]))
    if (extra(ds)) errors.set(0, Array.from({ length: extra(ds) }, () => 'elsewhere'))
    return { errors }
  }
  return { rebuild, rebuilds }
}
const has = (ds: PageDecision[], page: number) => ds.some((d) => d.page === page)

test('T16: a page whose edits raise the error count is reverted, and REVIEW_NOTES says so; a page whose edits help is kept', async () => {
  const f = fake({})
  // page 1 has 2 errors and the edit fixes them; page 2 has 1 and the edit makes it 3
  const b = book((ds) => ({ 1: has(ds, 1) ? 0 : 2, 2: has(ds, 2) ? 3 : 1 }))
  const r = await runRounds({ pages: [req(1), req(2)], ask: f.ask, validate: check, rebuild: b.rebuild })
  assert.deepEqual(r.decisions.map((d) => d.page), [1])
  assert.deepEqual(r.reverted.map((x) => x.page), [2])
  const notes = r.notes.filter((n) => /Reverted/i.test(n.chosen))
  assert.equal(notes.length, 1)
  assert.equal(notes[0].where, 'page 2')
  const text = reviewNotes({ file: 'b.epub', kind: 'Accessible PDF', notes: r.notes })
  assert.match(text, /Reverted/)
  assert.match(text, /page 2/i)
})

test('T16: edits that raise the book’s error count elsewhere are reverted too', async () => {
  const f = fake({})
  // the edit to page 1 fixes page 1 but breaks something not on page 1 (e.g. a continues to the page before)
  const b = book((ds) => ({ 1: has(ds, 1) ? 0 : 1 }), (ds) => (has(ds, 1) ? 3 : 0))
  const r = await runRounds({ pages: [req(1)], ask: f.ask, validate: check, rebuild: b.rebuild })
  assert.deepEqual(r.decisions, [])
  assert.deepEqual(r.reverted.map((x) => x.page), [1])
  assert.match(r.notes.map((n) => n.chosen).join('\n'), /Reverted/)
})

test('T16: a score dimension that falls on a book with a reference reverts the round', async () => {
  const f = fake({})
  const rebuild = async (ds: PageDecision[]): Promise<Check> => ({ errors: new Map([[1, [1, 2].map(() => 'x')]]), scores: { order: ds.length ? 0.8 : 0.9, roles: 0.7 } })
  const r = await runRounds({ pages: [req(1)], ask: f.ask, validate: check, rebuild })
  assert.deepEqual(r.decisions, [])
  assert.match(r.notes.map((n) => n.chosen).join('\n'), /Reverted.*order/s)
})

test('T16: round 2 asks only the pages whose check still fails, shows the model its earlier answer and the finding, and stops after 3 rounds', async () => {
  const f = fake({})
  // page 1 is fixed in round 1; page 2's edit does not remove its error but does not raise it either, so it stays failing
  const b = book((ds) => ({ 1: has(ds, 1) ? 0 : 1, 2: 1 }))
  const r = await runRounds({ pages: [req(1), req(2)], ask: f.ask, validate: check, rebuild: b.rebuild })
  assert.equal(f.asked(1), 1)
  assert.ok(f.asked(2) <= MAX_ASKS * MAX_ROUNDS)
  const later = f.calls.filter((c) => c.ev.page === 2).slice(1)
  assert.ok(later.length >= 1)
  assert.match(later[0].hints!.join('\n'), /finding 1 on page 2/)
  assert.match(later[0].hints!.join('\n'), /"op":"role"/)
  assert.ok(r.rounds <= MAX_ROUNDS)
})

test('T16: a round that changes nothing stops the rounds', async () => {
  const f = fake({ 2: [{ status: 'ok', answer: { page: 2, ops: [{ op: 'none' }], confidence: 0.9, reasons: [] }, raw: '{}' }] })
  const b = book(() => ({ 2: 1 }))
  const r = await runRounds({ pages: [req(2)], ask: f.ask, validate: check, rebuild: b.rebuild })
  assert.equal(r.rounds, 1)
  assert.equal(f.asked(2), 1)
})

test('T16: a page with no error after round 1 is not asked again', async () => {
  const f = fake({})
  const b = book((ds) => ({ 1: has(ds, 1) ? 0 : 1 }))
  const r = await runRounds({ pages: [req(1)], ask: f.ask, validate: check, rebuild: b.rebuild })
  assert.equal(f.asked(1), 1)
  assert.equal(r.rounds, 1)
  assert.deepEqual(r.decisions.map((d) => d.by), ['ai'])
})
