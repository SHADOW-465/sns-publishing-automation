// The spec of one build: house settings, the client's style, the series and the book, resolved,
// with every change, waiver and acceptance written to the store as a decision.
import { houseSettings, setSettings, DEFAULT_SETTINGS, type HouseSettings } from '../settings.ts'
import { ruleById, show, needsWaiver, WAIVER_TEXT, type RuleValue } from './rules.ts'
import { emptyLayer, layerFromSettings, resolve, specHash, LEVEL_LABEL, type Layer, type Level, type Resolved, type Source } from './layers.ts'
import { store, type Decision, type DecisionAction } from './store.ts'

export interface SpecContext {
  client: string // publisher
  series: string
  book: string // e-ISBN or title
}

export interface Spec {
  ctx: SpecContext
  house: HouseSettings // the Settings screen, before any layer
  layers: Layer[] // client, series, book (house is folded into `house`)
  resolved: Resolved
}

/** Load the client, series and book layers for a build (creating empty ones). */
export async function openSpec(ctx: SpecContext, house: HouseSettings = houseSettings()): Promise<Spec> {
  const get = async (level: Level, name: string) => (name.trim() ? ((await store().getLayer(level, name)) ?? emptyLayer(level, name)) : undefined)
  const layers = [await get('client', ctx.client), await get('series', ctx.series), await get('book', ctx.book)].filter((l): l is Layer => !!l)
  return { ctx, house, layers, resolved: resolveSpec(house, layers) }
}

export const resolveSpec = (house: HouseSettings, layers: Layer[]) => resolve([layerFromSettings('house', '', house, DEFAULT_SETTINGS), ...layers], DEFAULT_SETTINGS)

async function log(spec: Spec, actor: string, action: DecisionAction, detail: string, extra: Partial<Decision> = {}) {
  return store().addDecision({ actor: actor || '(no name)', action, client: spec.ctx.client, book: spec.ctx.book, detail, specHash: specHash(spec.resolved.settings), ...extra })
}

/** Set (or with undefined, clear) a rule on one layer. Changing an accessibility rule back to its safe value withdraws the waiver. */
export async function setRule(spec: Spec, level: Level, ruleId: string, value: RuleValue | undefined, actor: string, source?: Source): Promise<Spec> {
  const r = ruleById.get(ruleId)
  if (!r || !r.key || r.kind === 'locked') throw new Error(`${ruleId} is fixed and cannot be changed.`)
  const layer = spec.layers.find((l) => l.level === level)
  if (!layer) throw new Error(`There is no ${LEVEL_LABEL[level].toLowerCase()} layer for this book (name it first).`)
  const next: Layer = { ...layer, values: { ...layer.values }, sources: { ...layer.sources }, waivers: { ...layer.waivers } }
  if (value === undefined) {
    delete next.values[ruleId]
    delete next.sources[ruleId]
  } else {
    next.values[ruleId] = value
    if (source) next.sources[ruleId] = source
    else delete next.sources[ruleId]
  }
  if (next.waivers[ruleId] && !needsWaiver(r, value)) {
    delete next.waivers[ruleId]
    await log(spec, actor, 'waiver-withdrawn', `${ruleId} back to ${show(r, r.safe)}: waiver no longer needed.`, { ruleId })
  }
  await store().saveLayer(next)
  const out = withLayer(spec, next)
  await log(out, actor, source ? 'import' : 'change', `${LEVEL_LABEL[level]}${layer.name ? ` (${layer.name})` : ''}: ${ruleId} ${value === undefined ? 'reset to the value below' : `= ${show(r, value)}`}${source ? ` — from ${source.file}, ${source.where}: “${source.text.slice(0, 120)}”` : ''}`, { ruleId })
  return out
}

/** The click on "Yes, I know this reduces accessibility, do it anyway." — recorded with who and when. */
export async function giveWaiver(spec: Spec, level: Level, ruleId: string, actor: string): Promise<Spec> {
  if (!actor.trim()) throw new Error('Type your name first: a waiver records who agreed to it.')
  const layer = spec.layers.find((l) => l.level === level)
  const r = ruleById.get(ruleId)
  if (!layer || !r) return spec
  const next: Layer = { ...layer, waivers: { ...layer.waivers, [ruleId]: { at: new Date().toISOString(), by: actor.trim(), text: WAIVER_TEXT } } }
  await store().saveLayer(next)
  const out = withLayer(spec, next)
  await log(out, actor, 'waiver', `${ruleId} = ${show(r, layer.values[ruleId])}: “${WAIVER_TEXT}”`, { ruleId })
  return out
}

/** "Accept this spec" or "Continue without accepting": either way, the spec in effect is recorded. */
export async function decide(spec: Spec, actor: string, accepted: boolean): Promise<Decision> {
  const w = Object.entries(spec.resolved.from).filter(([, f]) => f.waiver).map(([id]) => id)
  const detail = `${accepted ? 'Accepted' : 'Continued without accepting'} the spec for “${spec.ctx.book}”${w.length ? ` with waivers for ${w.join(', ')}` : ''}${spec.resolved.pendingWaivers.length ? `; ${spec.resolved.pendingWaivers.length} requested change(s) not applied for want of a waiver` : ''}.`
  return log(spec, actor, accepted ? 'accepted' : 'proceeded', detail, { snapshot: spec.resolved.settings })
}

const withLayer = (spec: Spec, layer: Layer): Spec => {
  const layers = spec.layers.map((l) => (l.level === layer.level ? layer : l))
  return { ...spec, layers, resolved: resolveSpec(spec.house, layers) }
}

/** Make the resolved spec the settings the engine builds with. */
export const applySpec = (spec: Spec) => setSettings(spec.resolved.settings)
