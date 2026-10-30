// Gladiators in the Greek World: the tool's accessible PDF against the client's hand-finished one, mined for the staff's fixes (T26,
// OPUS_DESIGN2 §c.2 (2)). Used by the T26 test; run by hand it prints the counts and every disagreement:
//   node --import ./test/setup.ts test/staff-fix-gladiators.ts [out.json]
import { resolve } from 'node:path'
import { writeFileSync } from 'node:fs'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { analyzeUa, buildUa } from '../src/engine/pdfua/index.ts'
import { uaOptionsFrom } from '../src/engine/pdfua/structure.ts'
import { openSpec } from '../src/engine/spec/session.ts'
import { pdfStats } from '../src/engine/check/pdfstats.ts'
import { lineTexts, type EvidencePage } from '../src/engine/pdf/evidence.ts'
import { mineStaffFixes } from '../src/engine/pdf/staff-fix.ts'
import type { PageDecision } from '../src/engine/pdf/decision.ts'
import { nodeRaster } from './raster-node.ts'
import { AUTOMATION, has, read } from './samples.ts'

const S = resolve(AUTOMATION, 'Accessible-PDF-Automation/Simple')
export const haveGladiators = () => has(resolve(S, 'Output'))

/** the tool's build of Gladiators with these decisions laid on (none: the tool's own output), the options a job would run with */
export async function gladiators() {
  const options = uaOptionsFrom((await openSpec({ client: 'Pen & Sword Books', series: '', book: 'Gladiators', kind: 'accessible-pdf' })).resolved.settings)
  const a = await analyzeUa(pdfjs, nodeRaster, {
    main: read(resolve(S, 'Input/Gladiators in the Greek World.pdf')),
    extras: [read(resolve(S, 'Input/Gladiators in the Greek World_Plates.pdf'))],
    cover: { data: read(resolve(S, 'Input/cover.jpg')), png: false },
    altDocx: read(resolve(S, 'Input/Gladiators in the Greek World alt text.docx')),
  })
  const alt = Object.fromEntries(a.figures.map((f) => [f.key, f.alt]))
  const build = (decisions?: PageDecision[]) =>
    buildUa(a, { styles: a.styles, meta: { ...a.meta, isbn: '9781036130527' }, alt, cropToTrim: true, sourceName: 'Gladiators in the Greek World.pdf', options: { ...options, ...(decisions ? { decisions } : {}) } })
  const ref = read(resolve(S, 'Output/Gladiators in the Greek World_9781036130527.pdf'))
  return { a, options, build, ref }
}

/** the tool's file mined against the staff's */
export async function mineGladiators() {
  const g = await gladiators()
  const mine = await g.build()
  const m = mineStaffFixes({
    evidence: g.a.book.evidence!,
    lineText: (p) => lineTexts(g.a.book.pages[p - 1] as unknown as EvidencePage, p),
    mine: await pdfStats(mine.pdf, pdfjs),
    ref: await pdfStats(g.ref, pdfjs),
    guards: { runningHeads: g.options.runningHeads, captionIn: g.options.captionIn },
  })
  return { ...g, built: mine, mined: m }
}

if (process.argv[1]?.endsWith('staff-fix-gladiators.ts')) {
  const r = await mineGladiators()
  const { mined } = r
  console.log(JSON.stringify(mined.counts))
  for (const d of mined.reading) console.log(`${d.label}: ${d.score}`)
  // the disagreements by kind: the words with the quoted text and the numbers taken out
  const kinds = new Map<string, number>()
  for (const d of mined.disagreements) {
    const k = d.msg.replace(/“[^”]*”/g, '“…”').replace(/d+/g, 'N').slice(0, 90)
    kinds.set(k, (kinds.get(k) ?? 0) + 1)
  }
  for (const [k, n] of [...kinds].sort((x, y) => y[1] - x[1])) console.log(String(n).padStart(5), k)
  if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify({ counts: mined.counts, decisions: mined.decisions, disagreements: mined.disagreements }, null, 1))
}
