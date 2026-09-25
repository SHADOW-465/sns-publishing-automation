// Visual comparison from the command line: paragraph alignment in an EPUB vs the print PDF.
//   node --import ./test/setup.ts test/check-look.ts book.epub print.pdf
import { resolve } from 'node:path'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { unzip } from '../src/engine/zip.ts'
import { readPrintPages } from '../src/engine/pdf/pages.ts'
import { compareLook } from '../src/engine/check/look.ts'
import { read } from './samples.ts'

const [epub, pdf] = process.argv.slice(2)
const pages = await readPrintPages(pdfjs as never, read(resolve(pdf)))
const r = compareLook(unzip(read(resolve(epub))), pages)
console.log(`${r.checked} paragraphs compared, ${r.findings.length} differ`)
for (const f of r.findings.slice(0, 40)) console.log(`p.${f.page.padEnd(4)} ${f.file.padEnd(16)} e-book ${f.ebook.padEnd(7)} print ${f.print.padEnd(7)} ${f.text}`)
