// Batch 4: general rules for chapter labels, printed contents, guidebook openers, row-ruled tables,
// chart labels, split URLs, ordinals, overlapping text, recurring subheads, and PDF/UA reading order.
// Synthetic books only. No client file is read.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFString, StandardFonts, rgb } from 'pdf-lib'
import { zipSync, strToU8 } from 'fflate'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { text } from '../src/engine/zip.ts'
import { analyzePdf } from '../src/engine/pdfepub/analyze.ts'
import { buildPdfEpub } from '../src/engine/pdfepub/build.ts'
import { rulesFor } from '../src/engine/epub/imprint.ts'
import { pageLayout, joinRaisedLines, repairOrdinalHtml, isTwoUpSpread, type Line, type Run } from '../src/engine/pdf/layout.ts'
import { detectTables } from '../src/engine/pdf/tables.ts'
import { clusterDrawings } from '../src/engine/pdf/drawings.ts'
import { analyze, build } from '../src/engine/indesign/build.ts'
import { synthExport, SYNTH_CSS } from './synth.ts'
import { readWordBook } from '../src/engine/wordepub/read.ts'
import { buildStructure, type UaRole } from '../src/engine/pdfua/structure.ts'
import type { PdfBook, PLine } from '../src/engine/pdfepub/analyze.ts'
import { analyzeUa, buildUa } from '../src/engine/pdfua/index.ts'
import { nodeRaster } from './raster-node.ts'

const COVER = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))
const meta = { title: 'Sample', authors: 'A. Writer', publisher: 'Press', eisbn: '9780306406157', language: 'en' }

async function pdfEpub(data: Uint8Array) {
  const book = await analyzePdf(pdfjs, data, nodeRaster, {}, undefined, { splitSpreads: true })
  const r = await buildPdfEpub(book, { styles: book.styles, meta: { ...book.meta, ...meta, title: book.meta.title || 'Sample' }, rules: rulesFor('en'), cover: { name: 'cover.png', data: COVER } }, nodeRaster)
  const html = [...r.files].filter(([p]) => p.endsWith('.xhtml')).map(([, d]) => text(d)).join('\n')
  return { book, r, html }
}

const line = (page: number, text: string, x0: number, x1: number, y: number, size: number, key: string): PLine => ({
  page, text, x0, x1, y, size, base: y + size * 0.8, font: key, key, col: 0, marker: false,
  runs: [{ text, x0, x1, font: key, size, bold: false, italic: false }],
})
const pagesOf = (...pages: PLine[][]) =>
  ({ pages: pages.map((lines, index) => ({ index, width: 400, height: 560, lines, images: [], fills: [], rules: { h: [], v: [] }, shades: [] })), front: [0], lead: 14, step: 18, bodySize: 11, bodyKey: 'B 11', numbers: pages.map((_, i) => i + 1), styles: [] }) as unknown as PdfBook
const hroles = new Map<string, UaRole>([['H 24', 'H1'], ['H 18', 'H6'], ['H 9', 'H6'], ['B 11', 'P']])

test('1: a chapter label set above its title stays on that chapter', async () => {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const body = 'The paragraph continues across the page so the body face is the one readers meet most often. '
  const ch = (title: string, label: string | undefined, y0: number) => {
    const page = doc.addPage([400, 600])
    if (label) page.drawText(label, { x: 150, y: 470, size: 13, font: bold })
    page.drawText(title, { x: 90, y: 430, size: 22, font: bold })
    for (let i = 0; i < 8; i++) {
      page.drawText(body.slice(0, 32), { x: 40, y: y0 - i * 16, size: 11, font })
      page.drawText(body.slice(0, 32), { x: 230, y: y0 - i * 16, size: 11, font })
    }
  }
  ch('A Roadmap for the Work', 'CHAPTER 1', 380)
  ch('Why We Do It at All', 'CHAPTER 2', 380)
  const { r, html } = await pdfEpub(new Uint8Array(await doc.save()))
  const ch2 = r.sections.find((s) => /Why We Do It/.test(s.nav))
  assert.ok(ch2, r.sections.map((s) => s.nav).join(' | '))
  assert.match(ch2!.nav, /CHAPTER 2/)
  const file = text(r.files.get(`OEBPS/${ch2!.file}`)!)
  assert.match(file, /CHAPTER 2/)
  assert.match(file, /Why We Do It/)
  const ch1 = r.sections.find((s) => /Roadmap/.test(s.nav))!
  assert.doesNotMatch(text(r.files.get(`OEBPS/${ch1.file}`)!), /<h2[^>]*>\s*(?:<strong>)?CHAPTER 2/)
  assert.doesNotMatch(html, /1th9/)
})

