// T9: stable blocks and the layout JSON (OPUS_DESIGN2 §b.4). pageEvidence() groups a page's lines into blocks with IDs
// p<n>.<kind><i>, numbered top then left before any reordering. analyzePdf keeps one packet per PDF page for both pipelines.
// The snapshot of 5 eval pages holds IDs, kinds, boxes and a hash of the text, never the client's words.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { analyzePdf } from '../src/engine/pdfepub/analyze.ts'
import { pageEvidence, type PageEvidence } from '../src/engine/pdf/evidence.ts'
import type { Line } from '../src/engine/pdf/layout.ts'
import type { Raster } from '../src/engine/pdf/raster.ts'
import { nodeRaster } from './raster-node.ts'
import { AUTOMATION, has, read } from './samples.ts'

const L = (text: string, x0: number, y: number, size = 10, font = 'Serif'): Line => ({
  runs: [{ text, x0, x1: x0 + text.length * size * 0.45, font, size, bold: /Bold/.test(font), italic: /It$/.test(font) }],
  x0, x1: x0 + text.length * size * 0.45, y, base: y + size, size, font, text, marker: false,
})
// a heading across the page, two columns, a picture cut in two pieces with an italic caption under it, a folio
const lines = () => [
  L('Chapter Seven', 36, 40, 18, 'Sans-Bold'),
  L('The left column opens with a paragraph', 36, 80), L('that runs over three lines of the', 36, 92), L('column before it ends here.', 36, 104),
  L('A second paragraph is indented and', 46, 116), L('goes on below it.', 36, 128),
  L('The right column has two lines of', 228, 80), L('text above the picture.', 228, 92),
  L('Figura 7.2. Octavas en un piano', 228, 176, 9, 'Serif-It'),
  L('Body text again under the caption', 228, 200), L('in the right column.', 228, 212),
  L('131', 210, 620),
]
const page = (ls = lines(), images = [{ x0: 300, y0: 110, x1: 396, y1: 170 }, { x0: 228, y0: 110, x1: 300, y1: 170 }]) =>
  ({ width: 432, height: 648, lines: ls, images: images.map((b, i) => ({ ...b, id: `im${i}`, crop: { l: 0, t: 0, r: 1, b: 1 } })), fills: [] })
