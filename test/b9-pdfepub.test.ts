// Print PDF → EPUB, the Birmingham list (B9 items 1–9), each on a small book built in memory: front matter and metadata, the © sign,
// captions, verse and extracts, page markers in order, pictures at paragraph breaks, the contents heading, cover text.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PDFDocument, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { text } from '../src/engine/zip.ts'
import { analyzePdf } from '../src/engine/pdfepub/analyze.ts'
import { buildPdfEpub } from '../src/engine/pdfepub/build.ts'
import { readFront } from '../src/engine/pdfepub/front.ts'
import { fontFamilyOf } from '../src/engine/pdfepub/align.ts'
import { transformImprint } from '../src/engine/epub/imprint.ts'
import { plausibleAuthor } from '../src/engine/epub/names.ts'
import { rulesFor } from '../src/engine/epub/imprint.ts'
import { nodeRaster } from './raster-node.ts'
import { setSettings, DEFAULT_SETTINGS } from '../src/engine/settings.ts'

const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))
const W = 400
const H = 600
const WORDS = 'the old road ran past the mill and down to the river where the carts waited for the tide and the men talked of weather and prices and the long winter ahead'.split(' ')

interface Opts {
  /** the print wording of the copyright line ("c" is what a font without a © glyph map prints) */
  copyright?: string
  halfTitle?: boolean
  /** a short chapter's running head sits on pages that follow a captioned picture */
  runningHead?: string
  /** a page of nothing but a picture and its caption in the middle of the introduction, and one with only a picture */
  plates?: boolean
}

/** Draw `n` words of text as lines of one measure (x 60..340) from `top` (top-down), the first line indented; returns the next top. */
function flow(page: PDFPage, font: PDFFont, n: number, top: number, o: { size?: number; indent?: number; x?: number; width?: number; seed?: number } = {}): { y: number; lines: string[] } {
  const size = o.size ?? 11
  const x = o.x ?? 60
  const width = o.width ?? 280
  let line = ''
  let first = true
  let y = top
  const lines: string[] = []
  const put = () => {
    page.drawText(line, { x: x + (first ? o.indent ?? 12 : 0), y: H - y, size, font })
    lines.push(line)
    first = false
    y += 13
    line = ''
  }
  for (let i = 0; i < n; i++) {
    const w = WORDS[((o.seed ?? 0) + i) % WORDS.length]
    const next = line ? `${line} ${w}` : w
    if (font.widthOfTextAtSize(next, size) > width - (first ? o.indent ?? 12 : 0)) put()
    line = line ? `${line} ${w}` : w
  }
  if (line) put()
  return { y, lines }
}

