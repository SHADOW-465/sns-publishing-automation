// Command-line run of the print PDF → EPUB pipeline on any book (spreads are split).
//   node --import ./test/setup.ts test/run-pdf.ts <print.pdf> <cover.jpg|png> <outDir> [eisbn]
import { resolve } from 'node:path'
import { writeFileSync, mkdirSync } from 'node:fs'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { analyzePdf } from '../src/engine/pdfepub/analyze.ts'
import { buildPdfEpub } from '../src/engine/pdfepub/build.ts'
import { rulesFor } from '../src/engine/epub/imprint.ts'
import { nodeRaster } from './raster-node.ts'
import { read } from './samples.ts'
import { checkEpubBytes } from '../src/engine/check/epub.ts'
import { printReport } from './check-epub.ts'

const [pdf, cover, outDir = 'out', eisbn = '9780000000002'] = process.argv.slice(2)
const out = resolve(outDir)
const t = Date.now()
const book = await analyzePdf(pdfjs, read(resolve(pdf)), nodeRaster, {}, (d, n) => d % 40 === 0 && console.log(`read ${d}/${n}`), { splitSpreads: true })
console.log('META', book.meta)
for (const s of book.styles.slice(0, 40)) console.log(String(s.count).padStart(5), s.role.padEnd(15), s.key.padEnd(34), '|', s.samples[0]?.slice(0, 50))
console.log('CONTENTS', book.contents ? book.contents.entries.length + ' entries on pages ' + book.contents.pages.join(',') : 'none')
console.log('FRONT', book.front, 'imprint', book.imprintPage)
const r = await buildPdfEpub(book, { styles: book.styles, meta: { ...book.meta, eisbn }, rules: rulesFor(book.meta.language), cover: { name: 'cover.jpg', data: read(resolve(cover)) } }, nodeRaster)
mkdirSync(out, { recursive: true })
writeFileSync(resolve(out, 'book.epub'), r.epub)
for (const [p, d] of r.files) {
  mkdirSync(resolve(out, 'unzipped', p, '..'), { recursive: true })
  writeFileSync(resolve(out, 'unzipped', p), d)
}
console.log(r.sections.map((s) => `${s.file.padEnd(18)} ${s.type.padEnd(15)} ${s.nav}`).join('\n'))
for (const x of r.review) console.log(`${x.level.padEnd(5)} ${x.msg}${x.where ? `  [${x.where}]` : ''}`)
printReport(checkEpubBytes(r.epub, r.source))
console.log(`\n→ ${out}  (${((Date.now() - t) / 1000).toFixed(0)} s)`)
