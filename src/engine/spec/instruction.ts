// =============================================================================================
// The typed instruction for one book (OPUS_DESIGN2 §a.2–a.4, T21): "chapters are H1; pages 3–6 are plates; the captions are the small
// italic lines". Free text in any language is compiled by a text model (strict JSON schema, temperature 0) into rule values, directives
// and hints; the engine checks every item (rule IDs real, values coerce, pages inside the book, closed directive vocabulary, nothing
// locked) and keeps the words each item came from. The result is a `book` layer one rank above the spec (layers.ts), so the instruction
// beats the spec rows for this book only and `from[]` says so. Directives reach the knobs that exist; the others become hints for the
// page reader. The same text compiles once: the model's reply is cached under the text and the rule catalogue.
// No node imports here: the Spec step uses it in the browser (files are in instruction-fs.ts).
// =============================================================================================
import type { VisionConfig } from '../epub/alt-ai.ts'
import type { DecisionNote } from '../review/decisions.ts'
import type { PageDecision } from '../pdf/decision.ts'
import type { PageEvidence } from '../pdf/evidence.ts'
import type { HeadingMapEntry } from '../pdf/headings.ts'
import { emptyLayer, LEVEL_LABEL, type Layer, type Resolved } from './layers.ts'
import { RULES, ruleById, coerce, needsWaiver, show, type RuleValue } from './rules.ts'
import { ruleCatalogue } from './ai.ts'

/** [from, to] pairs, 1-based and inclusive */
export type PageRange = [number, number][]
type Level = HeadingMapEntry['level']

export type Directive = (
  | { op: 'ai_pages'; pages: PageRange | 'all' | 'flagged' } // where the page reader runs (default 'flagged')
  | { op: 'skip_pages'; pages: PageRange; as: 'artifact' | 'keep' } // blank or ad pages
  | { op: 'plates'; pages: PageRange }
  | { op: 'columns'; pages: PageRange; n: 1 | 2 | 3 }
  | { op: 'caption_style'; signal: 'italic' | 'smaller' | 'label'; near: 'figure' } // "the captions are the italic lines"
  | { op: 'heading_map'; sample: string; level: Level } // "the 'Conclusiones' heads are H3"
  | { op: 'treat_as'; pages: PageRange; kind: 'toc' | 'index' | 'notes' | 'illustrations' | 'body' }
  | { op: 'strict_review'; pages: PageRange | 'all' } // every edit of the page reader on these pages waits for a person
) & { /** the words it came from */ quote: string }

export interface CompiledInstruction {
  rules: { ruleId: string; value: RuleValue; quote: string; confidence: number; /** the words say "even though it is less accessible" */ waiver?: boolean }[]
  directives: Directive[]
  /** context for the page reader, never rules */
  hints: { scope: PageRange | 'book'; text: string; quote: string }[]
  /** never dropped silently */
  unmapped: { quote: string; why: string }[]
}

/** A request for a change the standards forbid: not applied, listed. */
export interface Refused {
  ruleId: string
  quote: string
  /** the standard or requirement the rule comes from */
  breaks: string
  why: string
}

/** What the operator accepted on the "What I understood" card (or a batch run took on its own). */
export interface AppliedInstruction {
  compiled: CompiledInstruction
  /** requests for a locked change, listed in REVIEW_NOTES */
  refused?: Refused[]
  actor: string
  at: string
  /** the typed text, for the decision log */
  text?: string
  /** a run with nobody to ask: only confident items that touch no accessibility rule become rules */
  unattended?: boolean
}

// ---- pages ------------------------------------------------------------------------------------------------------------------------------------------

const DASH = '[-–—]|to|a|bis|à'
/** "3-6, 9" → [[3,6],[9,9]]; undefined when it is not a list of ascending ranges inside the book (`pages` pages, when known) */
export function parsePages(s: string, pages?: number): PageRange | undefined {
  const out: PageRange = []
  for (const part of String(s).split(/[,;]/)) {
    const m = part.trim().match(new RegExp(`^(\\d+)\\s*(?:(?:${DASH})\\s*(\\d+))?$`, 'i'))
    if (!m) return undefined
    const a = Number(m[1])
    const b = m[2] ? Number(m[2]) : a
    if (a < 1 || b < a || (pages !== undefined && b > pages)) return undefined
    out.push([a, b])
  }
  return out.length ? out : undefined
}
export const inRange = (r: PageRange, page: number) => r.some(([a, b]) => page >= a && page <= b)
const rangeText = (r: PageRange) => r.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(', ')
const pagesWord = (r: PageRange) => (r.length === 1 && r[0][0] === r[0][1] ? [`Page ${r[0][0]}`, 'is'] : [`Pages ${rangeText(r)}`, 'are'])

