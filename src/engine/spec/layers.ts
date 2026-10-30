// =============================================================================================
// Rule layers: each layer states only what differs from the one below it. Later layers win:
//
//   house   → our defaults (Settings screen)
//   client  → the client's own house style (publisher), set by the client in the Spec step
//   series  → a series or imprint set differently from the client's other books
//   book    → this title only, including requirements imported from the client's Word/Excel files
//
// Standards are not a layer: 'locked' rules are never in a layer, and an 'advisory' value only
// takes effect with a waiver recorded on the same layer ("Yes, I know this reduces accessibility…").
// Every resolved value says which layer (and which file and row, for imported requirements) set it.
// =============================================================================================
import { DEFAULT_SETTINGS, type HouseSettings, type MarkupTemplate, type MarkupRole, type StyleRule } from '../settings.ts'
import { RULES, ruleById, needsWaiver, show, type RuleValue } from './rules.ts'
import { baseSettings, defaultFor, type OutputKind } from '../output/standards.ts'
import type { BookDetails } from './bookdetails.ts'

export const LEVELS = ['house', 'client', 'series', 'book'] as const
export type Level = (typeof LEVELS)[number]
export const LEVEL_LABEL: Record<Level, string> = { house: 'House default', client: 'Client style', series: 'Series', book: 'This book' }

export interface Source {
  file: string
  where: string // "row 14", "paragraph 3"
  text: string // the requirement as written
  by: 'keywords' | 'ai' | 'template' | 'person'
  /** a client correction (the rulebook); with `date` it beats a spec document dated before it (OPUS_DESIGN2 a.3) */
  correction?: boolean
  /** ISO date the document was written; none means older than every correction */
  date?: string
}
export interface Waiver {
  at: string // ISO time
  by: string // who ticked it
  text: string // the wording they accepted
}
export interface Layer {
  level: Level
  /** order inside one level: a book's instruction (rank 1) is read after its spec (rank 0, the default) and wins over it (OPUS_DESIGN2 a.3) */
  rank?: number
  name: string // "" for house, the publisher for client, the series name, the book (ISBN or title)
  values: Record<string, RuleValue> // rule ID → value
  sources: Record<string, Source>
  waivers: Record<string, Waiver>
  /** reader-facing label overrides per 2-letter language code (from the client's language workbook); merged into settings.labels */
  labels?: Record<string, Record<string, string>>
  /** how a role is written out (chapter title, note reference); later layers win per role */
  markup?: Partial<Record<MarkupRole, MarkupTemplate>>
  /** source style → meaning, keyed by a name for the entry; later layers win per key */
  styleMap?: Record<string, StyleRule>
  /** the client's CSS, appended after the house CSS */
  css?: string
  /** the client's Book_Details workbook (a book's file plan); the last layer that has one wins */
  bookDetails?: BookDetails
  updatedAt: string
}

export const emptyLayer = (level: Level, name: string): Layer => ({ level, name, values: {}, sources: {}, waivers: {}, updatedAt: new Date().toISOString() })

/** Two sources that disagree, or a source that asks for a locked change (OPUS_DESIGN2 a.3). `ask` is the question for the client, when one is needed. */
export interface Conflict {
  kind: 'locked' | 'correction' | 'same-source'
  ruleId: string
  quotes: string[]
  item: string
  chosen: string
  ask?: string
}

export interface Resolved {
  settings: HouseSettings
  /** rule ID → who set the value in effect */
  from: Record<string, { level: Level | 'default'; name: string; source?: Source; waiver?: Waiver; basis?: { plain: string; standard: string }; overrode?: { level: Level; name: string; source?: Source; value: RuleValue } }>
  /** advisory values that were asked for but have no waiver yet (the accessible value stays in effect) */
  pendingWaivers: { ruleId: string; level: Level; name: string; value: RuleValue }[]
  /** where sources disagreed and what was kept: REVIEW_NOTES lines and the client's open questions (precedence.ts) */
  conflicts: Conflict[]
}

/** The settings in effect for a build: every layer applied in order, with provenance. A value no layer sets is the default of the
 *  output type (with its reason and the standard it comes from), or the house default when no type is given. */