/** The book: [half title] title page, imprint, contents, an introduction of several pages with a captioned picture, one chapter. */
export async function book(o: Opts = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const serif = await doc.embedFont(StandardFonts.TimesRoman)
  const img = await doc.embedPng(PNG)
  const centred = (p: PDFPage, t: string, size: number, top: number) => p.drawText(t, { x: (W - serif.widthOfTextAtSize(t, size)) / 2, y: H - top, size, font: serif })
  const page = () => doc.addPage([W, H])
  if (o.halfTitle) centred(page(), 'THE LONG ROAD', 30, 200)
  const t = page()
  centred(t, 'THE LONG ROAD', 44, 200)
  centred(t, 'Ada Lovelace-Stone', 22, 330) // exactly half the size of the title: the author line must still not be part of the title
  const im = page()
  const lines = ['First published 2026', 'Example Press', 'The Mill, Stroud', o.copyright ?? 'Copyright © Ada Lovelace-Stone 2026', 'The right of Ada Lovelace-Stone to be identified as the Author of this work has been asserted.', 'All rights reserved. No part of this book may be reproduced without permission.', 'British Library Cataloguing in Publication Data. A catalogue record for this book is available.', 'ISBN 978 1 4028 9462 6']
  lines.forEach((l, i) => im.drawText(l, { x: 60, y: H - 330 - i * 11, size: 8, font: serif }))
  const toc = page()
  // printed numbers are the PDF page numbers: the contents page is followed by the introduction (4 pages), then chapters 1 and 2
  const first = doc.getPageCount() + 1
  centred(toc, 'Contents', 24, 100)
  ;[['Introduction', first], ['1. The Road', first + 4 + (o.plates ? 2 : 0)], ['2. The River', first + 5 + (o.plates ? 2 : 0)]].forEach(([a, b], i) => {
    toc.drawText(String(a), { x: 60, y: H - 170 - i * 20, size: 10, font: serif })
    toc.drawText(String(b), { x: 330, y: H - 170 - i * 20, size: 10, font: serif })
  })
  // introduction, four pages; the picture sits in the middle of the last paragraph of the first, text wraps round it
  for (let k = 0; k < 4; k++) {
    const p = page()
    if (k === 0) centred(p, 'Introduction', 24, 100)
    else p.drawText(o.runningHead ?? 'Introduction', { x: 60, y: H - 50, size: 11, font: serif })
    let top = k === 0 ? 170 : 90
    for (let q = 0; q < 2; q++) top = flow(p, serif, 70, top, { seed: q * 7 + k }).y
    if (k === 0) {
      top = flow(p, serif, 24, top, { seed: 3 }).y // the start of a sentence ...
      p.drawImage(img, { x: 240, y: H - top - 90, width: 100, height: 80 })
      p.drawText('Plan of the town.', { x: 240, y: H - top - 100, size: 9, font: serif })
      p.drawText('(Courtesy of the Museum)', { x: 240, y: H - top - 111, size: 9, font: serif })
      top = flow(p, serif, 40, top, { seed: 9, x: 60, width: 170, indent: 0 }).y // ... that runs on beside the picture
      top = flow(p, serif, 20, Math.max(top, 470), { seed: 2, indent: 0 }).y
    } else top = flow(p, serif, 70, top, { seed: 5 + k }).y
    if (k === 1 && o.plates) {
      const pl = page()
      pl.drawImage(img, { x: 80, y: H - 300, width: 200, height: 150 })
      pl.drawText('A mill by the river. (Courtesy of the Museum)', { x: 80, y: H - 320, size: 9, font: serif })
      page().drawImage(img, { x: 80, y: H - 300, width: 200, height: 150 })
    }
  }
  for (const [n, name] of [['1', 'The Road'], ['2', 'The River']]) {
    const c = page()
    c.drawText(n, { x: 195, y: H - 80, size: 17, font: serif })
    centred(c, name, 24, 110)
    let top = 170
    for (let q = 0; q < 4; q++) top = flow(c, serif, 60, top, { seed: q }).y
  }
  return new Uint8Array(await doc.save())
}

const input = (b: Awaited<ReturnType<typeof analyzePdf>>, over: Partial<typeof b.meta> = {}) => ({
  styles: b.styles, meta: { ...b.meta, eisbn: '9780306406157', ...over }, rules: rulesFor('en'), cover: { name: 'cover.jpg', data: PNG },
})
const xhtml = (files: Map<string, Uint8Array>) => [...files].filter(([p]) => p.endsWith('.xhtml')).map(([, d]) => text(d)).join('\n')
const file = (files: Map<string, Uint8Array>, re: RegExp) => text([...files].find(([p]) => re.test(p))![1])

// ---- 1, 8, 9: metadata from the title page, both title pages, the cover text ---------------------------------------------------
test('1: the title is the title page type, the author the person line the imprint confirms; neither holds the other, or a printing line', async () => {
  setSettings(DEFAULT_SETTINGS)
  const b = await analyzePdf(pdfjs, await book(), nodeRaster)
  assert.equal(b.meta.title, 'The Long Road')
  assert.equal(b.meta.authors, 'Ada Lovelace-Stone')
  const r = await buildPdfEpub(b, input(b), nodeRaster)
  const opf = file(r.files, /content\.opf$/)
  assert.match(opf, /<dc:title[^>]*>The Long Road<\/dc:title>/)
  assert.match(opf, /<dc:creator[^>]*>Ada Lovelace-Stone<\/dc:creator>/)
  assert.doesNotMatch(opf, /First published/)
})

