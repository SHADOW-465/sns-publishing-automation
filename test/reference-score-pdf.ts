// Accessible-PDF half of the reference score: builds Gladiators and the German report from the client's inputs and compares
// the result with the client's finished PDFs (fixtures/reference/Automation/Accessible-PDF-Automation).
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { analyzeUa, buildUa } from '../src/engine/pdfua/index.ts'
import { openSpec } from '../src/engine/spec/session.ts'
import { uaOptionsFrom } from '../src/engine/pdfua/structure.ts'
import { pdfStats } from '../src/engine/check/pdfstats.ts'
import { comparePdfs, readingDims } from '../src/engine/check/refscore-pdf.ts'
import { formatScore, type RefScore } from '../src/engine/check/refscore.ts'
import { nodeRaster } from './raster-node.ts'
import { AUTOMATION, has, read } from './samples.ts'

const D = resolve(AUTOMATION, 'Accessible-PDF-Automation')

/** the options a job would run with: the client's layers, then the Accessible PDF defaults */
const optionsFor = async (client: string, book: string) => uaOptionsFrom((await openSpec({ client, series: '', book, kind: 'accessible-pdf' })).resolved.settings)

/** the eval-set pages of a book (test/eval-pages.json) */
const evalPages = (id: string): number[] =>
  (JSON.parse(readFileSync(resolve(import.meta.dirname, 'eval-pages.json'), 'utf8')) as { books: { id: string; pages: { page: number | null }[] }[] }).books
    .find((b) => b.id === id)?.pages.flatMap((p) => (p.page === null ? [] : [p.page])) ?? []

/** the whole-book score, then reading order and caption/heading F1 on the book's eval pages alone */
async function score(out: Record<string, RefScore | { skipped: string }>, id: string, name: string, pdf: Uint8Array, refPdf: Uint8Array) {
  const mine = await pdfStats(pdf, pdfjs)
  const ref = await pdfStats(refPdf, pdfjs)
  const s = comparePdfs(mine, ref)
  console.log(formatScore(name, s) + '\n')
  out[id] = s
  const dims = readingDims(mine, ref, evalPages(id))
  const e = { overall: dims.find((d) => d.id === 'order')?.score ?? 0, dims }
  console.log(formatScore(`${name}, eval pages only`, e) + '\n')
  out[`${id}-eval`] = e
  // the check on the dimension itself: the reference read against itself is 100
  const self = readingDims(ref, ref)
  console.log(formatScore(`${name}, the reference against itself`, { overall: self.find((d) => d.id === 'order')?.score ?? 0, dims: self }) + '\n')
  out[`${id}-self`] = { overall: self.find((d) => d.id === 'order')?.score ?? 0, dims: self }
}

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
    const r = await buildUa(a, { styles: a.styles, meta: { ...a.meta, isbn: '9781036130527' }, alt, cropToTrim: true, sourceName: 'Gladiators in the Greek World.pdf', options: await optionsFor('Pen & Sword Books', 'Gladiators') })
    await score(out, 'gladiators', 'Gladiators in the Greek World (print PDF → Accessible PDF)', r.pdf, read(resolve(S, 'Output/Gladiators in the Greek World_9781036130527.pdf')))
  }
  if (want('evers')) {
    const M = resolve(D, 'Medium')
    const a = await analyzeUa(pdfjs, nodeRaster, { main: read(resolve(M, 'Input/DD_Evers-Woelk_2124-6.pdf')), extras: [], altDocx: read(resolve(M, 'Input/AltTexte MEW.docx')) })
    const alt = Object.fromEntries(a.figures.map((f) => [f.key, f.alt]))
    const r = await buildUa(a, { styles: a.styles, meta: a.meta, alt, cropToTrim: true, sourceName: 'DD_Evers-Woelk_2124-6.pdf', options: await optionsFor('', 'Evers') })
    await score(out, 'evers', 'Evers-Wölk report (print PDF → Accessible PDF)', r.pdf, read(resolve(M, 'Output/DD_Evers-Woelk_2124-6.pdf')))
  }
  return out
}
