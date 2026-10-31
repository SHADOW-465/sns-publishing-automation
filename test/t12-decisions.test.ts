// T12 (OPUS_DESIGN2 §b.5, §b.10 item 4): the PageDecision override layer. A page's typed ops (order, role, split, merge, continues,
// figure, caption), by the model or a person, laid on the engine's reading through the stable IDs of the page evidence (T9), in
// both pipelines: buildStructure (PDF/UA) and buildPdfEpub (PDF→EPUB). An empty decision changes nothing. One synthetic book.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PDFDocument, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { analyzePdf } from '../src/engine/pdfepub/analyze.ts'
import { buildPdfEpub } from '../src/engine/pdfepub/build.ts'
import { analyzeUa, buildUa } from '../src/engine/pdfua/index.ts'
import { buildStructure, type SNode } from '../src/engine/pdfua/structure.ts'
import { auditPictures } from '../src/engine/pdfua/audit.ts'
import { decisionsByPage, type PageDecision } from '../src/engine/pdf/decision.ts'
import { rulesFor } from '../src/engine/epub/imprint.ts'
import { text } from '../src/engine/zip.ts'
import { nodeRaster } from './raster-node.ts'
import { readTags } from './read-tags.ts'

const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))
const W = 400
const H = 600
const WORDS = 'the old road ran past the mill and down to the river where the carts waited for the tide and the men talked of weather and prices and the long winter ahead'.split(' ')
const words = (n: number, seed: number) => Array.from({ length: n }, (_, i) => WORDS[(seed + i) % WORDS.length]).join(' ')

/** A title page; a chapter page (p2): a heading, paragraphs Alpha and Bravo, a one-line paragraph "The Weir", a picture cut in two
 *  pieces with a gap (p2.i01, p2.i02), an italic caption with a line of text under it in the same face (one block, p2.b05), Delta,
 *  a source line, Echo running to the foot of the page; and p3, which goes on with Foxtrot (a new indented paragraph in print). */
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
  put(c, words(10, 26), 60, 516) // mid-sentence at the foot of the page
  const n = doc.addPage([W, H])
  para(n, 'Foxtrot', 70, 2)
  para(n, 'Golf', 122, 4)
  return new Uint8Array(await doc.save())
}
const data = await book()

// ---- PDF→EPUB ----------------------------------------------------------------------------------------------------------------------
const epub = async (decisions?: PageDecision[]) => {
  const b = await analyzePdf(pdfjs, data, nodeRaster)
  const r = await buildPdfEpub(b, { styles: b.styles, meta: { ...b.meta, eisbn: '9780306406157' }, rules: rulesFor('en'), cover: { name: 'cover.png', data: PNG }, decisions }, nodeRaster)
  const html = text(r.files.get('OEBPS/chapter01.xhtml')!).replace(/^[\s\S]*<body[^>]*>/, '').replace(/<\/body>[\s\S]*$/, '')
  return { r, html, ev: b.evidence! }
}
/** the HTML element (a <p>, <hN> or <figure>) the words are in */
const elementOf = (html: string, s: string) => html.match(/<figure[\s\S]*?<\/figure>|<(p|h\d)\b[\s\S]*?<\/\1>/g)?.find((e) => e.includes(s))

// ---- PDF/UA ----------------------------------------------------------------------------------------------------------------------
const ua = async (decisions?: PageDecision[]) => {
  const a = await analyzeUa(pdfjs, nodeRaster, { main: data, extras: [], options: { decisions } })
  const figs = new Map([...a.detected].map(([k, fs]) => [k, fs.map((f) => ({ ...f, lines: [], caption: '', node: undefined }))]))
  const st = buildStructure(a.book, new Map(a.styles.map((s) => [s.key, s.role])), figs, { decisions })
  // the elements in reading order with their text: [tag, text]
  const flat: [string, string][] = []
  const walk = (n: SNode) => {
    if (!/^(Document|Sect|L|LI|TOC)$/.test(n.tag)) flat.push([n.tag, n.lines.map((l) => l.text.trim()).join(' ')])
    n.kids.forEach(walk)
  }
  walk(st.root)
  return { a, st, flat, tagOf: (s: string) => flat.find(([, t]) => t.includes(s))?.[0], at: (s: string) => flat.findIndex(([, t]) => t.includes(s)) }
}

const D = (ops: PageDecision['ops'], page = 2): PageDecision[] => [{ page, ops }]

