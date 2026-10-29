// T13 (OPUS_DESIGN2 §b.5.1–b.5.4): the validator of a page answer. Reference checks, text conservation, the rule guards and the
// geometry sanity check. A failing op is dropped on its own and listed with the reason; a failed conservation drops the answer.
// One synthetic page, built by hand as the layout JSON (the validator reads the evidence, not a PDF).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { EvidenceBlock, PageEvidence } from '../src/engine/pdf/evidence.ts'
import type { Op } from '../src/engine/pdf/decision.ts'
import { applyOps, conserved, kendallTau, validate, type ValidateOptions } from '../src/engine/pdf/validate.ts'

const LONG = Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ')
/** text blocks as [id, bbox, lines, extras]; each line is p3.l<nn> in order of appearance */
const lineText = new Map<string, string>()
let ln = 0
const T = (n: number, bbox: EvidenceBlock['bbox'], lines: string[], x: Partial<EvidenceBlock> = {}): EvidenceBlock => {
  const lineIds = lines.map((t) => (lineText.set(`p3.l${String(++ln).padStart(2, '0')}`, t), `p3.l${String(ln).padStart(2, '0')}`))
  return { id: `p3.b${String(n).padStart(2, '0')}`, kind: 'text', bbox, size: 11, bodySize: 11, lines: lines.length, text: lines.join(' '), lineIds, role: 'P', ...x }
}
const F = (n: number, bbox: EvidenceBlock['bbox'], pieces: string[]): EvidenceBlock => ({ id: `p3.f${String(n).padStart(2, '0')}`, kind: 'figure', bbox, pieces, caption: null })

const blocks: EvidenceBlock[] = [
  T(1, [60, 12, 340, 24], ['THE MILL'], { size: 9, role: 'P' }), // running head in the top band
  T(2, [60, 70, 200, 94], ['Chapter One'], { size: 24, role: 'H1' }),
  T(3, [60, 120, 340, 160], ['Alpha the old road ran past', 'the mill and down to the river', 'where the carts waited.']),
  T(4, [60, 170, 340, 210], ['Bravo the men talked of weather', 'and prices and the long winter', 'ahead of them all.']),
  F(1, [60, 250, 180, 330], ['p3.i01']),
  F(2, [210, 250, 330, 330], ['p3.i02']),
  T(5, [60, 337, 250, 363], ['Figure 1. The mill and the weir.', 'Charlie the carts waited by the water.'], { italic: true }),
  T(6, [60, 400, 340, 440], ['Delta the tide came in and the', 'boats rose on the water', 'and the day was done.']),
  T(7, [60, 450, 300, 462], ['https://example.org/mill']),
  T(8, [60, 470, 340, 510], [LONG]),
  T(9, [60, 520, 300, 532], ['1. Source: the town museum.'], { role: 'Note' }),
  T(10, [190, 580, 210, 592], ['42'], { size: 9 }), // folio in the bottom band
  T(11, [90, 262, 120, 274], ['1850'], { size: 8 }), // a label inside the first figure
  T(12, [150, 380, 220, 392], ['* * *']), // an ornament
  T(13, [60, 540, 340, 552], ['A caption far from any picture']),
  T(14, [60, 560, 300, 572], ['Figura 7.2. Octavas en un piano']), // a figure label far from any picture
]
const ev: PageEvidence = {
  page: 3, printed: '3', w: 400, h: 600, columns: [[60, 340]], blocks,
  engineOrder: ['p3.b01', 'p3.b02', 'p3.b03', 'p3.b04', 'p3.f01', 'p3.f02', 'p3.b05', 'p3.b06', 'p3.b07', 'p3.b08', 'p3.b09', 'p3.b12', 'p3.b13', 'p3.b14', 'p3.b10', 'p3.b11'],
  engineConfidence: 0.9,
}
const ids = (kind: string) => blocks.filter((b) => b.kind === kind).map((b) => b.id)
const opts: ValidateOptions = { lineText, repeats: (t) => (t === 'THE MILL' || t === '42' ? 5 : 1), runningHeads: 'artifact' }
const ORDER = [...ev.engineOrder!]
const run = (op: Op | Op[], o: Partial<ValidateOptions> = {}, e: PageEvidence = ev) => validate(e, Array.isArray(op) ? op : [op], { ...opts, ...o })
const swapped = (a: string, b: string) => ORDER.map((x) => (x === a ? b : x === b ? a : x))
const why = (r: ReturnType<typeof validate>, re: RegExp) => assert.ok(r.rejected.some((x) => re.test(x.why)), `${re} in ${JSON.stringify(r.rejected)}`)


