// Scores what the tool builds from the client's real inputs against the client's own finished files.
//   node --import ./test/setup.ts test/reference-score.ts [label] [--only=cambia,ceramics,gladiators,evers]
// Prints one table per book (a score per feature, then the differences in plain words) and writes
// docs/reference-scores/<label>.json so the numbers before and after a change can be compared.
// Needs the client's books in fixtures/reference/Automation (see docs/REFERENCE_INVENTORY.md); a missing book is skipped.
import { resolve } from 'node:path'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Files } from '../src/engine/zip.ts'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { unzip } from '../src/engine/zip.ts'
import { analyze, build } from '../src/engine/indesign/build.ts'
import { readPrintPages } from '../src/engine/pdf/pages.ts'
import { analyzePdf } from '../src/engine/pdfepub/analyze.ts'
import { buildPdfEpub } from '../src/engine/pdfepub/build.ts'
import { coverFromSpread } from '../src/engine/pdfepub/cover.ts'
import { rulesFor } from '../src/engine/epub/imprint.ts'
import { openSpec, applySpec } from '../src/engine/spec/session.ts'
import { MemoryStore, setStore } from '../src/engine/spec/store.ts'
import { DEFAULT_SETTINGS, setSettings } from '../src/engine/settings.ts'
import { scoreEpub, formatScore, type RefScore } from '../src/engine/check/refscore.ts'
import { nodeRaster } from './raster-node.ts'
import { AUTOMATION, INDD, has, read } from './samples.ts'

const args = process.argv.slice(2)
const label = args.find((a) => !a.startsWith('--')) ?? 'current'
const only = args.find((a) => a.startsWith('--only='))?.slice(7).split(',')
const want = (n: string) => !only || only.includes(n)

// SAVE=1 keeps the built files (without pictures) in scratch/built-<book>/ for looking at
const save = (name: string, files: Files) => {
  if (!process.env.SAVE) return
  for (const [p, d] of files) {
    if (/.(jpe?g|png|gif)$/i.test(p)) continue
    const to = resolve('scratch', 'built-' + name, p)
    mkdirSync(dirname(to), { recursive: true })
    writeFileSync(to, d)
  }
}
const results: Record<string, RefScore | { skipped: string }> = {}
const show = (name: string, s: RefScore) => {
  results[name] = s
  console.log(formatScore(name, s) + '\n')
}

if (want('cambia')) {
  const input = resolve(INDD, 'Input/88228-02 Cambia tu mente.zip')
  if (!has(input)) results.cambia = { skipped: 'fixtures missing' }
  else {
    const ref = unzip(read(resolve(INDD, 'Output/Cambia tu mente.epub')))
    const files = unzip(read(input))
    setStore(new MemoryStore())
    setSettings(DEFAULT_SETTINGS)
    try {
      let a = analyze(files)
      // the client's own layer (matched on the publisher) applies, as in the app
      applySpec(await openSpec({ client: a.meta.publisher, series: '', book: '979-13-88228-26-1', kind: 'accessible-epub' }, DEFAULT_SETTINGS))
      a = analyze(files)
      const printPages = await readPrintPages(pdfjs as never, read(resolve(INDD, 'Input/88228-02 Cambia tu mente.pdf')))
      const r = build(a, { styles: a.styles, images: a.images, printPages, meta: { ...a.meta, eisbn: '979-13-88228-26-1' }, cover: { name: 'cover.jpg', data: ref.get('OEBPS/images/cover.jpg')! } })
      save('cambia', r.files)
      show('Cambia tu mente (InDesign → Accessible EPUB, Arkano Books)', scoreEpub(r.files, ref))
    } finally {
      setSettings(DEFAULT_SETTINGS)
    }
  }
}

if (want('ceramics')) {
  const dir = resolve(AUTOMATION, 'WORD-to-EPUB-Automation')
  const pdf = resolve(dir, 'Input/Contemporary_Ceramics_Final.pdf')
  if (!has(pdf)) results.ceramics = { skipped: 'fixtures missing' }
  else {
    setStore(new MemoryStore())
    setSettings(DEFAULT_SETTINGS)
    try {
      const ref = unzip(read(resolve(dir, 'Output/9780719847127.epub')))
      const book = await analyzePdf(pdfjs, read(pdf), nodeRaster)
      // a Standard EPUB for The Crowood Press: the client's layer, then the Standard EPUB defaults
      applySpec(await openSpec({ client: book.meta.publisher, series: '', book: '9780719847127', kind: 'standard-epub' }, DEFAULT_SETTINGS))
      const cover = await coverFromSpread(pdfjs, read(resolve(dir, 'Input/9780719847110_Contemporary Ceramics_FAW.pdf')), book.pages[0], nodeRaster, [], 1200)
      const r = await buildPdfEpub(book, { styles: book.styles, meta: { ...book.meta, eisbn: '9780719847127', profile: 'standard' }, rules: rulesFor('en'), cover: { name: 'cover.jpg', data: cover } }, nodeRaster)
      save('ceramics', r.files)
      show('Contemporary Ceramics (print PDF → Standard EPUB, Crowood)', scoreEpub(r.files, ref))
    } finally {
      setSettings(DEFAULT_SETTINGS)
    }
  }
}

if (want('gladiators') || want('evers')) {
  // accessible PDF scores come from the PDF/UA harness when it is present
  {
    const { scorePdfUaBooks } = await import('./reference-score-pdf.ts')
    Object.assign(results, await scorePdfUaBooks(want))
  }
}

const out = resolve('docs/reference-scores')
mkdirSync(out, { recursive: true })
writeFileSync(resolve(out, `${label}.json`), JSON.stringify({ label, at: new Date().toISOString(), results }, null, 2) + '\n')
console.log(`→ docs/reference-scores/${label}.json`)
