// Debug view of the first pages' text lines (position, size) to see how a printed contents is set.
//   node --import ./test/setup.ts test/dump-toc.ts print.pdf [from] [to]
import { resolve } from 'node:path'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { pageLayout } from '../src/engine/pdf/layout.ts'
import { read } from './samples.ts'
const doc = await (pdfjs as never as { getDocument: (o: object) => { promise: Promise<{ numPages: number; getPage: (n: number) => Promise<never> }> } }).getDocument({ data: read(resolve(process.argv[2])).slice(), disableFontFace: true, isEvalSupported: false }).promise
const [from = 1, to = 12] = process.argv.slice(3).map(Number)
for (let i = from; i <= Math.min(to, doc.numPages); i++) {
  const l = await pageLayout(pdfjs as never, await doc.getPage(i), i - 1)
  console.log(`--- page ${i} (${Math.round(l.width)}x${Math.round(l.height)})`)
  for (const x of [...l.lines].sort((a, b) => a.y - b.y || a.x0 - b.x0)) console.log(`${x.x0.toFixed(0).padStart(4)} ${x.y.toFixed(0).padStart(4)} ${x.size.toFixed(1).padStart(5)}  ${x.text.slice(0, 90)}`)
}