const ALL = ORDER
const flow = (...drop: string[]) => ALL.filter((x) => !drop.includes(x))

test('T13: a clean answer passes whole and nothing is listed as rejected', () => {
  const ops: Op[] = [
    { op: 'order', ids: flow('p3.b01').map((x) => (x === 'p3.b03' ? 'p3.b04' : x === 'p3.b04' ? 'p3.b03' : x)) },
    { op: 'role', id: 'p3.b02', role: 'H2' },
    { op: 'split', id: 'p3.b05', atLine: 'p3.l10', roles: ['Caption', 'P'] },
    { op: 'role', id: 'p3.b01', role: 'Artifact' },
    { op: 'none' },
  ]
  const r = run(ops)
  assert.deepEqual(r.rejected, [])
  assert.deepEqual(r.ops, ops)
  assert.equal(r.answerRejected, undefined)
})

// ---- b.5.1 reference checks -------------------------------------------------------------------------------------------------------------

test('T13 b.5.1: an op that names a block the page does not have is dropped alone, with the reason', () => {
  const good: Op = { op: 'role', id: 'p3.b02', role: 'H2' }
  const r = run([{ op: 'role', id: 'p3.b99', role: 'H2' }, good, { op: 'merge', ids: ['p3.b03', 'p3.b98'] }, { op: 'caption', figure: 'p3.f09', caption: 'p3.b05' }])
  assert.deepEqual(r.ops, [good])
  assert.deepEqual(r.rejected.map((x) => x.index), [0, 2, 3])
  why(r, /p3\.b99/)
  assert.ok(r.rejected.every((x) => x.stage === 'reference' && x.op))
})

test('T13 b.5.1: continues may come from the page before or the page, not from a further page', () => {
  assert.deepEqual(run({ op: 'continues', id: 'p3.b03', from: 'p2.b08' }).rejected, [])
  assert.deepEqual(run({ op: 'continues', id: 'p3.b03', from: 'p3.b01' }).rejected, [])
  why(run({ op: 'continues', id: 'p3.b03', from: 'p1.b08' }), /p1\.b08/)
})

test('T13 b.5.1: an order that misses a block or lists one twice is rejected, in plain words', () => {
  const r = run({ op: 'order', ids: ALL.filter((x) => x !== 'p3.b06').concat('p3.b02') })
  assert.deepEqual(r.ops, [])
  assert.equal(r.rejected[0].stage, 'reference')
  assert.match(r.rejected[0].why, /block p3\.b06 is missing from order; p3\.b02 appears twice/)
  why(run({ op: 'order', ids: [...ALL, 'p3.b77'] }), /p3\.b77/)
})

test('T13 b.5.1: the order is a permutation of the blocks after this answer’s merges and artifacts', () => {
  const merged = run([{ op: 'merge', ids: ['p3.b03', 'p3.b04'] }, { op: 'order', ids: flow('p3.b04') }])
  assert.deepEqual(merged.rejected, [])
  const listed = run([{ op: 'merge', ids: ['p3.b03', 'p3.b04'] }, { op: 'order', ids: ALL }])
  why(listed, /p3\.b04.*(merged|should not)/)
  const art = run([{ op: 'role', id: 'p3.b10', role: 'Artifact' }, { op: 'order', ids: ALL }])
  why(art, /p3\.b10.*(artifact|should not)/)
  assert.deepEqual(run([{ op: 'role', id: 'p3.b10', role: 'Artifact' }, { op: 'order', ids: flow('p3.b10') }]).rejected, [])
})

test('T13 b.5.1: one block cannot be merged twice or be the caption of two figures', () => {
  const r = run([{ op: 'merge', ids: ['p3.b03', 'p3.b04'] }, { op: 'merge', ids: ['p3.b04', 'p3.b06'] }])
  assert.deepEqual(r.rejected.map((x) => x.index), [1])
  const c = run([{ op: 'caption', figure: 'p3.f01', caption: 'p3.b05' }, { op: 'caption', figure: 'p3.f02', caption: 'p3.b05' }])
  assert.deepEqual(c.rejected.map((x) => x.index), [1])
})

