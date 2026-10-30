// =============================================================================================
// Spec drafter (OPUS_DESIGN2 §c.5, T23): the client's file is partial and unreliable, so it is evidence, not the spec. Every requirement
// is read (file, row, quote), mapped to a rule (keywords, then the text model if one is given), and written into a full spec workbook:
// one row per rule with its value, a status (client said / inferred / from rulebook / house default / ASK CLIENT) and the evidence.
// What no rule takes is listed with its quote on the "Open questions" sheet. The workbook is the client layer: they fill the ASK rows and
// send it back, and route 1 (requirements.ts, fromSpecWorkbook) reads it exactly. The model never changes text: it only maps words to rules.
// =============================================================================================
import { houseSettings } from '../settings.ts'
import type { OutputKind } from '../output/standards.ts'
import { resolveSpec } from './session.ts'
import { emptyLayer, type Layer, type Source } from './layers.ts'
import { ruleById, RULES, show, type RuleValue } from './rules.ts'
import { readRequirements, specWorkbook, type DraftNote, type Requirement, type Suggestion } from './requirements.ts'
import { matchByKeywords } from './requirements.ts'
import { settleSameSource, type Row } from './precedence.ts'

export const STATUS = ['client said', 'inferred', 'from rulebook', 'house default', 'ASK CLIENT'] as const
/** a mapping this sure, with a value, is what the client said; less is asked */
export const SURE = 0.85

export interface DraftInput {
  client: string
  book: string
  files: { name: string; data: Uint8Array }[]
  /** what is known already (the client's rulebook, corrections); the draft is added on top as the client layer */
  layers?: Layer[]
  kind?: OutputKind
  /** the text model (matchWithAi): asked only about requirements the keywords did not place surely */
  ai?: (items: Requirement[]) => Promise<Suggestion[]>
}
export interface Draft {
  workbook: Uint8Array
  resolved: ReturnType<typeof resolveSpec>
  /** rule ID → status and evidence, as written in the workbook */
  notes: Record<string, DraftNote>
  /** requirements that name a rule, and those that name none (with their quote and place); questions = everything the client is asked */
  mapped: Suggestion[]
  unmapped: Requirement[]
  questions: Requirement[]
  /** every requirement read; mapped + unmapped + otherRoutes = total */
  total: number
  /** rows that belong to another route (a Book_Details workbook feeds the navigation step) */
  otherRoutes: number
}

const quote = (r: Requirement) => `“${r.text}” (${r.where})`

export async function draftSpec(p: DraftInput): Promise<Draft> {
  // 1. read: each requirement keeps its file, row and quote
  const items: Requirement[] = []
  const template: Suggestion[] = []
  let otherRoutes = 0
  for (const f of p.files) {
    const read = readRequirements(f.name, f.data)
    const at = (x: Requirement): Requirement => ({ text: x.text, where: `${f.name}, ${x.where}` })
    if (read.bookDetails) otherRoutes += read.items.length
    else if (read.template) template.push(...read.template.map((s) => ({ ...s, req: at(s.req) })))
    else items.push(...read.items.map(at))
  }

  // 2. map: keywords first, then the text model for what they did not place surely
  let found = matchByKeywords(items)
  if (p.ai) {
    const weak = found.filter((s) => s.confidence < SURE).map((s) => s.req)
    const better = weak.length ? await p.ai(weak) : []
    found = found.map((s) => {
      const b = better.find((x) => x.req === s.req || (x.req.text === s.req.text && x.req.where === s.req.where))
      return b && b.ruleId && b.confidence > s.confidence ? b : s
    })
  }
  const all = [...template, ...found]
  const mapped = all.filter((s) => s.ruleId && ruleById.has(s.ruleId))
  const unmapped = all.filter((s) => !mapped.includes(s)).map((s) => s.req)
  const fileOf = (where: string) => p.files.find((f) => where.startsWith(`${f.name}, `))?.name ?? where
  const rowOf = (where: string) => where.slice(fileOf(where).length + 2)

  // 3. draft: sure mappings become the client layer; two rows that disagree are settled and asked
  const rulebook = Object.assign({}, ...(p.layers ?? []).map((l) => l.values)) as Record<string, RuleValue>
  const sure = mapped.filter((s) => s.value !== undefined && s.confidence >= SURE && ruleById.get(s.ruleId!)!.key)
  const rows: (Row & { by: Source['by'] })[] = sure.map((s) => ({ ruleId: s.ruleId!, value: s.value!, quote: s.req.text, where: s.req.where, by: s.by }))
  const { kept, conflicts } = settleSameSource(rows, rulebook)
  const layer = emptyLayer('client', p.client)
  for (const k of kept) {
    layer.values[k.ruleId] = k.value
    layer.sources[k.ruleId] = { file: fileOf(k.where), where: rowOf(k.where), text: k.quote, by: k.by }
  }
  const resolved = resolveSpec(houseSettings(), [...(p.layers ?? []), layer], p.kind)

  // 4. status and evidence, one row per rule
  const said = (id: string) => mapped.filter((s) => s.ruleId === id)
  const settled = new Map(conflicts.map((c) => [c.ruleId, c]))
  const notes: Record<string, DraftNote> = {}
  const lockedAsks: Requirement[] = []
  for (const r of RULES) {
    const f = resolved.from[r.id]
    const sayings = said(r.id)
    const note = (status: (typeof STATUS)[number], evidence: string) => (notes[r.id] = { status, evidence })
    if (settled.has(r.id)) note('ASK CLIENT', `Two rows disagree: ${settled.get(r.id)!.quotes.map((q) => `“${q}”`).join(' and ')}`)
    else if (!r.key && sayings.length) {
      // a standard (locked): the file is quoted, the standard stays, and the client is told why
      note('from rulebook', sayings.map((s) => `${quote(s.req)} — required by ${r.origin}, so it stays`).join('; '))
      for (const s of sayings) lockedAsks.push({ text: `${r.title} (${r.id}): your file says ${quote(s.req)}. ${r.origin} requires it as it is, so it was kept. Please confirm.`, where: `Rule ${r.id}, locked standard` })
    } else if (layer.sources[r.id] && f.source === layer.sources[r.id]) note('client said', quote({ text: f.source.text, where: `${f.source.file}, ${f.source.where}` }))
    else if (sayings.length && !sure.some((s) => s.ruleId === r.id))
      note('ASK CLIENT', sayings.map((s) => `${quote(s.req)} — read as ${s.value === undefined ? 'a rule to set, value not clear' : show(r, s.value)} (${Math.round(s.confidence * 100)}% sure)`).join('; '))
    else if (f?.level === 'default' || !f) note(r.key ? 'house default' : 'from rulebook', '')
    else note(f.source?.correction ? 'inferred' : 'from rulebook', f.source ? `${quote({ text: f.source.text, where: `${f.source.file}, ${f.source.where}` })}${sayings.length ? ' — the spec row was not used, see Open questions' : ''}` : '')
  }

  const questions = [...unmapped, ...conflicts.flatMap((c) => (c.ask ? [{ text: c.ask, where: `Rule ${c.ruleId}, two rows disagree` }] : [])), ...lockedAsks]
  const workbook = specWorkbook({ client: p.client, book: p.book, resolved, questions, draft: notes })
  return { workbook, resolved, notes, mapped, unmapped, questions, total: items.length + template.length + otherRoutes, otherRoutes }
}
