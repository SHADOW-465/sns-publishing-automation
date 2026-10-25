// The export gate for the command-line runners (VAL-001, VAL-004): a runner writes its deliverable through gatedWrite(), which runs
// every guard and EPUBCheck (an EPUB) or the PDF/UA checks (a PDF) first, prints what is still open, and writes the file only when
// nothing is open or an override was typed:
//   GATE_OVERRIDE="reason why this goes out anyway"   GATE_ACTOR="Your name"
// The one-page report is written beside the file either way, with the override in it. A blocked run sets exit code 3.
// The unzipped copy a runner dumps for diffing is a diagnostic, not a deliverable, and is not gated.
import { writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import type { ReviewItem } from '../src/engine/epub/package.ts'
import type { CheckSource } from '../src/engine/check/epub.ts'
import type { EpubValidator } from '../src/engine/check/gate.ts'
import { collectPdfGate, gateGuards, gateReport, mayExport, overrideGate, runEpubGate, type ExportGate, type GateOverride } from '../src/engine/check/exportgate.ts'
import { checkUa } from '../src/engine/pdfua/check.ts'
import { settings } from '../src/engine/settings.ts'
import { setStore } from '../src/engine/spec/store.ts'
import { JsonFileStore } from '../src/engine/spec/json-store.ts'
import { localValidator } from './epubcheck.ts'

// decisions go to the JSON file named by SNS_STORE, else they live for this run (and are printed and put in the report)
if (process.env.SNS_STORE) setStore(new JsonFileStore(process.env.SNS_STORE))

export interface GatedResult { gate: ExportGate; override?: GateOverride; written: boolean; report: string; guards: ReviewItem[] }

export async function gatedWrite(
  kind: 'epub' | 'pdf',
  data: Uint8Array,
  file: string,
  review: ReviewItem[],
  o: { source?: CheckSource; client?: string; book?: string; validator?: EpubValidator } = {},
): Promise<GatedResult> {
  const gate = kind === 'epub'
    ? await runEpubGate(data, review, settings(), { source: o.source, validator: o.validator ?? localValidator })
    : collectPdfGate(await checkUa(data), review)
  let override: GateOverride | undefined
  const reason = process.env.GATE_OVERRIDE
  if (gate.blocked && reason !== undefined) {
    try {
      override = await overrideGate(gate, { actor: process.env.GATE_ACTOR ?? '', reason, client: o.client ?? '', book: o.book ?? basename(file) })
    } catch (e) {
      console.log(`GATE override refused: ${(e as Error).message}`)
    }
  }
  const allowed = mayExport(gate, override)
  const report = gateReport(gate, override, basename(file))
  writeFileSync(file.replace(/\.[^.\\/]+$/, '') + '.report.md', report)
  console.log(`\nGATE ${gate.blocked ? (override ? `OVERRIDDEN by ${override.actor}: ${override.reason}` : `BLOCKED: ${gate.fixes.length} to fix`) : 'PASS'} · ${gate.checks.length} to check · ran: ${gate.ran.join(', ')}${gate.skipped.length ? ` · NOT RUN: ${gate.skipped.join(' ')}` : ''}`)
  for (const f of gate.fixes.slice(0, 40)) console.log(`  FIX  [${f.source}] ${f.msg.replace(/\s+/g, ' ').slice(0, 220)}${f.where ? `  [${f.where}]` : ''}`)
  if (gate.fixes.length > 40) console.log(`  … and ${gate.fixes.length - 40} more`)
  if (allowed) writeFileSync(file, data)
  else {
    console.log(`GATE: ${basename(file)} was NOT written. Fix the problems above, or run again with GATE_OVERRIDE="reason" GATE_ACTOR="name".`)
    process.exitCode = 3
  }
  return { gate, override, written: allowed, report, guards: gateGuards(gate, override) }
}
