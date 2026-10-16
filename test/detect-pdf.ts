// PDF detection numbers: style roles, contents entries, front pages, notes found, for the reference print PDFs.
//   node --import ./test/setup.ts test/detect-pdf.ts <out.json>
import { resolve } from 'node:path'
import { existsSync, writeFileSync } from 'node:fs'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { analyzePdf } from '../src/engine/pdfepub/analyze.ts'
import { nodeRaster } from './raster-node.ts'
import { AUTOMATION, INDD, read } from './samples.ts'

const C = resolve(import.meta.dirname, '../../corrections')
const books = [
  { name: 'Tempelhofer print', pdf: resolve(C, 'Weigel_Tempelhofer_Feld_Inhalt_print_83fe21e0-beb6-458a-a56b-d5f74054d93d.pdf'), spreads: false },
  { name: 'Cambia print', pdf: resolve(INDD, 'Input/88228-02 Cambia tu mente.pdf'), spreads: false },
  { name: 'Ceramics', pdf: resolve(AUTOMATION, 'WORD-to-EPUB-Automation/Input/Contemporary_Ceramics_Final.pdf'), spreads: false },
]
const out: Record<string, unknown> = {}
for (const b of books) {
  if (!existsSync(b.pdf)) continue
  const book = await analyzePdf(pdfjs, read(b.pdf), nodeRaster, {}, undefined, { splitSpreads: true })
  out[b.name] = {
    pages: book.pages.length, contentsEntries: book.contents?.entries.length ?? 0, front: book.front.length, imprintPage: book.imprintPage,
    roles: Object.fromEntries(book.styles.map((s) => [s.key, `${s.role} (${s.count}x${(s as { confidence?: number }).confidence !== undefined ? `, ${(s as { confidence?: number }).confidence}` : ''}${s.unsure ? ', unsure' : ''})`])),
    notes: (book as { notes?: unknown }).notes ?? 'not detected',
  }
}
writeFileSync(resolve(process.argv[2] ?? 'detect-pdf.json'), JSON.stringify(out, null, 1))
console.log(JSON.stringify(out, (k, v) => (k === 'roles' ? Object.keys(v).length + ' styles' : v), 1))
