// Server-side "Fix with AI" (Vercel function). The Groq key lives only here, in process.env.GROQ_API_KEY: it is never sent to the
// browser, never logged and never returned. Any failure answers { fallback: true } and the app keeps its own best guesses.
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
export const MODEL = 'llama-3.3-70b-versatile'
// Free Groq models, tried in order when the key has no access to one (404 / model_not_found / decommissioned).
export const MODELS = [MODEL, 'openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'meta-llama/llama-4-scout-17b-16e-instruct', 'qwen/qwen3-32b', 'llama-3.1-8b-instant']
let workingModel = 0
const MAX_BODY = 200_000
const MAX_TEXT = 14_000
const MAX_ITEMS = 120
const BATCH = 40
const TIMEOUT_MS = 25_000

type Item = { id: string; label: string; options: string[]; currentGuess?: string; location?: string; context?: string }
type Body = { task: 'details'; text: string; missing: string[]; lang?: string } | { task: 'choose'; items: Item[] }

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function groq(key: string, messages: { role: string; content: string }[], f: typeof fetch = fetch): Promise<unknown> {
  for (let attempt = 0, mi = workingModel; ; attempt++) {
    const ac = new AbortController()
    const t = setTimeout(() => ac.abort(), TIMEOUT_MS)
    try {
      const r = await f(GROQ_URL, { method: 'POST', signal: ac.signal, headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: MODELS[mi], temperature: 0, response_format: { type: 'json_object' }, messages }) })
      if (r.status === 429 && attempt < 2) {
        const ra = Number(r.headers.get('retry-after'))
        await sleep(Math.min(8000, Number.isFinite(ra) && ra > 0 ? ra * 1000 : 1500 * (attempt + 1)))
        continue
      }
      if ((r.status === 404 || r.status === 400) && mi < MODELS.length - 1) {
        const txt = await r.text().catch(() => '')
        if (r.status === 404 || /model/i.test(txt)) { mi++; attempt--; continue }
        throw new Error('groq ' + r.status + ' ' + txt.replace(/[^\w .,:-]/g, ' ').slice(0, 120))
      }
      if (!r.ok) throw new Error('groq ' + r.status + ' ' + (await r.text().catch(() => '')).replace(/[^\w .,:-]/g, ' ').slice(0, 120))
      const d = (await r.json()) as { choices?: { message?: { content?: string } }[] }
      workingModel = mi
      return JSON.parse(d.choices?.[0]?.message?.content ?? '')
    } finally {
      clearTimeout(t)
    }
  }
}

const str = (v: unknown, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

export async function handle(body: Body, key: string, f: typeof fetch = fetch): Promise<unknown> {
  if (body.task === 'details') {
    const fields = (body.missing ?? []).filter((x) => ['title', 'authors', 'publisher', 'eisbn'].includes(x))
    if (!fields.length) return { found: {} }
    const out = (await groq(key, [
      { role: 'system', content: 'You read the front matter of a book (title page, copyright page) and return JSON. Only copy values that are literally printed in the text. Never invent. If a value is not in the text, return an empty string for it.' },
      { role: 'user', content: `Fields wanted: ${fields.join(', ')} (authors: names separated by ", "; eisbn: the e-book / digital ISBN only if marked as such, else the only ISBN given). Return {"title":"","authors":"","publisher":"","eisbn":""}.\n\nTEXT:\n${String(body.text ?? '').slice(0, MAX_TEXT)}` },
    ], f)) as Record<string, unknown>
    const found: Record<string, string> = {}
    for (const k of fields) { const v = str(out?.[k]); if (v && String(body.text).toLowerCase().includes(v.toLowerCase().slice(0, 12))) found[k] = v } // must appear in the text
    return { found }
  }
  if (body.task === 'choose') {
    const items = (body.items ?? []).slice(0, MAX_ITEMS)
    const decisions: { id: string; choice: string; reason: string }[] = []
    for (let i = 0; i < items.length; i += BATCH) {
      const batch = items.slice(i, i + BATCH)
      const out = (await groq(key, [
        { role: 'system', content: 'You help an e-book production tool. For each item pick exactly one of its options (copy the option text exactly) and give a short reason. Return {"decisions":[{"id":"","choice":"","reason":""}]}.' },
        { role: 'user', content: JSON.stringify(batch) },
      ], f)) as { decisions?: { id?: unknown; choice?: unknown; reason?: unknown }[] }
      for (const it of batch) {
        const d = out?.decisions?.find((x) => x?.id === it.id)
        const c = str(d?.choice)
        decisions.push({ id: it.id, choice: it.options.includes(c) ? c : it.currentGuess ?? it.options[0] ?? '', reason: it.options.includes(c) ? str(d?.reason, 200) : 'kept the current guess (invalid answer)' })
      }
    }
    return { decisions }
  }
  throw new Error('unknown task')
}

export async function POST(req: Request): Promise<Response> {
  const key = process.env.GROQ_API_KEY
  if (!key) return json(503, { fallback: true, error: 'AI is not configured' })
  const raw = await req.text()
  if (raw.length > MAX_BODY) return json(413, { fallback: true, error: 'too large' })
  let body: Body
  try { body = JSON.parse(raw) } catch { return json(400, { fallback: true, error: 'bad json' }) }
  try {
    return json(200, { model: MODEL, ...(await handle(body, key) as object) })
  } catch (e) {
    // the reason only (status or error name), never the key or the request
    return json(502, { fallback: true, error: 'AI call failed: ' + String((e as Error)?.name === 'AbortError' ? 'timeout' : (e as Error)?.message).slice(0, 160) })
  }
}