test('2: a half-title and a printed Índice become front matter, not one back-matter section', async () => {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const half = doc.addPage([400, 600])
  half.drawText('SAMPLE RELATIONS', { x: 80, y: 450, size: 14, font })
  half.drawText('OF THE FEDERAL CITIES', { x: 70, y: 430, size: 14, font })
  const toc = doc.addPage([400, 600])
  toc.drawText('INDICE', { x: 160, y: 480, size: 11, font })
  const entries = ['1. Alpha Topic', '2. Beta Topic', '3. Gamma Topic', '4. Delta Topic']
  entries.forEach((e, i) => {
    toc.drawText(e, { x: 40, y: 440 - i * 28, size: 11, font })
    toc.drawText(String(i + 4), { x: 340, y: 440 - i * 28, size: 11, font })
  })
  const body = 'The paragraph continues across the page so the body face is the one readers meet most often. '
  entries.forEach((e, i) => {
    const page = doc.addPage([400, 600])
    page.drawText(e, { x: 40, y: 520, size: 18, font: bold })
    for (let k = 0; k < 10; k++) page.drawText(body, { x: 40, y: 480 - k * 16, size: 11, font })
  })
  const { book, r } = await pdfEpub(new Uint8Array(await doc.save()))
  const types = r.sections.map((s) => `${s.type}:${s.file}`)
  assert.ok(book.contents, `no contents; front ${book.front.join(',')}; ${types.join(' ')}`)
  assert.ok(r.sections.some((s) => s.type === 'halftitle'), types.join(' '))
  assert.ok(r.sections.some((s) => s.type === 'toc'), types.join(' '))
  const stray = r.sections.find((s) => s.file.startsWith('sec') && /INDICE|SAMPLE RELATIONS/.test(text(r.files.get(`OEBPS/${s.file}`) ?? new Uint8Array())))
  assert.equal(stray, undefined, types.join(' '))
  const tocHtml = text(r.files.get('OEBPS/toc.xhtml')!)
  assert.match(tocHtml, /Alpha Topic/)
  assert.match(tocHtml, /epub:type="frontmatter"/)
})

test('3: a short unlabelled place opener under region parts joins the section that follows', () => {
  const css = SYNTH_CSS + '\nh1.h1 { font-size: 2em; font-family: "Sans", sans-serif; text-align: center; }\np.h2 { font-size: 1.17em; font-weight: bold; font-family: "Sans", sans-serif; }\n'
  const words = (n: number) => `<p class="Cuerpo">${Array.from({ length: n }, () => 'word').join(' ')}</p>`
  const ch = (title: string, n: number) => `<h1 class="h1">${title}</h1>\n${words(n)}`
  const body = [
    '<p class="Cuerpo">Front line.</p>',
    ch('The North', 40),
    ch('Along the Coast', 1000),
    ch('High Plateau', 30),
    ch('The South', 40),
    ch('Along the River', 1000),
    ch('Cat Ba Shore', 40),
    ch('Nam Dinh Shore', 30),
    ch('The Harbour Road', 100),
    '<h1 class="h1">Another Place</h1>\n<p class="h2">A note</p>\n' + words(200),
    ch('The Last Road', 200),
  ].join('\n')
  const a = analyze(synthExport(body, css, 'en-GB'))
  const r = build(a, { styles: a.styles, images: a.images, meta: { ...a.meta, ...meta, language: 'en-GB', rights: 'Copyright © A. Writer 2020' }, cover: { name: 'cover.png', data: COVER } })
  const parts = r.sections.filter((s) => s.type === 'part').map((s) => s.nav)
  assert.ok(parts.some((n) => /North/.test(n)) && parts.some((n) => /South/.test(n)), `parts: ${parts.join(' | ')}; all: ${r.sections.map((s) => `${s.type}:${s.nav}`).join(' | ')}`)
  assert.ok(!r.sections.some((s) => s.type === 'chapter' && /Cat Ba Shore/.test(s.nav)), r.sections.map((s) => `${s.type}:${s.nav}`).join(' | '))
  const harbour = r.sections.find((s) => /Harbour Road/.test(s.nav))!
  const harbourHtml = text(r.files.get(`OEBPS/${harbour.file}`)!)
  assert.match(harbourHtml, /Cat Ba Shore/)
  assert.match(harbourHtml, /Nam Dinh Shore/)
  assert.ok(!r.sections.some((s) => s.type === 'chapter' && /Nam Dinh Shore|High Plateau/.test(s.nav)), r.sections.map((s) => `${s.type}:${s.nav}`).join(' | '))
  const coast = r.sections.find((s) => /Along the Coast/.test(s.nav))!
  assert.match(text(r.files.get(`OEBPS/${coast.file}`)!), /High Plateau/)
})