// ---- what the model is asked ------------------------------------------------------------------------------------------------------------------

/** The rule list as the model sees it: the rules of ai.ts, and the locked ones named so that a request to change them can be refused. */
export function instructionCatalogue(): string {
  const locked = RULES.filter((r) => r.kind === 'locked').map((r) => `${r.id}: ${r.title}. LOCKED (${r.origin}): it cannot be changed; if the text asks to change it, still return it so that it can be refused.`)
  return [ruleCatalogue(), ...locked].join('\n')
}

const PAGES_NOTE = 'pages: "3-6, 9" (digits only; page numbers of the PDF)'
const SYSTEM = `You compile one typed instruction about one book into JSON for an e-book conversion tool. The instruction may be in any language (English, Spanish, German …).
Return only what the text says; do not invent anything. Keep, for every item, the words of the instruction it came from in "quote", unchanged.
rules: a listed rule ID and the value the text asks for (value as text: for yes/no rules "true" or "false"; for a choice, its value). confidence is 0 to 1.
  waiver is true only if the text itself says the result is less accessible and asks for it anyway ("even though it is less accessible"); otherwise false.
directives: how the tool runs for this book. The only operations are:
  ai_pages (${PAGES_NOTE}, or "all", or "flagged"): where the page reader checks reading order and tags
  skip_pages (pages, as "artifact" or "keep"): blank or advertising pages
  plates (pages) · columns (pages, n 1|2|3) · treat_as (pages, kind toc|index|notes|illustrations|body)
  caption_style (signal italic|smaller|label, near "figure"): "the captions are the small italic lines"
  heading_map (sample: an example heading text, level H1–H6 or P): "the 'Conclusiones' headings are H3"
  strict_review (pages or "all"): a person must approve every edit on those pages
hints: other facts about the book or some pages (scope "book" or pages) that help a reader of the page; text in English.
unmapped: anything in the text that fits none of the above, with why. Never drop a sentence silently.

Rules:
${instructionCatalogue()}`

const str = { type: 'string' }
const dir = (op: string, props: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, properties: { op: { const: op }, ...props, quote: str }, required: ['op', ...Object.keys(props), 'quote'] })
const pagesP = { pages: str }
export function instructionSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      rules: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { ruleId: str, value: str, quote: str, confidence: { type: 'number' }, waiver: { type: 'boolean' } }, required: ['ruleId', 'value', 'quote', 'confidence', 'waiver'] } },
      directives: {
        type: 'array',
        items: {
          anyOf: [
            dir('ai_pages', pagesP), dir('skip_pages', { ...pagesP, as: { enum: ['artifact', 'keep'] } }), dir('plates', pagesP), dir('columns', { ...pagesP, n: { type: 'integer' } }),
            dir('caption_style', { signal: { enum: ['italic', 'smaller', 'label'] }, near: { const: 'figure' } }), dir('heading_map', { sample: str, level: str }),
            dir('treat_as', { ...pagesP, kind: { enum: ['toc', 'index', 'notes', 'illustrations', 'body'] } }), dir('strict_review', pagesP),
          ],
        },
      },
      hints: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { scope: str, text: str, quote: str }, required: ['scope', 'text', 'quote'] } },
      unmapped: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { quote: str, why: str }, required: ['quote', 'why'] } },
    },
    required: ['rules', 'directives', 'hints', 'unmapped'],
  }
}

