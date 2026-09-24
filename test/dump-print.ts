// Debug view of what the print-PDF reader sees: printed page number, blank flag, first words.
//   node --import ./test/setup.ts test/dump-print.ts print.pdf [from] [to]
import { resolve } from 'node:path'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { readPrintPages } from '../src/engine/pdf/pages.ts'
import { read } from './samples.ts'
const pages = await readPrintPages(pdfjs as never, read(resolve(process.argv[2])))
const [from = 0, to = 30] = process.argv.slice(3).map(Number)
pages.slice(from, to).forEach((p, i) => console.log(String(from + i).padStart(4), p.n.padStart(5), p.blank ? 'BLANK' : '     ', p.text.slice(0, 80)))