test('4: segmented row rules keep every column, including ones whose numbers are right-aligned', () => {
  const edges = [40, 110, 180, 250, 320, 390, 460, 530]
  const names = ['stub', 'gob', 'asl', 'oab', 'pgr', 'ppc', 'ent']
  const segs = [20, 100, 180].flatMap((y) => edges.slice(0, -1).map((a, i) => ({ a, b: edges[i + 1], p: y })))
  const ln = (t: string, x0: number, x1: number, y: number) => ({
    text: t, x0, x1, y, size: 9, base: y + 7, font: 'F', key: 'F 9', page: 0, col: 0, marker: false,
    runs: [{ text: t, x0, x1, font: 'F', size: 9, bold: false, italic: false }],
  })
  const lines = [
    ...names.map((t, i) => ln(t, edges[i] + 4, edges[i] + 4 + t.length * 5, 40)),
    ...names.map((_, i) => ln(String(10 + i), edges[i + 1] - 18, edges[i + 1] - 4, 120)),
  ]
  const tables = detectTables({ width: 600, height: 400, lines, rules: { h: segs, v: [] } })
  assert.equal(tables.length, 1)
  const texts = (c: number) => tables[0].cells.filter((k) => k.c === c).flatMap((k) => k.lines.map((l) => l.text.trim()))
  for (const name of ['oab', 'pgr', 'ppc', 'ent']) {
    const col = names.indexOf(name)
    assert.ok(texts(col).includes(name), `${name} landed in ${texts(col).join(',')}; cols ${tables[0].cols}`)
    assert.ok(texts(col).includes(String(10 + col)), `${name} lost its number ${texts(col)}`)
  }
})

test('4b: a landscape table is not cut in half as a two-page spread', () => {
  const ln = (text: string, x0: number, x1: number, y = 40) => ({ text, x0, x1, y, size: 9, base: y + 8, font: 'F', runs: [] as Run[] })
  const table = {
    width: 640, height: 420,
    lines: [ln('Resultado final', 40, 150), ln('gob', 180, 210), ln('oab', 400, 440), ln('ent', 520, 560)],
    rules: { h: [20, 80, 140].map((p) => ({ a: 30, b: 580, p })), v: [] },
  }
  assert.equal(isTwoUpSpread(table as unknown as Parameters<typeof isTwoUpSpread>[0]), false)
  const spread = {
    width: 640, height: 420,
    lines: [ln('Left page one', 40, 180), ln('Left page two', 40, 170, 60), ln('Left page three', 40, 160, 80), ln('Left page four', 40, 150, 100), ln('Right page one', 400, 560), ln('Right page two', 400, 540, 60), ln('Right page three', 400, 520, 80), ln('Right page four', 400, 500, 100)],
    rules: { h: [] as { a: number; b: number; p: number }[], v: [] },
  }
  assert.equal(isTwoUpSpread(spread as unknown as Parameters<typeof isTwoUpSpread>[0]), true)
})

