// Nov 3 client book (Sistemas Partidários, PDF flow): a chapter opener with the number, a two-line title set in the number's face, and an
// unnumbered subtitle in the same face as the numbered subheads ("1.1 …"). The subtitle joins the chapter (nav "1. Title: Subtitle"); the
// title's second line and the subtitle never open chapters of their own; numbered subheads stay subheads; "8." alone opens a chapter.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { text } from '../src/engine/zip.ts'
import { analyzePdf } from '../src/engine/pdfepub/analyze.ts'
import { buildPdfEpub } from '../src/engine/pdfepub/build.ts'
import { rulesFor } from '../src/engine/epub/imprint.ts'
import { nodeRaster } from './raster-node.ts'
import { setSettings, DEFAULT_SETTINGS } from '../src/engine/settings.ts'

const COVER = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))
const words = 'O texto deste capítulo fala do trabalho no campo e das pessoas que ali viveram e marcaram a história do lugar'.split(' ')

async function book(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const serif = await doc.embedFont(StandardFonts.TimesRoman)
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold)
  const W = 400, H = 600
  const chapters: [string, string[], string][] = [
    ['1.', ['Estudo dos sistemas', 'partidários'], 'Definição e abordagens'],
    ['2.', ['Mudança dos sistemas', 'partidários'], 'Abordagem estrutural'],
    ['3.', ['Fatores da mudança'], ''],
  ]
  let folio = 11
  for (const [k, [num, title, sub]] of chapters.entries()) {
    const p = doc.addPage([W, H])
    let y = 520
    p.drawText(num, { x: 60, y, size: 24, font: bold })
    for (const t of title) p.drawText(t, { x: 60, y: (y -= 28), size: 24, font: bold })
    if (sub) p.drawText(sub, { x: 60, y: (y -= 30), size: 14, font: bold })
    y -= 40
    for (let s = 1; s <= 3; s++) {
      p.drawText(`${k + 1}.${s} Secção número ${s}`, { x: 60, y, size: 14, font: bold })
      y -= 22
      for (let line = 0; line < 7; line++, y -= 13) p.drawText(words.slice(line % 6, line % 6 + 9).join(' '), { x: 60, y, size: 11, font: serif })
      y -= 10
    }
    p.drawText(String(folio++), { x: 195, y: 25, size: 9, font: serif })
  }
  return doc.save()
}

test('chapter opener: wrapped title, subtitle in the subhead face, numbered subheads kept', async () => {
  setSettings(DEFAULT_SETTINGS)
  const b = await analyzePdf(pdfjs, await book(), nodeRaster)
  const r = await buildPdfEpub(b, { styles: b.styles, meta: { ...b.meta, title: 'Sistemas', authors: 'A. Autora', eisbn: '9780306406157', language: 'pt-PT' }, rules: rulesFor('pt'), cover: { name: 'cover.png', data: COVER } }, nodeRaster)
  const chapters = [...r.files.keys()].filter((p) => /chapter\d+\.xhtml$/.test(p)).sort()
  assert.equal(chapters.length, 3, chapters.join(' '))
  const nav = text(r.files.get('OEBPS/nav.xhtml')!).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
  assert.match(nav, /1\. Estudo dos sistemas partidários: Definição e abordagens/)
  assert.match(nav, /2\. Mudança dos sistemas partidários: Abordagem estrutural/)
  assert.doesNotMatch(nav, /1\.: /)
  const ch1 = text(r.files.get(chapters[0])!)
  assert.match(ch1, /<p class="ch-subtitle" role="doc-subtitle">[^<]*(?:<[^>]+>)*Definição e abordagens/)
  assert.match(ch1, /<h2\b[^>]*>(?:<[^>]+>)*\s*1\.1 Secção/)
  // chapter 3 has no subtitle: its first numbered subhead is not taken for one
  const ch3 = text(r.files.get(chapters[2])!)
  assert.doesNotMatch(ch3, /ch-subtitle/)
  assert.match(ch3, /<h2\b[^>]*>(?:<[^>]+>)*\s*3\.1 Secção/)
})
