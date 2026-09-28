// =============================================================================================
// Where layers and decisions are kept. The app talks to the SpecStore interface only, so the
// desktop version can swap in SQLite (schema in docs/spec-schema.sql) without touching the rest.
//
// Today: BrowserStore keeps "tables" as JSON in localStorage (this computer, this browser).
// Tests use MemoryStore. Decisions are append-only: a record is never changed or deleted, which is
// what makes the log usable as proof ("the client accepted spec 3f9a…, with these waivers, on …").
// =============================================================================================
import type { Layer, Level } from './layers.ts'
import type { HouseSettings } from '../settings.ts'

export type DecisionAction = 'accepted' | 'proceeded' | 'waiver' | 'waiver-withdrawn' | 'import' | 'change'
export interface Decision {
  id: string
  at: string // ISO time
  actor: string // who clicked
  action: DecisionAction
  client: string
  book: string
  ruleId?: string
  detail: string
  /** fingerprint of the rules in effect (layers.specHash) */
  specHash: string
  /** the full resolved settings at that moment, for 'accepted' / 'proceeded' */
  snapshot?: Partial<HouseSettings>
}

export interface SpecStore {
  getLayer(level: Level, name: string): Promise<Layer | undefined>
  saveLayer(layer: Layer): Promise<void>
  listLayers(level?: Level): Promise<Layer[]>
  /** append-only */
  addDecision(d: Omit<Decision, 'id' | 'at'>): Promise<Decision>
  listDecisions(filter?: { client?: string; book?: string }): Promise<Decision[]>
}

const layerKey = (level: Level, name: string) => `${level}|${name.trim().toLowerCase()}`
const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

export class MemoryStore implements SpecStore {
  protected layers = new Map<string, Layer>()
  protected decisions: Decision[] = []
  async getLayer(level: Level, name: string) {
    return this.layers.get(layerKey(level, name))
  }
  async saveLayer(layer: Layer) {
    this.layers.set(layerKey(layer.level, layer.name), { ...layer, updatedAt: new Date().toISOString() })
    this.persist()
  }
  async listLayers(level?: Level) {
    return [...this.layers.values()].filter((l) => !level || l.level === level)
  }
  async addDecision(d: Omit<Decision, 'id' | 'at'>) {
    const rec: Decision = { ...d, id: newId(), at: new Date().toISOString() }
    this.decisions.push(rec)
    this.persist()
    return rec
  }
  async listDecisions(filter: { client?: string; book?: string } = {}) {
    const eq = (a: string, b?: string) => !b || a.trim().toLowerCase() === b.trim().toLowerCase()
    return this.decisions.filter((d) => eq(d.client, filter.client) && eq(d.book, filter.book)).slice().reverse()
  }
  protected persist() {}
}

/** localStorage-backed store for the web app. Storage can be unavailable (private window): it then works for the session only. */
export class BrowserStore extends MemoryStore {
  private static KEY = 'automation:spec-db'
  constructor() {
    super()
    try {
      const raw = localStorage.getItem(BrowserStore.KEY)
      if (raw) {
        const db = JSON.parse(raw) as { layers: Layer[]; decisions: Decision[] }
        for (const l of db.layers ?? []) this.layers.set(layerKey(l.level, l.name), l)
        this.decisions = db.decisions ?? []
      }
    } catch {
      /* unreadable: start empty */
    }
  }
  protected persist() {
    try {
      localStorage.setItem(BrowserStore.KEY, JSON.stringify({ layers: [...this.layers.values()], decisions: this.decisions }))
    } catch {
      /* full or blocked: kept for this session */
    }
  }
  /** everything, for a backup file */
  exportAll() {
    return JSON.stringify({ layers: [...this.layers.values()], decisions: this.decisions }, null, 2)
  }
}

let current: SpecStore = typeof localStorage === 'undefined' ? new MemoryStore() : new BrowserStore()
export const store = () => current
export const setStore = (s: SpecStore) => (current = s)