test('5: pie labels next to a drawing join the picture, and the caption stays outside it', () => {
  const drawings = [0, 1, 2, 3, 4, 5].map((i) => ({ x0: 140 + (i % 3) * 30, y0: 200 + Math.floor(i / 3) * 30, x1: 165 + (i % 3) * 30, y1: 225 + Math.floor(i / 3) * 30 }))
  const lab = (t: string, x0: number, y: number) => ({ x0, x1: x0 + t.length * 5, y, size: 9, text: t })
  const boxes = clusterDrawings({
    width: 400, height: 600, drawings,
    lines: [lab('40', 80, 210), lab('North', 200, 175), lab('Grafica 1.4 Shares of the fund this year', 40, 280), lab('The prose of the paragraph is much longer than a chart label and must stay.', 40, 360)],
  })
  assert.equal(boxes.length, 1)
  assert.ok(boxes[0].x0 < 90, 'the axis number was absorbed')
  assert.ok(boxes[0].y0 < 180, 'the pie label was absorbed')
  assert.ok(boxes[0].y1 < 270, 'the caption was not absorbed')
})

test('6: a hyperlink that stops halfway through a URL takes the rest of the URL, including across a line-end hyphen', () => {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  const xml = `<?xml version="1.0"?><w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Bibliography</w:t></w:r></w:p>
    <w:p>
      <w:r><w:t>Secretaría. </w:t></w:r>
      <w:hyperlink r:id="rId1"><w:r><w:t>https://example.org/sesnsp/accio-</w:t></w:r></w:hyperlink>
      <w:r><w:br/></w:r>
      <w:r><w:t>nes/informe</w:t></w:r>
    </w:p>
    <w:p><w:r><w:t>A well-known well-wisher wrote it.</w:t></w:r></w:p>
  </w:body></w:document>`
  const rels = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.org/sesnsp/accio-" TargetMode="External"/></Relationships>`
  const styles = `<?xml version="1.0"?><w:styles xmlns:w="${W}"><w:style w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style></w:styles>`
  const book = readWordBook(zipSync({ 'word/document.xml': strToU8(xml), 'word/styles.xml': strToU8(styles), 'word/_rels/document.xml.rels': strToU8(rels) }))
  const para = book.blocks.find((b) => b.role === 'body' && b.text.includes('sesnsp'))
  assert.ok(para && para.role === 'body')
  const link = para.inlines.find((i) => i.href)
  assert.equal(link?.text, 'https://example.org/sesnsp/acciones/informe')
  assert.equal(link?.href, 'https://example.org/sesnsp/acciones/informe')
  assert.ok(!para.inlines.some((i) => i.t === 'text' && !i.href && /nes\/informe/.test(i.text)))

  const xml2 = `<?xml version="1.0"?><w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Bibliography</w:t></w:r></w:p>
    <w:p>
      <w:hyperlink r:id="rId1"><w:r><w:t>https://www.gob.mx/sesnsp/accio-</w:t></w:r></w:hyperlink>
      <w:r><w:t>nes-y-programas/para-la-se-</w:t></w:r>
      <w:r><w:t>guridad</w:t></w:r>
    </w:p>
    <w:p>
      <w:hyperlink r:id="rId2"><w:r><w:t>https://www.diputados.gob.mx/</w:t></w:r></w:hyperlink>
      <w:r><w:t> LeyesBiblio/ref/cpeum_per.htm</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t>. https://www.planalto. </w:t></w:r>
      <w:r><w:t>gov.br/ccivil_03/constituicao91.htm</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t>. https://www.diputa-</w:t></w:r>
      <w:r><w:t>dos.gob.mx/LeyesBiblio/pdf/LGSNSP.pdf</w:t></w:r>
    </w:p>
    <w:p>
      <w:hyperlink r:id="rId3"><w:r><w:t>https://www.youtube.com/watch?v=ZUYF</w:t></w:r></w:hyperlink>
      <w:r><w:t> </w:t></w:r>
      <w:r><w:t>goVLSzU</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t>. https:// </w:t></w:r>
      <w:hyperlink r:id="rId4"><w:r><w:t>www.animalpolitico.com/el-proyecto-punta-co-</w:t></w:r></w:hyperlink>
      <w:r><w:t>lonet-recibe-final/</w:t></w:r>
    </w:p>
    <w:p>
      <w:hyperlink r:id="rId5"><w:r><w:t>https://www.gob.mx/cms/uploads/attachment/file/</w:t></w:r></w:hyperlink>
      <w:r><w:t> </w:t></w:r>
      <w:r><w:t>228649/Lineamientos_del_ Consejo.pdf</w:t></w:r>
    </w:p>
  </w:body></w:document>`
  const rels2 = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://www.gob.mx/sesnsp/accio-" TargetMode="External"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://www.diputados.gob.mx/" TargetMode="External"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://www.youtube.com/watch?v=ZUYF" TargetMode="External"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://www.animalpolitico.com/el-proyecto-punta-co-" TargetMode="External"/><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://www.gob.mx/cms/uploads/attachment/file/" TargetMode="External"/></Relationships>`
  const book2 = readWordBook(zipSync({ 'word/document.xml': strToU8(xml2), 'word/styles.xml': strToU8(styles), 'word/_rels/document.xml.rels': strToU8(rels2) }))
  const gob = book2.blocks.find((b) => b.role === 'body' && b.text.includes('sesnsp'))
  const dip = book2.blocks.find((b) => b.role === 'body' && b.text.includes('diputados'))
  assert.equal(gob && gob.role === 'body' && gob.inlines.find((i) => i.href)?.text, 'https://www.gob.mx/sesnsp/acciones-y-programas/para-la-seguridad')
  assert.equal(gob && gob.role === 'body' && gob.inlines.find((i) => i.href)?.href, 'https://www.gob.mx/sesnsp/acciones-y-programas/para-la-seguridad')
  assert.equal(dip && dip.role === 'body' && dip.inlines.find((i) => i.href)?.href, 'https://www.diputados.gob.mx/LeyesBiblio/ref/cpeum_per.htm')
  const plano = book2.blocks.find((b) => b.role === 'body' && b.text.includes('planalto'))
  assert.equal(plano && plano.role === 'body' && plano.text.includes('https://www.planalto.gov.br/ccivil_03/constituicao91.htm'), true)
  const diputa = book2.blocks.find((b) => b.role === 'body' && b.text.includes('LGSNSP'))
  assert.equal(diputa && diputa.role === 'body' && diputa.text.includes('https://www.diputados.gob.mx/LeyesBiblio/pdf/LGSNSP.pdf'), true)
  const yt = book2.blocks.find((b) => b.role === 'body' && b.text.includes('youtube'))
  assert.equal(yt && yt.role === 'body' && yt.inlines.find((i) => i.href)?.href, 'https://www.youtube.com/watch?v=ZUYFgoVLSzU')
  const animal = book2.blocks.find((b) => b.role === 'body' && b.text.includes('animalpolitico'))
  assert.equal(animal && animal.role === 'body' && animal.inlines.find((i) => i.href)?.href, 'https://www.animalpolitico.com/el-proyecto-punta-colonet-recibe-final/')
  const file = book2.blocks.find((b) => b.role === 'body' && b.text.includes('228649'))
  assert.equal(file && file.role === 'body' && file.inlines.find((i) => i.href)?.href, 'https://www.gob.mx/cms/uploads/attachment/file/228649/Lineamientos_del_Consejo.pdf')
})

