// Command-line run of InDesign → EPUB on any export, followed by the built-in quality check.
//   node --import ./test/setup.ts test/run-indd.ts <export.zip|.epub> [print.pdf] [cover.jpg|png] [outDir] [eisbn]
// Prints the style profile, sections, conversion notes and check report; writes the EPUB and an unzipped copy.
import { resolve, basename } from 'node:path'
import { writeFileSync, mkdirSync } from 'node:fs'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { unzip } from '../src/engine/zip.ts'
import { analyze, build } from '../src/engine/indesign/build.ts'
import { readPrintPages } from '../src/engine/pdf/pages.ts'
import { checkEpubBytes } from '../src/engine/check/epub.ts'
import { printReport } from './check-epub.ts'
import { read } from './samples.ts'

const [src, pdf, coverPath, outDir = 'out', eisbn = ''] = process.argv.slice(2)
const out = resolve(outDir)
const a = analyze(unzip(read(resolve(src))))
console.log('META', a.meta)
for (const s of a.styles) console.log(String(s.count).padStart(5), s.role.padEnd(14), s.key.padEnd(34), '|', s.samples[0]?.slice(0, 60))
const printPages = pdf ? await readPrintPages(pdfjs as never, read(resolve(pdf))) : undefined
const cover = coverPath ? { name: basename(coverPath), data: read(resolve(coverPath)) } : undefined
const r = build(a, { styles: a.styles, images: a.images, printPages, meta: { ...a.meta, eisbn }, cover })
mkdirSync(out, { recursive: true })
writeFileSync(resolve(out, 'book.epub'), r.epub)
for (const [p, d] of r.files) {
  mkdirSync(resolve(out, 'unzipped', p, '..'), { recursive: true })
  writeFileSync(resolve(out, 'unzipped', p), d)
}
console.log(r.sections.map((s) => `${s.file.padEnd(18)} ${s.type.padEnd(13)} ${s.nav}`).join('\n'))
for (const x of r.review) console.log(`${x.level.padEnd(5)} ${x.msg}${x.where ? `  [${x.where}]` : ''}`)
printReport(checkEpubBytes(r.epub, r.source))