test('1: readFront takes title and author from title page, half-title and cataloguing lines, and never a printing line', () => {
  const page = (index: number, ...ls: [string, number][]) => ({ index, lines: ls.map(([t, size], i) => ({ text: t, size, y: 100 + i * 60 })) })
  const cap = (s: string) => s
  // the cataloguing record names the author when the title page does not
  const a = readFront([page(0, ['A DARK HISTORY', 44], ['Anthony Poulton-Smith', 22])], ['First published 2026', 'Poulton-Smith, Anthony, 1950–'], { title: '', author: '' }, cap)
  assert.equal(a.author, 'Anthony Poulton-Smith')
  assert.equal(a.title, 'A DARK HISTORY')
  // a PDF whose Info author is a printing line
  const b = readFront([page(0, ['Only A Title', 30])], ['Copyright © Jo Writer 2026'], { title: '', author: 'First published 2026' }, cap)
  assert.equal(b.author, 'Jo Writer')
  const c = readFront([page(0, ['Only A Title', 30])], ['First published 2026'], { title: '', author: 'First published 2026' }, cap)
  assert.equal(c.author, '')
  assert.ok(!plausibleAuthor('First published 2026') && !plausibleAuthor('Copyright © 2026') && plausibleAuthor('Anthony Poulton-Smith'))
  // title type of two sizes ("CONTEMPORARY" over "CERAMICS") is one title; the subtitle small under it is not
  const d = readFront([page(0, ['CONTEMPORARY', 60], ['CERAMICS', 100], ['Twenty Key Themes', 30], ['Jo Taylor', 30])], ['Copyright © Jo Taylor 2026'], { title: '', author: '' }, (s) => s)
  assert.equal(d.title, 'CONTEMPORARY CERAMICS')
  assert.equal(d.author, 'Jo Taylor')
  assert.equal(d.subtitle, 'Twenty Key Themes')
})

test('8: a PDF with a half-title and a full title page gives both: halftitle and title', async () => {
  const b = await analyzePdf(pdfjs, await book({ halfTitle: true }), nodeRaster)
  assert.equal(b.halfTitle, 0)
  assert.equal(b.titlePage, 1)
  const r = await buildPdfEpub(b, input(b), nodeRaster)
  const nav = file(r.files, /nav\.xhtml$/)
  assert.ok(r.files.has('OEBPS/halftitle.xhtml') && r.files.has('OEBPS/title.xhtml'), [...r.files.keys()].join(' '))
  assert.match(file(r.files, /halftitle\.xhtml$/), /epub:type="halftitlepage"/)
  assert.match(file(r.files, /\/title\.xhtml$/), /epub:type="titlepage"/)
  assert.match(nav, /epub:type="titlepage"/)
  // a title page alone stays one title page
  const one = await analyzePdf(pdfjs, await book(), nodeRaster)
  const r1 = await buildPdfEpub(one, input(one), nodeRaster)
  assert.ok(!r1.files.has('OEBPS/halftitle.xhtml') && r1.files.has('OEBPS/title.xhtml'))
})

test('9: the cover description is "Cover of <title>" when the author is not a name, and never a printing line', async () => {
  const b = await analyzePdf(pdfjs, await book(), nodeRaster)
  const bad = await buildPdfEpub(b, input(b, { authors: 'First published 2026' }), nodeRaster)
  const alt = file(bad.files, /cover\.xhtml$/).match(/<img alt="([^"]*)"/)![1]
  assert.equal(alt, 'Cover of The Long Road')
  const good = await buildPdfEpub(b, input(b), nodeRaster)
  assert.match(file(good.files, /cover\.xhtml$/), /alt="Title: The Long Road\. Author: Ada Lovelace-Stone/)
})