test('7: a raised ordinal read between the digits of its number follows the whole number', () => {
  const run = (text: string, x0: number, x1: number, sup = false): Run => ({ text, x0, x1, font: 'F', size: sup ? 6 : 11, bold: false, italic: false, base: sup ? 100 : 104, sup })
  const host: Line = { text: '19', x0: 40, x1: 52, y: 90, base: 104, size: 11, font: 'F', marker: false, runs: [run('1', 40, 46), run('9', 46, 52)] }
  const raised: Line = { text: 'th', x0: 46, x1: 54, y: 84, base: 98, size: 6, font: 'F', marker: false, runs: [run('th', 46, 54, true)] }
  const joined = joinRaisedLines([host, raised])
  assert.equal(joined.length, 1)
  assert.match(joined[0].text, /^19th/)
  assert.ok(joined[0].runs.some((r) => r.sup && r.text === 'th'))
  const digits = joined[0].runs.filter((r) => /^\d+$/.test(r.text)).map((r) => r.text).join('')
  assert.equal(digits, '19')
  const fixed = repairOrdinalHtml('<p class="noindent">By the 13 century, churches were built in pure early</p>\n<p class="noindent">th</p>\n<p class="noindent">in the 15<sup>th</sup> and 16the century.</p>\n<p>late 11 and 12<sup>th</sup> century</p>')
  assert.match(fixed, /13<sup>th<\/sup> century/)
  assert.doesNotMatch(fixed, /<p[^>]*>\s*th\s*<\/p>/)
  assert.match(fixed, /16<sup>th<\/sup> the century/)
  assert.match(fixed, /11<sup>th<\/sup> and 12<sup>th<\/sup>/)
  assert.match(fixed, /15<sup>th<\/sup>/)
})

