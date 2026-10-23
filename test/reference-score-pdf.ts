// Accessible-PDF half of the reference score: builds Gladiators and the German report from the client's inputs and compares
// the result with the client's finished PDFs (fixtures/reference/Automation/Accessible-PDF-Automation).
import { resolve } from 'node:path'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { analyzeUa, buildUa } from '../src/engine/pdfua/index.ts'
import { bundledUaOptions } from '../src/engine/spec/clients.ts'
import { pdfStats } from '../src/engine/check/pdfstats.ts'
import { comparePdfs, } from '../src/engine/check/refscore-pdf.ts'
import { formatScore, type RefScore } from '../src/engine/check/refscore.ts'
import { nodeRaster } from './raster-node.ts'
import { AUTOMATION, has, read } from './samples.ts'

const D = resolve(AUTOMATION, 'Accessible-PDF-Automation')

export async function scorePdfUaBooks(want: (n: string) => boolean): Promise<Record<string, RefScore | { skipped: string }>> {
  const out: Record<string, RefScore | { skipped: string }> = {}
  if (!has(D)) return { gladiators: { skipped: 'fixtures missing' }, evers: { skipped: 'fixtures missing' } }
  if (want('gladiators')) {
    const S = resolve(D, 'Simple')
    const a = await analyzeUa(pdfjs, nodeRaster, {
      main: read(resolve(S, 'Input/Gladiators in the Greek World.pdf')),
      extras: [read(resolve(S, 'Input/Gladiators in the Greek World_Plates.pdf'))],
      cover: { data: read(resolve(S, 'Input/cover.jpg')), png: false },
      altDocx: read(resolve(S, 'Input/Gladiators in the Greek World alt text.docx')),
    })
    const alt = Object.fromEntries(a.figures.map((f) => [f.key, f.alt]))
    const r = await buildUa(a, { styles: a.styles, meta: { ...a.meta, isbn: '9781036130527' }, alt, cropToTrim: true, sourceName: 'Gladiators in the Greek World.pdf', options: bundledUaOptions(a.book.meta.publisher) })
    const s = comparePdfs(await pdfStats(r.pdf), await pdfStats(read(resolve(S, 'Output/Gladiators in the Greek World_9781036130527.pdf'))))
    console.log(formatScore('Gladiators in the Greek World (print PDF → Accessible PDF)', s) + '\n')
    out.gladiators = s
  }
  if (want('evers')) {
    const M = resolve(D, 'Medium')
    const a = await analyzeUa(pdfjs, nodeRaster, { main: read(resolve(M, 'Input/DD_Evers-Woelk_2124-6.pdf')), extras: [], altDocx: read(resolve(M, 'Input/AltTexte MEW.docx')) })
    const alt = Object.fromEntries(a.figures.map((f) => [f.key, f.alt]))
    const r = await buildUa(a, { styles: a.styles, meta: a.meta, alt, cropToTrim: true, sourceName: 'DD_Evers-Woelk_2124-6.pdf', options: bundledUaOptions(a.book.meta.publisher) })
    const s = comparePdfs(await pdfStats(r.pdf), await pdfStats(read(resolve(M, 'Output/DD_Evers-Woelk_2124-6.pdf'))))
    console.log(formatScore('Evers-Wölk report (print PDF → Accessible PDF)', s) + '\n')
    out.evers = s
  }
  return out
}
