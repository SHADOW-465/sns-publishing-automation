// Optional picture descriptions from a vision model, through any OpenAI-compatible chat API.
// Off unless a key is typed in Settings. The key stays in this browser (localStorage) and is never
// written into a book, a spec, or the repository. Groq is the default; OpenRouter or any other
// base URL works the same way.

import { ALT_AIM, fitAlt, repeatsCaption } from './alt.ts'
import { extOf, mediaType } from './image.ts'
import { settings } from '../settings.ts'

export const VISION_KEY = 'automation:vision'
export const GROQ_VISION_BASE = 'https://api.groq.com/openai/v1'
export const GROQ_VISION_MODEL = 'qwen/qwen3.8-27b'
export const OPENROUTER_BASE = 'https://openrouter.ai/api/v1'

export interface VisionConfig {
  apiKey: string
  baseUrl: string
  model: string
}

const DEFAULTS: VisionConfig = { apiKey: '', baseUrl: GROQ_VISION_BASE, model: GROQ_VISION_MODEL }

/** Kept in this browser only. Never exported with settings or the spec. */
export function visionConfig(): VisionConfig {
  try {
    const c = JSON.parse(localStorage.getItem(VISION_KEY) ?? '{}') as Partial<VisionConfig>
    return { apiKey: c.apiKey ?? '', baseUrl: (c.baseUrl || DEFAULTS.baseUrl).replace(/\/$/, ''), model: c.model || DEFAULTS.model }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveVisionConfig(c: VisionConfig) {
  try {
    localStorage.setItem(VISION_KEY, JSON.stringify({ apiKey: c.apiKey, baseUrl: c.baseUrl.replace(/\/$/, ''), model: c.model }))
  } catch {
    /* storage blocked: the key lasts for this session only */
  }
}

const LANG_NAME: Record<string, string> = {
  de: 'German', en: 'English', es: 'Spanish', fr: 'French', it: 'Italian', pt: 'Portuguese', nl: 'Dutch',
  pl: 'Polish', sv: 'Swedish', da: 'Danish', tr: 'Turkish', ru: 'Russian', ar: 'Arabic', he: 'Hebrew', ca: 'Catalan', el: 'Greek',
}

export const PICTURE_KINDS = ['decorative', 'photo', 'portrait', 'artwork', 'chart', 'diagram', 'map', 'table', 'text', 'cover'] as const
export type PictureKind = (typeof PICTURE_KINDS)[number]

const COMPLEX_KIND = new Set<PictureKind>(['chart', 'diagram', 'map', 'table'])

export interface ClassifiedAlt {
  kind: PictureKind
  decorative: boolean
  alt: string
  longDesc: string
}

const KIND_WORD: Record<string, PictureKind> = {
  decorative: 'decorative', ornament: 'decorative', decoration: 'decorative',
  photo: 'photo', photograph: 'photo', portrait: 'portrait', artwork: 'artwork', art: 'artwork',
  chart: 'chart', graph: 'chart', diagram: 'diagram', map: 'map',
  table: 'table', 'table-as-image': 'table',
  text: 'text', logo: 'text', cover: 'cover',
}

/** The instruction sent with the picture. The model classifies first, then describes, in the book's language. */
export function visionPrompt(lang: string, caption: string, nearby: string, max = ALT_AIM): string {
  const code = lang.toLowerCase().slice(0, 2)
  const name = LANG_NAME[code] ?? lang
  const cap = caption.trim()
  const near = nearby.trim()
  return [
    'Classify the picture, then describe it.',
    'Reply with one JSON object and nothing else, no markdown:',
    '{"kind":"photo","decorative":false,"alt":"...","longdesc":""}',
    'kind is one of: decorative, photo, portrait, artwork, chart, diagram, map, table, text, cover.',
    'decorative is true only for an ornament, a rule, a background, or a picture that adds no information. Then alt and longdesc are empty strings.',
    `Write alt and longdesc in ${name}.`,
    `alt is at most ${max} characters. Do not start alt with "image of", "picture of", or "Bild von".`,
    'Do not repeat the caption. Do not invent anything that is not visible.',
    'chart, diagram, map, or table: alt says what the figure is; longdesc gives the data a reader cannot get from the short alt.',
    'text or cover: alt transcribes the visible words, and longdesc is empty.',
    'photo, portrait, or artwork: one sentence in alt, and longdesc is empty.',
    cap ? `Caption (do not repeat it): ${cap}` : 'There is no caption.',
    near ? `Nearby text: ${near}` : '',
  ].filter(Boolean).join('\n')
}

const LEADING = /^(?:image of|picture of|bild von)\s+/i

function asKind(raw: unknown): PictureKind {
  const k = String(raw ?? '').toLowerCase().trim()
  return KIND_WORD[k] ?? 'photo'
}

/** Turn the model's reply into a classified description. Plain text (no JSON) is kept as a photo alt. */
export function parseVisionReply(raw: string, caption: string, max = ALT_AIM): ClassifiedAlt {
  const text = raw.replace(/```(?:json)?/gi, '').trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  let parsed: Record<string, unknown> | null = null
  if (start >= 0 && end > start) {
    try {
      const value = JSON.parse(text.slice(start, end + 1)) as unknown
      const obj = Array.isArray(value) ? value[0] : value
      if (obj && typeof obj === 'object') parsed = obj as Record<string, unknown>
    } catch {
      parsed = null
    }
  }
  if (!parsed) {
    const alt = fitAlt(text, max).replace(LEADING, '')
    return { kind: 'photo', decorative: false, alt: repeatsCaption(alt, caption) ? '' : alt, longDesc: '' }
  }
  const kind = asKind(parsed.kind)
  const decorative = parsed.decorative === true || parsed.decorative === 'true' || kind === 'decorative'
  if (decorative) return { kind: 'decorative', decorative: true, alt: '', longDesc: '' }
  let alt = fitAlt(String(parsed.alt ?? parsed.description ?? ''), max).replace(LEADING, '').trim()
  if (LEADING.test(alt)) alt = alt.replace(LEADING, '').trim()
  if (repeatsCaption(alt, caption)) alt = ''
  const longRaw = String(parsed.longdesc ?? parsed.longDesc ?? parsed.long_desc ?? '').replace(/\s+/g, ' ').trim()
  const longDesc = COMPLEX_KIND.has(kind) ? longRaw : ''
  return { kind, decorative: false, alt, longDesc }
}

export function mimeOf(path: string, bytes: Uint8Array): string {
  const e = extOf(bytes)
  if (e === 'png') return 'image/png'
  if (e === 'gif') return 'image/gif'
  if (e === 'webp') return 'image/webp'
  if (e === 'svg') return 'image/svg+xml'
  if (e === 'jpg') return 'image/jpeg'
  return mediaType(path)
}

function dataUrl(bytes: Uint8Array, mime: string): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return `data:${mime};base64,${btoa(bin)}`
}

/** Shrink a picture before sending it. Skipped when this environment cannot draw (tests, Node). */
export async function shrinkForVision(bytes: Uint8Array, mime: string): Promise<{ bytes: Uint8Array; mime: string }> {
  // Node (and the tests) have no canvas. The browser app draws a smaller JPEG before the request.
  if (typeof document === 'undefined' || mime === 'image/svg+xml' || typeof process !== 'undefined' && !!process.versions?.node) return { bytes, mime }
  try {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }))
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('unreadable'))
      img.src = url
    })
    const longest = Math.max(img.naturalWidth, img.naturalHeight) || 1
    const scale = Math.min(1, 768 / longest)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return { bytes, mime }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.7))
    URL.revokeObjectURL(url)
    if (!blob) return { bytes, mime }
    return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'image/jpeg' }
  } catch {
    return { bytes, mime }
  }
}

export interface AltDraftRequest {
  id: string
  bytes: Uint8Array
  mime: string
  caption: string
  nearby: string
}

export interface AltDraftResult {
  id: string
  alt: string
  longDesc: string
  decorative: boolean
  kind: PictureKind | ''
  error?: string
}

const OFF = 'Picture descriptions from a vision model are off. Add an API key in Settings.'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type Fetch = typeof fetch

async function once(cfg: VisionConfig, prompt: string, image: string, doFetch: Fetch): Promise<string> {
  let wait = 1000
  let last = 'The vision model did not answer.'
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await doFetch(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey.trim()}` },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: 'You classify one picture in an e-book and describe it. Reply with one JSON object only.' },
          { role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: image } }] },
        ],
      }),
    })
    if (res.status === 429) {
      const retry = Number(res.headers.get('retry-after'))
      await sleep(Number.isFinite(retry) && retry >= 0 ? retry * 1000 : wait)
      wait = Math.min(wait * 2, 16000)
      last = 'The vision model is rate-limiting requests. Wait a minute and try again.'
      continue
    }
    if (res.status === 401 || res.status === 403) throw new Error('The API key was refused. Check it in Settings.')
    if (!res.ok) {
      last = `The vision model answered ${res.status}.`
      if (attempt < 3 && res.status >= 500) {
        await sleep(wait)
        wait *= 2
        continue
      }
      throw new Error(last)
    }
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    return body.choices?.[0]?.message?.content ?? ''
  }
  throw new Error(last)
}