test('7b: an InDesign run split as 1 th 3 becomes 13th', () => {
  const css = SYNTH_CSS + '\nspan.ord { vertical-align: super; font-size: 0.6em; }\n'
  const body = `<p class="Titulo">Chapter One</p>\n<p class="Cuerpo">On the 1<span class="ord">th</span>3 of June the church was dedicated and the parish came to see it.</p>\n<p class="Cuerpo">${'More of the story follows here. '.repeat(30)}</p>`
  const a = analyze(synthExport(body, css, 'en-GB'))
  const r = build(a, { styles: a.styles, images: a.images, meta: { ...a.meta, ...meta, language: 'en-GB', rights: 'Copyright © A. Writer 2020' }, cover: { name: 'cover.png', data: COVER } })
  const html = [...r.files.values()].map((d) => text(d)).join('\n')
  assert.match(html, /13<sup>th<\/sup>/)
  assert.doesNotMatch(html, /1<sup>th<\/sup>3/)
})

test('8: text drawn twice on the same spot keeps the top layer, and a doubled phrase collapses', async () => {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage([400, 600])
  page.drawText('The Beautiful Harpies', { x: 40, y: 500, size: 14, font, color: rgb(0, 0, 0) })
  page.drawText('1066 CHURCHES', { x: 40, y: 500, size: 14, font, color: rgb(0, 0, 0) })
  page.drawText('Love Your Book Love Your Book', { x: 40, y: 460, size: 12, font })
  const lay = await pageLayout(pdfjs, await pdfjs.getDocument({ data: new Uint8Array(await doc.save()), disableFontFace: true }).promise.then((d) => d.getPage(1)), 0)
  const texts = lay.lines.map((l) => l.text.trim())
  assert.ok(texts.some((t) => t === '1066 CHURCHES'), texts.join(' | '))
  assert.ok(!texts.some((t) => /Harpies.*CHURCHES|CHURCHES.*Harpies/.test(t)), texts.join(' | '))
  assert.ok(texts.some((t) => t === 'Love Your Book'), texts.join(' | '))
})

test('8b: two identical title lines stay one heading', async () => {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const page = doc.addPage([400, 600])
  page.drawText('Love Your Book', { x: 40, y: 500, size: 22, font: bold })
  page.drawText('Love Your Book', { x: 40, y: 470, size: 22, font: bold })
  const body = 'The paragraph continues across the page so the body face is the one readers meet most often. '
  for (let i = 0; i < 8; i++) page.drawText(body, { x: 40, y: 420 - i * 16, size: 11, font })
  const { html } = await pdfEpub(new Uint8Array(await doc.save()))
  assert.doesNotMatch(html, /Love Your Book Love Your Book/)
  assert.doesNotMatch(html, /Love Your Book<\/strong>\s*<strong>Love Your Book/)
})

