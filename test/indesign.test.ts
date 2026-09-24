// Regression test: rebuild the Cambia tu mente sample and compare with the hand-finished EPUB
// in Automation/Indesin-to-EPUB-Automation/Output. Skipped when the samples are not present.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { unzip, text } from '../src/engine/zip.ts'
import { analyze, build } from '../src/engine/indesign/build.ts'
import { readPrintPages } from '../src/engine/pdf/pages.ts'
import { INDD, has, read } from './samples.ts'
import { epubcheck } from './epubcheck.ts'

const input = resolve(INDD, 'Input/88228-02 Cambia tu mente.zip')
const reference = resolve(INDD, 'Output/Cambia tu mente.epub')

const words = (html: string) =>
  html.replace(/^[\s\S]*?<body>|<\/body>[\s\S]*$/g, '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ')
    .toLocaleLowerCase().split(/\s+/).filter(Boolean)
/** multiset word overlap, 1 = same words */
function similarity(a: string[], b: string[]) {
  const count = new Map<string, number>()
  for (const w of a) count.set(w, (count.get(w) ?? 0) + 1)
  let common = 0
  for (const w of b) if ((count.get(w) ?? 0) > 0) (common++, count.set(w, count.get(w)! - 1))
  return a.length + b.length ? (2 * common) / (a.length + b.length) : 1
}
const pages = (files: Map<string, Uint8Array>) =>
  [...files].filter(([p]) => p.endsWith('.xhtml') && !p.endsWith('nav.xhtml'))
    .flatMap(([, d]) => [...text(d).matchAll(/id="page-(\d+)"/g)].map((m) => Number(m[1]))).sort((a, b) => a - b)

test('InDesign export → house EPUB matches the hand-finished reference', { skip: !has(input) && 'samples missing' }, async () => {
  const a = analyze(unzip(read(input)))
  assert.equal(a.meta.title, 'Cambia tu mente')
  assert.equal(a.meta.authors, 'RJ Spina')
  assert.equal(a.meta.printIsbn, '979-13-88228-02-5')
  const ref = unzip(read(reference))
  const printPages = await readPrintPages(pdfjs as never, read(resolve(INDD, 'Input/88228-02 Cambia tu mente.pdf')))
  const r = build(a, {
    styles: a.styles, images: a.images, printPages,
    meta: { ...a.meta, eisbn: '979-13-88228-26-1' },
    cover: { name: 'cover.jpg', data: ref.get('OEBPS/images/cover.jpg')! },
  })

  assert.deepEqual(r.review.filter((x) => x.level === 'error'), [], 'no validation errors')
  const refDocs = [...ref.keys()].filter((p) => /OEBPS\/\w+\.xhtml$/.test(p) && !p.endsWith('nav.xhtml')).sort()
  const genDocs = [...r.files.keys()].filter((p) => /OEBPS\/\w+\.xhtml$/.test(p) && !p.endsWith('nav.xhtml')).sort()
  assert.deepEqual(genDocs, refDocs, 'same content documents')
  for (const p of refDocs) {
    const sim = similarity(words(text(ref.get(p)!)), words(text(r.files.get(p)!)))
    assert.ok(sim >= 0.97, `${p}: text similarity ${sim.toFixed(3)}`)
  }
  assert.deepEqual(pages(r.files), pages(ref), 'same page markers')
  const notes = (f: Map<string, Uint8Array>) => [...f.values()].map(text).join('').match(/epub:type="footnote"/g)?.length
  assert.equal(notes(r.files), notes(ref), 'same number of footnotes')

  const ec = epubcheck(r.epub)
  if (ec) assert.deepEqual(ec.errors, [], 'EPUBCheck reports no errors')
  else console.log('EPUBCheck not installed in tools/: skipped')
})
