// =============================================================================================
// The pre-export gate (VAL-001, VAL-004): before a file is downloaded or written, every guard and the validators run on it,
// and while one "fix"-severity issue remains the export is blocked. A person can still export, with a typed reason that is
// written to the decision log and to the report that goes with the file. A "check"-severity issue is listed, never blocks.
//
//   EPUB  the built-in quality check, the build's guards (the review list), our page rules and axe-core / Ace, and EPUBCheck when it can run
//   PDF   the Matterhorn checks on the written file (pdfua/check.ts) and the build's own errors
//
// A validator that cannot run here (no Java for EPUBCheck) is named in `skipped`; it does not block, because nobody can fix that
// from the file, but the report says the file was not checked by it.
// =============================================================================================
import type { ReviewItem } from '../epub/package.ts'
import { checkEpubBytes, type CheckReport, type CheckSource } from './epub.ts'
import { extraReview } from './counts.ts'
import { claimsCheck, gate, pageRules, type EpubValidator, type GateStage, type ValidatorResult } from './gate.ts'
import { conformance } from './conform.ts'
import { text, unzip, type Files } from '../zip.ts'
import type { AxeRunner } from './axe.ts'
import type { HouseSettings } from '../settings.ts'
import { store } from '../spec/store.ts'

export interface GateIssue {
  /** which check found it: "Structure checks", "EPUBCheck", "Conversion" … */
  source: string
  msg: string
  where?: string
}
export interface ExportGate {
  kind: 'epub' | 'pdf'
  /** fix-severity: the export is blocked while any remains */
  fixes: GateIssue[]
  /** check-severity: listed, never block */
  checks: GateIssue[]
  /** checks that ran */
  ran: string[]
  /** checks that could not run here, and why */
  skipped: string[]
  blocked: boolean
  at: string
}
export interface GateOverride {
  actor: string
  reason: string
  at: string
  /** the fix-severity issues that were still open */
  fixes: number
}

/** The shortest reason that says anything. A single word is not a reason. */
export const MIN_REASON = 12

type Stage = Pick<GateStage, 'id' | 'title' | 'ran' | 'errors' | 'warnings'>

const done = (kind: ExportGate['kind'], fixes: GateIssue[], checks: GateIssue[], ran: string[], skipped: string[]): ExportGate => ({ kind, fixes, checks, ran, skipped, blocked: fixes.length > 0, at: new Date().toISOString() })

/**
 * The verdict from parts that have already run (the screen runs EPUBCheck and the accessibility check itself, as it shows them):
 * the quality check `report`, the build's `review` list, and the other validators as `stages`. The conversion notes the checker
 * already reports are counted once (counts.ts).
 */
export function collectGate(p: { report: CheckReport; review: ReviewItem[]; stages?: Stage[] }): ExportGate {
  const fixes: GateIssue[] = []
  const checks: GateIssue[] = []
  const add = (level: 'error' | 'warn' | 'pass' | 'info', i: GateIssue) => (level === 'error' ? fixes.push(i) : level === 'warn' ? checks.push(i) : undefined)
  for (const g of p.report.groups) for (const f of g.findings) add(f.level, { source: g.title, msg: f.msg, where: f.where })
  for (const r of extraReview(p.report, p.review)) add(r.level, { source: 'Conversion', msg: r.msg, where: r.where })
  const ran = ['Quality check', 'Build checks']
  const skipped: string[] = []
  for (const s of p.stages ?? []) {
    if (s.id === 'structure') continue // the quality check above is that stage
    if (s.ran) ran.push(s.title)
    else if (s.id === 'epubcheck') skipped.push('EPUBCheck did not run here (it needs Java), so this file was not checked by it.')
    else if (s.id === 'ace') skipped.push('Ace by DAISY did not run here; the pages were checked with axe-core, the engine inside Ace.')
    for (const m of s.errors) fixes.push({ source: s.title, msg: m })
    for (const m of s.warnings) checks.push({ source: s.title, msg: m })
  }
  return done('epub', fixes, checks, ran, skipped)
}

