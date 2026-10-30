// T26 (OPUS_DESIGN2 §c.2 (2)): the staff-fix miner. The tool's tag tree against a tag tree finished by hand, every difference an op (§b.5)
// or a listed reference disagreement. One synthetic book (the one T12 uses): the "staff file" is the tool's own output built with a
// person's decisions laid on, so the ops the miner finds must be the ones that were laid on, and laid back on the tool's output through
// T12 they must give the staff file's tag tree. A second part runs on Gladiators (the tool's output against the client's hand-tagged
// file) when the client's files are there.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PDFDocument, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { analyzeUa, buildUa } from '../src/engine/pdfua/index.ts'
import { checkUa } from '../src/engine/pdfua/check.ts'
import { collectPdfGate } from '../src/engine/check/exportgate.ts'
import { readingDims } from '../src/engine/check/refscore-pdf.ts'
import { pdfStats, type PdfStats } from '../src/engine/check/pdfstats.ts'
import { lineTexts, type EvidencePage } from '../src/engine/pdf/evidence.ts'
import { mineStaffFixes, type MineInput } from '../src/engine/pdf/staff-fix.ts'
import type { PageDecision } from '../src/engine/pdf/decision.ts'
import { nodeRaster } from './raster-node.ts'
import { haveGladiators, mineGladiators } from './staff-fix-gladiators.ts'

const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))
const W = 400
const H = 600
const WORDS = 'the old road ran past the mill and down to the river where the carts waited for the tide and the men talked of weather and prices and the long winter ahead'.split(' ')
const words = (n: number, seed: number) => Array.from({ length: n }, (_, i) => WORDS[(seed + i) % WORDS.length]).join(' ')

// the T12 book: a title page; a chapter page (p2) with a heading, paragraphs Alpha and Bravo, a one-line "The Weir", a picture in two
// pieces, an italic caption clumped with the line under it, Delta, a source line, Echo; p3 goes on with Foxtrot.
async function book(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const serif = await doc.embedFont(StandardFonts.TimesRoman)
  const it = await doc.embedFont(StandardFonts.TimesRomanItalic)
  const img = await doc.embedPng(PNG)
  const put = (p: PDFPage, t: string, x: number, top: number, size = 11, font: PDFFont = serif) => p.drawText(t, { x, y: H - top, size, font })
  const para = (p: PDFPage, first: string, top: number, seed: number) => (put(p, `${first} ${words(9, seed)}`, 72, top), put(p, words(10, seed + 9), 60, top + 13), put(p, `${words(6, seed + 19)}.`, 60, top + 26))
  const t = doc.addPage([W, H])
  put(t, 'THE MILL', 110, 200, 40)
  put(t, 'Ada Lovelace-Stone', 140, 300, 16)
  const c = doc.addPage([W, H])
  put(c, 'Chapter One', 60, 70, 24)
  para(c, 'Alpha', 120, 0)
  para(c, 'Bravo', 159, 3)
  put(c, 'The Weir', 60, 211)
  c.drawImage(img, { x: 60, y: H - 330, width: 120, height: 90 })
  c.drawImage(img, { x: 210, y: H - 330, width: 120, height: 90 })
  put(c, 'Figure 1. The mill and the weir.', 60, 346, 11, it)
  put(c, 'Charlie the carts waited by the water.', 60, 359, 11, it)
  para(c, 'Delta', 400, 5)
  put(c, 'Source: the town museum.', 60, 452)
  put(c, `Echo ${words(9, 7)}`, 72, 490)
  put(c, words(10, 16), 60, 503)
  put(c, words(10, 26), 60, 516)
  const n = doc.addPage([W, H])
  para(n, 'Foxtrot', 70, 2)
  para(n, 'Golf', 122, 4)
  return new Uint8Array(await doc.save())
}
const data = await book()

