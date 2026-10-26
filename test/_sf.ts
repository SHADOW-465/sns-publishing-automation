import { resolve } from 'node:path'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { analyzePdf } from '../src/engine/pdfepub/analyze.ts'
import { nodeRaster } from './raster-node.ts'
import { read } from './samples.ts'
const [pdf, from = '0', to = '6'] = process.argv.slice(2)
const book = await analyzePdf(pdfjs, read(resolve(pdf)), nodeRaster, {}, undefined, { splitSpreads: true })
console.log(book.meta, 'front', book.front, 'imprint', book.imprintPage)
for (const p of book.pages.slice(Number(from), Number(to))) {
  console.log(`=== page ${p.index} (printed ${book.numbers[p.index]}) imgs=${p.images.length}`)
  for (const l of p.lines) console.log(`${l.size.toFixed(1).padStart(5)} y=${l.y.toFixed(0).padStart(4)} x=${l.x0.toFixed(0).padStart(3)}-${l.x1.toFixed(0)} ${l.imprint ? 'I' : ' '} ${l.text}`)
}