test('T13 b.5.1: an op that carries anything beyond its own fields (new words) is rejected', () => {
  const r = run({ op: 'role', id: 'p3.b03', role: 'P', text: 'Another sentence.' } as unknown as Op)
  assert.deepEqual(r.ops, [])
  why(r, /text/)
  why(run({ op: 'frobnicate' } as unknown as Op), /frobnicate/)
  why(run({ op: 'role', id: 'p3.b03', role: 'H9' } as unknown as Op), /H9/)
})

// ---- b.5.2 conservation -----------------------------------------------------------------------------------------------------------------

test('T13 b.5.2: conserved() says what was lost, added or reworded', () => {
  assert.equal(conserved(['Alpha beta', 'gamma'], ['gamma', 'Alpha  beta ']), undefined)
  assert.match(conserved(['Alpha beta'], ['Alpha']) ?? '', /lost/)
  assert.match(conserved(['Alpha'], ['Alpha', 'Alpha']) ?? '', /added/)
  const swap = conserved(['The mill'], ['The mall']) ?? ''
  assert.match(swap, /lost “i”/)
  assert.match(swap, /added “a”/)
})

test('T13 b.5.2: the page with no ops, and every valid order, keeps every character', () => {
  const page = [...lineText.values()]
  assert.equal(conserved(page, applyOps(ev, lineText, [])), undefined)
  assert.equal(conserved(page, applyOps(ev, lineText, [{ op: 'order', ids: flow().reverse() }])), undefined)
  // a model order that drops a block, or lists one twice, does not keep the text
  assert.match(conserved(page, applyOps(ev, lineText, [{ op: 'order', ids: flow('p3.b06') }])) ?? '', /lost/)
  assert.match(conserved(page, applyOps(ev, lineText, [{ op: 'order', ids: [...ALL, 'p3.b06'] }])) ?? '', /added/)
})

test('T13 b.5.2: a page whose blocks do not add up to its text drops the whole answer and keeps the engine version', () => {
  // two blocks with one ID (a segmentation bug): the second one’s words cannot be placed
  const twin: PageEvidence = { ...ev, blocks: [...blocks, { ...blocks[2] }] }
  const r = run([{ op: 'role', id: 'p3.b02', role: 'H2' }, { op: 'none' }], {}, twin)
  assert.deepEqual(r.ops, [])
  assert.match(r.answerRejected ?? '', /lost/)
  assert.equal(r.rejected.length, 2)
  assert.ok(r.rejected.every((x) => x.stage === 'conservation'))
})

test('T13 b.5.2 fuzz: random op lists never pass unless the text multiset is equal', () => {
  let seed = 20260101
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)
  const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)]
  const textIds = ids('text')
  const pool = [...textIds, ...ids('figure'), 'p3.b99', 'p2.b08', 'p3.i01', 'p3.i02', 'p3.i09']
  const lines = ['p3.l03', 'p3.l04', 'p3.l06', 'p3.l09', 'p3.l10', 'p3.l99']
  const roles = ['P', 'H1', 'H2', 'H3', 'Caption', 'Note', 'Artifact', 'Aside', 'LI', 'TOCI', 'BlockQuote']
  const shuffle = <T,>(a: T[]) => a.map((x) => [rnd(), x] as const).sort((p, q) => p[0] - q[0]).map((p) => p[1])
  const op = (): Op => {
    switch (Math.floor(rnd() * 9)) {
      case 0: return { op: 'order', ids: shuffle(ALL).slice(0, ALL.length - (rnd() < 0.4 ? 1 : 0)).concat(rnd() < 0.3 ? [pick(pool)] : []) }
      case 1: return { op: 'order', ids: ALL.map((x, i, a) => (rnd() < 0.15 ? a[(i + 1) % a.length] : x)) }
      case 2: return { op: 'role', id: pick(pool), role: pick(roles) as 'P' }
      case 3: return { op: 'split', id: pick(textIds), atLine: pick(lines), roles: ['Caption', 'P'] }
      case 4: return { op: 'merge', ids: [pick(pool), pick(pool), ...(rnd() < 0.3 ? [pick(pool)] : [])] }
      case 5: return { op: 'continues', id: pick(pool), from: pick(pool) }
      case 6: return { op: 'figure', pieces: [pick(pool), pick(pool)], ...(rnd() < 0.5 ? { caption: pick(pool) } : {}) }
      case 7: return { op: 'caption', figure: pick(pool), caption: pick(pool) }
      default: return { op: 'none' }
    }
  }
  const page = [...lineText.values()]
  let unconserved = 0
  let accepted = 0
  for (let n = 0; n < 4000; n++) {
    const ops = Array.from({ length: 1 + Math.floor(rnd() * 3) }, op)
    const r = run(ops, { second: ALL })
    assert.equal(conserved(page, applyOps(ev, lineText, r.ops)), undefined, `what passed keeps the text: ${JSON.stringify(ops)}`)
    if (conserved(page, applyOps(ev, lineText, ops))) {
      unconserved++
      assert.ok(r.rejected.length > 0, `the model’s own list loses or adds text, so something is rejected: ${JSON.stringify(ops)}`)
    } else if (r.rejected.length === 0 && r.ops.some((o) => o.op !== 'none')) accepted++
  }
  assert.ok(unconserved > 100, `the fuzz reaches lists that do not conserve (${unconserved})`)
  assert.ok(accepted > 100, `and lists that do (${accepted})`)
})

