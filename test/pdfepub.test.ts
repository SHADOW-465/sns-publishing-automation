// Regression test: rebuild Contemporary Ceramics from its print PDF and compare with the
// hand-made EPUB in Automation/WORD-to-EPUB-Automation/Output. Skipped without the samples.
// Slow (~2 min): it reads a 155 MB PDF with 285 pictures.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { unzip, text } from '../src/engine/zip.ts'
import { analyzePdf } from '../src/engine/pdfepub/analyze.ts'
import { buildPdfEpub } from '../src/engine/pdfepub/build.ts'
import { coverFromSpread } from '../src/engine/pdfepub/cover.ts'
import { rulesFor } from '../src/engine/epub/imprint.ts'
import { nodeRaster } from './raster-node.ts'
import { epubcheck } from './epubcheck.ts'
import { AUTOMATION, has, read } from './samples.ts'

const DIR = resolve(AUTOMATION, 'WORD-to-EPUB-Automation')
const pdf = resolve(DIR, 'Input/Contemporary_Ceramics_Final.pdf')
const reference = resolve(DIR, 'Output/9780719847127.epub')
// the reference uses a few different file names for the same sections
const RENAME: Record<string, string> = { 'half-title': 'halftitle', copy: 'copyright', bm1: 'bib' }

const words = (html: string) => html.replace(/^[\s\S]*?<body>|<\/body>[\s\S]*$/g, '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').toLowerCase().split(/\s+/).filter(Boolean)
function similarity(a: string[], b: string[]) {
  const count = new Map<string, number>()
  for (const w of a) count.set(w, (count.get(w) ?? 0) + 1)
  let common = 0
  for (const w of b) if ((count.get(w) ?? 0) > 0) (common++, count.set(w, count.get(w)! - 1))
  return a.length + b.length ? (2 * common) / (a.length + b.length) : 1
}
const pageIds = (files: Map<string, Uint8Array>, re: RegExp) =>
  new Set([...files].filter(([p]) => p.endsWith('.xhtml') && !p.endsWith('nav.xhtml')).flatMap(([, d]) => [...text(d).matchAll(re)].map((m) => m[1])))

test('print PDF → EPUB matches the hand-made Contemporary Ceramics EPUB', { skip: !has(pdf) && 'samples missing', timeout: 900_000 }, async () => {
  const book = await analyzePdf(pdfjs, read(pdf), nodeRaster)
  assert.equal(book.meta.title, 'Contemporary Ceramics')
  assert.equal(book.meta.authors, 'Jo Taylor')
  assert.equal(book.meta.printIsbn, '978 0 7198 4711 0')
  const review: never[] = []
  const cover = await coverFromSpread(pdfjs, read(resolve(DIR, 'Input/9780719847110_Contemporary Ceramics_FAW.pdf')), book.pages[0], nodeRaster, review, 1200)
  const r = await buildPdfEpub(book, { styles: book.styles, meta: { ...book.meta, eisbn: '9780719847127' }, rules: rulesFor('en'), cover: { name: 'cover.jpg', data: cover } }, nodeRaster)
  // pictures without a caption need a description from a person: the only error allowed here
  assert.deepEqual(r.review.filter((x) => x.level === 'error' && !/need a description/.test(x.msg)), [], 'no validation errors')

  const ref = unzip(read(reference))
  for (const [p, d] of ref) {
    const m = p.match(/^OEBPS\/([\w-]+)\.xhtml$/)
    if (!m || m[1] === 'nav' || m[1] === 'cover') continue
    const mine = r.files.get(`OEBPS/${RENAME[m[1]] ?? m[1]}.xhtml`)
    assert.ok(mine, `section ${m[1]} exists`)
    const sim = similarity(words(text(d)), words(text(mine)))
    assert.ok(sim >= 0.95, `${m[1]}: text similarity ${sim.toFixed(3)}`)
  }
  assert.deepEqual(pageIds(r.files, /id="page-(\d+)"/g), pageIds(ref, /id="pg_(\d+)"/g), 'a marker for every printed page')
  const imgs = (f: Map<string, Uint8Array>) => [...f.keys()].filter((p) => /images\/pg-/.test(p)).length
  assert.ok(imgs(r.files) >= imgs(ref), `all pictures extracted (${imgs(r.files)} vs ${imgs(ref)})`)

  const ec = epubcheck(r.epub)
  if (ec) assert.deepEqual(ec.errors, [], 'EPUBCheck reports no errors')
})