/**
 * Draft a description for each picture. Without a key, nothing is sent.
 * A draft that only repeats the caption is returned empty. One refused key stops the batch.
 */
export async function draftPictureAlts(
  items: AltDraftRequest[],
  lang: string,
  cfg: VisionConfig,
  onProgress?: (done: number, total: number) => void,
  doFetch: Fetch = fetch,
): Promise<AltDraftResult[]> {
  if (!cfg.apiKey.trim()) throw new Error(OFF)
  const out: AltDraftResult[] = []
  for (let i = 0; i < items.length; i++) {
    onProgress?.(i, items.length)
    const item = items[i]
    try {
      const shrunk = await shrinkForVision(item.bytes, item.mime)
      const text = await once(cfg, visionPrompt(lang, item.caption, item.nearby, settings().altMaxChars), dataUrl(shrunk.bytes, shrunk.mime), doFetch)
      const parsed = parseVisionReply(text, item.caption, settings().altMaxChars)
      const kept = parsed.decorative || !!parsed.alt
      out.push({
        id: item.id,
        alt: parsed.alt,
        longDesc: parsed.longDesc,
        decorative: parsed.decorative,
        kind: parsed.kind,
        error: kept ? undefined : text.trim() ? 'The draft repeated the caption, so it was not kept.' : 'The model returned no description.',
      })
    } catch (e) {
      const message = (e as Error).message
      if (/refused|API key/i.test(message)) throw new Error(message)
      out.push({ id: item.id, alt: '', longDesc: '', decorative: false, kind: '', error: message })
    }
  }
  onProgress?.(items.length, items.length)
  return out
}