const shuffle = <T>(xs: T[], seed: number): T[] => {
  const a = [...xs]
  let s = seed
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648
    const j = s % (i + 1)
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

test('T9: lines are grouped into blocks numbered top, then left; a picture in two touching pieces is one figure', () => {
  const ev = pageEvidence(page(), { page: 147, printed: '131' })
  assert.equal(ev.page, 147)
  assert.equal(ev.printed, '131')
  assert.deepEqual([ev.w, ev.h], [432, 648])
  assert.deepEqual(ev.blocks.filter((b) => b.kind === 'text').map((b) => `${b.id} ${b.text}`), [
    'p147.b01 Chapter Seven',
    'p147.b02 The left column opens with a paragraph that runs over three lines of the column before it ends here.',
    'p147.b03 The right column has two lines of text above the picture.',
    'p147.b04 A second paragraph is indented and goes on below it.',
    'p147.b05 Figura 7.2. Octavas en un piano',
    'p147.b06 Body text again under the caption in the right column.',
    'p147.b07 131',
  ])
  const cap = ev.blocks.find((b) => b.id === 'p147.b05')!
  assert.deepEqual([cap.style, cap.italic, cap.bold, cap.size, cap.lines], ['Serif-It 9', true, false, 9, 1])
  assert.equal(cap.bodySize, 10)
  assert.deepEqual(ev.blocks.find((b) => b.id === 'p147.b02')!.lineIds, ['p147.l02', 'p147.l04', 'p147.l06'])
  const figs = ev.blocks.filter((b) => b.kind === 'figure')
  assert.deepEqual(figs.map((f) => [f.id, f.bbox, f.pieces, f.caption]), [['p147.f01', [228, 110, 396, 170], ['p147.i01', 'p147.i02'], null]])
  assert.equal(ev.columns.length, 2)
})

test('T9: the same page in 20 input orders gives the same JSON', () => {
  const want = JSON.stringify(pageEvidence(page(), { page: 3 }))
  for (let seed = 1; seed <= 20; seed++) {
    const p = page(shuffle(lines(), seed), shuffle([{ x0: 300, y0: 110, x1: 396, y1: 170 }, { x0: 228, y0: 110, x1: 300, y1: 170 }], seed))
    assert.equal(JSON.stringify(pageEvidence(p, { page: 3 })), want, `seed ${seed}`)
  }
})

test('T9: the IDs do not change when the engine reads the page in another order; engineOrder follows the engine', () => {
  const ls = lines()
  const pic = { x0: 228, y0: 110, x1: 396, y1: 170 }
  const columnsFirst = [ls[0], ls[1], ls[2], ls[3], ls[4], ls[5], ls[6], ls[7], pic, ls[8], ls[9], ls[10]]
  const rowsFirst = [ls[0], ls[1], ls[6], ls[2], ls[7], ls[3], ls[4], ls[5], ls[9], ls[10], ls[8], pic]
  const a = pageEvidence(page(), { page: 9, order: columnsFirst })
  const b = pageEvidence(page(), { page: 9, order: rowsFirst })
  assert.deepEqual(a.blocks, b.blocks)
  assert.deepEqual(a.blocks, pageEvidence(page(), { page: 9 }).blocks)
  assert.deepEqual(a.engineOrder, ['p9.b01', 'p9.b02', 'p9.b04', 'p9.b03', 'p9.f01', 'p9.b05', 'p9.b06'])
  assert.deepEqual(b.engineOrder, ['p9.b01', 'p9.b02', 'p9.b03', 'p9.b04', 'p9.b06', 'p9.b05', 'p9.f01'])
})

test('T9: a block over 40 words carries its first and last 15 words', () => {
  const words = Array.from({ length: 60 }, (_, i) => `w${i + 1}`)
  const ls = Array.from({ length: 6 }, (_, k) => L(words.slice(k * 10, k * 10 + 10).join(' '), 36, 80 + k * 12))
  const ev = pageEvidence({ width: 432, height: 648, lines: ls, images: [] }, { page: 1 })
  assert.equal(ev.blocks[0].text, `${words.slice(0, 15).join(' ')} … ${words.slice(45).join(' ')}`)
  assert.equal(ev.blocks[0].lines, 6)
})

/** a small book: a heading, body text on every page, a vector chart with labels on page 2, folios */
async function smallBook(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const serif = await doc.embedFont(StandardFonts.TimesRoman)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const words = 'The text of this chapter tells of the work in the field and of the people who lived there and made the story of the place'.split(' ')
  for (let n = 1; n <= 4; n++) {
    const p = doc.addPage([400, 600])
    p.drawText(`Chapter ${n}`, { x: 60, y: 520, size: 24, font: bold })
    for (let k = 0; k < (n === 2 ? 8 : 24); k++) p.drawText(words.slice(k % 6, (k % 6) + 9).join(' '), { x: 60, y: 480 - k * 13, size: 11, font: serif })
    if (n === 2) {
      for (let b = 0; b < 6; b++) p.drawRectangle({ x: 80 + b * 30, y: 200, width: 24, height: 30 + b * 25 })
      for (let b = 0; b < 6; b++) p.drawText(String(2000 + b), { x: 80 + b * 30, y: 188, size: 8, font: serif })
      p.drawText('Figure 1. Growth by year', { x: 60, y: 160, size: 9, font: serif })
    }
    p.drawText(String(n + 10), { x: 195, y: 25, size: 9, font: serif })
  }
  return doc.save()
}

test('T9: the same PDF gives identical evidence across runs and across PDF/UA and PDF→EPUB', async () => {
  const data = await smallBook()
  const epub = (await analyzePdf(pdfjs, data, nodeRaster)).evidence
  const again = (await analyzePdf(pdfjs, data, nodeRaster)).evidence
  const ua = (await analyzePdf(pdfjs, data, nodeRaster, {}, undefined, { structure: false, keepFurniture: true })).evidence
  assert.equal(epub?.length, 4)
  assert.equal(JSON.stringify(again), JSON.stringify(epub))
  assert.equal(JSON.stringify(ua), JSON.stringify(epub))
  // the chart is a figure in the packet even though the EPUB path rasterises it and drops its labels from its own lines
  const p2 = epub![1]
  assert.equal(p2.page, 2)
  assert.equal(p2.printed, '12')
  assert.equal(p2.blocks.filter((b) => b.kind === 'figure').length, 1)
  assert.ok(p2.blocks.some((b) => b.text?.startsWith('2000 2001')))
  // neighbours: the last body words of the page before, the first of the page after
  assert.equal(p2.prevPageTail?.id.startsWith('p1.b'), true)
  assert.equal(p2.nextPageHead?.id.startsWith('p3.b'), true)
  assert.equal(epub![0].prevPageTail, undefined)
  assert.equal(epub![3].nextPageHead, undefined)
})

// ---- snapshot on 5 eval pages (test/eval-pages.json); skipped when the client's books are not on this machine ----
const BOOKS = [
  { id: 'evers', file: resolve(AUTOMATION, 'Accessible-PDF-Automation/Medium/Input/DD_Evers-Woelk_2124-6.pdf'), pages: [70, 132] },
  { id: 'ceramics', file: resolve(AUTOMATION, 'WORD-to-EPUB-Automation/Input/Contemporary_Ceramics_Final.pdf'), pages: [8, 53, 65] },
]
const SNAP = resolve(import.meta.dirname, 'snapshots/t9-evidence.json')
const noRaster = { image: async () => null, page: async () => null } as unknown as Raster
const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16)
/** the packet without the client's words: text becomes a hash */
const redact = (e: PageEvidence) => ({
  ...e,
  blocks: e.blocks.map((b) => (b.text === undefined ? b : { ...b, text: hash(b.text) })),
  prevPageTail: e.prevPageTail && { ...e.prevPageTail, text: hash(e.prevPageTail.text) },
  nextPageHead: e.nextPageHead && { ...e.nextPageHead, text: hash(e.nextPageHead.text) },
})

test('T9: snapshot of the evidence on 5 eval pages, the same from both pipelines', { skip: !BOOKS.every((b) => has(b.file)) && 'client books missing', timeout: 600_000 }, async () => {
  const got: Record<string, unknown> = {}
  for (const b of BOOKS) {
    const data = read(b.file)
    const epub = (await analyzePdf(pdfjs, data, noRaster)).evidence!
    const ua = (await analyzePdf(pdfjs, data, noRaster, {}, undefined, { structure: false })).evidence!
    assert.equal(JSON.stringify(ua), JSON.stringify(epub), `${b.id}: PDF/UA and PDF→EPUB differ`)
    for (const n of b.pages) got[`${b.id} p${n}`] = redact(epub[n - 1])
  }
  if (process.env.UPDATE_SNAPSHOT) {
    mkdirSync(resolve(SNAP, '..'), { recursive: true })
    writeFileSync(SNAP, JSON.stringify(got, null, 1) + '\n')
  }
  assert.deepEqual(got, JSON.parse(readFileSync(SNAP, 'utf8')))
})