// ---- b.5.3 rule guards ------------------------------------------------------------------------------------------------------------------

test('T13 b.5.3 Artifact: only the top or bottom band, repeated text or an ornament; any other is downgraded to a review item', () => {
  for (const id of ['p3.b01', 'p3.b10', 'p3.b12']) assert.deepEqual(run({ op: 'role', id, role: 'Artifact' }).rejected, [], id)
  const r = run({ op: 'role', id: 'p3.b03', role: 'Artifact' })
  assert.deepEqual(r.ops, [])
  assert.equal(r.rejected[0].stage, 'guard')
  assert.equal(r.rejected[0].review, true)
  why(r, /review/)
  assert.equal(run({ op: 'role', id: 'p3.b06', role: 'Artifact' }, { repeats: () => 3 }).rejected.length, 0, 'text repeated on 3 pages')
  const s = run({ op: 'split', id: 'p3.b05', atLine: 'p3.l10', roles: ['P', 'Artifact'] })
  assert.equal(s.rejected[0]?.review, true, 'a part of a split too')
})

test('T13 b.5.3 Artifact: a running head is locked as an artifact when uaRunningHeads = artifact', () => {
  const r = run({ op: 'role', id: 'p3.b01', role: 'P' })
  assert.deepEqual(r.ops, [])
  why(r, /running head/)
  assert.deepEqual(run({ op: 'role', id: 'p3.b01', role: 'P' }, { runningHeads: 'keep' }).rejected, [])
})

test('T13 b.5.3 H*: refused for blocks over 25 words, URL lines and lines inside a figure', () => {
  assert.deepEqual(run({ op: 'role', id: 'p3.b02', role: 'H2' }).rejected, [])
  for (const [id, re] of [['p3.b08', /25 words/], ['p3.b07', /URL/], ['p3.b11', /figure/]] as const) {
    const r = run({ op: 'role', id, role: 'H3' })
    assert.deepEqual(r.ops, [], id)
    assert.equal(r.rejected[0].stage, 'guard')
    why(r, re)
  }
  why(run({ op: 'split', id: 'p3.b03', atLine: 'p3.l04', roles: ['Caption', 'P'] }), /3 em/) // the guards judge each part of a split
})

test('T13 b.5.3 Caption: only within 3 em of a figure, or with a figure label', () => {
  assert.deepEqual(run({ op: 'role', id: 'p3.b05', role: 'Caption' }).rejected, [])
  assert.deepEqual(run({ op: 'role', id: 'p3.b14', role: 'Caption' }).rejected, [], 'a label, far away')
  const far = run({ op: 'role', id: 'p3.b13', role: 'Caption' })
  assert.deepEqual(far.ops, [])
  why(far, /3 em/)
  why(run({ op: 'caption', figure: 'p3.f01', caption: 'p3.b13' }), /3 em/)
  why(run({ op: 'figure', pieces: ['p3.i01'], caption: 'p3.b13' }), /3 em/)
  assert.deepEqual(run({ op: 'caption', figure: 'p3.f01', caption: 'p3.b05' }).rejected, [])
})

