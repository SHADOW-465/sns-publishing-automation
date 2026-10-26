// Batch 2 EPUB corrections (24 Oct client review), each as a general rule on a small synthetic book.
// No client file is read: the books and the print PDF are built here.
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { text, bytes } from '../src/engine/zip.ts'
import { analyze, build, usePdfPictures } from '../src/engine/indesign/build.ts'
import { missingPictures, readPdfPictures } from '../src/engine/indesign/pdfpictures.ts'
import { pictureGuards, figureGuards, noteRefGuards, indexRangeGuards, tableGuards, scriptGuards } from '../src/engine/check/guards.ts'
import { setSettings, DEFAULT_SETTINGS, settings } from '../src/engine/settings.ts'
import { expandPageEnd, indexNumberSpans, linkIndexLocators } from '../src/engine/pdfua/indexlinks.ts'
import { noteRef } from '../src/engine/epub/markup.ts'
import { openSpec, applySpec } from '../src/engine/spec/session.ts'
import { readExport, inferProfile } from '../src/engine/indesign/read.ts'
import { synthExport, synthBook, SYNTH_CSS } from './synth.ts'
import { nodeRaster } from './raster-node.ts'
import { analyzePdf } from '../src/engine/pdfepub/analyze.ts'
import { buildPdfEpub } from '../src/engine/pdfepub/build.ts'
import { rulesFor } from '../src/engine/epub/imprint.ts'
import { joinRaisedLines, pageLayout } from '../src/engine/pdf/layout.ts'
import { detectTables } from '../src/engine/pdf/tables.ts'

afterEach(() => setSettings(DEFAULT_SETTINGS))

const COVER = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))
const para = (t: string) => `<p class="Cuerpo">${t.repeat(20)}</p>`

/** A two-chapter export whose pictures are named in the pages but not in the package. */
function pictureBook() {
  const body = synthBook(2, (n) =>
    `${para(`Words of chapter ${n} go on. `)}\n<img src="images/pic${n}.jpg" alt=""/>\n<p class="Cuerpo">Picture ${n}. Caption of the picture.</p>\n${para('More text follows here. ')}`)
  return synthExport(body, SYNTH_CSS, 'en-GB')
}

/** A print PDF with `n` pictures on `n` pages (a 1 px PNG drawn large). */
async function printPdf(n: number) {
  const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const img = await doc.embedPng(png)
  for (let i = 0; i < n; i++) {
    const page = doc.addPage([420, 600])
    page.drawText(`Page ${i + 1}`, { x: 40, y: 560, size: 10, font })
    page.drawImage(img, { x: 60, y: 200, width: 200, height: 150 })
  }
  return new Uint8Array(await doc.save())
}

const buildBook = (a: ReturnType<typeof analyze>) =>
  build(a, { styles: a.styles, images: a.images, meta: { ...a.meta, title: 'Sample', authors: 'A. Writer', publisher: 'Press', eisbn: '9780306406157', language: 'en-GB' }, cover: { name: 'cover.png', data: COVER } })

// ---- 1: pictures the InDesign package lacks come from the print PDF (IMG-009, IMG-011) -------------
test('1: a package without its pictures takes them from the print PDF, and says so when it cannot', async () => {
  const a = analyze(pictureBook())
  assert.deepEqual(missingPictures(a.ex).map((s) => s.split('/').pop()), ['pic1.jpg', 'pic2.jpg'])
  assert.equal(a.images.length, 0, 'nothing in the package to place')

  // without the PDF: the picture is not silently dropped, the book is flagged
  const bare = buildBook(analyze(pictureBook()))
  assert.ok(bare.review.some((x) => x.level === 'error' && x.msg.startsWith('IMG-011:') && /2 pictures are not in the InDesign package/.test(x.msg)), JSON.stringify(bare.review.filter((x) => x.level === 'error')))

  // with the PDF: both pictures are in the package, every <img> has bytes, and the count agrees
  const pics = await readPdfPictures(pdfjs, await printPdf(2), nodeRaster)
  assert.equal(pics.length, 2)
  assert.deepEqual(await usePdfPictures(a, pics), [])
  const r = buildBook(a)
  const html = [...r.files].filter(([p]) => p.endsWith('.xhtml')).map(([, d]) => text(d)).join('\n')
  assert.equal((html.match(/<img\b[^>]*src="images\/pic\d\.jpg"/g) ?? []).length, 2)
  for (const n of [1, 2]) assert.ok(r.files.get(`OEBPS/images/pic${n}.jpg`)?.length, `pic${n}.jpg is in the package`)
  assert.deepEqual(r.review.filter((x) => x.level === 'error' && /^IMG-011/.test(x.msg)), [])
})