test('9: a subheading that recurs in every chapter never opens its own section', () => {
  const css = `
p.text { font-size: 1em; font-family: "Minion Pro", serif; }
h1.h1 { font-size: 2em; font-family: "Veneer", sans-serif; }
p.h2 { font-size: 1.17em; font-family: "Hero", sans-serif; font-weight: bold; }
p.ihv1 { font-size: 1em; font-family: "Veneer", sans-serif; }
p.Inhalt { font-size: 1.2em; text-align: center; }
`
  const long = (t: string) => `<p class="text">${t} </p>`
  const body = [
    '<p class="Inhalt">Contents</p>',
    '<p class="ihv1">Alpha</p>',
    '<p class="ihv1">Beta</p>',
    '<p class="ihv1">Bibliography</p>',
    '<h1 class="h1">Alpha</h1>',
    long('Alpha tells the first story of the volume and keeps its own ending.'),
    '<p class="h2">Conclusiones</p>',
    long('The closing words of alpha stay inside alpha.'),
    '<h1 class="h1">Beta</h1>',
    long('Beta tells the second story of the volume and keeps its own ending.'),
    '<p class="h2">Conclusiones</p>',
    long('The closing words of beta stay inside beta.'),
    '<p class="h2">Bibliography</p>',
    long('One list of works, named once.'),
  ].join('\n')
  const a = analyze(synthExport(body, css, 'es-ES'))
  const r = build(a, { styles: a.styles, images: a.images, meta: { ...a.meta, ...meta, language: 'es-ES', rights: 'Copyright © A. Writer 2020' }, cover: { name: 'cover.png', data: COVER } })
  assert.ok(!r.sections.some((s) => /conclusiones/i.test(s.nav)), r.sections.map((s) => s.nav).join(' | '))
  const alpha = r.sections.find((s) => s.nav === 'Alpha')!
  assert.match(text(r.files.get(`OEBPS/${alpha.file}`)!), /Conclusiones/)
  assert.ok(r.sections.some((s) => s.type === 'bibliography'), r.sections.map((s) => `${s.type}:${s.nav}`).join(' | '))
})

test('10: an edition line follows the title, a sentence beside a QR is its own paragraph, and chart labels are not headings', () => {
  const edition = line(0, 'Segunda edicion', 40, 160, 40, 18, 'H 18')
  const tracked = line(0, 'E D I C I O N D E L V I G E S I M O', 40, 300, 22, 12, 'B 11')
  const title = line(0, 'The Book Title', 40, 240, 80, 24, 'H 24')
  const body = line(0, 'Body text of the chapter goes on past the title.', 40, 360, 200, 11, 'B 11')
  const qrSentence = line(0, 'Scan this code to read the publisher note.', 200, 380, 120, 11, 'B 11')
  const under = line(0, 'Printed in the city during the spring.', 40, 280, 180, 11, 'B 11')
  const book = pagesOf([tracked, edition, title, body], [qrSentence, under])
  book.pages[1].images = [{ id: 'qr', x0: 40, y0: 100, x1: 120, y1: 180, crop: { l: 0, t: 0, r: 1, b: 1 }, jpeg: null }]
  const label = (t: string, x0: number, y: number) => line(0, t, x0, x0 + t.length * 6, y, 9, 'H 9')
  book.pages.push({ ...book.pages[0], index: 2, lines: [label('8D', 110, 100), label('4D', 300, 180), label('Evolucion de los hominidos', 290, 90), label('Evolucion de la humanidad', 250, 150), line(2, 'A real section heading', 40, 220, 400, 18, 'H 18'), line(2, 'Body text after the pyramid chart goes on.', 40, 340, 440, 11, 'B 11')] })
  const chart = { page: 2, box: { x0: 100, x1: 280, y0: 300, y1: 460 }, lines: [], caption: '', vector: true }
  const st = buildStructure(book, hroles, new Map([[2, [chart as never]]]))
  const first = st.root.kids.find((k) => k.tag === 'Sect') ?? st.root
  const tags = first.kids.map((k) => `${k.tag}:${k.text ?? k.lines.map((l) => l.text).join(' ')}`)
  const titleAt = tags.findIndex((t) => /The Book Title/.test(t))
  const editionAt = tags.findIndex((t) => /edicion/.test(t))
  assert.ok(titleAt >= 0 && editionAt > titleAt, tags.join(' | '))
  assert.match(tags[editionAt], /^P:/)
  assert.ok(titleAt >= 0 && !/E D I C/.test(tags[titleAt] ?? ''), tags[titleAt])
  const trackedAt = tags.findIndex((t) => /E D I C I O N/.test(t))
  assert.ok(trackedAt > titleAt && /^P:/.test(tags[trackedAt]), tags.join(' | '))
  const ps = st.nodes.filter((n) => n.tag === 'P' && n.lines.some((l) => /Scan this code/.test(l.text)))
  assert.equal(ps.length, 1)
  assert.equal(ps[0].lines.length, 1)
  assert.ok(!st.headings.some((h) => h.text === '8D' || h.text === '4D' || /hominidos/.test(h.text ?? "")), st.headings.map((h) => h.text).join(' | '))
  assert.equal(st.figures[0].lines.length, 4)
})

