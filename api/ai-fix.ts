// Server-side "Fix with AI" (Vercel function). The Groq key lives only here, in process.env.GROQ_API_KEY: it is never sent to the
// browser, never logged and never returned. Any failure answers { fallback: true } and the app keeps its own best guesses.
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
export const MODEL = 'llama-3.3-70b-versatile'
// Free Groq models, tried in order when the key has no access to one (404 / model_not_found / decommissioned).
export const MODELS = [MODEL, 'openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'meta-llama/llama-4-scout-17b-16e-instruct', 'qwen/qwen3-32b', 'llama-3.1-8b-instant']
let workingModel = 0
// Groq models that take a picture (docs: console.groq.com/docs/vision), tried in order like MODELS.
export const VISION_MODELS = ['qwen/qwen3.8-27b', 'meta-llama/llama-4-scout-17b-16e-instruct', 'meta-llama/llama-4-maverick-17b-128e-instruct']
let workingVision = 0
const MAX_BODY = 200_000
const MAX_IMAGE_BODY = 600_000 // a picture the browser has already shrunk (about 800 px, JPEG)
const MAX_ALT = 150
const MAX_TEXT = 14_000
const MAX_ITEMS = 120
const BATCH = 40
const TIMEOUT_MS = 25_000

type Item = { id: string; label: string; options: string[]; currentGuess?: string; location?: string; context?: string }
type Body = { task: 'vision'; image: string; caption?: string; lang?: string; max?: number } | { task: 'details'; text: string; missing: string[]; lang?: string } | { task: 'choose'; items: Item[] }

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type Message = { role: string; content: string | { type: string; text?: string; image_url?: { url: string } }[] }
export async function groq(key: string, messages: Message[], f: typeof fetch = fetch, vision = false): Promise<unknown> {
  const models = vision ? VISION_MODELS : MODELS
  for (let attempt = 0, mi = vision ? workingVision : workingModel; ; attempt++) {
    const ac = new AbortController()
    const t = setTimeout(() => ac.abort(), TIMEOUT_MS)
    try {
      const r = await f(GROQ_URL, { method: 'POST', signal: ac.signal, headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: models[mi], temperature: 0, ...(vision ? {} : { response_format: { type: 'json_object' } }), messages }) })
      if (r.status === 429 && attempt < 2) {
        const ra = Number(r.headers.get('retry-after'))
        await sleep(Math.min(8000, Number.isFinite(ra) && ra > 0 ? ra * 1000 : 1500 * (attempt + 1)))
        continue
      }
      if ((r.status === 404 || r.status === 400) && mi < models.length - 1) {
        const txt = await r.text().catch(() => '')
        if (r.status === 404 || /model/i.test(txt)) { mi++; attempt--; continue }
        throw new Error('groq ' + r.status + ' ' + txt.replace(/[^\w .,:-]/g, ' ').slice(0, 120))
      }
      if (!r.ok) throw new Error('groq ' + r.status + ' ' + (await r.text().catch(() => '')).replace(/[^\w .,:-]/g, ' ').slice(0, 120))
      const d = (await r.json()) as { choices?: { message?: { content?: string } }[] }
      if (vision) workingVision = mi
      else workingModel = mi
      const content = d.choices?.[0]?.message?.content ?? ''
      return vision ? content : JSON.parse(content)
    } finally {
      clearTimeout(t)
    }
  }
}

const str = (v: unknown, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

const LANG = { de: 'German', en: 'English', es: 'Spanish', fr: 'French', it: 'Italian', pt: 'Portuguese', nl: 'Dutch', pl: 'Polish', sv: 'Swedish', da: 'Danish' } as Record<string, string>

/** One short description of a picture. The reply is cleaned to plain text of at most MAX_ALT characters; an empty reply throws (the route answers fallback). */
async function describe(body: Extract<Body, { task: 'vision' }>, key: string, f: typeof fetch): Promise<string> {
  const image = String(body.image ?? '')
  if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image)) throw new Error('bad image')
  const max = Math.min(MAX_ALT, Math.max(40, Number(body.max) || MAX_ALT))
  const lang = LANG[String(body.lang ?? 'en').toLowerCase().slice(0, 2)] ?? 'English'
  const cap = str(body.caption, 300)
  const prompt = [
    `Describe this picture from a book for a blind reader, in ${lang}: one plain sentence of at most ${max} characters.`,
    'Say what is visible. Do not start with "image of" or "picture of". Do not invent names, places or dates. Reply with the sentence only.',
    cap ? `Its caption is: ${cap}. Do not repeat the caption; add what it does not say.` : 'It has no caption.',
  ].join(' ')
  const out = await groq(key, [
    { role: 'system', content: 'You write short alternative text for pictures in e-books.' },
    { role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: image } }] },
  ], f, true)
  let alt = String(out ?? '').replace(/<think>[^]*?<\/think>/gi, '').replace(/```[a-z]*/gi, '').replace(/\s+/g, ' ').trim().replace(/^["“'‘]+|["”'’]+$/g, '').replace(/^(?:image|picture|photo(?:graph)?) of\s+/i, '')
  if (alt.length > max) alt = alt.slice(0, max).replace(/\s+\S*$/, '').replace(/[,;:\s]+$/, '') + (/[.!?]$/.test(alt.slice(0, max)) ? '' : '.')
  if (!alt || (cap && alt.toLowerCase() === cap.toLowerCase())) throw new Error('no description')
  return alt
}

export async function handle(body: Body, key: string, f: typeof fetch = fetch): Promise<unknown> {
  if (body.task === 'vision') return { alt: await describe(body, key, f) }
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
  if (raw.length > (raw.includes('"task":"vision"') ? MAX_IMAGE_BODY : MAX_BODY)) return json(413, { fallback: true, error: 'too large' })
  let body: Body
  try { body = JSON.parse(raw) } catch { return json(400, { fallback: true, error: 'bad json' }) }
  try {
    return json(200, { model: MODEL, ...(await handle(body, key) as object) })
  } catch (e) {
    // the reason only (status or error name), never the key or the request
    return json(502, { fallback: true, error: 'AI call failed: ' + String((e as Error)?.name === 'AbortError' ? 'timeout' : (e as Error)?.message).split(key).join('***').slice(0, 160) })
  }
}
