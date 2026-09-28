// =============================================================================================
// Client requirement files → rule values. Three routes, all ending in a review screen where a
// person confirms each suggestion (nothing from free text is applied on its own):
//   1. our spec workbook (exported from the app, filled in by the client): exact, row by row
//   2. the client's own Word / Excel / text file: each requirement is matched to a rule by the
//      words it uses (RULES[].keywords) and the value by the words for each choice
//   3. optionally, the same requirements sent to an AI model (ai.ts) for better matches
// Requirements that match no rule are returned as open questions for the client.
// =============================================================================================
import { RULES, ruleById, coerce, show, houseDefault, needsWaiver, WAIVER_TEXT, type Rule, type RuleValue } from './rules.ts'
import { LEVEL_LABEL, type Resolved } from './layers.ts'
import { readDocx, readXlsx, writeXlsx, type Sheet } from './office.ts'
import { text } from '../zip.ts'
import type { Decision } from './store.ts'

export interface Requirement {
  text: string
  where: string
}
export interface Suggestion {
  req: Requirement
  ruleId?: string
  value?: RuleValue
  /** 0–1 */
  confidence: number
  by: 'template' | 'keywords' | 'ai'
  reason: string
}

/** Split a client file into requirements: paragraphs, table rows, spreadsheet rows. */
export function readRequirements(name: string, data: Uint8Array): { template?: Suggestion[]; items: Requirement[] } {
  const ext = name.toLowerCase().split('.').pop()
  if (ext === 'xlsx') {
    const sheets = readXlsx(data)
    const template = fromSpecWorkbook(sheets)
    if (template) return { template, items: template.map((s) => s.req) }
    return { items: sheets.flatMap((sh) => sh.rows.map((r, i) => ({ text: r.filter(Boolean).join(' | '), where: `${sh.name}, row ${i + 1}` })).filter((x) => x.text.trim())) }
  }
  if (ext === 'docx') return { items: readDocx(data).map((b) => ({ text: b.text, where: b.where })) }
  if (ext === 'csv' || ext === 'tsv') {
    return { items: text(data).split(/\r?\n/).map((l, i) => ({ text: l.split(ext === 'csv' ? ',' : '\t').join(' | ').trim(), where: `line ${i + 1}` })).filter((x) => x.text) }
  }
  if (ext === 'txt' || ext === 'md') return { items: text(data).split(/\r?\n/).map((l, i) => ({ text: l.trim(), where: `line ${i + 1}` })).filter((x) => x.text) }
  throw new Error(`“${name}” is not a file the tool can read. Use Word (.docx), Excel (.xlsx), CSV or plain text.`)
}

const fold = (s: string) => s.toLocaleLowerCase().normalize('NFD').replace(/\p{M}/gu, '')

/** Match requirements to rules by the words they use. */
export function matchByKeywords(items: Requirement[]): Suggestion[] {
  return items.map((req) => {
    const t = fold(req.text)
    let best: { r: Rule; score: number; hits: string[] } | undefined
    for (const r of RULES) {
      if (r.kind === 'locked' && r.type === 'fixed') {
        // locked rules still match, so the requirement is answered ("already done, cannot change")
      }
      const hits = r.keywords.filter((k) => t.includes(fold(k)))
      // an explicit rule ID wins outright
      const score = (t.includes(fold(r.id)) ? 10 : 0) + hits.reduce((n, k) => n + (k.length > 8 ? 2 : 1), 0)
      if (score && (!best || score > best.score)) best = { r, score, hits }
    }
    if (!best) return { req, confidence: 0, by: 'keywords', reason: 'No rule uses these words.' }
    const r = best.r
    const value = r.type === 'fixed' ? undefined : valueFromText(r, t)
    return {
      req, ruleId: r.id, value, by: 'keywords',
      confidence: Math.min(1, best.score / 4) * (value === undefined && r.type !== 'fixed' ? 0.6 : 1),
      reason: `Words: ${best.hits.slice(0, 3).join(', ') || r.id}${value === undefined && r.type !== 'fixed' ? ' — choose the value' : ''}`,
    }
  })
}

