// Node-only. Reads .env.local into process.env (values already set win) and finds the Supabase settings
// under any of the names Supabase's own templates use. Never logs a value.
import { existsSync } from 'node:fs'

export function loadEnvLocal(file = '.env.local') {
  if (existsSync(file)) process.loadEnvFile(file)
}

const first = (env: Record<string, string | undefined>, names: string[]) => names.map((n) => env[n]).find(Boolean)
const withPrefixes = (tail: string[]) => ['', 'NEXT_PUBLIC_', 'VITE_'].flatMap((p) => tail.map((t) => `${p}${t}`))

export function supabaseFromEnv(env: Record<string, string | undefined> = process.env): { url: string; key: string } | undefined {
  const url = first(env, withPrefixes(['SUPABASE_URL']))
  const key = first(env, withPrefixes(['SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_PUBLISHABLE_OR_ANON_KEY', 'SUPABASE_PUBLISHABLE_DEFAULT_KEY']))
  return url && key ? { url, key } : undefined
}