// ---- 2: the copyright page ---------------------------------------------------------------------------------------------------
test('2: © survives when the font prints it as "c"; a copyright line is never made from a printing line', async () => {
  const b = await analyzePdf(pdfjs, await book({ copyright: 'c 2026 Ada Lovelace-Stone' }), nodeRaster)
  const r = await buildPdfEpub(b, input(b), nodeRaster)
  const page = file(r.files, /copyright\.xhtml$/)
  assert.match(page, /© 2026 Ada Lovelace-Stone/)
  assert.doesNotMatch(page, /<p[^>]*>c 2026/)
  // the garbled line was made from the wrong author: no line is made at all
  const rules = rulesFor('en')
  const made = transformImprint([{ text: 'Example Press', html: 'Example Press', gap: false }], { eisbn: '9780306406157', rules, author: 'First published 2026', year: '2026', esc: (s) => s })
  assert.ok(!made.paras.some((p) => /First published 2026 2026|©/.test(p.html)), JSON.stringify(made.paras))
  const ok = transformImprint([{ text: 'Example Press', html: 'Example Press', gap: false }], { eisbn: '9780306406157', rules, author: 'Ada Lovelace-Stone', year: '2026', esc: (s) => s })
  assert.ok(ok.paras.some((p) => /© Ada Lovelace-Stone 2026/.test(p.html)))
})

// ---- 7: contents heading -----------------------------------------------------------------------------------------------------
test('7: the contents heading is centred and serif, as in the print', async () => {
  const b = await analyzePdf(pdfjs, await book(), nodeRaster)
  const r = await buildPdfEpub(b, input(b), nodeRaster)
  const css = file(r.files, /style\.css$/)
  const rule = css.match(/h1\.TOC-1,\s*h1\.ch-head\s*\{[^}]*\}/)![0]
  assert.match(rule, /text-align:\s*center/)
  assert.match(rule, /font-family:\s*serif/)
  assert.equal(fontFamilyOf(['SabonLTStd 24']), 'serif')
  assert.equal(fontFamilyOf(['Helvetica Bold 18']), 'sans-serif')
})

// ---- 3, 5, 6: captions, markers, pictures -----------------------------------------------------------------------------------
test('3, 5, 6: a caption is a figcaption, a running head is not part of it, markers stay in order, a picture waits for a paragraph break', async () => {
  const b = await analyzePdf(pdfjs, await book(), nodeRaster)
  const r = await buildPdfEpub(b, input(b), nodeRaster)
  const intro = file(r.files, /intro\.xhtml$/)
  assert.doesNotMatch(intro, /class="poem"/, 'lines wrapped round a picture are prose, not verse')
  assert.match(intro, /<figure[^>]*>[^]*<figcaption[^>]*>Plan of the town\. \(Courtesy of the Museum\)<\/figcaption>[^]*<\/figure>/)
  // the running head of the pages after the picture is furniture: it is in no paragraph and not in the caption
  assert.doesNotMatch(intro, /Museum\)[^<]*(<span[^>]*\/>)?\s*Introduction/)
  assert.equal((intro.replace(/<title>[^]*?<\/title>/, '').match(/>\s*Introduction\s*</g) ?? []).length, 1, 'only the heading says Introduction')
  // markers follow the page order in every file
  const all = [...r.files].filter(([p]) => /(intro|chapter\d+)\.xhtml$/.test(p)).map(([, d]) => text(d)).join('\n')
  const marks = [...all.matchAll(/epub:type="pagebreak" id="page-(\d+)"/g)].map((m) => Number(m[1]))
  assert.deepEqual(marks, [...marks].sort((a, c) => a - c))
  // the figure is between two paragraphs, never inside the words of one
  const before = intro.slice(0, intro.indexOf('<figure'))
  assert.match(before, /<\/p>\s*$/)
  for (const p of intro.match(/<p[^>]*>[^<]*(?:<(?!\/p)[^>]*>[^<]*)*<\/p>/g) ?? []) assert.doesNotMatch(p, /<figure/)
})