test('T12: an empty decision, or one that says none, gives the same output as no decision, in both pipelines', async () => {
  const base = await epub()
  for (const d of [[], D([{ op: 'none' }])]) {
    const r = (await epub(d)).r
    assert.deepEqual([...r.files.keys()], [...base.r.files.keys()])
    for (const [p, bytes] of base.r.files) if (!p.endsWith('.opf')) assert.deepEqual(r.files.get(p), bytes, p) // the opf carries the build time
  }
  const u = await ua()
  for (const d of [[], D([{ op: 'none' }])]) assert.deepEqual((await ua(d)).flat, u.flat)
})

test('T12 order: the page is read in the order the decision gives, pictures where it puts them', async () => {
  const order = D([{ op: 'order', ids: ['p2.b01', 'p2.b03', 'p2.b02', 'p2.b04', 'p2.b06', 'p2.f01', 'p2.f02', 'p2.b05', 'p2.b07', 'p2.b08'] }])
  const e = await epub(order)
  assert.ok(e.html.indexOf('Bravo') < e.html.indexOf('Alpha'), 'EPUB: Bravo before Alpha')
  assert.ok(e.html.indexOf('Delta') < e.html.indexOf('<figure'), 'EPUB: the pictures after Delta')
  const before = await epub()
  assert.ok(before.html.indexOf('Alpha') < before.html.indexOf('Bravo') && before.html.indexOf('<figure') < before.html.indexOf('Delta'), 'the engine alone reads the page top down')
  const u = await ua(order)
  assert.ok(u.at('Bravo') < u.at('Alpha'), 'PDF/UA: Bravo before Alpha')
  assert.ok(u.at('Delta') < u.flat.findIndex(([t]) => t === 'Figure'), 'PDF/UA: the figures after Delta')
})