const a = await analyzeUa(pdfjs, nodeRaster, { main: data, extras: [] })
const make = async (decisions?: PageDecision[]) => {
  const alt = Object.fromEntries(a.figures.map((f) => [f.key, 'The mill and the weir.']))
  return (await buildUa(a, { styles: a.styles, meta: { ...a.meta, isbn: '' }, alt, cropToTrim: false, sourceName: 'mill.pdf', options: { decisions } })).pdf
}
const tool = await make()
const mineStats = await pdfStats(tool, pdfjs)
const input = (ref: PdfStats, mine = mineStats): MineInput => ({
  evidence: a.book.evidence!,
  lineText: (p) => lineTexts(a.book.pages[p - 1] as unknown as EvidencePage, p),
  mine,
  ref,
})
/** the staff's file: the tool's output with a person's decisions laid on */
const staff = async (ops: PageDecision['ops']) => {
  const pdf = await make([{ page: 2, ops, by: 'person' }])
  return { pdf, stats: await pdfStats(pdf, pdfjs) }
}
/** the file's tag tree as role and words, element by element (readTags runs the words of neighbouring elements together) */
const shape = async (pdf: Uint8Array) => (await pdfStats(pdf, pdfjs)).order!.elements.map((e) => `${e.page} ${e.role}: ${e.words.join(' ')}`)

test('T26: the tool against itself gives no ops and no disagreements', () => {
  const m = mineStaffFixes(input(mineStats))
  assert.deepEqual(m.decisions, [])
  assert.deepEqual(m.disagreements, [])
  assert.equal(m.counts.differences, 0)
})

for (const [name, op] of [
  ['role', { op: 'role', id: 'p2.b07', role: 'Note' }],
  ['merge', { op: 'merge', ids: ['p2.b06', 'p2.b07'] }],
  ['order', { op: 'order', ids: ['p2.b01', 'p2.b03', 'p2.b02', 'p2.b04', 'p2.b06', 'p2.f01', 'p2.f02', 'p2.b05', 'p2.b07', 'p2.b08'] }],
] as [string, PageDecision['ops'][number]][]) {
  test(`T26 ${name}: the staff's fix is found as the op, and laid back on the tool's output it gives the staff's tags`, async () => {
    const s = await staff([op])
    const m = mineStaffFixes(input(s.stats))
    assert.deepEqual(m.disagreements, [])
    // the tool glues a short heading to the block after it and ties a caption to its picture, so the staff's order is found by its tags, not by its list
    if (op.op === 'order') assert.deepEqual(m.decisions.map((d) => d.ops.map((o) => o.op)), [['order']])
    else assert.deepEqual(m.decisions, [{ page: 2, ops: [op], by: 'person' }])
    assert.equal(m.counts.differences, 1)
    assert.notDeepEqual(await shape(s.pdf), await shape(tool), 'the fix changes the tags')
    assert.deepEqual(await shape(await make(m.decisions)), await shape(s.pdf))
  })
}

test('T26 split: a caption the staff cut from the line under it is a split at that line', async () => {
  const cap = a.book.evidence![1].blocks.find((b) => b.id === 'p2.b05')!
  const s = await staff([{ op: 'split', id: 'p2.b05', atLine: cap.lineIds![1], roles: ['Caption', 'P'] }])
  const m = mineStaffFixes(input(s.stats))
  assert.deepEqual(m.decisions, [{ page: 2, ops: [{ op: 'split', id: 'p2.b05', atLine: cap.lineIds![1], roles: ['Caption', 'P'] }], by: 'person' }])
  assert.deepEqual(m.disagreements, [])
  assert.deepEqual(await shape(await make(m.decisions)), await shape(s.pdf))
})

test('T26 continues: a paragraph the staff joined across the page break', async () => {
  const pdf = await make([{ page: 3, ops: [{ op: 'continues', id: 'p3.b01', from: 'p2.b08' }], by: 'person' }])
  const m = mineStaffFixes(input(await pdfStats(pdf, pdfjs)))
  assert.deepEqual(m.decisions, [{ page: 3, ops: [{ op: 'continues', id: 'p3.b01', from: 'p2.b08' }], by: 'person' }])
})

/** the staff's stats with one element of the page changed: what a hand-tagged file can say that the ops cannot, or that the rules refuse */
const edited = async (text: string, role: string) => {
  const s = structuredClone(await pdfStats(tool, pdfjs))
  const el = s.order!.elements.find((e) => e.page === 2 && e.words.join(' ').startsWith(text))!
  el.role = role
  return s
}