test('T13 b.5.3 split and merge: a split is at a line boundary of the block; a merge joins blocks that are neighbours in the order', () => {
  why(run({ op: 'split', id: 'p3.b05', atLine: 'p3.l09', roles: ['Caption', 'P'] }), /line boundary/)
  why(run({ op: 'split', id: 'p3.b05', atLine: 'p3.l03', roles: ['Caption', 'P'] }), /p3\.l03/)
  assert.deepEqual(run({ op: 'merge', ids: ['p3.b03', 'p3.b04'] }).rejected, [])
  const far = run({ op: 'merge', ids: ['p3.b03', 'p3.b06'] })
  assert.deepEqual(far.ops, [])
  why(far, /adjacent/)
  // adjacent in the order the answer proposes, too
  why(run([{ op: 'order', ids: swapped('p3.b04', 'p3.b06') }, { op: 'merge', ids: ['p3.b03', 'p3.b04'] }]), /adjacent/)
})

test('T13 b.5.3 figure: pieces are not grouped across body-size prose', () => {
  assert.deepEqual(run({ op: 'figure', pieces: ['p3.i01', 'p3.i02'] }).rejected, [])
  const prose = T(15, [185, 270, 205, 300], ['Some body prose in between them all'])
  const e: PageEvidence = { ...ev, blocks: [...blocks, prose], engineOrder: [...ALL, prose.id] }
  const r = run({ op: 'figure', pieces: ['p3.i01', 'p3.i02'] }, {}, e)
  assert.deepEqual(r.ops, [])
  why(r, /prose/)
  why(run({ op: 'figure', pieces: ['p3.i01', 'p3.b03'] }), /p3\.b03/)
})

test('T13 b.5.3 order: a caption comes after its figure (captionIn), and a note after the paragraph it belongs to', () => {
  const link: Op = { op: 'caption', figure: 'p3.f02', caption: 'p3.b05' }
  const before = ALL.filter((x) => x !== 'p3.b05')
  before.splice(before.indexOf('p3.f01'), 0, 'p3.b05')
  const bad = run([link, { op: 'order', ids: before }])
  assert.deepEqual(bad.ops, [link])
  why(bad, /after its figure/)
  assert.deepEqual(run([link, { op: 'order', ids: before }], { captionIn: 'inside' }).rejected, [])
  assert.deepEqual(run([link, { op: 'order', ids: ALL }]).rejected, [])
  const note = run({ op: 'order', ids: swapped('p3.b08', 'p3.b09') })
  assert.deepEqual(note.ops, [])
  why(note, /note p3\.b09.*p3\.b08/)
})

// ---- b.5.4 geometry sanity --------------------------------------------------------------------------------------------------------------

test('T13 b.5.4: kendallTau is 1 for the same order and -1 for the reverse', () => {
  assert.equal(kendallTau(['a', 'b', 'c'], ['a', 'b', 'c']), 1)
  assert.equal(kendallTau(['a', 'b', 'c'], ['c', 'b', 'a']), -1)
  assert.equal(kendallTau(['a', 'b', 'c'], ['a', 'x']), 1, 'ids they do not share are left out; fewer than two in common is no disagreement')
})

test('T13 b.5.4: a big change to an order the engine was sure of needs a second opinion that agrees', () => {
  const rev = [...ALL].reverse().map((x) => (x === 'p3.b08' ? 'p3.b09' : x === 'p3.b09' ? 'p3.b08' : x)) // the note stays after its paragraph
  const big: Op = { op: 'order', ids: rev }
  const none = run(big)
  assert.deepEqual(none.ops, [])
  assert.equal(none.needsSecond, true)
  why(none, /second opinion/)
  assert.deepEqual(run(big, { second: rev }).rejected, [], 'agrees')
  const no = run(big, { second: ALL })
  assert.deepEqual(no.ops, [])
  assert.equal(no.needsSecond, undefined)
  why(no, /keep the engine order/)
  // the engine was unsure: no second opinion needed; a small change: none needed
  assert.deepEqual(run(big, {}, { ...ev, engineConfidence: 0.6 }).rejected, [])
  assert.deepEqual(run({ op: 'order', ids: swapped('p3.b03', 'p3.b04') }).rejected, [])
})