test('T12 role: a block takes the role the decision gives it', async () => {
  const d = D([{ op: 'role', id: 'p2.b04', role: 'H2' }])
  assert.equal((await ua()).tagOf('The Weir'), 'P')
  assert.match((await ua(d)).tagOf('The Weir') ?? '', /^H[2-6]$/)
  assert.match(elementOf((await epub()).html, 'The Weir')!, /^<p/)
  assert.match(elementOf((await epub(d)).html, 'The Weir')!, /^<h[2-6] class="subhead/)
})

test('T12 split: a caption clumped with the line under it becomes a Caption and a P', async () => {
  const { ev } = await epub()
  const cap = ev[1].blocks.find((b) => b.id === 'p2.b05')!
  const d = D([{ op: 'split', id: 'p2.b05', atLine: cap.lineIds![1], roles: ['Caption', 'P'] }])
  const u = await ua(d)
  assert.ok(u.flat.some(([t, s]) => t === 'Caption' && s === 'Figure 1. The mill and the weir.'), 'PDF/UA: the caption alone')
  assert.equal(u.tagOf('Charlie the carts'), 'P')
  assert.ok((await ua()).flat.some(([t, s]) => t === 'Caption' && s.includes('Charlie')), 'the engine alone keeps them together')
  const e = await epub(d)
  const fig = elementOf(e.html, 'Figure 1. The mill')!
  // the caption is set in Times-Italic: REGR-3 reads that face (capital I) as italic, so the caption text is in <em>
  assert.match(fig, /^<figure[\s\S]*<figcaption[^>]*>(?:<em>)?Figure 1\. The mill and the weir\.(?:<\/em>)?<\/figcaption>/)
  assert.doesNotMatch(fig, /Charlie/)
  assert.match(elementOf(e.html, 'Charlie the carts')!, /^<p/)
})

test('T12 merge: two blocks become one paragraph', async () => {
  const d = D([{ op: 'merge', ids: ['p2.b02', 'p2.b03'] }])
  assert.notEqual((await ua()).at('Alpha'), (await ua()).at('Bravo'))
  const u = await ua(d)
  assert.equal(u.at('Alpha'), u.at('Bravo'), 'PDF/UA: one element')
  assert.equal(u.tagOf('Bravo'), 'P')
  assert.notEqual(elementOf((await epub()).html, 'Alpha'), elementOf((await epub()).html, 'Bravo'))
  const e = await epub(d)
  assert.equal(elementOf(e.html, 'Alpha'), elementOf(e.html, 'Bravo'), 'EPUB: one paragraph')
})

test('T12 continues: a block goes on with a block of the page before', async () => {
  const d = D([{ op: 'continues', id: 'p3.b01', from: 'p2.b08' }], 3)
  assert.notEqual((await ua()).at('Echo'), (await ua()).at('Foxtrot'))
  const u = await ua(d)
  assert.equal(u.at('Echo'), u.at('Foxtrot'), 'PDF/UA: one paragraph across the page break')
  assert.equal(u.at('Golf'), u.at('Foxtrot') + 1, 'the next paragraph still starts its own')
  const e = await epub(d)
  assert.equal(elementOf(e.html, 'Echo'), elementOf(e.html, 'Foxtrot'), 'EPUB: one paragraph')
  assert.match(elementOf(e.html, 'Foxtrot')!, /id="page-3"[^>]*\/>Foxtrot/, 'the page marker stays where the page starts')
  assert.notEqual(elementOf(e.html, 'Golf'), elementOf(e.html, 'Foxtrot'))
})

test('T12 figure: a picture cut in two, grouped by a decision, is one Figure with one alt in both pipelines', async () => {
  const d = D([{ op: 'figure', pieces: ['p2.i01', 'p2.i02'] }])
  // PDF→EPUB: one picture on the page, one <img>, one alt to write
  const before = await epub()
  assert.equal(before.r.pictures.filter((p) => p.path.startsWith('images/pg-2')).length, 2)
  const e = await epub(d)
  const pics = e.r.pictures.filter((p) => p.path.startsWith('images/pg-2'))
  assert.equal(pics.length, 1)
  assert.equal((e.html.match(/<img /g) ?? []).length, 1)
  assert.equal((e.html.match(/<figure/g) ?? []).length, 1)
  // PDF/UA: one Figure over both pieces, which takes one alt
  const u = await ua(d)
  const figs = u.st.figures.filter((f) => f.page === 1)
  assert.equal(figs.length, 1)
  assert.deepEqual([figs[0].box.x0, figs[0].box.x1], [60, 330])
  const a = u.a
  assert.equal(a.figures.filter((f) => f.page === 1).length, 1)
  const out = await buildUa(a, { styles: a.styles, meta: { ...a.meta, isbn: '' }, alt: Object.fromEntries(a.figures.map((f) => [f.key, 'The mill and the weir, in two photographs.'])), cropToTrim: false, sourceName: 'mill.pdf', options: { decisions: d } })
  const audit = auditPictures(await PDFDocument.load(out.pdf, { updateMetadata: false }))
  assert.equal(audit.figureElements, 1)
  assert.equal(audit.picturesInTree, 2, 'both pieces are inside the one Figure')
  assert.deepEqual((await readTags(out.pdf.slice(), 2, 2)).filter((t) => /^p2 +Figure /.test(t)), ['p2   Figure [alt: The mill and the weir, in two photographs.]: '])
})

test('T12 caption: a block linked to a figure is its caption', async () => {
  const d = D([{ op: 'caption', figure: 'p2.f02', caption: 'p2.b07' }])
  const u = await ua(d)
  const second = u.flat.map(([t]) => t).lastIndexOf('Figure')
  assert.deepEqual(u.flat[second + 1], ['Caption', 'Source: the town museum.'])
  assert.equal(u.st.figures.find((f) => f.page === 1 && f.box.x0 === 210)?.caption, 'Source: the town museum.')
  const e = await epub(d)
  assert.match(elementOf(e.html, 'pg-2-2.jpg')!, /<figcaption[^>]*>Source: the town museum\.<\/figcaption>/)
  assert.equal(e.r.pictures.find((p) => p.path === 'images/pg-2-2.jpg')?.caption, 'Source: the town museum.')
})

test('T12: a person’s decision for a page wins over the model’s, through the same path', async () => {
  const model: PageDecision = { page: 2, by: 'ai', ops: [{ op: 'role', id: 'p2.b04', role: 'H2' }] }
  const person: PageDecision = { page: 2, by: 'person', ops: [{ op: 'role', id: 'p2.b04', role: 'Caption' }, { op: 'caption', figure: 'p2.f01', caption: 'p2.b04' }] }
  assert.deepEqual(decisionsByPage([person, model]).get(2), person)
  assert.deepEqual(decisionsByPage([model, person]).get(2), person)
  const u = await ua([model, person])
  assert.deepEqual(u.flat[u.flat.findIndex(([t]) => t === 'Figure') + 1], ['Caption', 'The Weir'])
  assert.match(elementOf((await epub([model, person])).html, 'The Weir')!, /^<figure[\s\S]*<figcaption[^>]*>The Weir<\/figcaption>/)
})

test('T12: an op that names a block the page does not have is left out and listed, in both pipelines; the rest is unchanged', async () => {
  const d = D([{ op: 'role', id: 'p2.b99', role: 'H2' }])
  const base = await epub()
  const e = await epub(d)
  assert.equal(e.html, base.html)
  assert.ok(e.r.review.some((r) => /left out.*p2\.b99/.test(r.msg)), 'EPUB review says so')
  assert.ok((await ua(d)).a.review.some((r) => /left out.*p2\.b99/.test(r.msg)), 'PDF/UA review says so')
})
