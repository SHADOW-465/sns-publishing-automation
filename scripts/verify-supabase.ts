// Checks the Supabase project against supabase/migrations/20261023180000_clients_books.sql. Run: npx tsx scripts/verify-supabase.ts
// (or node scripts/verify-supabase.ts). Reads .env.local. Prints PASS/FAIL lines only, never a key.
// With only the anon key, row level security refuses writes (no policy for anon): set SUPABASE_SERVICE_ROLE_KEY for this check.
import { deepStrictEqual } from 'node:assert'
import { loadEnvLocal, supabaseFromEnv } from '../src/engine/spec/env.ts'
import { SupabaseStore } from '../src/engine/spec/supabase-store.ts'
import { emptyLayer } from '../src/engine/spec/layers.ts'

loadEnvLocal()
const sb = supabaseFromEnv()
if (!sb) {
  console.log('FAIL config: no Supabase URL and key found in the environment or .env.local')
  process.exit(1)
}
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const key = serviceKey || sb.key
const base = `${sb.url.replace(/\/$/, '')}/rest/v1`
const call = (path: string, init: RequestInit = {}) =>
  fetch(`${base}/${path}`, { ...init, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(init.headers ?? {}) } })

let failed = 0
const report = (ok: boolean, what: string, why = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${what}${ok || !why ? '' : ` - ${why}`}`)
}
console.log(`INFO using the ${serviceKey ? 'service role' : 'anon'} key`)

for (const t of ['clients', 'layers', 'books', 'jobs', 'reference_files', 'decisions']) {
  try {
    const r = await call(`${t}?select=*&limit=0`)
    report(r.ok, `table ${t} exists`, r.status === 404 ? 'not found: apply the migration' : `status ${r.status}`)
  } catch (e) {
    report(false, `table ${t} exists`, `unreachable (${(e as Error).message})`)
  }
}

const name = `__verify_${Date.now()}__`
const store = new SupabaseStore(sb.url, key)
let clientId: string | undefined
try {
  const layer = emptyLayer('client', name)
  layer.values['NAV-02'] = 'strip'
  const c = await call('clients', { method: 'POST', body: JSON.stringify({ name }) })
  if (!c.ok) throw new Error(`creating the client row was refused (${c.status})${c.status === 401 || c.status === 403 ? ': row level security needs a signed-in user or SUPABASE_SERVICE_ROLE_KEY' : ''}`)
  clientId = ((await c.json()) as { id: string }[])[0]?.id
  report(!!clientId, 'client row created')
  await store.saveLayer(layer)
  const back = await store.getLayer('client', name)
  if (!back) throw new Error('the layer saved but was not read back')
  const pick = (l: typeof layer) => ({ level: l.level, name: l.name, values: l.values, sources: l.sources, waivers: l.waivers })
  deepStrictEqual(pick(back), pick(layer))
  report(true, 'settings layer read back equal')
} catch (e) {
  report(false, 'client row with settings layer round trip', (e as Error).message.split('\n')[0])
} finally {
  const gone = [await call(`layers?level=eq.client&name=eq.${encodeURIComponent(name)}`, { method: 'DELETE' }), clientId ? await call(`clients?id=eq.${clientId}`, { method: 'DELETE' }) : null]
  const left = await call(`layers?name=eq.${encodeURIComponent(name)}&select=id`).then((r) => (r.ok ? r.json() : [])).catch(() => [])
  report(gone.every((r) => !r || r.ok) && (left as unknown[]).length === 0, 'test rows deleted', 'cleanup failed or was refused; remove rows named __verify_* by hand')
}
process.exit(failed ? 1 : 0)