// a short hash that works in the browser too; the cache entry keeps the text, so a collision is caught on read
const hash = (s: string) => {
  let a = 0x811c9dc5
  let b = 0x1b873593
  for (let i = 0; i < s.length; i++) {
    a = Math.imul(a ^ s.charCodeAt(i), 0x01000193)
    b = Math.imul(b ^ s.charCodeAt(i), 0x85ebca6b) ^ (b >>> 13)
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0')
}
/** Changes when the prompt, the schema or any rule changes: a cached compile is valid for one catalogue version only. */
export const CATALOGUE_VERSION = hash(SYSTEM + JSON.stringify(instructionSchema()))

// ---- the engine's check of what came back -------------------------------------------------------------------------------------------------------

const LEVELS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P'])
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

/** The model's reply as a CompiledInstruction the engine stands behind. What fails a check goes to `unmapped` with the reason. */
export function validateCompiled(raw: unknown, pages?: number): { compiled: CompiledInstruction; refused: Refused[] } {
  const v = obj(raw)
  const list = (k: string) => (Array.isArray(v[k]) ? (v[k] as unknown[]).map(obj) : [])
  const compiled: CompiledInstruction = { rules: [], directives: [], hints: [], unmapped: [] }
  const refused: Refused[] = []
  const no = (quote: unknown, why: string) => compiled.unmapped.push({ quote: text(quote), why })
  for (const u of list('unmapped')) no(u.quote, text(u.why) || 'Not understood.')

  const rules = new Map<string, CompiledInstruction['rules'][number]>()
  for (const x of list('rules')) {
    const id = text(x.ruleId)
    const r = ruleById.get(id)
    if (!r) no(x.quote, `${id || '(no ID)'} is not a rule of this tool.`)
    else if (r.kind === 'locked') refused.push({ ruleId: id, quote: text(x.quote), breaks: r.origin, why: `${r.title} (${id}) is fixed by ${r.origin} and cannot be changed.` })
    else {
      const value = r.key ? coerce(r, x.value) : undefined
      if (value === undefined) no(x.quote, `“${String(x.value)}” is not a value ${id} can take.`)
      else {
        const confidence = Math.max(0, Math.min(1, typeof x.confidence === 'number' ? x.confidence : 0))
        rules.set(id, { ruleId: id, value, quote: text(x.quote), confidence, ...(x.waiver === true ? { waiver: true } : {}) }) // typed later, wins
      }
    }
  }
  compiled.rules = [...rules.values()]

  for (const x of list('directives')) {
    const q = text(x.quote)
    const wide = x.pages === 'all' || x.pages === 'flagged' ? (x.pages as 'all' | 'flagged') : undefined
    const range = wide ? undefined : parsePages(String(x.pages ?? ''), pages)
    const bad = (why: string) => no(q, why)
    const pagesOk = () => (range ? true : (bad(`The pages “${String(x.pages)}” are not pages of this book${pages ? ` (${pages} pages)` : ''}.`), false))
    let d: Directive | undefined
    switch (x.op) {
      case 'ai_pages':
        if (wide || pagesOk()) d = { op: 'ai_pages', pages: wide ?? range!, quote: q }
        break
      case 'strict_review':
        if (x.pages === 'all' || pagesOk()) d = { op: 'strict_review', pages: x.pages === 'all' ? 'all' : range!, quote: q }
        break
      case 'skip_pages':
        if (x.as !== 'artifact' && x.as !== 'keep') bad(`“${String(x.as)}” is not artifact or keep.`)
        else if (pagesOk()) d = { op: 'skip_pages', pages: range!, as: x.as, quote: q }
        break
      case 'plates':
        if (pagesOk()) d = { op: 'plates', pages: range!, quote: q }
        break
      case 'columns':
        if (x.n !== 1 && x.n !== 2 && x.n !== 3) bad(`${String(x.n)} columns: only 1, 2 or 3.`)
        else if (pagesOk()) d = { op: 'columns', pages: range!, n: x.n, quote: q }
        break
      case 'treat_as':
        if (!['toc', 'index', 'notes', 'illustrations', 'body'].includes(String(x.kind))) bad(`“${String(x.kind)}” is not a kind of page the tool knows.`)
        else if (pagesOk()) d = { op: 'treat_as', pages: range!, kind: x.kind as 'toc', quote: q }
        break
      case 'caption_style':
        if (!['italic', 'smaller', 'label'].includes(String(x.signal)) || x.near !== 'figure') bad('A caption can be told by italic, smaller or label type, near a figure.')
        else d = { op: 'caption_style', signal: x.signal as 'italic', near: 'figure', quote: q }
        break
      case 'heading_map':
        if (!text(x.sample) || !LEVELS.has(String(x.level))) bad(`“${String(x.level)}” is not a heading level (H1–H6) or P.`)
        else d = { op: 'heading_map', sample: text(x.sample), level: x.level as Level, quote: q }
        break
      default:
        bad(`“${String(x.op)}” is not something the tool can be told to do.`)
    }
    if (d) compiled.directives.push(d)
  }

  for (const x of list('hints')) {
    const scope = text(x.scope).toLowerCase() === 'book' ? 'book' : parsePages(String(x.scope ?? ''), pages)
    if (!scope || !text(x.text)) no(x.quote, `The hint is for “${String(x.scope)}”, which is not the book or pages of this book.`)
    else compiled.hints.push({ scope, text: text(x.text), quote: text(x.quote) })
  }
  return { compiled, refused }
}

// ---- compiling, once ----------------------------------------------------------------------------------------------------------------------------

export interface InstructionCache {
  get(key: string): { text: string; reply: unknown } | undefined
  put(key: string, e: { text: string; reply: unknown }): void
}
export const memoryCache = (): InstructionCache => {
  const m = new Map<string, { text: string; reply: unknown }>()
  return { get: (k) => m.get(k), put: (k, e) => void m.set(k, e) }
}

export type Compile = { ok: true; compiled: CompiledInstruction; refused: Refused[]; cached: boolean } | { ok: false; why: string }
export interface CompileOptions {
  fetch?: typeof fetch
  /** pages in the book, for the page-range check */
  pages?: number
  cache?: InstructionCache
  /** answer from the cache only (a miss is "not compiled yet"): for the stages that run without a model */
  cacheOnly?: boolean
  timeoutMs?: number
}

/**
 * Compile the text once per (text, catalogue version). Never throws: an empty text, a model that is off or an answer that is not JSON is
 * `ok: false` with the reason, and the instruction counts as absent (§a.5). The reply is cached before the check, so a rule renamed later
 * is caught on the next read, and the same text always gives the same result.
 */
export async function compileInstruction(input: string, cfg: VisionConfig, o: CompileOptions = {}): Promise<Compile> {
  const t = input.trim()
  if (!t) return { ok: false, why: 'The instruction is empty.' }
  const key = hash(`${CATALOGUE_VERSION}\n${t}`)
  const hit = o.cache?.get(key)
  const done = (reply: unknown, cached: boolean): Compile => ({ ok: true, ...validateCompiled(reply, o.pages), cached })
  if (hit && hit.text === t) return done(hit.reply, true)
  if (o.cacheOnly) return { ok: false, why: 'The instruction has not been compiled yet.' }
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), o.timeoutMs ?? 60_000)
  try {
    const res = await (o.fetch ?? fetch)(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cfg.apiKey.trim() ? { Authorization: `Bearer ${cfg.apiKey.trim()}` } : {}) },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0,
        seed: 7,
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: t }],
        response_format: { type: 'json_schema', json_schema: { name: 'compiled_instruction', strict: true, schema: instructionSchema() } },
      }),
      signal: ctl.signal,
    })
    if (!res.ok) return { ok: false, why: res.status === 401 || res.status === 403 ? 'The model refused the key.' : `The model answered ${res.status}.` }
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    const raw = (body.choices?.[0]?.message?.content ?? '').replace(/```(?:json)?/gi, '')
    let reply: unknown
    try {
      reply = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1))
    } catch {
      return { ok: false, why: 'The model’s answer was not JSON.' }
    }
    o.cache?.put(key, { text: t, reply })
    return done(reply, false)
  } catch (e) {
    return { ok: false, why: ctl.signal.aborted ? 'The model did not answer in time.' : (e as Error).message || 'The model did not answer.' }
  } finally {
    clearTimeout(timer)
  }
}

// ---- the layer ------------------------------------------------------------------------------------------------------------------------------------

/** Under this confidence, or on an accessibility rule, a run with nobody to ask does not take a rule from the instruction (§a.4). */
export const UNATTENDED_CONFIDENCE = 0.85

export interface PartlyUnderstood {
  ruleId: string
  quote: string
  why: string
}

/**
 * The `book` layer of rank 1 for an instruction. Interactive: every rule the operator ticked. Unattended: only confident rules that touch no
 * accessibility rule; the rest are `partly` understood and come back as `asHints`. An accessibility-lowering value is applied only when the
 * words say so (waiver): the quote, the actor and the time are then the waiver.
 */
export function instructionLayer(book: string, c: CompiledInstruction, o: { actor: string; at?: string; unattended?: boolean }): { layer: Layer; asHints: string[]; partly: PartlyUnderstood[] } {
  const at = o.at ?? new Date().toISOString()
  const layer: Layer = { ...emptyLayer('book', book), rank: 1, updatedAt: at }
  const asHints: string[] = []
  const partly: PartlyUnderstood[] = []
  for (const x of c.rules) {
    const r = ruleById.get(x.ruleId)
    if (!r) continue
    const why = !o.unattended ? '' : r.kind === 'advisory' ? 'it changes an accessibility rule, so a person has to confirm it' : x.confidence < UNATTENDED_CONFIDENCE ? `the tool was only ${Math.round(x.confidence * 100)}% sure of it` : ''
    if (why) {
      partly.push({ ruleId: x.ruleId, quote: x.quote, why })
      asHints.push(`The instruction said “${x.quote}” (${r.title}); not applied as a rule: ${why}.`)
      continue
    }
    layer.values[x.ruleId] = x.value
    layer.sources[x.ruleId] = { file: 'instruction', where: 'typed instruction', text: x.quote, by: 'person' }
    if (x.waiver && needsWaiver(r, x.value)) layer.waivers[x.ruleId] = { at, by: o.actor, text: x.quote }
  }
  return { layer, asHints, partly }
}

// ---- directives → the knobs that exist ----------------------------------------------------------------------------------------------------

export interface Knobs {
  /** UaOptions.captionStyle */
  captionStyle?: { signal: 'italic' | 'smaller' | 'label'; near: 'figure' }
  /** reconcileHeadings({ headingMap }) */
  headingMap: HeadingMapEntry[]
  /** where the page reader runs; 'flagged' is the default */
  aiPages: PageRange | 'all' | 'flagged'
  strictPages?: PageRange | 'all'
  /** skip_pages as artifact: skipDecisions */
  skipPages: PageRange
  /** directives with no setting to change: they reach the page reader as hints, and REVIEW_NOTES lists them */
  asHints: Directive[]
  /** the page reader's context for one page: the book's hints, the page's, then the directives that are hints only */
  hintsFor(page: number): string[]
  isStrict(page: number): boolean
}

const HINT_OF = (d: Directive): string | undefined => {
  switch (d.op) {
    case 'plates': { const [p, is] = pagesWord(d.pages); return `${p} ${is} plates (pictures with their captions).` }
    case 'columns': { const [p, is] = pagesWord(d.pages); return `${p} ${is === 'is' ? 'has' : 'have'} ${['', 'one column', 'two columns', 'three columns'][d.n]}.` }
    case 'treat_as': { const [p, is] = pagesWord(d.pages); return `${p} ${is} ${{ toc: 'a table of contents', index: 'an index', notes: 'notes', illustrations: 'a list of illustrations', body: 'body text' }[d.kind]}.` }
    case 'skip_pages': { const [p, is] = pagesWord(d.pages); return d.as === 'keep' ? `${p} ${is} kept in the reading order, however ${is === 'is' ? 'it looks' : 'they look'}.` : undefined }
    default: return undefined
  }
}

export function knobsOf(c: CompiledInstruction): Knobs {
  const ds = c.directives
  const last = <T extends Directive['op']>(op: T) => ds.filter((d): d is Extract<Directive, { op: T }> => d.op === op).at(-1)
  const ai = last('ai_pages')
  const strict = last('strict_review')
  const cap = last('caption_style')
  const skipPages = ds.flatMap((d) => (d.op === 'skip_pages' && d.as === 'artifact' ? d.pages : []))
  const asHints = ds.filter((d) => (d.op === 'skip_pages' ? d.as === 'keep' : d.op === 'plates' || d.op === 'columns' || d.op === 'treat_as'))
  const covers = (r: PageRange | 'all' | 'flagged' | undefined, p: number) => r === 'all' || (Array.isArray(r) && inRange(r, p))
  return {
    ...(cap ? { captionStyle: { signal: cap.signal, near: cap.near } } : {}),
    headingMap: ds.flatMap((d) => (d.op === 'heading_map' ? [{ sample: d.sample, level: d.level }] : [])),
    aiPages: ai?.pages ?? 'flagged',
    ...(strict ? { strictPages: strict.pages } : {}),
    skipPages,
    asHints,
    hintsFor: (page) => [
      ...c.hints.filter((h) => h.scope === 'book').map((h) => h.text),
      ...c.hints.filter((h) => h.scope !== 'book' && inRange(h.scope, page)).map((h) => h.text),
      ...asHints.filter((d) => 'pages' in d && inRange(d.pages as PageRange, page)).map((d) => HINT_OF(d)!),
    ],
    isStrict: (page) => covers(strict?.pages, page),
  }
}

/** The pages the page reader runs on: the flagged ones (default), every page, or the flagged ones and the named range. */
export function aiPageSet(ai: Knobs['aiPages'], flagged: number[], all: number[]): number[] {
  if (ai === 'flagged') return [...flagged]
  if (ai === 'all') return [...all]
  return [...new Set([...flagged, ...all.filter((p) => inRange(ai, p))])].sort((a, b) => a - b)
}

/** skip_pages as artifact: the text of those pages is left out of the reading order, as a person's decision (which always wins). */
export function skipDecisions(evidence: PageEvidence[], k: Pick<Knobs, 'skipPages'>): PageDecision[] {
  return evidence
    .filter((ev) => inRange(k.skipPages, ev.page))
    .map((ev): PageDecision => ({ page: ev.page, by: 'person', ops: ev.blocks.filter((b) => b.kind === 'text').map((b) => ({ op: 'role', id: b.id, role: 'Artifact' })) }))
    .filter((d) => d.ops.length)
}

/** strict_review: the page reader's edits on those pages are not applied; the notes say they wait for a person. */
export function holdStrict<R extends { decisions: PageDecision[]; notes: DecisionNote[] }>(res: R, k: Pick<Knobs, 'isStrict'>): R & { held: PageDecision[] } {
  const held = res.decisions.filter((d) => k.isStrict(d.page))
  const page = (n: DecisionNote) => Number(/^page (\d+)$/.exec(n.where ?? '')?.[1] ?? 0)
  return {
    ...res,
    decisions: res.decisions.filter((d) => !k.isStrict(d.page)),
    notes: res.notes.map((n): DecisionNote => (n.status === 'applied' && k.isStrict(page(n)) ? { ...n, status: 'pending', how: 'left', chosen: `Waiting for a person to approve: ${n.chosen}` } : n)),
    held,
  }
}

// ---- REVIEW_NOTES ---------------------------------------------------------------------------------------------------------------------------------

const STEP = 'Instruction'
export interface InstructionNotesInput {
  compiled?: CompiledInstruction
  refused?: Refused[]
  /** the resolved spec: for the rules the instruction overrode */
  resolved?: Resolved
  partly?: PartlyUnderstood[]
  /** the text could not be read: it counts as absent */
  unreadable?: { text: string; why: string }
}

/** What the instruction did, for REVIEW_NOTES: overrides, refusals, what was only partly understood, what is only a hint. */
export function instructionNotes(i: InstructionNotesInput): DecisionNote[] {
  const out: DecisionNote[] = []
  if (i.unreadable) out.push({ step: STEP, item: `Instruction could not be read: ${i.unreadable.text}`, chosen: `Treated as if there were none (${i.unreadable.why}).`, how: 'left' })
  for (const f of i.refused ?? []) out.push({ step: STEP, item: `The instruction asked to change ${ruleById.get(f.ruleId)?.title ?? f.ruleId} (${f.ruleId}): “${f.quote}”`, chosen: `Not applied: breaks ${f.breaks}. The rule stays as it is.`, how: 'left', rule: f.ruleId })
  for (const x of i.compiled?.rules ?? []) {
    const r = ruleById.get(x.ruleId)
    const f = i.resolved?.from[x.ruleId]
    if (!r || f?.source?.file !== 'instruction' || !f.overrode) continue
    const o = f.overrode
    const was = `${o.level === 'book' ? 'spec' : LEVEL_LABEL[o.level].toLowerCase()}${o.source?.where ? ` ${o.source.where}` : ''}`
    out.push({ step: STEP, item: `Instruction overrode ${x.ruleId} (${was} said ${show(r, o.value)})`, chosen: `Used ${show(r, x.value)} for this book, as typed: “${x.quote}”`, how: 'person', rule: x.ruleId, before: show(r, o.value), after: show(r, x.value) })
  }
  for (const p of i.partly ?? []) out.push({ step: STEP, item: `Instruction partly understood: “${p.quote}”`, chosen: `Given to the page reader as a hint, not applied as a rule: ${p.why}.`, how: 'left', rule: p.ruleId })
  for (const u of i.compiled?.unmapped ?? []) out.push({ step: STEP, item: `Instruction partly understood: “${u.quote}”`, chosen: `Not applied: ${u.why}`, how: 'left' })
  for (const d of knobsOf(i.compiled ?? { rules: [], directives: [], hints: [], unmapped: [] }).asHints) out.push({ step: STEP, item: `Instruction “${d.quote}” has no setting to change`, chosen: 'Given to the page reader as a hint.', how: 'guess' })
  return out
}