// ---- 4: verse and extracts ----------------------------------------------------------------------------------------------------
test('4: short lines of verse are one poem block with line breaks, an indented extract is one blockquote', async () => {
  const doc = await PDFDocument.create()
  const serif = await doc.embedFont(StandardFonts.TimesRoman)
  const page = (f: (p: PDFPage) => void) => f(doc.addPage([W, H]))
  const verse = ['Roll on, thou shallow dirty river, roll', 'Past the mill and the dark old wharf', 'Down to the sea where the grey gulls call', 'And the tide takes all we ever knew']
  page((p) => {
    p.drawText('Verse', { x: 160, y: H - 100, size: 24, font: serif })
    let top = flow(p, serif, 70, 150, { seed: 0 }).y
    verse.forEach((v, i) => p.drawText(v, { x: 60, y: H - top - 6 - i * 13, size: 11, font: serif }))
    top += 6 + verse.length * 13 + 6
    top = flow(p, serif, 70, top, { seed: 3 }).y
    // an extract: set in from the margin, together
    flow(p, serif, 45, top + 6, { x: 90, width: 250, indent: 0, seed: 5 })
  })
  for (let i = 0; i < 4; i++) page((p) => flow(p, serif, 120, 90, { seed: i }))
  const b = await analyzePdf(pdfjs, new Uint8Array(await doc.save()), nodeRaster)
  const r = await buildPdfEpub(b, input(b, { title: 'Verse', authors: 'Ada Lovelace-Stone' }), nodeRaster)
  const html = xhtml(r.files)
  const poem = html.match(/<div class="poem">[^]*?<\/div>/)?.[0] ?? ''
  assert.ok(poem, 'a poem block')
  assert.match(poem, /Roll on, thou shallow dirty river, roll<br\/>\s*Past the mill/)
  assert.match(poem, /<br\/>\s*And the tide takes all we ever knew/)
  assert.doesNotMatch(html, /<p class="indent">Past the mill/)
  assert.match(html, /<blockquote class="extract">[^]*<\/blockquote>/)
})

test('5: a page of pictures between two pages of text keeps its marker in page order, and its captioned picture stays in its chapter', async () => {
  const b = await analyzePdf(pdfjs, await book({ plates: true }), nodeRaster)
  const r = await buildPdfEpub(b, input(b), nodeRaster)
  const names = [...r.files.keys()].filter((p) => /(intro|chapter\d+)\.xhtml$/.test(p)).sort((a, c) => Number(/intro/.test(c)) - Number(/intro/.test(a)) || a.localeCompare(c))
  const marks = names.flatMap((n) => [...text(r.files.get(n)!).matchAll(/epub:type="pagebreak" id="page-(\d+)"/g)].map((m) => Number(m[1])))
  assert.deepEqual(marks, [...marks].sort((a, c) => a - c), marks.join(' '))
  assert.equal(new Set(marks).size, marks.length, 'no marker twice')
  const intro = file(r.files, /intro\.xhtml$/)
  assert.match(intro, /<figcaption[^>]*>A mill by the river\. \(Courtesy of the Museum\)<\/figcaption>/, 'the captioned picture page stays in the introduction')
  assert.doesNotMatch(file(r.files, /chapter01\.xhtml$/), /A mill by the river/)
  assert.deepEqual(marks.slice(0, 7), [4, 5, 6, 7, 8, 9, 10])
})

test('3: a caption set beside a picture is one figcaption even when only its last line reaches the picture', async () => {
  const doc = await PDFDocument.create()
  const serif = await doc.embedFont(StandardFonts.TimesRoman)
  const img = await doc.embedPng(PNG)
  for (let i = 0; i < 5; i++) {
    const p = doc.addPage([W, H])
    if (i === 1) {
      p.drawImage(img, { x: 190, y: H - 260, width: 150, height: 110 })
      ;['Ultraviolet therapy', 'was used to prevent', 'rickets in a hospital.', '(Courtesy of the Museum)'].forEach((t, k) => p.drawText(t, { x: 60, y: H - 200 - k * 11, size: 9, font: serif }))
      flow(p, serif, 60, 290, { seed: 1 })
      flow(p, serif, 50, 90, { seed: 4 })
    } else flow(p, serif, 130, 90, { seed: i })
  }
  const b = await analyzePdf(pdfjs, new Uint8Array(await doc.save()), nodeRaster)
  const r = await buildPdfEpub(b, input(b, { title: 'Caps', authors: 'Ada Lovelace-Stone' }), nodeRaster)
  const html = xhtml(r.files)
  assert.match(html, /<figcaption[^>]*>Ultraviolet therapy was used to prevent rickets in a hospital\. \(Courtesy of the Museum\)<\/figcaption>/)
  assert.doesNotMatch(html, /<p[^>]*>[^<]*Ultraviolet/)
})