/** Spec conformance (conform.ts) checks the accessibility layer's markup against the rules; a Standard EPUB has none of it, so it does not apply. */
const isAccessible = (files: Files) => /schema:accessMode/.test(text([...files].find(([p]) => p.endsWith('.opf'))?.[1] ?? new Uint8Array()))

/** Runs everything on a built EPUB. `validator` is EPUBCheck, `ace` the Ace service, `axe` runs axe-core on one page (gate.ts). */
export async function runEpubGate(epub: Uint8Array, review: ReviewItem[], s: HouseSettings, o: { source?: CheckSource; validator?: EpubValidator; ace?: EpubValidator; axe?: AxeRunner } = {}): Promise<ExportGate> {
  const report = checkEpubBytes(epub, o.source)
  const g = await gate(epub, s, { ...o, report, conformance: isAccessible(unzip(epub)) })
  return collectGate({ report, review, stages: g.stages })
}

/** The accessible PDF: `found` are the Matterhorn checks run on the written file (checkUa), `review` the build's own list. */
export function collectPdfGate(found: ReviewItem[], review: ReviewItem[]): ExportGate {
  const seen = new Set<string>()
  const fixes: GateIssue[] = []
  const checks: GateIssue[] = []
  for (const r of [...found, ...review]) {
    if (seen.has(r.level + r.msg)) continue
    seen.add(r.level + r.msg)
    if (r.level === 'error') fixes.push({ source: 'PDF/UA checks', msg: r.msg, where: r.where })
    else if (r.level === 'warn') checks.push({ source: 'PDF/UA checks', msg: r.msg, where: r.where })
  }
  return done('pdf', fixes, checks, ['PDF/UA checks on the written file', 'Build checks'], [])
}

/** Whether the file may leave: nothing to fix, or an override that is complete. */
export const mayExport = (g: ExportGate, o?: GateOverride) => !g.blocked || (!!o && o.fixes === g.fixes.length)

/**
 * "Export anyway". Needs a name and a typed reason; both go to the decision log (action "override") before the file is released, and
 * the returned record goes into the report. Throws, and records nothing, when the reason is missing or too short.
 */
export async function overrideGate(g: ExportGate, p: { actor: string; reason: string; client: string; book: string; specHash?: string }): Promise<GateOverride> {
  const actor = p.actor.trim()
  const reason = p.reason.trim().replace(/\s+/g, ' ')
  if (!g.blocked) throw new Error('Nothing is blocking the export, so there is nothing to override.')
  if (!actor) throw new Error('Type your name first: an override is recorded with who made it.')
  if (reason.length < MIN_REASON) throw new Error(`Type the reason for exporting with ${g.fixes.length} problem${g.fixes.length === 1 ? '' : 's'} still open (at least ${MIN_REASON} characters). It is kept in the record and in the report.`)
  const rec: GateOverride = { actor, reason, at: new Date().toISOString(), fixes: g.fixes.length }
  await store().addDecision({
    actor, action: 'override', client: p.client, book: p.book, ruleId: 'VAL-001', specHash: p.specHash ?? '',
    detail: `Exported ${g.kind === 'pdf' ? 'a PDF' : 'an EPUB'} with ${g.fixes.length} fix-severity problem${g.fixes.length === 1 ? '' : 's'} still open. Reason: ${reason} | Open: ${g.fixes.slice(0, 5).map((f) => f.msg.slice(0, 90)).join(' | ')}${g.fixes.length > 5 ? ` | … and ${g.fixes.length - 5} more` : ''}`,
  })
  return rec
}

/** What is written when "Continue anyway" is pressed without a typed reason. */
export const DEFAULT_REASON = 'Exported without fixing the open problems. Chosen on screen with “Continue anyway”; no reason was typed.'

/**
 * "Continue anyway": the export is never blocked. Same record as overrideGate (decision log, report), but a name and a reason are
 * optional: with none, the name is “reviewer” and the reason is DEFAULT_REASON. If the log cannot be written the file is still released;
 * the returned record goes into the report and the review notes.
 */