test('10b: stacked link rectangles that share a target collapse to one link', async () => {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage([400, 600])
  page.drawText('See the three books.', { x: 40, y: 500, size: 12, font })
  const link = (rect: number[], uri: string) => doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: rect, Border: [0, 0, 0], A: { S: 'URI', URI: PDFString.of(uri) } }))
  page.node.set(PDFName.of('Annots'), doc.context.obj([
    link([40, 400, 120, 480], 'https://example.org/a'),
    link([42, 402, 122, 482], 'https://example.org/a'),
    link([150, 400, 230, 480], 'https://example.org/b'),
    link([148, 398, 228, 478], 'https://example.org/b'),
    link([260, 400, 340, 480], 'https://example.org/c'),
    link([262, 404, 342, 484], 'https://example.org/c'),
    link([40, 200, 140, 300], 'https://example.org/d'),
    link([48, 176, 100, 196], 'https://example.org/d'),
    link([40, 40, 160, 54], 'https://example.org/d'),
  ]))
  const bytes = new Uint8Array(await doc.save())
  const a = await analyzeUa(pdfjs, nodeRaster, { main: bytes, extras: [], options: {} })
  const r = await buildUa(a, { styles: a.styles, meta: { ...a.meta, isbn: '' }, alt: {}, cropToTrim: false, options: {} })
  const out = await PDFDocument.load(r.pdf, { updateMetadata: false })
  const annots = out.getPage(0).node.lookupMaybe(PDFName.of('Annots'), PDFArray)!.asArray()
  const uris = annots.map((x) => (out.context.lookup(x as never, PDFDict).lookup(PDFName.of('A'), PDFDict).lookup(PDFName.of('URI'), PDFString) as PDFString).decodeText())
  assert.deepEqual(uris.sort(), ['https://example.org/a', 'https://example.org/b', 'https://example.org/c', 'https://example.org/d', 'https://example.org/d'])
})

test('10c: a small ornament or publisher mark on a title page does not take the subtitle and author lines', () => {
  const title = line(0, 'The Book Title', 40, 240, 80, 24, 'H 24')
  const subtitle = line(0, 'A Novel of Adventure', 70, 200, 115, 9, 'H 9')
  const author = line(0, 'Rochester, Vermont', 70, 190, 150, 9, 'H 9')
  const book = pagesOf([title, subtitle, author, line(0, 'Body text of the chapter goes on past the title.', 40, 360, 300, 11, 'B 11')])
  const mark = { page: 0, box: { x0: 60, x1: 100, y0: 410, y1: 450 }, lines: [], caption: '', vector: true }
  const st = buildStructure(book, hroles, new Map([[0, [mark as never]]]))
  assert.equal(st.figures[0].lines.length, 0)
  assert.ok(st.nodes.some((n) => n.lines.some((l) => l.text === 'A Novel of Adventure') && n.tag !== 'Figure'))
})
