// Regression test on a second InDesign book with a different house style (Penguin Random House
// México, "La cara oculta de Sheinbaum"): front matter, metadata and contents must come out right
// from the book's own pages, not from file names or one publisher's style names.
// Input lives in ../Outputs/input (not in git); skipped when absent.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { unzip, text } from '../src/engine/zip.ts'
import { analyze, build } from '../src/engine/indesign/build.ts'
import { readPrintPages } from '../src/engine/pdf/pages.ts'
import { checkEpubBytes } from '../src/engine/check/epub.ts'
import { epubcheck } from './epubcheck.ts'
import { AUTOMATION, has, read } from './samples.ts'

const DIR = resolve(AUTOMATION, '../Outputs/input')
const input = resolve(DIR, 'La cara oculta de la presidenta_Grijalbo.epub')
const pdf = resolve(DIR, 'La cara oculta de Sheinbaum INT MX.pdf')

test('La cara oculta de Sheinbaum: front matter, metadata, contents, notes, page numbers', { skip: !has(input) && 'sample missing', timeout: 600_000 }, async () => {
  const a = analyze(unzip(read(input)))
  // the InDesign title is a file name ("…presidenta_Grijalbo") and the title page is in capitals
  assert.equal(a.meta.title, 'La cara oculta de Sheinbaum')
  assert.equal(a.meta.subtitle, 'La turbia verdad detrás de la máscara')
  assert.equal(a.meta.authors, 'Elena Chávez')
  assert.equal(a.meta.publisher, 'Penguin Random House Grupo Editorial')
  assert.equal(a.meta.printIsbn, '978-607-388-024-4')

  const printPages = has(pdf) ? await readPrintPages(pdfjs as never, read(pdf)) : undefined
  const images = a.images.map((i) => ({ ...i, alt: i.alt || 'Captura de una publicación en X de Andrés Manuel López Obrador.' }))
  const r = build(a, { styles: a.styles, images, printPages, meta: { ...a.meta, eisbn: '9786073880251' }, cover: { name: 'cover.jpg', data: a.ex.images.get(a.ex.coverImage!)! } })

  assert.deepEqual(r.sections.slice(0, 7).map((s) => s.file), ['halftitle.xhtml', 'title.xhtml', 'copyright.xhtml', 'epig.xhtml', 'ded.xhtml', 'toc.xhtml', 'prol.xhtml'])
  assert.equal(r.sections.filter((s) => s.type === 'chapter').length, 20)
  assert.deepEqual(r.sections.slice(-2).map((s) => s.type), ['conclusion', 'acknowledgments'])
  // acronyms typed in lowercase small caps read as capitals in the navigation
  assert.ok(r.sections.some((s) => s.nav === '10. No hay renuncia en la UNAM'))

  const file = (f: string) => text(r.files.get(`OEBPS/${f}`)!)
  // contents: every entry has its chapter title back (the export only had "2.", "3.", …)
  const toc = [...file('toc.xhtml').matchAll(/<a href="[^"]+">([^<]+)<\/a>/g)].map((m) => m[1])
  assert.equal(toc.length, 23)
  assert.ok(toc.every((t) => !/^\d+\.?$/.test(t.trim())), toc.join(' | '))
  assert.ok(!toc.includes('de Sheinbaum'))
  // copyright page: author, publisher and address kept; print-only lines gone; e-ISBN in the print style
  const cp = file('copyright.xhtml')
  assert.match(cp, /© 2026, Elena Chávez/)
  assert.match(cp, /1er piso, colonia Granada/) // lines joined into one address
  assert.doesNotMatch(cp, /Impreso en|papel utilizado/)
  assert.match(cp, /978-607-388-025-1/)
  // title page carries title, subtitle and author
  assert.match(file('title.xhtml'), /<h1[^>]*>LA CARA OCULTA DE SHEINBAUM<\/h1>[\s\S]*La turbia verdad[\s\S]*ELENA CHÁVEZ/)
  // chapter notes are linked both ways
  const ch1 = file('chapter01.xhtml')
  assert.match(ch1, /<a epub:type="noteref" href="#chap1-n1" id="chap1-r1" role="doc-noteref">1<\/a>/)
  assert.match(ch1, /id="chap1-n1"><a epub:type="backlink" href="#chap1-r1"/)

  // body styles keep the alignment of their own definition; the epigraph's local "align right"
  // stays on the epigraph (it once leaked onto every paragraph of the style)
  const css = file('css/style.css')
  assert.match(css, /p\.TXT-SIN-SANGRIA \{ text-align: justify;/)
  assert.match(file('epig.xhtml'), /class="TXT-SIN-SANGRIA TXT-SIN-SANGRIA_\d"/)
  assert.match(css, /p\.TXT-SIN-SANGRIA_\d \{ text-align: right;/)
  assert.deepEqual(r.review.filter((x) => /alignment/.test(x.msg)), [])

  const report = checkEpubBytes(r.epub, r.source)
  const problems = report.groups.flatMap((g) => g.findings).filter((f) => f.level !== 'pass')
  assert.deepEqual(problems, [], 'built-in check is clean')
  assert.ok(report.stats.pages >= 190, `${report.stats.pages} page markers`)
  const ec = epubcheck(r.epub)
  if (ec) assert.deepEqual(ec.errors, [], 'EPUBCheck reports no errors')
})
