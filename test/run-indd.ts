// Command-line run of InDesign → EPUB on any export, followed by the built-in quality check.
//   node --import ./test/setup.ts test/run-indd.ts <export.zip|.epub> [print.pdf] [cover.jpg|png] [outDir] [eisbn]
// Prints the style profile, sections, conversion notes and check report; writes the EPUB and an unzipped copy.
import { resolve, basename } from 'node:path'
import { writeFileSync, mkdirSync } from 'node:fs'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { unzip } from '../src/engine/zip.ts'
import { analyze, build, usePdfPictures } from '../src/engine/indesign/build.ts'
import { readPrintPages } from '../src/engine/pdf/pages.ts'
import { checkEpubBytes } from '../src/engine/check/epub.ts'
import { altTally } from '../src/engine/epub/alt.ts'
import { printReport } from './check-epub.ts'
import { read } from './samples.ts'
import { readPdfPictures, exportPictures } from '../src/engine/indesign/pdfpictures.ts'
import { nodeRaster } from './raster-node.ts'
import { openSpec, applySpec, applyBookDetailsToSpec } from '../src/engine/spec/session.ts'
import { readRequirements } from '../src/engine/spec/requirements.ts'
import { DEFAULT_SETTINGS } from '../src/engine/settings.ts'
import { gatedWrite } from './gate-run.ts'

const [src, pdf, coverPath, outDir = 'out', eisbn = ''] = process.argv.slice(2)
const out = resolve(outDir)
const t0 = Date.now()
const a = analyze(unzip(read(resolve(src))), {}, [], (stage) => console.log(`STAGE ${stage}  +${Date.now() - t0} ms`))
console.log('META', a.meta)
for (const s of a.styles) console.log(String(s.count).padStart(5), s.role.padEnd(14), s.key.padEnd(34), '|', s.samples[0]?.slice(0, 60))
const printPages = pdf ? await readPrintPages(pdfjs as never, read(resolve(pdf))) : undefined
// the package may lack pictures: take them from the print PDF (and count them there for the quality check)
if (pdf && (exportPictures(a.ex).length || process.env.COUNT_PICTURES)) {
  const t0 = Date.now()
  const pics = await readPdfPictures(pdfjs, read(resolve(pdf)), nodeRaster, printPages)
  const left = usePdfPictures(a, pics)
  console.log(`PDF PICTURES ${pics.length} read in ${Date.now() - t0} ms; not paired: ${left.length}`)
}
const cover = coverPath ? { name: basename(coverPath), data: read(resolve(coverPath)) } : undefined
// the client's own style (bundled client layer, matched on the publisher) and any house settings apply, as in the app
let spec = await openSpec({ client: a.meta.publisher, series: '', book: eisbn || a.meta.title }, DEFAULT_SETTINGS)
// BOOK_DETAILS=<Book_Details.xlsx>: the client's file plan, onto the book layer through the spec loader
if (process.env.BOOK_DETAILS) {
  const bd = readRequirements(basename(process.env.BOOK_DETAILS), read(resolve(process.env.BOOK_DETAILS))).bookDetails
  if (!bd) throw new Error(`${process.env.BOOK_DETAILS} has no NAV-NCX sheet`)
  spec = await applyBookDetailsToSpec(spec, 'book', bd, 'headless')
}
applySpec(spec)
console.log('CLIENT RULES', spec.layers.filter((l) => Object.keys(l.values).length || l.labels).map((l) => `${l.level}:${l.name} ${JSON.stringify(l.values)} ${JSON.stringify(l.labels ?? {})}`).join(' | ') || '(none)')
console.log('NOTEREF', JSON.stringify(spec.resolved.settings.markup.noteref ?? null))
const r = build(a, { styles: a.styles, images: a.images, printPages, meta: { ...a.meta, eisbn, ...(process.env.PROFILE ? { profile: process.env.PROFILE as 'standard' } : {}) }, cover })
mkdirSync(out, { recursive: true })
// the deliverable goes through the export gate (VAL-001): blocked while a fix-severity problem remains, unless overridden
await gatedWrite('epub', r.epub, resolve(out, 'book.epub'), r.review, { source: r.source, client: a.meta.publisher, book: eisbn || a.meta.title })
for (const [p, d] of r.files) {
  mkdirSync(resolve(out, 'unzipped', p, '..'), { recursive: true })
  writeFileSync(resolve(out, 'unzipped', p), d)
}
console.log(r.sections.map((s) => `${s.file.padEnd(18)} ${s.type.padEnd(13)} ${s.nav}`).join('\n'))
for (const x of r.review) console.log(`${x.level.padEnd(5)} ${x.msg}${x.where ? `  [${x.where}]` : ''}`)
console.log('ALT', altTally(a.images))
printReport(checkEpubBytes(r.epub, r.source), r.review)