test('1: guard IMG-011 flags an <img> without bytes and fewer pictures than the print PDF', () => {
  const files = new Map([
    ['OEBPS/c1.xhtml', bytes('<html><body><img src="images/a.jpg" alt=""/><img src="images/b.jpg" alt=""/></body></html>')],
    ['OEBPS/images/a.jpg', new Uint8Array([1, 2, 3])],
  ])
  const msgs = pictureGuards(files, 5).map((x) => x.msg)
  assert.equal(msgs.length, 2)
  assert.match(msgs[0], /^IMG-011: 1 picture has no image file in the package, for example “images\/b\.jpg”/)
  assert.match(msgs[1], /^IMG-011: the print PDF has 5 pictures and the e-book has 2\. 3 pictures are missing/)
  assert.ok(pictureGuards(files, 5).every((x) => x.level === 'error'))
  files.set('OEBPS/images/b.jpg', new Uint8Array([4]))
  assert.deepEqual(pictureGuards(files, 2), [])
})

const CSS_BU = SYNTH_CSS + '\np.BU { font-size:0.85em; margin-top:0; margin-bottom:0; font-family:"Serif", serif; }\n'

function withPng(files: ReturnType<typeof synthExport>, name: string) {
  const opf = text(files.get('OEBPS/content.opf')!)
  files.set('OEBPS/content.opf', bytes(opf.replace('</manifest>', `<item id="im" href="images/${name}" media-type="image/png"/></manifest>`)))
  files.set(`OEBPS/images/${name}`, COVER)
  return files
}

