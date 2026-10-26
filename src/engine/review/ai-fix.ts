// Browser side of "Fix with AI": asks the app's own server route (/api/ai-fix, Groq). No key is ever in the browser. Any failure
// (offline, static server without the route, timeout, rate limit) returns undefined and the caller keeps its best guesses.
import type { DecisionNote } from './decisions.ts'

export const AI_LABEL = 'AI (Groq llama-3.3-70b)'

export async function callAiFix<T>(body: unknown, opts: { timeoutMs?: number; fetchImpl?: typeof fetch; url?: string } = {}): Promise<T | undefined> {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), opts.timeoutMs ?? 45_000)
  try {
    const r = await (opts.fetchImpl ?? fetch)(opts.url ?? '/api/ai-fix', { method: 'POST', signal: ac.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    if (!r.ok) return undefined
    const d = (await r.json()) as T & { fallback?: boolean }
    return d?.fallback ? undefined : d
  } catch {
    return undefined
  } finally {
    clearTimeout(t)
  }
}

type Meta = { title: string; authors: string; publisher: string; eisbn: string }

/** Book details the book does not give: the AI reads the front matter and copies values it finds printed there. */
export async function aiDetails<M extends Meta>(meta: M, frontText: string, opts: Parameters<typeof callAiFix>[1] = {}): Promise<{ meta: M; notes: DecisionNote[] }> {
  const missing = (['title', 'authors', 'publisher', 'eisbn'] as const).filter((k) => !String(meta[k] ?? '').trim())
  if (!missing.length || !frontText.trim()) return { meta, notes: [] }
  const r = await callAiFix<{ found?: Partial<Record<keyof Meta, string>> }>({ task: 'details', text: frontText.slice(0, 14_000), missing }, opts)
  if (!r?.found) return { meta, notes: [] }
  let m = meta
  const notes: DecisionNote[] = []
  for (const k of missing) {
    const v = r.found[k]?.trim()
    if (!v) continue
    m = { ...m, [k]: v }
    notes.push({ step: 'Book details', item: `The ${k === 'eisbn' ? 'e-book ISBN' : k === 'authors' ? 'author' : k} was missing`, chosen: `Filled in “${v}”, as printed in the book’s front matter. Please check.`, how: 'ai', where: `Book details › ${k}` })
  }
  return { meta: m, notes }
}

/** Front-matter text for the AI: the first stretch of the book plus any line that looks like a copyright/imprint line. */
export function frontMatterText(lines: string[], max = 12_000): string {
  const clean = lines.map((l) => String(l ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean)
  const imprint = clean.filter((l) => /©|copyright|isbn|publish|verlag|editor|edici|editore|edition|first published/i.test(l))
  return [...clean.slice(0, 250), '---', ...imprint.slice(0, 60)].join('\n').slice(0, max)
}
