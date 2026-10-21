// A print PDF with real footnotes (raised number in the text, numbered small line at the foot) goes through the whole PDF → EPUB path:
// the notes become notes, the foot lines leave the page text, and EPUBCheck is clean. Built in memory, no client book needed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { text } from '../src/engine/zip.ts'
import { analyzePdf } from '../src/engine/pdfepub/analyze.ts'
import { buildPdfEpub } from '../src/engine/pdfepub/build.ts'
import { rulesFor } from '../src/engine/epub/imprint.ts'
import { nodeRaster } from './raster-node.ts'
import { epubcheck } from './epubcheck.ts'
import { setSettings, DEFAULT_SETTINGS } from '../src/engine/settings.ts'

const COVER = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))

async function bookWithFootnotes(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const serif = await doc.embedFont(StandardFonts.TimesRoman)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const W = 400, H = 600
  const words = 'Der Text dieses Kapitels erzählt von der Arbeit am Feld und von den Menschen, die dort lebten und die Geschichte des Ortes prägten'.split(' ')
  let note = 0
  for (let ch = 1; ch <= 8; ch++) {
    const p = doc.addPage([W, H])
    p.drawText(`Kapitel ${ch}`, { x: 60, y: 520, size: 24, font: bold })
    const foot: string[] = []
    for (let line = 0; line < 30; line++) {
      const y = 480 - line * 13
      const text = words.slice(line % 6, line % 6 + 9).join(' ')
      p.drawText(text, { x: 60, y, size: 11, font: serif })
      if (line === 4 || line === 12) {
        note++
        const x = 60 + serif.widthOfTextAtSize(text, 11)
        p.drawText(String(note), { x: x + 1, y: y + 4, size: 6.5, font: serif })
        foot.push(`${note} Anmerkung ${note} zum Kapitel ${ch}, mit Quelle und Seite.`)
      }
    }
    foot.forEach((t, i) => p.drawText(t, { x: 60, y: 60 - i * 10, size: 8, font: serif }))
    p.drawText(String(ch + 10), { x: 195, y: 25, size: 9, font: serif })
  }
  return doc.save()
}

test('PDF footnotes become real notes with links both ways, and the EPUB is valid', async () => {
  const data = await bookWithFootnotes()
  const book = await analyzePdf(pdfjs, data, nodeRaster)
  const r = await buildPdfEpub(book, { styles: book.styles, meta: { ...book.meta, title: 'Das Feld', authors: 'A. Autor', eisbn: '9780306406157', language: 'de-DE' }, rules: rulesFor('de'), cover: { name: 'cover.png', data: COVER } }, nodeRaster)
  const all = [...r.files].filter(([p]) => p.endsWith('.xhtml')).map(([, d]) => text(d)).join('\n')
  const refs = [...all.matchAll(/epub:type="noteref"[^>]*href="#(fn-\d+)"/g)].map((m) => m[1])
  assert.equal(refs.length, 16, 'every raised number links to its note')
  for (const id of refs) assert.match(all, new RegExp(`id="${id}"[^>]*role="doc-footnote"`))
  assert.equal([...all.matchAll(/epub:type="backlink"/g)].length, 16, 'and each note links back')
  assert.match(all, /Anmerkung 3 zum Kapitel 2, mit Quelle und Seite\./)
  assert.equal([...all.matchAll(/Anmerkung 3 zum Kapitel 2/g)].length, 1, 'the foot line is not repeated in the page text')
  const ec = epubcheck(r.epub)
  if (ec) assert.deepEqual(ec.errors, [], ec.output)
})

test('the client’s chapter-title template (tag, class, attributes) shapes the PDF build’s chapter headings too', async () => {
  const book = await analyzePdf(pdfjs, await bookWithFootnotes(), nodeRaster)
  setSettings({ ...DEFAULT_SETTINGS, markup: { 'chapter-title': { tag: 'h2', class: 'chapter-b', attrs: { 'data-kind': 'chapter' } } } })
  try {
    const r = await buildPdfEpub(book, { styles: book.styles, meta: { ...book.meta, title: 'Das Feld', authors: 'A. Autor', eisbn: '9780306406157', language: 'de-DE' }, rules: rulesFor('de'), cover: { name: 'cover.png', data: COVER } }, nodeRaster)
    const chap = [...r.files].find(([p]) => /chapter01\.xhtml$/.test(p))
    assert.ok(chap, 'a chapter file')
    assert.match(text(chap![1]), /<h2 class="chapter-b" id="chap1" data-kind="chapter">/)
    // "{style}" stands for the builder's own class, never written out literally
    setSettings({ ...DEFAULT_SETTINGS, markup: { 'chapter-title': { class: '{style} chapter-b' } } })
    const r2 = await buildPdfEpub(book, { styles: book.styles, meta: { ...book.meta, title: 'Das Feld', authors: 'A. Autor', eisbn: '9780306406157', language: 'de-DE' }, rules: rulesFor('de'), cover: { name: 'cover.png', data: COVER } }, nodeRaster)
    assert.match(text([...r2.files].find(([p]) => /chapter01\.xhtml$/.test(p))![1]), /<h1 class="ch-head1 chapter-b" id="chap1">/)
  } finally {
    setSettings(DEFAULT_SETTINGS)
  }
})

test('NOTE-05 in the PDF build: per chapter, the second chapter’s notes are 1 and 2 again, in the text and in front of the note', async () => {
  const book = await analyzePdf(pdfjs, await bookWithFootnotes(), nodeRaster)
  setSettings({ ...DEFAULT_SETTINGS, noteNumbers: 'per-chapter' })
  try {
    const r = await buildPdfEpub(book, { styles: book.styles, meta: { ...book.meta, title: 'Das Feld', authors: 'A. Autor', eisbn: '9780306406157', language: 'de-DE' }, rules: rulesFor('de'), cover: { name: 'cover.png', data: COVER } }, nodeRaster)
    const ch2 = text([...r.files].find(([p]) => /chapter02\.xhtml$/.test(p))![1])
    assert.deepEqual([...ch2.matchAll(/role="doc-noteref">([^<]+)<\/a>/g)].map((m) => m[1]), ['1', '2'])
    assert.deepEqual([...ch2.matchAll(/role="doc-backlink">([^<]+)<\/a>/g)].map((m) => m[1]), ['1', '2'])
    assert.match(ch2, /role="doc-backlink">1<\/a> Anmerkung 3 zum Kapitel 2/)
  } finally {
    setSettings(DEFAULT_SETTINGS)
  }
})