// ---- 2: the caption stays inside the figure (FIG-003, FIG-004) --------------------------------
test('2: a caption-style paragraph is a figcaption inside the figure, with space below it', () => {
  const body = synthBook(2, (n) =>
    n === 1
      ? `${para('Words of chapter 1 go on. ')}\n<img src="images/pic.png" alt="The field"/>\n<p class="BU">Abb. 1: the field in 1924.</p>\n${para('More text follows here. ')}`
      : para('Words of chapter 2 go on. '))
  const a = analyze(withPng(synthExport(body, CSS_BU), 'pic.png'))
  const r = buildBook(a)
  const html = [...r.files].filter(([p]) => p.endsWith('.xhtml')).map(([, d]) => text(d)).join('\n')
  assert.match(html, /<figure class="fig_group"><img [^>]*src="images\/pic\.png"\/><figcaption><p class="BU">Abb\. 1: the field in 1924\.<\/p><\/figcaption><\/figure>/)
  assert.doesNotMatch(html, /<\/figure>\s*<p class="BU">/)
  assert.match(text(r.files.get('OEBPS/css/style.css')!), /figcaption[^{]*\{[^}]*margin-bottom:\s*1\.5em/)
  assert.deepEqual(figureGuards(r.files), [])
  const bad = new Map([['OEBPS/c.xhtml', bytes('<figure class="fig_group"></figure><p class="BU">Late</p>')], ['OEBPS/css/style.css', bytes('p { margin: 0 }')]])
  assert.match(figureGuards(bad)[0].msg, /^FIG-003:/)
  assert.match(figureGuards(bad)[1].msg, /^FIG-004:/)
})

// ---- 3: BeBra note calls are superscripts when the layer says so (NOT-001) ---------------------
test('3: BeBra markup.noteref.wrap=sup wraps the call, and a bare link is flagged only then', async () => {
  const spec = await openSpec({ client: 'BeBra Verlag GmbH', series: '', book: 'Sample' }, DEFAULT_SETTINGS)
  applySpec(spec)
  assert.equal(settings().markup.noteref?.wrap, 'sup')
  assert.match(noteRef('#fn-1', 'fn_1', '1'), /^<sup><a epub:type="noteref"/)
  const note = `<p class="Cuerpo">${'The sentence about the field goes on here. '.repeat(12)}<span class="ENzeichen"><a class="_idEndnoteLink" role="doc-noteref" epub:type="noteref" href="#endnote-001"><span>1</span></a></span> more words follow after the call.</p>`
  const notes = `<div epub:type="endnotes"><aside epub:type="footnote" id="endnote-001"><p class="Cuerpo">1 The note text itself is long enough to keep.</p></aside></div>`
  const body = synthBook(2, (n) => (n === 1 ? note : para('Words of chapter 2 go on. '))) + notes
  const r = buildBook(analyze(synthExport(body, SYNTH_CSS, 'de-DE')))
  const html = [...r.files].filter(([p]) => p.endsWith('.xhtml')).map(([, d]) => text(d)).join('\n')
  assert.match(html, /<sup><a epub:type="noteref" href="#fn-01" id="fn_01" role="doc-noteref">[^<]+<\/a><\/sup>/)
  assert.deepEqual(noteRefGuards(r.files, 'sup'), [])
  const bare = new Map([['OEBPS/c.xhtml', bytes('<p><a epub:type="noteref" href="#fn-1" role="doc-noteref">1</a></p>')]])
  assert.match(noteRefGuards(bare, 'sup')[0].msg, /^NOT-001:/)
  assert.deepEqual(noteRefGuards(bare, ''), [])
  setSettings({ ...DEFAULT_SETTINGS, markup: { noteref: { wrap: '' } } })
  assert.equal(noteRef('#fn-1', 'fn_1', '1').startsWith('<a '), true)
})

// ---- 4: abbreviated index ranges expand and link both ends (IDX-002) ---------------------------
test('4: an abbreviated index range expands and the guard rejects a link to an earlier page', () => {
  assert.equal(expandPageEnd(266, '69'), 269)
  assert.equal(expandPageEnd(48, '9'), 49)
  assert.equal(expandPageEnd(105, '8'), 108)
  assert.equal(expandPageEnd(199, '02'), 202)
  assert.equal(expandPageEnd(192, '161'), 161)
  const html = linkIndexLocators('Rome, 48–9, 266-69')
  assert.match(html, /<a href="#pg:48">48<\/a>–<a href="#pg:49">9<\/a>/)
  assert.match(html, /<a href="#pg:266">266<\/a>-<a href="#pg:269">69<\/a>/)
  assert.deepEqual(indexNumberSpans('Rome, 48–9').map((s) => s.pageNo), [48, 49])
  const bad = new Map([['OEBPS/index.xhtml', bytes('<p><a href="c.xhtml#page-266">266</a>-<a href="c.xhtml#page-69">69</a></p>')]])
  assert.match(indexRangeGuards(bad)[0].msg, /^IDX-002: the index range 266-69/)
  const good = new Map([['OEBPS/index.xhtml', bytes('<p><a href="c5.xhtml#page-266">266</a>-<a href="c6.xhtml#page-269">69</a></p>')]])
  assert.deepEqual(indexRangeGuards(good), [])
  const full = new Map([['OEBPS/index.xhtml', bytes('<p><a href="c.xhtml#page-192">192</a>-<a href="c.xhtml#page-161">161</a></p>')]])
  assert.deepEqual(indexRangeGuards(full), [])
})

// ---- 5: style inference stays linear on a long single file --------------------------------------
test('5: inferProfile on a long synthetic book stays under a few seconds', () => {
  const paras = Array.from({ length: 3000 }, (_, i) => `<p class="Cuerpo">Sentence ${i} of the long chapter keeps going with ordinary words about the field and the city.</p>`).join('\n')
  const ex = readExport(synthExport(synthBook(1, () => paras), SYNTH_CSS))
  const t0 = Date.now()
  const styles = inferProfile(ex)
  const ms = Date.now() - t0
  assert.ok(styles.some((s) => s.key === 'Cuerpo' && s.role === 'p'))
  assert.ok(ms < 8000, `inferProfile took ${ms} ms`)
})

// ---- 6: a turned ruled table, and a chart drawn as vectors (TBL-001, IMG-011) -------------------
test('6: a landscape table on a portrait page becomes a table, and a vector chart becomes a picture', async () => {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const W = 420
  const H = 640
  const body = doc.addPage([W, H])
  body.drawText('Chapter One', { x: 50, y: 580, size: 22, font: bold })
  body.drawText('The church is of the 13 century and stands in the field beyond the wall.', { x: 50, y: 540, size: 11, font })
  const before = font.widthOfTextAtSize('The church is of the 13', 11)
  body.drawText('th', { x: 50 + before, y: 545, size: 6, font })
  body.drawText('A long sentence follows so this page is body text and not a caption under the chart.', { x: 50, y: 500, size: 11, font })
  for (let i = 0; i < 6; i++) body.drawEllipse({ x: 150 + (i % 3) * 46, y: 280 + Math.floor(i / 3) * 46, xScale: 22, yScale: 22, color: rgb(0.2, 0.35, 0.55) })
  body.drawText('Grafica 1. The shares, shown as a drawing rather than a placed image.', { x: 50, y: 180, size: 10, font })
  const table = doc.addPage([W, H])
  const xs = [40, 160, 280, 380]
  const ys = [80, 240, 400, 540]
  for (const x of xs) table.drawLine({ start: { x, y: ys[0] }, end: { x, y: ys[3] }, thickness: 0.7 })
  for (const y of ys) table.drawLine({ start: { x: xs[0], y }, end: { x: xs[3], y }, thickness: 0.7 })
  const cells = ['Solicitante gob', 'Resultado final', 'En espera de juicio', 'Monocratico eliminado', 'Total relativo', 'Cuadro de resultados']
  cells.forEach((word, i) => {
    const col = i % 3
    const row = Math.floor(i / 3)
    table.drawText(word, { x: xs[col] + 14, y: ys[row] + 16, size: 10, font, rotate: degrees(90) })
  })
  const data = new Uint8Array(await doc.save())
  const pdf = await pdfjs.getDocument({ data: data.slice(), disableFontFace: true }).promise
  const lay0 = await pageLayout(pdfjs, await pdf.getPage(1), 0)
  const joined = joinRaisedLines(lay0.lines)
  const host = joined.find((l) => l.runs.some((r) => r.sup && r.text === 'th'))
  assert.ok(host, `raised th was not joined: ${joined.map((l) => l.text).join(' | ')}`)
  assert.match(host!.text, /13th century/)
  const lay1 = await pageLayout(pdfjs, await pdf.getPage(2), 1, { unrotate: true })
  const tables = detectTables(lay1)
  assert.ok(tables.some((t) => t.lines.some((l) => /Solicitante/.test(l.text))), `no table text: ${lay1.lines.map((l) => l.text).join(' | ')} rules h${lay1.rules?.h.length} v${lay1.rules?.v.length}`)
  const book = await analyzePdf(pdfjs, data, nodeRaster)
  assert.ok(book.pages[0].images.length >= 1, 'the vector chart is a picture')
  const r = await buildPdfEpub(book, { styles: book.styles, meta: { ...book.meta, title: 'Charts', authors: 'A. Writer', eisbn: '9780306406157', language: 'en-GB' }, rules: rulesFor('en'), cover: { name: 'cover.png', data: COVER } }, nodeRaster)
  const html = [...r.files].filter(([p]) => p.endsWith('.xhtml')).map(([, d]) => text(d)).join('\n')
  assert.match(html, /<sup>th<\/sup>/)
  assert.match(html, /<table\b/)
  assert.match(html, /Solicitante/)
  assert.match(html, /<img\b[^>]*src="images\/pg-/)
  assert.deepEqual(scriptGuards(r.files), [])
  assert.deepEqual(tableGuards(r.files, 1), [])
  const bare = new Map([['OEBPS/c.xhtml', bytes('<p>th</p>')]])
  assert.match(scriptGuards(bare)[0].msg, /^TXT-008:/)
  assert.match(tableGuards(new Map([['OEBPS/c.xhtml', bytes('<p>Name Date</p>')]]), 1)[0].msg, /^TBL-001:/)
  // row rules and no column rules: the cells are the gaps, as on a turned table whose verticals were never stroked
  const cell = (text: string, x0: number, y: number) => ({ text, x0, x1: x0 + text.length * 5, y, size: 10, base: y + 10, font: 'F', marker: false, runs: [{ text, x0, x1: x0 + text.length * 5, font: 'F', size: 10, bold: false, italic: false }] })
  const ruled = detectTables({
    width: 400, height: 500,
    lines: [
      cell('Name', 20, 100), cell('Result', 140, 100), cell('Share', 260, 100),
      cell('Waiting', 20, 140), cell('22.2', 140, 140), cell('40', 260, 140),
      cell('Removed', 20, 180), cell('3.7', 140, 180), cell('12', 260, 180),
    ],
    rules: { h: [90, 130, 170, 210].map((p) => ({ a: 10, b: 300, p })), v: [] },
  })
  assert.equal(ruled.length, 1)
  assert.match(ruled[0].lines.map((l) => l.text).join(' '), /Name/)
})