export async function continueAnyway(g: ExportGate, p: { actor?: string; reason?: string; client: string; book: string; specHash?: string }): Promise<GateOverride> {
  const actor = (p.actor ?? '').trim() || 'reviewer'
  const typed = (p.reason ?? '').trim().replace(/\s+/g, ' ')
  const reason = typed.length >= MIN_REASON ? typed : DEFAULT_REASON
  try {
    return await overrideGate(g, { actor, reason, client: p.client, book: p.book, specHash: p.specHash })
  } catch {
    return { actor, reason, at: new Date().toISOString(), fixes: g.fixes.length }
  }
}

/** The gate's own messages, in the shape of the other guards (they name the rule): blocked, or exported with an override. */
export function gateGuards(g: ExportGate, o?: GateOverride): ReviewItem[] {
  if (!g.blocked) return []
  return o
    ? [{ level: 'info', msg: `VAL-004: exported with ${g.fixes.length} problem${g.fixes.length === 1 ? '' : 's'} open, overridden by ${o.actor} on ${o.at.slice(0, 10)}: ${o.reason}` }]
    : [{ level: 'error', msg: `VAL-001: export blocked while ${g.fixes.length} problem${g.fixes.length === 1 ? '' : 's'} to fix remain. Fix them, or export with a typed reason.` }]
}

const line = (i: GateIssue) => `- **${i.source}:** ${i.msg.replace(/\s+/g, ' ')}${i.where ? ` (${i.where})` : ''}`

/** The one-page PASS / FAIL report that goes with the file (VAL-004), in plain Markdown. */
export function gateReport(g: ExportGate, o: GateOverride | undefined, file: string): string {
  const verdict = !g.blocked ? 'PASS' : o ? 'FAIL, EXPORTED WITH AN OVERRIDE' : 'FAIL, EXPORT BLOCKED'
  return [
    `# Check report: ${file}`,
    '',
    `**Result: ${verdict}** · ${g.fixes.length} to fix · ${g.checks.length} to check · ${g.at}`,
    '',
    ...(o ? ['## Override', '', `Exported with ${o.fixes} problem${o.fixes === 1 ? '' : 's'} still open.`, `- Who: ${o.actor}`, `- When: ${o.at}`, `- Reason: ${o.reason}`, ''] : []),
    '## What ran',
    '',
    ...g.ran.map((r) => `- ${r}`),
    ...g.skipped.map((r) => `- NOT RUN: ${r}`),
    '',
    `## To fix (${g.fixes.length})`,
    '',
    ...(g.fixes.length ? g.fixes.map(line) : ['Nothing.']),
    '',
    `## To check (${g.checks.length})`,
    '',
    ...(g.checks.length ? g.checks.slice(0, 60).map(line) : ['Nothing.']),
    ...(g.checks.length > 60 ? [`- … and ${g.checks.length - 60} more`] : []),
    '',
  ].join('\n')
}

/** The validators a screen has already run (it shows EPUBCheck and the accessibility check itself), plus the in-app page rules and conformance, as gate stages. */
export function uiStages(files: Files, s: HouseSettings, ec: ValidatorResult | null | undefined, a11y: (ValidatorResult & { by: string }) | null | undefined): Stage[] {
  const rules = pageRules(files)
  return [
    ...(isAccessible(files) ? [{ id: 'conformance' as const, title: 'Spec conformance', ran: true, errors: conformance(files, s), warnings: [] }] : []),
    { id: 'accessibility', title: a11y?.by ?? 'Accessibility', ran: true, errors: [...claimsCheck(files), ...rules.errors, ...(a11y?.errors ?? [])], warnings: [...rules.warnings, ...(a11y?.warnings ?? [])] },
    { id: 'epubcheck', title: 'EPUBCheck', ran: !!ec, errors: ec?.errors ?? [], warnings: ec?.warnings ?? [] },
  ]
}
