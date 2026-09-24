// The built-in quality check from the command line.
//   node --import ./test/setup.ts test/check-epub.ts book.epub [print.pdf]
import { resolve } from 'node:path'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { checkEpubBytes, type CheckReport } from '../src/engine/check/epub.ts'
import { readPrintPages } from '../src/engine/pdf/pages.ts'
import { read } from './samples.ts'

export function printReport(r: CheckReport) {
  console.log(`\nCHECK: ${r.errors} to fix, ${r.warnings} to check · ${JSON.stringify(r.stats)}`)
  for (const g of r.groups) {
    console.log(`  ${g.title}`)
    for (const f of g.findings) console.log(`    ${f.level === 'error' ? 'FIX ' : f.level === 'warn' ? 'CHK ' : 'ok  '} ${f.msg}${f.where ? `  [${f.where}]` : ''}`)
  }
}

if (process.argv[1]?.endsWith('check-epub.ts')) {
  const [epub, pdf] = process.argv.slice(2)
  const printPages = pdf ? (await readPrintPages(pdfjs as never, read(resolve(pdf)))).filter((p) => !p.blank).map((p) => p.n) : undefined
  printReport(checkEpubBytes(read(resolve(epub)), { printPages }))
}
