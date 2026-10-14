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
import { DEFAULT_SETTINGS, type HouseSettings } from '../settings.ts'
import { RULES, ruleById, needsWaiver, type RuleValue } from './rules.ts'

export const LEVELS = ['house', 'client', 'series', 'book'] as const
export type Level = (typeof LEVELS)[number]
export const LEVEL_LABEL: Record<Level, string> = { house: 'House default', client: 'Client style', series: 'Series', book: 'This book' }

export interface Source {
  file: string
  where: string // "row 14", "paragraph 3"
  text: string // the requirement as written
  by: 'keywords' | 'ai' | 'template' | 'person'
}
export interface Waiver {
  at: string // ISO time
  by: string // who ticked it
  text: string // the wording they accepted
}
export interface Layer {
  level: Level
  name: string // "" for house, the publisher for client, the series name, the book (ISBN or title)
  values: Record<string, RuleValue> // rule ID → value
  sources: Record<string, Source>
  waivers: Record<string, Waiver>
  /** reader-facing label overrides per 2-letter language code (from the client's language workbook); merged into settings.labels */
  labels?: Record<string, Record<string, string>>
  updatedAt: string
}

export const emptyLayer = (level: Level, name: string): Layer => ({ level, name, values: {}, sources: {}, waivers: {}, updatedAt: new Date().toISOString() })

export interface Resolved {
  settings: HouseSettings
  /** rule ID → who set the value in effect */
  from: Record<string, { level: Level | 'default'; name: string; source?: Source; waiver?: Waiver }>
  /** advisory values that were asked for but have no waiver yet (the accessible value stays in effect) */
  pendingWaivers: { ruleId: string; level: Level; name: string; value: RuleValue }[]
}

/** The settings in effect for a build: every layer applied in order, with provenance. */
export function resolve(layers: Layer[], base: HouseSettings = DEFAULT_SETTINGS): Resolved {
  const settings = { ...base } as Record<string, unknown>
  const from: Resolved['from'] = {}
  const pendingWaivers: Resolved['pendingWaivers'] = []
  for (const r of RULES) if (r.key) from[r.id] = { level: 'default', name: '' }
  const ordered = [...layers].sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level))
  const labels: Record<string, Record<string, string>> = {}
  for (const [code, m] of Object.entries(base.labels ?? {})) labels[code] = { ...m }
  for (const layer of ordered) {
    for (const [id, value] of Object.entries(layer.values)) {
      const r = ruleById.get(id)
      if (!r || !r.key || r.kind === 'locked') continue
      if (needsWaiver(r, value) && !layer.waivers[id]) {
        pendingWaivers.push({ ruleId: id, level: layer.level, name: layer.name, value })
        continue
      }
      settings[r.key] = value
      from[id] = { level: layer.level, name: layer.name, source: layer.sources[id], waiver: layer.waivers[id] }
    }
    for (const [code, m] of Object.entries(layer.labels ?? {})) labels[code] = { ...(labels[code] ?? {}), ...m }
  }
  settings.labels = labels
  return { settings: settings as unknown as HouseSettings, from, pendingWaivers }
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
