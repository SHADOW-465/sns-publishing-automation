// Batch 3C: Word page markers, small caps, superscripts and links; PDF run-level small caps and raised digits.
// Synthetic fixtures only. No client file is read.
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { zipSync, strToU8 } from 'fflate'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { text, bytes } from '../src/engine/zip.ts'
import { readWordBook, stampPagesFromPdf, markWordSmallCaps, foldPageText } from '../src/engine/wordepub/read.ts'
import { buildWordEpub } from '../src/engine/wordepub/build.ts'
import { pageMarkGuards, smallCapsGuards, linkGuards } from '../src/engine/check/guards.ts'
import { setSettings, DEFAULT_SETTINGS } from '../src/engine/settings.ts'
import { joinRaisedLines, smallCapTokens, markSmallCapRuns, type Line, type Run } from '../src/engine/pdf/layout.ts'
import { analyzePdf } from '../src/engine/pdfepub/analyze.ts'
import { buildPdfEpub } from '../src/engine/pdfepub/build.ts'
import { rulesFor } from '../src/engine/epub/imprint.ts'
import { nodeRaster } from './raster-node.ts'
import type { BookMeta } from '../src/engine/epub/package.ts'

afterEach(() => setSettings(DEFAULT_SETTINGS))

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const COVER = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))

function docx(parts: Record<string, string>): Uint8Array {
  const files: Record<string, Uint8Array> = {}
  for (const [name, data] of Object.entries(parts)) files[name] = strToU8(data)
  return zipSync(files)
}

const p = (inner: string, pPr = '') => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${inner}</w:p>`
const run = (t: string, rPr = '') => `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${t}</w:t></w:r>`
const meta: BookMeta = {
  title: 'Prueba', subtitle: '', authors: 'Autora', publisher: 'Editorial', language: 'es-ES',
  eisbn: '9780306406157', printIsbn: '', rights: '', certifiedBy: '', conformsTo: '',
}

const styles = `<?xml version="1.0"?><w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:lang w:val="es-ES"/></w:rPr></w:rPrDefault></w:docDefaults>
  <w:style w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style></w:styles>`

function manuscript(): Uint8Array {
  const body = `<?xml version="1.0"?>
<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>
  ${p(run('Capítulo uno'), '<w:pStyle w:val="Heading1"/>')}
  ${p(`<w:bookmarkStart w:id="0" w:name="_GoBack"/><w:bookmarkStart w:id="1" w:name="sec1"/>${run('Véase ')}<w:hyperlink w:anchor="sec1">${run('esta sección')}</w:hyperlink>${run(' y ')}<w:hyperlink r:id="rId9">${run('el sitio')}</w:hyperlink>${run(' o www.example.org/a y ana@example.com.')}`)}
  ${p(`${run('adi', '<w:smallCaps/>')}${run(' y ')}${run('uaem', '<w:caps/>')}${run(' base', '<w:vertAlign w:val="baseline"/>')}${run('2', '<w:vertAlign w:val="superscript"/>')}${run('i', '<w:vertAlign w:val="subscript"/>')}${run(' ruido', '<w:position w:val="4"/>')}`)}
  <w:tbl><w:tr><w:tc>${p(`${run('celda ')}<w:r><w:br w:type="page"/></w:r>${run('sigue')}`)}</w:tc></w:tr></w:tbl>
</w:body></w:document>`
  const rels = `<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/path" TargetMode="External"/>
</Relationships>`
  return docx({ 'word/document.xml': body, 'word/styles.xml': styles, 'word/_rels/document.xml.rels': rels })
}

test('Word keeps a page break inside a table, small caps, scripts and links', () => {
  const book = readWordBook(manuscript())
  const built = buildWordEpub(book, { meta, cover: { name: 'cover.png', data: COVER } })
  const html = [...built.files].filter(([path]) => path.endsWith('.xhtml')).map(([, d]) => text(d)).join('\n')
  assert.match(html, /<td>[^<]*celda <span[^>]*id="page-1"[^>]*\/>sigue/)
  assert.match(html, /<span class="small-caps">ADI<\/span>/)
  assert.match(html, /<span class="small-caps">UAEM<\/span>/)
  assert.match(html, /base<sup>2<\/sup><sub>i<\/sub>/)
  assert.doesNotMatch(html, /<sup>[^<]*ruido/)
  assert.match(html, /<a href="#sec1">esta sección<\/a>/)
  assert.match(html, /<span id="sec1"\/>/)
  assert.match(html, /<a href="https:\/\/example.com\/path">el sitio<\/a>/)
  assert.match(html, /<a href="https:\/\/www\.example\.org\/a">www\.example\.org\/a<\/a>/)
  assert.match(html, /<a href="mailto:ana@example\.com">ana@example\.com<\/a>/)
  assert.doesNotMatch(html, /_GoBack/)
  assert.equal(built.review.filter((r) => r.msg.startsWith('TXT-007:') || r.msg.startsWith('LNK-001:')).length, 0)
})

test('Word pages and small caps come from the companion PDF when the manuscript has neither', () => {
  const sentence = 'the quick brown fox jumps over the lazy dog near the river bank today'
  const second = 'public policy in the valley starts inside this table cell and continues onward'
  const body = `<?xml version="1.0"?>