export function resolve(layers: Layer[], base: HouseSettings = DEFAULT_SETTINGS, kind?: OutputKind): Resolved {
  if (kind) base = baseSettings(kind)
  const settings = { ...base } as Record<string, unknown>
  const from: Resolved['from'] = {}
  const pendingWaivers: Resolved['pendingWaivers'] = []
  const conflicts: Conflict[] = []
  for (const r of RULES) if (r.key) from[r.id] = { level: 'default', name: '', ...(kind ? { basis: (({ plain, standard }) => ({ plain, standard }))(defaultFor(kind, r.id)) } : {}) }
  const ordered = [...layers].sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level) || (a.rank ?? 0) - (b.rank ?? 0))
  const labels: Record<string, Record<string, string>> = {}
  for (const [code, m] of Object.entries(base.labels ?? {})) labels[code] = { ...m }
  for (const layer of ordered) {
    for (const [id, value] of Object.entries(layer.values)) {
      const r = ruleById.get(id)
      const src = layer.sources[id]
      if (r?.kind === 'locked' && src && !(r.key && JSON.stringify(settings[r.key]) === JSON.stringify(value))) {
        const said = `“${src.text}” (${src.file}, ${src.where})`
        conflicts.push({ kind: 'locked', ruleId: id, quotes: [src.text], item: `${src.file} asked to change ${r.title} (${id}): “${src.text}”`, chosen: `Not applied: breaks ${r.origin}. The rule stays as it is.`, ask: `${r.title} (${id}): your file says ${said}, but ${r.origin} does not allow it, so it was not applied. Please confirm or change the requirement.` })
      }
      if (!r || !r.key || r.kind === 'locked') continue
      if (needsWaiver(r, value) && !layer.waivers[id]) {
        pendingWaivers.push({ ruleId: id, level: layer.level, name: layer.name, value })
        continue
      }
      // an instruction that replaces a value some layer set says whose it was (REVIEW_NOTES: "spec row 14 said …")
      const was = from[id]
      const differs = JSON.stringify(settings[r.key]) !== JSON.stringify(value)
      // spec over rulebook, except a client correction dated after the spec document (an undated spec is older than every correction)
      if (!layer.rank && src && differs && was.level === 'client' && was.source?.correction && later(was.source.date, src.date)) {
        const c = was.source, title = `${r.title} (${id})`, said = `“${src.text}” (${src.file}, ${src.where})`, corr = `“${c.text}” (${c.file}, ${c.where}, ${c.date})`
        conflicts.push({
          kind: 'correction', ruleId: id, quotes: [src.text, c.text],
          item: `The spec and a later client correction disagree on ${title}: ${said} and ${corr}`,
          chosen: `Used ${show(r, settings[r.key] as RuleValue)}, the client's correction of ${c.date}, over the spec.`,
          ask: `${title}: the spec says ${said}, but a later correction says ${corr}. We used the correction. Is that right?`,
        })
        continue
      }
      // two rows of one file on different levels: the level nearest the book wins, listed without a question
      if (!layer.rank && src && differs && was.source && was.source.file === src.file && was.level !== layer.level)
        conflicts.push({ kind: 'same-source', ruleId: id, quotes: [was.source.text, src.text], item: `Two rows of ${src.file} disagree on ${r.title} (${id}): “${was.source.text}” (${was.source.where}) and “${src.text}” (${src.where})`, chosen: `Used ${show(r, value)} (${src.where}), the row nearest the book.` })
      const overrode = layer.rank && was.level !== 'default' && JSON.stringify(settings[r.key]) !== JSON.stringify(value) ? { level: was.level, name: was.name, source: was.source, value: settings[r.key] as RuleValue } : undefined
      settings[r.key] = value
      from[id] = { level: layer.level, name: layer.name, source: layer.sources[id], waiver: layer.waivers[id], ...(overrode ? { overrode } : {}) }
    }
    for (const [code, m] of Object.entries(layer.labels ?? {})) labels[code] = { ...(labels[code] ?? {}), ...m }
  }
  settings.labels = labels
  const markup: Record<string, MarkupTemplate> = { ...(base.markup ?? {}) }
  const styleMap: Record<string, StyleRule> = { ...(base.styleMap ?? {}) }
  const css = [String(settings.extraCss ?? '')].filter(Boolean) // the house value, or CSS-03 as the last layer set it
  for (const layer of ordered) {
    const who = { level: layer.level, name: layer.name }
    for (const [role, t] of Object.entries(layer.markup ?? {})) (markup[role] = t), (from[`markup:${role}`] = who)
    for (const [key, r] of Object.entries(layer.styleMap ?? {})) (styleMap[key] = r), (from[`style:${key}`] = who)
    if (layer.css?.trim()) css.push(layer.css.trim())
    if (layer.bookDetails) (settings.bookDetails = layer.bookDetails), (from['bookDetails'] = who)
  }
  settings.markup = markup
  settings.styleMap = styleMap
  settings.extraCss = css.join('\n')
  return { settings: settings as unknown as HouseSettings, from, pendingWaivers, conflicts }
}

/** Is the correction dated strictly after the spec document? A correction with no valid date never is; a spec with none always is older. */
const later = (correction?: string, spec?: string) => {
  const c = Date.parse(correction ?? ''), s = Date.parse(spec ?? '')
  return !isNaN(c) && (isNaN(s) || c > s)
}

/** A layer holding the differences between a settings object and the defaults (the house layer from the Settings screen). */
export function layerFromSettings(level: Level, name: string, s: HouseSettings, base: HouseSettings = DEFAULT_SETTINGS): Layer {
  const l = emptyLayer(level, name)
  for (const r of RULES) {
    if (!r.key) continue
    if (JSON.stringify(s[r.key]) !== JSON.stringify(base[r.key])) l.values[r.id] = s[r.key] as RuleValue
  }
  // labels are not rule-shaped (a nested map); carry them on the layer so Settings-screen wording flows through too
  if (s.labels && Object.keys(s.labels).length) l.labels = s.labels
  return l
}

/** Short fingerprint of the values in effect: stored with each decision, so a record proves which spec was accepted. */
export function specHash(s: HouseSettings): string {
  const text = JSON.stringify(RULES.filter((r) => r.key).map((r) => [r.id, s[r.key!]]))
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  return (h >>> 0).toString(16).padStart(8, '0')
}
