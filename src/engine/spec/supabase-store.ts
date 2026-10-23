// Supabase REST access for the same tables as supabase/migrations. Not used unless
// SUPABASE_URL and SUPABASE_ANON_KEY are set. Never logs the key.
import type { SpecStore, Decision, DecisionAction } from './store.ts'
import type { Layer, Level } from './layers.ts'
import type { HouseSettings } from '../settings.ts'

interface Row {
  id?: string
  level?: Level
  name?: string
  body?: Layer
  at?: string
  actor?: string
  action?: DecisionAction
  client?: string
  book?: string
  rule_id?: string
  detail?: string
  spec_hash?: string
  snapshot?: Partial<HouseSettings>
}

export class SupabaseStore implements SpecStore {
  private readonly url: string
  private readonly key: string
  constructor(url: string, key: string) {
    this.url = url
    this.key = key
  }

  private async rest(path: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetch(`${this.url.replace(/\/$/, '')}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: this.key,
        Authorization: `Bearer ${this.key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
        ...(init.headers ?? {}),
      },
    })
    if (!res.ok) throw new Error(`The settings store refused the request (${res.status}). Check the project URL and that the migration has been applied.`)
    return res
  }

  async getLayer(level: Level, name: string) {
    const q = `layers?level=eq.${encodeURIComponent(level)}&name=eq.${encodeURIComponent(name.trim())}&select=body&limit=1`
    const rows = (await (await this.rest(q)).json()) as { body: Layer }[]
    return rows[0]?.body
  }
  async saveLayer(layer: Layer) {
    await this.rest('layers?on_conflict=level,name', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ level: layer.level, name: layer.name, body: { ...layer, updatedAt: new Date().toISOString() } }) })
  }
  async listLayers(level?: Level) {
    const q = level ? `layers?level=eq.${encodeURIComponent(level)}&select=body` : 'layers?select=body'
    const rows = (await (await this.rest(q)).json()) as { body: Layer }[]
    return rows.map((r) => r.body)
  }
  async addDecision(d: Omit<Decision, 'id' | 'at'>) {
    const rows = (await (await this.rest('decisions', { method: 'POST', body: JSON.stringify({ actor: d.actor, action: d.action, client: d.client, book: d.book, rule_id: d.ruleId ?? null, detail: d.detail, spec_hash: d.specHash, snapshot: d.snapshot ?? null }) })).json()) as Row[]
    const r = rows[0]
    return { ...d, id: r?.id ?? '', at: r?.at ?? new Date().toISOString() }
  }
  async listDecisions(filter: { client?: string; book?: string } = {}) {
    const bits = ['select=*', 'order=at.desc']
    if (filter.client) bits.push(`client=eq.${encodeURIComponent(filter.client)}`)
    if (filter.book) bits.push(`book=eq.${encodeURIComponent(filter.book)}`)
    const rows = (await (await this.rest(`decisions?${bits.join('&')}`)).json()) as Row[]
    return rows.map((r) => ({ id: r.id ?? '', at: r.at ?? '', actor: r.actor ?? '', action: r.action ?? 'change', client: r.client ?? '', book: r.book ?? '', ruleId: r.rule_id, detail: r.detail ?? '', specHash: r.spec_hash ?? '', snapshot: r.snapshot }))
  }
}
