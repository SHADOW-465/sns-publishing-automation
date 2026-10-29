// T19 (OPUS_DESIGN2 §b.2, OPUS_PLAN 5.1–5.2): the batch runner. Build all books, then the page reader once over all of them, then apply and
// rebuild, then validate, then score and write QUEUE.md. A timeout per stage and a try/catch per book: one corrupt book does not stop the run.
// The model and the validators are never resident together; the worst book is first in the queue.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bookScore, queueMd, runBatch, type Stages, type Validation } from '../src/engine/batch/run.ts'

const books = ['alpha', 'bravo', 'corrupt', 'delta', 'echo']
// what each book's validation finds: bravo is the weakest of the sound books
const found: Record<string, Validation> = {
  alpha: { pass: true, items: [{ score: 0.95, msg: 'Caption tagged P', where: 'page 4' }] },
  bravo: { pass: true, items: [{ score: 0.3, msg: 'Reading order uncertain', where: 'page 9' }, { score: 0.5, msg: 'Heading level guessed', where: 'page 12' }, { score: 0.55, msg: 'Table without header', where: 'page 40' }, { score: 0.4, msg: 'Picture without description', where: 'page 41' }, { score: 0.9, msg: 'Fine' }] },
  delta: { pass: true, items: [{ score: 0.8, msg: 'List guessed', where: 'page 2' }] },
  echo: { pass: false, items: [{ score: 0.9, msg: 'EPUBCheck: 2 errors' }] },
}

function rig(over: Partial<Stages> = {}) {
  const log: string[] = []
  const resident = { model: false }
  const stages: Stages = {
    build: async (b) => {
      log.push(`build:${b}`)
      if (b === 'corrupt') throw new Error('not a PDF: bad xref table')
    },
    ai: async (b) => {
      assert.ok(resident.model, 'the model is asked only while it is loaded')
      log.push(`ai:${b}`)
    },
    apply: async (b) => {
      assert.ok(!resident.model, 'the rebuild runs with the model unloaded')
      log.push(`apply:${b}`)
    },
    validate: async (b) => {
      assert.ok(!resident.model, 'the validators never run while the model is loaded')
      log.push(`validate:${b}`)
      return found[b]
    },
    ...over,
  }
  const model = {
    load: async () => (log.push('model:load'), (resident.model = true), undefined),
    unload: async () => (log.push('model:unload'), (resident.model = false), undefined),
  }
  return { log, stages, model, resident }
}

test('T19: 5 books, one corrupt, finish unattended; the model loads once and is gone before any validator runs', async () => {
  const { log, stages, model } = rig()
  const r = await runBatch({ books, stages, model, timeoutMs: 1000 })
  assert.equal(r.length, 5)
  assert.equal(log.filter((l) => l === 'model:load').length, 1)
  assert.equal(log.filter((l) => l === 'model:unload').length, 1)
  const at = (l: string) => log.indexOf(l)
  // every build, then the model, then the rebuilds and validators
  for (const b of books) assert.ok(at(`build:${b}`) < at('model:load'))
  assert.ok(log.filter((l) => l.startsWith('ai:')).every((l) => at(l) > at('model:load') && at(l) < at('model:unload')))
  assert.ok(log.filter((l) => /^(apply|validate):/.test(l)).every((l) => at(l) > at('model:unload')))
  // the corrupt book failed at its build, was not shown to the model or the validators, and the others went through
  const bad = r.find((x) => x.book === 'corrupt')!
  assert.equal(bad.failed?.stage, 'build')
  assert.match(bad.failed!.error, /bad xref/)
  assert.ok(!log.some((l) => /^(ai|apply|validate):corrupt$/.test(l)))
  assert.deepEqual(log.filter((l) => l.startsWith('validate:')), ['validate:alpha', 'validate:bravo', 'validate:delta', 'validate:echo'])
})

test('T19: a stage that hangs is stopped at its timeout and the next book goes on; a model that will not load leaves the pages as built', async () => {
  const seen: AbortSignal[] = []
  const a = rig({ build: async (b, signal) => { if (b === 'bravo') (seen.push(signal), await new Promise(() => {})) } })
  const r = await runBatch({ books, stages: a.stages, model: a.model, timeoutMs: 30 })
  assert.equal(r.find((x) => x.book === 'bravo')!.failed?.stage, 'build')
  assert.match(r.find((x) => x.book === 'bravo')!.failed!.error, /timed out/)
  assert.ok(seen[0].aborted, 'the stage is told to stop')
  assert.ok(r.find((x) => x.book === 'alpha')!.score > 0)

  const b = rig()
  b.model.load = async () => { throw new Error('no server') }
  const r2 = await runBatch({ books, stages: b.stages, model: b.model, timeoutMs: 1000 })
  assert.ok(!b.log.some((l) => l.startsWith('ai:')))
  assert.ok(r2.filter((x) => !x.failed).every((x) => x.notes.some((n) => /page reader not available/.test(n))))
  assert.ok(b.log.includes('validate:alpha'), 'the build goes on')

  // a page reader that fails on one book is a note on that book, not a failed book
  const c = rig({ ai: async (bk) => { if (bk === 'delta') throw new Error('out of memory') } })
  const r3 = await runBatch({ books, stages: c.stages, model: c.model, timeoutMs: 1000 })
  const d = r3.find((x) => x.book === 'delta')!
  assert.equal(d.failed, undefined)
  assert.ok(d.notes.some((n) => /out of memory/.test(n)))
  assert.ok(c.log.includes('validate:delta'))
})

test('T19: the book score is the weaker of "passes the validators" and the 10th-percentile item score; the worst book is first in QUEUE.md', async () => {
  assert.equal(bookScore({ pass: false, items: [{ score: 0.9, msg: 'x' }] }).score, 0)
  assert.equal(bookScore({ pass: true, items: [] }).score, 1)
  assert.deepEqual(bookScore(found.bravo), { score: 0.3, low: 4 })
  // ten items: the 10th percentile is the lowest one; twenty: the second lowest
  const many = (n: number) => ({ pass: true, items: Array.from({ length: n }, (_, i) => ({ score: (i + 1) / 100, msg: `m${i}` })) })
  assert.equal(bookScore(many(10)).score, 0.01)
  assert.equal(bookScore(many(20)).score, 0.02)

  const { stages, model } = rig()
  const r = await runBatch({ books, stages, model, timeoutMs: 1000, ms: (() => { let t = 0; return () => (t += 1000) })() })
  assert.deepEqual(r.map((x) => x.book), ['corrupt', 'echo', 'bravo', 'delta', 'alpha'], 'failed first, then a failed validator, then the weakest')
  const q = queueMd(r, new Date('2026-10-30T22:00:00Z'))
  const lines = q.split('\n')
  assert.match(q, /^# Review queue/)
  const first = lines.findIndex((l) => /^1\. /.test(l))
  assert.match(lines[first], /corrupt/)
  assert.match(lines[first], /failed at build/i)
  assert.match(q, /bad xref/)
  // bravo: the 3 worst items with where they are, worst first, and the time taken
  const b = lines.findIndex((l) => /^3\. .*bravo/.test(l))
  assert.match(lines[b], /score 30/)
  assert.match(lines[b], /4 items under 0\.6/)
  assert.match(lines[b + 1], /Reading order uncertain.*page 9/)
  assert.match(lines[b + 2], /Picture without description.*page 41/)
  assert.match(lines[b + 3], /Heading level guessed.*page 12/)
  assert.ok(!/Table without header/.test(lines[b + 4] ?? ''), 'only the 3 worst')
  assert.match(lines[b], /\d+ s|\d+ min/)
})
