// Command-line run of the InDesign → EPUB pipeline on the Cambia tu mente sample.
//   node --import ./test/setup.ts test/run-sample.ts [outDir]
// Writes the EPUB and an unzipped copy (for diffing), prints the review list.
import { resolve } from 'node:path'
import { writeFileSync, mkdirSync } from 'node:fs'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { unzip } from '../src/engine/zip.ts'
import { analyze, build } from '../src/engine/indesign/build.ts'
import { readPrintPages } from '../src/engine/pdf/pages.ts'
import { INDD, read } from './samples.ts'

const out = resolve(process.argv[2] ?? 'out')
const a = analyze(unzip(read(resolve(INDD, 'Input/88228-02 Cambia tu mente.zip'))))
const cover = unzip(read(resolve(INDD, 'Output/Cambia tu mente.epub'))).get('OEBPS/images/cover.jpg')!
const printPages = await readPrintPages(pdfjs as never, read(resolve(INDD, 'Input/88228-02 Cambia tu mente.pdf')))
const r = build(a, {
  styles: a.styles, images: a.images, printPages,
  meta: { ...a.meta, eisbn: '979-13-88228-26-1' },
  cover: { name: 'cover.jpg', data: cover },
})
mkdirSync(out, { recursive: true })
writeFileSync(resolve(out, `${a.meta.title}.epub`), r.epub)
for (const [p, d] of r.files) {
  mkdirSync(resolve(out, 'unzipped', p, '..'), { recursive: true })
  writeFileSync(resolve(out, 'unzipped', p), d)
}
console.log(r.sections.map((s) => `${s.file.padEnd(18)} ${s.type.padEnd(13)} ${s.nav}`).join('\n'))
for (const x of r.review) console.log(`${x.level.padEnd(5)} ${x.msg}${x.where ? `  [${x.where}]` : ''}`)
console.log(`\n→ ${resolve(out, `${a.meta.title}.epub`)}`)