test('T26: a drop cap the staff tagged as Figure is a reference disagreement, not an op', async () => {
  const m = mineStaffFixes(input(await edited('the weir', 'Figure')))
  assert.deepEqual(m.decisions, [])
  assert.match(m.disagreements[0].msg, /tags “the weir” as Figure/)
  assert.equal(m.counts.differences, 1)
})

test('T26: a fix the rulebook refuses (a heading of more than 25 words) is listed with the reason, not applied', async () => {
  const m = mineStaffFixes(input(await edited('bravo', 'H1')))
  assert.deepEqual(m.decisions, [])
  assert.match(m.disagreements[0].msg, /refused.*25 words/)
  assert.equal(m.counts.differences, 1)
  assert.equal(m.counts.ops, 0)
})

test('T26: a page the staff file does not tag is not judged, and said', () => {
  const ref = structuredClone(mineStats)
  ref.order!.elements = ref.order!.elements.filter((e) => e.page !== 3)
  const m = mineStaffFixes(input(ref))
  assert.deepEqual(m.counts.skipped, [3])
})

test('T26: the mined ops keep every word and the file still passes the built-in PDF/UA checks', async () => {
  const s = await staff([{ op: 'role', id: 'p2.b04', role: 'Note' }, { op: 'merge', ids: ['p2.b06', 'p2.b07'] }])
  const m = mineStaffFixes(input(s.stats))
  const out = await make(m.decisions)
  const words = async (p: Uint8Array) => (await pdfStats(p, pdfjs)).order!.pages[2].join(' ')
  assert.equal(await words(out), await words(tool))
  const errors = async (p: Uint8Array) => (await checkUa(p)).filter((r) => r.level === 'error').length
  assert.ok((await errors(out)) <= (await errors(tool)))
})

// ---- Gladiators: the tool's output against the client's hand-tagged file ----------------------------------------------------------
test('T26 Gladiators: every difference is an op or a listed disagreement, and the ops laid on the build keep it passing', { skip: !haveGladiators() && 'the client’s Gladiators files are not here' }, async () => {
  const r = await mineGladiators()
  const m = r.mined
  assert.ok(m.counts.ops > 0 && m.counts.disagreements > 0)
  assert.equal(m.counts.differences, m.counts.ops + m.counts.disagreements)
  assert.equal(m.decisions.reduce((n, d) => n + d.ops.length, 0), m.counts.ops)
  for (const kind of ['merge', 'split', 'role', 'order']) assert.ok(m.counts.byOp[kind] > 0, `${kind} ops found`)
  // the reference's drop caps tagged as Figure (reference-score: pages 49, 65, 138) are disagreements, not ops
  assert.deepEqual(m.disagreements.filter((d) => /drop cap/.test(d.msg)).map((d) => d.page), [49, 65, 138])
  assert.ok(m.decisions.every((d) => d.by === 'person' && d.ops.every((o) => o.op !== 'none')))
  // laid on the build through T12: every op resolves, the built-in PDF/UA checks and the export gate find no more than before,
  // and against the staff file the reading order and the role F1 are no worse
  const after = await r.build(m.decisions)
  assert.deepEqual(after.review.filter((x) => /left out/.test(x.msg)), [])
  const found = async (b: typeof after) => {
    const gate = collectPdfGate(await checkUa(b.pdf), b.review)
    return { fixes: gate.fixes.length, checks: gate.checks.length, errors: b.review.filter((x) => x.level === 'error').length }
  }
  const was = await found(r.built)
  const now = await found(after)
  assert.ok(now.fixes <= was.fixes && now.checks <= was.checks && now.errors <= was.errors, JSON.stringify({ was, now }))
  const ref = await pdfStats(r.ref, pdfjs)
  const score = async (b: typeof after) => Object.fromEntries(readingDims(await pdfStats(b.pdf, pdfjs), ref).map((d) => [d.id, d.score ?? 0]))
  const [s0, s1] = [await score(r.built), await score(after)]
  assert.ok(s1.order >= s0.order && s1.roles >= s0.roles, JSON.stringify({ s0, s1 }))
})
