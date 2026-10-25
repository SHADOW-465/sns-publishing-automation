// JSON file store. Used when Supabase is not configured (no SUPABASE_URL). Tests use this, not the network.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { MemoryStore, type SpecStore } from './store.ts'
import type { Layer } from './layers.ts'
import type { Decision } from './store.ts'
import { SupabaseStore } from './supabase-store.ts'
import { supabaseFromEnv } from './env.ts'

export class JsonFileStore extends MemoryStore {
  private readonly filePath: string
  constructor(filePath: string) {
    super()
    this.filePath = filePath
    try {
      const db = JSON.parse(readFileSync(this.filePath, 'utf8')) as { layers?: Layer[]; decisions?: Decision[] }
      for (const l of db.layers ?? []) this.layers.set(`${l.level}|${l.name.trim().toLowerCase()}`, l)
      this.decisions = db.decisions ?? []
    } catch {
      /* no file yet */
    }
  }
  protected persist() {
    mkdirSync(dirname(this.filePath), { recursive: true })
    writeFileSync(this.filePath, JSON.stringify({ layers: [...this.layers.values()], decisions: this.decisions }, null, 2))
  }
}

/** Supabase when the URL and key are set under any name supabaseFromEnv knows; otherwise the JSON file at SNS_STORE, or an in-memory store. The key is never printed. */
export function openStoreFromEnv(env: Record<string, string | undefined> = process.env): SpecStore {
  const sb = supabaseFromEnv(env)
  if (sb) return new SupabaseStore(sb.url, sb.key)
  if (env.SNS_STORE) return new JsonFileStore(env.SNS_STORE)
  return new MemoryStore()
}
