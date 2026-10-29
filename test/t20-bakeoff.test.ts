// T20 (OPUS_DESIGN2 §b.8): the model bake-off harness. N models over the eval pages, one comparison table with the accuracy columns, p50/p95
// seconds and peak VRAM for each; the winner (most accurate, p95 under 20 s) and its weights hash are written to config.
// The models are fakes: a canned answer per model, a clock that advances by a set time per page, a VRAM sampler.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EvidenceBlock, PageEvidence } from '../src/engine/pdf/evidence.ts'
import type { Op } from '../src/engine/pdf/decision.ts'
import type { PageReply } from '../src/engine/pdf/page-model.ts'
import { bakeoffTable, chooseModel, readChoice, recordChoice, runBakeoff, type BakeCase, type Candidate } from '../src/engine/pdf/bakeoff.ts'

const lineText: Record<string, string> = {}
let ln = 0
const T = (n: number, y: number, text: string, x: Partial<EvidenceBlock> = {}): EvidenceBlock => {
  const id = `p1.l${String(++ln).padStart(2, '0')}`
  lineText[id] = text
  return { id: `p1.b${String(n).padStart(2, '0')}`, kind: 'text', bbox: [60, y, 340, y + 14], size: 11, bodySize: 11, lines: 1, text, lineIds: [id], role: 'P', ...x }
}
const ev: PageEvidence = {
  page: 1, printed: '1', w: 400, h: 600, columns: [[60, 340]],
  blocks: [
    T(1, 100, 'A Heading', { size: 20, role: 'H1' }),
    T(2, 130, 'Alpha the old road ran past the mill.'),
    { id: 'p1.f01', kind: 'figure', bbox: [60, 200, 180, 280], pieces: ['p1.i01', 'p1.i02'], caption: null },
    T(3, 290, 'Figure 1. The mill.', { italic: true }),
    T(4, 330, 'Bravo the men talked of weather.'),
  ],
  // the engine reads the caption last and tags it P
  engineOrder: ['p1.b01', 'p1.b02', 'p1.f01', 'p1.b04', 'p1.b03'],
  engineConfidence: 0.7,
}
const kase: BakeCase = {
  req: { ev, images: [] },
  lineText,
  expected: {
    order: ['p1.b01', 'p1.b02', 'p1.f01', 'p1.b03', 'p1.b04'],
    roles: { 'p1.b01': 'H1', 'p1.b02': 'P', 'p1.b03': 'Caption', 'p1.b04': 'P' },
    figures: [['p1.i01', 'p1.i02']],
  },
}
const GOOD: Op[] = [{ op: 'order', ids: ['p1.b01', 'p1.b02', 'p1.f01', 'p1.b03', 'p1.b04'] }, { op: 'role', id: 'p1.b03', role: 'Caption' }]
const BAD: Op[] = [{ op: 'role', id: 'p1.b99', role: 'Caption' }, { op: 'none' }] // one op names a block that is not on the page
const ok = (ops: Op[]): PageReply => ({ status: 'ok', answer: { page: 1, ops, confidence: 0.9, reasons: [] }, raw: '' })

// per model: what it answers, how long a page takes (ms), the VRAM it shows after each page (MiB)
const fakes: Record<string, { reply: PageReply; ms: number[]; vram: number[]; hash?: string }> = {
  accurate: { reply: ok(GOOD), ms: [4000, 6000, 30000], vram: [20000, 22000, 21000], hash: 'a'.repeat(64) },
  small: { reply: ok(BAD), ms: [1000, 2000, 3000], vram: [6000, 6100, 6000], hash: 'b'.repeat(64) },
}

async function bake() {
  let t = 0
  let current = ''
  const queue: Record<string, { ms: number[]; vram: number[] }> = {}
  const cands: Candidate[] = Object.entries(fakes).map(([name, f]) => ({
    name, cfg: { apiKey: '', baseUrl: 'http://x', model: name }, weightsSha256: f.hash, quant: 'fp8',
    load: async () => { current = name; queue[name] = { ms: [...f.ms], vram: [...f.vram] } },
    unload: async () => { current = '' },
    vram: async () => (current ? queue[current].vram.shift() : undefined),
  }))
  const rows = await runBakeoff(cands, [kase, kase, kase], {
    ask: async (cfg) => (t += queue[cfg.model].ms.shift()!, fakes[cfg.model].reply),
    now: () => t,
  })
  return { rows, cands }
}

test('T20: each model gets a row with the accuracy columns, p50/p95 seconds and peak VRAM', async () => {
  const { rows } = await bake()
  const [acc, small] = rows
  assert.equal(acc.model, 'accurate')
  assert.equal(acc.pages, 3)
  // the right answer: order and caption and heading and figure all right
  assert.equal(acc.order, 1)
  assert.equal(acc.captionF1, 1)
  assert.equal(acc.headingF1, 1)
  assert.equal(acc.figure, 1)
  assert.equal(acc.rejected, 0)
  assert.equal(acc.p50, 6)
  assert.equal(acc.p95, 30)
  assert.equal(acc.vramMiB, 22000)
  // the small model's one bad op is rejected (1 of 2 ops, every page); the page keeps the engine order, which has the caption last
  assert.equal(small.rejected, 0.5)
  assert.ok(small.order! < 1)
  assert.equal(small.captionF1, 0)
  assert.equal(small.p50, 2)
  assert.equal(small.vramMiB, 6100)
})

test('T20: the table has one line per model with every column', async () => {
  const { rows } = await bake()
  const md = bakeoffTable(rows)
  for (const h of ['Model', 'Reading order', 'Caption F1', 'Heading F1', 'Figures', 'Rejected', 'p50 s', 'p95 s', 'Peak VRAM GB']) assert.ok(md.includes(h), h)
  assert.equal(md.split('\n').filter((l) => /^\| (accurate|small) /.test(l)).length, 2)
  assert.match(md, /\| accurate \|.*\| 21\.5 \|/)
})

test('T20: the choice is the most accurate model with p95 under 20 s, and it is recorded with its weights hash', async () => {
  const { rows, cands } = await bake()
  // "accurate" is the better model but its p95 is 30 s
  const pick = chooseModel(rows)!
  assert.equal(pick.model, 'small')
  assert.equal(chooseModel(rows, 60)!.model, 'accurate')
  assert.equal(chooseModel(rows, 0.5), undefined)
  const dir = mkdtempSync(join(tmpdir(), 't20-'))
  try {
    const file = join(dir, 'config', 'page-model.json')
    recordChoice(file, pick, cands.find((c) => c.name === pick.model)!)
    const c = readChoice(file)!
    assert.equal(c.model, 'small')
    assert.equal(c.weightsSha256, 'b'.repeat(64))
    assert.equal(c.quant, 'fp8')
    assert.ok(JSON.parse(readFileSync(file, 'utf8')).p95 <= 20)
    // a model whose weights cannot be named is not recorded: the cache key needs the hash (§b.6)
    assert.throws(() => recordChoice(file, pick, { ...cands[1], weightsSha256: undefined }), /weights/i)
    assert.equal(readChoice(join(dir, 'none.json')), undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
