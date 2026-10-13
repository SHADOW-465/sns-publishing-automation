// Optional picture descriptions from a vision model, through any OpenAI-compatible chat API.
// Off unless a key is typed in Settings. The key stays in this browser (localStorage) and is never
// written into a book, a spec, or the repository. Groq is the default; OpenRouter or any other
// base URL works the same way.

import { ALT_AIM, fitAlt, repeatsCaption } from './alt.ts'
import { extOf, mediaType } from './image.ts'

export const VISION_KEY = 'automation:vision'
export const GROQ_VISION_BASE = 'https://api.groq.com/openai/v1'
export const GROQ_VISION_MODEL = 'qwen/qwen3.6-27b'
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

/** The instruction sent with the picture. German books get a German instruction. */
export function visionPrompt(lang: string, caption: string, nearby: string): string {
  const code = lang.toLowerCase().slice(0, 2)
  const cap = caption.trim()
  const near = nearby.trim()
  if (code === 'de') {
    return [
      'Beschreibe nur, was auf dem Bild zu sehen ist.',
      `Höchstens etwa ${ALT_AIM} Zeichen, ein Satz.`,
      'Wiederhole nicht die Bildunterschrift und erfinde nichts, was nicht zu sehen ist.',
      cap ? `Bildunterschrift (nicht wiederholen): ${cap}` : 'Es gibt keine Bildunterschrift.',
      near ? `Text daneben: ${near}` : '',
    ].filter(Boolean).join('\n')
  }
  const name = LANG_NAME[code] ?? lang
  return [
    `Describe only what is visible in the picture. Write in ${name}.`,
    `At most about ${ALT_AIM} characters, one sentence.`,
    'Do not repeat the caption, and do not invent anything that is not visible.',
    cap ? `Caption (do not repeat it): ${cap}` : 'There is no caption.',
    near ? `Nearby text: ${near}` : '',
  ].filter(Boolean).join('\n')
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
          { role: 'system', content: 'You write alt text for one picture in an e-book. Reply with the description only.' },
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
    return fitAlt(body.choices?.[0]?.message?.content ?? '')
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
      const text = await once(cfg, visionPrompt(lang, item.caption, item.nearby), dataUrl(shrunk.bytes, shrunk.mime), doFetch)
      const alt = text && !repeatsCaption(text, item.caption) ? text : ''
      out.push({ id: item.id, alt, error: alt ? undefined : text ? 'The draft repeated the caption, so it was not kept.' : 'The model returned no description.' })
    } catch (e) {
      const message = (e as Error).message
      if (/refused|API key/i.test(message)) throw new Error(message)
      out.push({ id: item.id, alt: '', error: message })
    }
  }
  onProgress?.(items.length, items.length)
  return out
}