<w:document xmlns:w="${W}"><w:body>
  ${p(run('Capítulo uno'), '<w:pStyle w:val="Heading1"/>')}
  ${p(run(sentence + ' and then the chapter goes on with ordinary words.'))}
  <w:tbl><w:tr><w:tc>${p(run('see uaemex and ' + second))}</w:tc></w:tr></w:tbl>
</w:body></w:document>`
  const book = readWordBook(docx({ 'word/document.xml': body, 'word/styles.xml': styles }))
  assert.equal(book.blocks.some((b) => 'inlines' in b && b.inlines.some((i) => i.t === 'page')), false)
  const pages = [
    { n: '40', text: `${'12 34 56 78 90 '.repeat(30)}${sentence} extra words that belong to the printed page and are not in the word file` },
    { n: '42', text: 'intro words that are skipped ' + second + ' and the rest of the printed page follows here' },
  ]
  assert.equal(stampPagesFromPdf(book, pages), 2)
  const fit = (s: string) => (s + ' '.repeat(48)).slice(0, 48)
  const zebra = fit('zebra phrase appears again at the end of book')
  const early = fit('alpha sentence is here in the chapter and')
  assert.equal(zebra.length, 48)
  assert.equal(early.length, 48)
  const ahead = readWordBook(docx({
    'word/document.xml': `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>${p(run(early + ' with ordinary words. ' + 'padding words '.repeat(30) + zebra))}</w:body></w:document>`,
    'word/styles.xml': styles,
  }))
  assert.equal(stampPagesFromPdf(ahead, [{ n: '7', text: `${zebra} ${early} with ordinary words and the printed page goes on from here` }]), 1)
  const afterMark = ahead.blocks.flatMap((b) => 'inlines' in b ? b.inlines : []).map((i) => i.t === 'page' ? '|7|' : i.text).join('')
  assert.ok(afterMark.indexOf('|7|') < 20, afterMark.slice(0, 80))
  assert.ok(afterMark.indexOf('|7|') < afterMark.indexOf('zebra'))
  assert.equal(stampPagesFromPdf(book, pages), 0, 'a second pass does not add markers')
  assert.equal(markWordSmallCaps(book, ['uaem', 'adi']), 0, 'uaem does not match inside uaemex')
  const marked = markWordSmallCaps(book, ['policy'])
  assert.equal(marked, 1)
  assert.equal(markWordSmallCaps(book, ['policy']), 0)
  const built = buildWordEpub(book, { meta, cover: { name: 'cover.png', data: COVER } })
  const html = [...built.files].filter(([path]) => path.endsWith('.xhtml')).map(([, d]) => text(d)).join('\n')
  assert.match(html, /id="page-40"/)
  assert.match(html, /<td>[\s\S]*id="page-42"/)
  assert.match(html, /<span class="small-caps">POLICY<\/span>/)
  assert.doesNotMatch(html, /STD-08/)
  assert.equal(foldPageText('interguberna-mentales'), 'intergubernamentales')

  setSettings({ ...DEFAULT_SETTINGS, wordPagesFromPdf: false })
  const fresh = readWordBook(docx({ 'word/document.xml': body, 'word/styles.xml': styles }))
  assert.equal(stampPagesFromPdf(fresh, pages), 0)
})

test('STD-08, TXT-007 and LNK-001 fire on the missing markup', () => {
  const empty = new Map([['OEBPS/c.xhtml', bytes('<p>See www.example.org and ana@example.com.</p>')]])
  assert.match(pageMarkGuards(empty, 4)[0].msg, /^STD-08:/)
  assert.match(smallCapsGuards(empty, 2)[0].msg, /^TXT-007:/)
  assert.match(linkGuards(empty)[0].msg, /^LNK-001:/)
  const ok = new Map([['OEBPS/c.xhtml', bytes('<p id="page-1">See <a href="https://www.example.org">www.example.org</a> <span class="small-caps">ADI</span></p>')]])
  assert.deepEqual(pageMarkGuards(ok, 1), [])
  assert.deepEqual(smallCapsGuards(ok, 1), [])
  assert.deepEqual(linkGuards(ok), [])
  const half = new Map([['OEBPS/c.xhtml', bytes('<p id="page-1">one</p>')]])
  assert.match(pageMarkGuards(half, 6)[0].msg, /^STD-08:/)
  setSettings({ ...DEFAULT_SETTINGS, stdPageMarks: 'none' })
  assert.deepEqual(pageMarkGuards(empty, 6), [])
})

function line(text: string, x0: number, x1: number, base: number, size: number): Line {
  const run: Run = { text, x0, x1, font: 'F', size, bold: false, italic: false, base }
  return { runs: [run], x0, x1, y: base - size, base, size, font: 'F', text, marker: false }
}

test('a raised digit joins its line; a list number at the margin stays a line', () => {
  const host = line('See note', 50, 120, 100, 11)
  const digit = line('1', 122, 128, 94, 6)
  const joined = joinRaisedLines([host, digit])
  assert.equal(joined.length, 1)
  assert.equal(joined[0].runs.some((r) => r.sup && r.text === '1'), true)
  const item = line('The entry continues here', 60, 220, 100, 11)
  const margin = line('2', 40, 48, 94, 6)
  const kept = joinRaisedLines([item, margin])
  assert.equal(kept.length, 2)
})

test('small-cap tokens are wide lowercase words, and the EPUB span uppercases them', async () => {
  const tokens = smallCapTokens([
    { text: 'politicas publicas en el valle', avg: 385 },
    { text: 'uaem', avg: 603 },
    { text: 'no.uaemex.mx', avg: 550 },
    { text: 'otra linea de cuerpo bastante larga', avg: 390 },
    { text: 'cnp', avg: 566 },
    { text: 'q). ', avg: 470 },
    { text: 'y el resto del parrafo sigue aqui abajo', avg: 388 },
    { text: 'abc', avg: 558 },
    { text: 'ufabc', avg: 556 },
    { text: 'SOBRE LOS AUTORES', avg: 598 },
    { text: 'Andrea Ahtziri Escobar Hernandez', avg: 529 },
  ])
  assert.deepEqual(tokens.sort(), ['abc', 'cnpq', 'uaem', 'ufabc'])
  const lines = [line('see uaemex and uaem today', 40, 200, 100, 11)]
  markSmallCapRuns(lines, ['uaem'])
  assert.deepEqual(lines[0].runs.filter((r) => r.sc).map((r) => r.text), ['uaem'])
  const host = [line('círculo am and www.am.com today', 40, 240, 100, 11)]
  markSmallCapRuns(host, ['am'])
  assert.deepEqual(host[0].runs.filter((r) => r.sc).map((r) => r.text), ['am'])

  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage([420, 600])
  page.drawText('Chapter One', { x: 50, y: 560, size: 22, font })
  page.drawText('The institute uaem publishes the report on public policy in the valley.', { x: 40, y: 500, size: 11, font })
  page.drawText('A second sentence keeps this page as body text rather than a title page.', { x: 40, y: 478, size: 11, font })
  const width = font.widthOfTextAtSize('See the note', 11)
  page.drawText('See the note', { x: 40, y: 440, size: 11, font })
  page.drawText('1', { x: 42 + width, y: 446, size: 6, font })
  const data = new Uint8Array(await doc.save())
  const book = await analyzePdf(pdfjs, data, nodeRaster)
  book.pages[0].scTokens = ['uaem']
  const built = await buildPdfEpub(book, {
    styles: book.styles,
    meta: { ...book.meta, title: 'Caps', authors: 'A. Writer', eisbn: '9780306406157', language: 'es-ES' },
    rules: rulesFor('es'),
    cover: { name: 'cover.png', data: COVER },
  }, nodeRaster)
  const html = [...built.files].filter(([path]) => path.endsWith('.xhtml')).map(([, d]) => text(d)).join('\n')
  assert.match(html, /<span class="small-caps">UAEM<\/span>/)
  assert.match(html, /<sup>1<\/sup>/)
  assert.equal(built.review.filter((r) => r.msg.startsWith('TXT-007:')).length, 0)
  const css = built.files.get('OEBPS/css/style.css')
  assert.ok(css)
  assert.match(text(css), /span\.small-caps/)
})
