// Command-line run of the print PDF → EPUB pipeline on the Contemporary Ceramics sample.
//   node --import ./test/setup.ts test/run-pdf-sample.ts [outDir]
import { resolve } from 'node:path'
import { writeFileSync, mkdirSync } from 'node:fs'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { analyzePdf } from '../src/engine/pdfepub/analyze.ts'
import { buildPdfEpub } from '../src/engine/pdfepub/build.ts'
import { coverFromSpread } from '../src/engine/pdfepub/cover.ts'
import { rulesFor } from '../src/engine/epub/imprint.ts'
import { nodeRaster } from './raster-node.ts'
import { AUTOMATION, read } from './samples.ts'

const DIR = resolve(AUTOMATION, 'WORD-to-EPUB-Automation/Input')
const out = resolve(process.argv[2] ?? 'out')
const t = Date.now()
const book = await analyzePdf(pdfjs, read(resolve(DIR, 'Contemporary_Ceramics_Final.pdf')), nodeRaster, {}, (d, n) => d % 20 === 0 && console.log(`read ${d}/${n} pages`))
const cover = await coverFromSpread(pdfjs, read(resolve(DIR, '9780719847110_Contemporary Ceramics_FAW.pdf')), book.pages[0], nodeRaster, [])
const r = await buildPdfEpub(book, { styles: book.styles, meta: { ...book.meta, eisbn: '978 0 7198 4712 7' }, rules: rulesFor(book.meta.language), cover: { name: 'cover.jpg', data: cover } }, nodeRaster)
mkdirSync(out, { recursive: true })
const file = resolve(out, `${book.meta.title}.epub`)
writeFileSync(file, r.epub)
for (const [p, d] of r.files) {
  mkdirSync(resolve(out, 'unzipped', p, '..'), { recursive: true })
  writeFileSync(resolve(out, 'unzipped', p), d)
}
console.log(r.sections.map((s) => `${s.file.padEnd(18)} ${s.type.padEnd(15)} ${s.nav}`).join('\n'))
for (const x of r.review) console.log(`${x.level.padEnd(5)} ${x.msg}${x.where ? `  [${x.where}]` : ''}`)
console.log(`\n→ ${file}  (${((Date.now() - t) / 1000).toFixed(0)} s)`)