/** The value a requirement asks for, from the words for each choice, a number, or yes/no. */
export function valueFromText(r: Rule, t: string): RuleValue | undefined {
  if (r.type === 'choice') {
    // the longest matching phrase decides: "sin thead" (plain cells) beats "thead" (header cells)
    let best: [string, number] | undefined
    for (const [v, words] of Object.entries(r.choiceWords ?? {}))
      for (const w of words) if (t.includes(fold(w)) && (!best || w.length > best[1])) best = [v, w.length]
    if (best) return best[0]
    return r.choices?.find(([v, label]) => t.includes(fold(label)) || new RegExp(`\\b${v.replace(/[^\w]/g, '.')}\\b`).test(t))?.[0]
  }
  if (r.type === 'number') {
    const m = t.match(/(-?\d+(?:[.,]\d+)?)\s*(em|%|px)?/)
    return m ? coerce(r, m[1]) : undefined
  }
  if (r.type === 'bool') {
    if (/\b(no|sin|without|remove|quitar|eliminar|elimina|don'?t|do not|nunca|never|off)\b/.test(t) && !/\bmissing\b|\bfalta\b/.test(t)) return false
    return true
  }
  return undefined
}

// ---------------------------------------------------------------------------------------------
// The spec workbook: every rule with its value, who set it, and what each value produces
// ---------------------------------------------------------------------------------------------

const HEAD = ['Rule ID', 'Group', 'What it controls', 'Kind', 'Allowed values', 'House default', 'Value', 'Set by', 'Accessibility waiver', 'Example / notes']

export function specWorkbook(p: { client: string; book: string; resolved: Resolved; decisions?: Decision[]; questions?: Requirement[] }): Uint8Array {
  const { resolved } = p
  const rows = RULES.map((r) => {
    const v = r.key ? (resolved.settings[r.key] as RuleValue) : undefined
    const f = resolved.from[r.id]
    const allowed = r.type === 'choice' || r.type === 'multi' ? r.choices!.map(([x]) => x).join(', ') : r.type === 'bool' ? 'Yes, No' : r.type === 'number' ? `${r.min ?? ''}–${r.max ?? ''} ${r.unit ?? ''}`.trim() : r.type === 'fixed' ? '(fixed)' : r.type === 'list' ? 'one phrase per line' : 'CSS'
    return [
      r.id, r.group, `${r.title}. ${r.help}`, r.kind, allowed, show(r, houseDefault(r)), r.type === 'fixed' ? '(always applied)' : show(r, v),
      f ? `${f.level === 'default' ? 'Default' : LEVEL_LABEL[f.level]}${f.name ? ` (${f.name})` : ''}${f.source ? ` — ${f.source.file}, ${f.source.where}` : ''}` : '',
      f?.waiver ? `Yes — ${f.waiver.by}, ${f.waiver.at.slice(0, 10)}` : r.kind === 'advisory' ? `Needed for any value other than ${show(r, r.safe)}` : '',
      r.example && r.key ? r.example(v ?? '') : r.origin,
    ]
  })
  const lists = RULES.map((r, i) => ({ r, row: i + 2 })).filter(({ r }) => r.type === 'choice' || r.type === 'bool').map(({ r, row }) => ({ ref: `G${row}`, values: r.type === 'bool' ? ['Yes', 'No'] : r.choices!.map(([v]) => v) }))
  const sheets: Sheet[] = [
    { name: 'Spec', rows: [HEAD, ...rows], widths: [10, 18, 60, 10, 28, 16, 22, 30, 28, 50], lists },
    { name: 'About', rows: [['Field', 'Value'], ['Client', p.client], ['Book', p.book], ['Exported', new Date().toISOString()], ['How to use', 'Change the Value column only (drop-downs show the allowed values), then load the file in the Spec step. Accessibility waivers are given in the app, not in this file.'], ['Kinds', 'locked = required for a valid EPUB, cannot change; advisory = accessibility, needs a waiver in the app; free = your choice']], widths: [16, 90] },
  ]
  if (p.decisions?.length) sheets.push({ name: 'Log', rows: [['When', 'Who', 'What', 'Rule', 'Detail', 'Spec'], ...p.decisions.map((d) => [d.at, d.actor, d.action, d.ruleId ?? '', d.detail, d.specHash])], widths: [22, 18, 12, 10, 70, 10] })
  if (p.questions?.length) sheets.push({ name: 'Open questions', rows: [['Requirement', 'Where', 'Answer (which rule, which value)'], ...p.questions.map((q) => [q.text, q.where, ''])], widths: [80, 20, 50] })
  return writeXlsx(sheets)
}

/** Our own workbook coming back: exact values per rule ID; undefined if the file is something else. */
export function fromSpecWorkbook(sheets: Sheet[]): Suggestion[] | undefined {
  for (const sh of sheets) {
    const head = sh.rows[0]?.map((h) => h.trim().toLowerCase()) ?? []
    const idCol = head.indexOf('rule id')
    const valCol = head.indexOf('value')
    if (idCol < 0 || valCol < 0) continue
    const out: Suggestion[] = []
    sh.rows.slice(1).forEach((row, i) => {
      const r = ruleById.get((row[idCol] ?? '').trim().toUpperCase())
      if (!r || !r.key) return
      const raw = row[valCol] ?? ''
      const v = coerce(r, raw)
      out.push({
        req: { text: `${r.id} = ${raw}`, where: `${sh.name}, row ${i + 2}` }, ruleId: r.id, value: v, by: 'template',
        confidence: v === undefined ? 0.3 : 1, reason: v === undefined ? `“${raw}” is not an allowed value` : 'From the spec workbook',
      })
    })
    return out
  }
  return undefined
}

/** Suggestions that would change an accessibility rule: shown with the waiver wording. */
export const waiverNeeded = (s: Suggestion) => {
  const r = s.ruleId ? ruleById.get(s.ruleId) : undefined
  return !!r && needsWaiver(r, s.value) ? WAIVER_TEXT : undefined
}
