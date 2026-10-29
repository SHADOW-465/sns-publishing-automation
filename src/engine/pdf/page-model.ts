// The page reader's client (OPUS_DESIGN2 §b.2, §b.4, §b.8, T14): one page's image and layout JSON go to a local OpenAI-compatible server
// (vLLM, llama.cpp; the same config as the picture describer in epub/alt-ai.ts), and a typed PageAnswer comes back, shaped by a JSON
// schema at decode time. This file only asks and parses. Whether an answer is allowed to change a page is the validator's job (validate.ts).
// It never throws and never blocks a build: a bad, slow or missing answer leaves the page "left" with the reason in plain words.
import { dataUrl, type VisionConfig } from '../epub/alt-ai.ts'
import type { Op } from './decision.ts'
import type { PageEvidence } from './evidence.ts'
import type { Raster } from './raster.ts'

export interface PageAnswer {
  page: number
  ops: Op[]
  confidence: number
  reasons: { op: number; why: string; rule?: string }[]
}

/** §b.7: 60 s per page */
export const PAGE_MODEL_TIMEOUT_MS = 60_000
/** pinned with temperature 0 and top_k 1 (§b.6); the cache, not the model, is what makes a rebuild repeatable */
const PINNED = { temperature: 0, seed: 7, top_k: 1, max_tokens: 4096 }
export const PAGE_MODEL_SYSTEM = [
  'You read one page of a book from its picture and the layout JSON the engine built from it.',
  'Reply with one JSON object that follows the schema, and nothing else.',
  'You may say what each block is, where it is read, and what belongs together, using the block IDs in the JSON. You never write, change or remove text.',
  'If the engine is right, reply with {"op":"none"} only.',
].join('\n')

const ID = { type: 'string' }
const IDS = { type: 'array', items: ID }
const ROLES = ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'Caption', 'Note', 'Artifact', 'Aside', 'LI', 'TOCI', 'BlockQuote']
const op = (name: string, props: Record<string, unknown>, required: string[]) => ({
  type: 'object', additionalProperties: false, properties: { op: { const: name }, ...props }, required: ['op', ...required],
})

/** The JSON schema of a PageAnswer (§b.5); the server uses it for guided decoding. */
export function pageAnswerSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      page: { type: 'integer' },
      ops: {
        type: 'array',
        items: {
          anyOf: [
            op('order', { ids: IDS }, ['ids']),
            op('role', { id: ID, role: { enum: ROLES } }, ['id', 'role']),
            op('split', { id: ID, atLine: ID, roles: { type: 'array', items: { enum: ROLES }, minItems: 2, maxItems: 2 } }, ['id', 'atLine', 'roles']),
            op('merge', { ids: IDS }, ['ids']),
            op('continues', { id: ID, from: ID }, ['id', 'from']),
            op('figure', { pieces: IDS, caption: ID }, ['pieces']),
            op('caption', { figure: ID, caption: ID }, ['figure', 'caption']),
            op('none', {}, []),
          ],
        },
      },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      reasons: {
        type: 'array',
        items: { type: 'object', additionalProperties: false, properties: { op: { type: 'integer' }, why: { type: 'string' }, rule: { type: 'string' } }, required: ['op', 'why'] },
      },
    },
    required: ['page', 'ops', 'confidence', 'reasons'],
  }
}

const OPS = new Set(['order', 'role', 'split', 'merge', 'continues', 'figure', 'caption', 'none'])

/** The reply text as a PageAnswer for `page`, or why it is not one. Only the shape is checked here; the validator checks the sense. */
export function parsePageAnswer(raw: string, page: number): { answer: PageAnswer } | { why: string } {
  const text = raw.replace(/```(?:json)?/gi, '')
  const a = text.indexOf('{')
  const b = text.lastIndexOf('}')
  if (a < 0 || b <= a) return { why: 'The answer was not JSON.' }
  let v: Record<string, unknown>
  try {
    v = JSON.parse(text.slice(a, b + 1))
  } catch {
    return { why: 'The answer was not valid JSON.' }
  }
  if (v.page !== page) return { why: `The answer is for page ${String(v.page)}, not page ${page}.` }
  if (!Array.isArray(v.ops)) return { why: 'The answer has no list of ops.' }
  const bad = v.ops.findIndex((o) => !o || typeof o !== 'object' || !OPS.has((o as { op?: string }).op ?? ''))
  if (bad >= 0) return { why: `Op ${bad} is not one of the known ops.` }
  if (typeof v.confidence !== 'number' || !(v.confidence >= 0 && v.confidence <= 1)) return { why: 'The confidence is not a number from 0 to 1.' }
  const reasons = Array.isArray(v.reasons) ? (v.reasons as PageAnswer['reasons']) : []
  return { answer: { page, ops: v.ops as Op[], confidence: v.confidence, reasons } }
}

export interface PageRequest {
  ev: PageEvidence
  /** PNG renders of the page (renderPage): 150 dpi for the page, 300 dpi crops for figure pieces */
  images: { dpi: number; png: Uint8Array }[]
  /** the rule cards that apply to this page type (c.4) and the hints from the instruction (a.4) */
  rules?: string[]
  hints?: string[]
}

export type PageReply =
  | { status: 'ok'; answer: PageAnswer; raw: string }
  | { status: 'invalid'; why: string; raw: string }
  | { status: 'timeout'; why: string }
  | { status: 'unavailable'; why: string }

export interface AskOptions {
  timeoutMs?: number
  fetch?: typeof fetch
}

/** One page, one request, no retries (rounds and retries are T16). */
export async function askPage(cfg: VisionConfig, r: PageRequest, o: AskOptions = {}): Promise<PageReply> {
  const text = [
    `Page ${r.ev.page}. Layout JSON:`,
    JSON.stringify(r.ev),
    r.rules?.length ? `Rules for this page:\n${r.rules.join('\n')}` : '',
    r.hints?.length ? `Hints:\n${r.hints.join('\n')}` : '',
    `Answer as a PageAnswer for page ${r.ev.page}.`,
  ].filter(Boolean).join('\n')
  const body = {
    model: cfg.model,
    ...PINNED,
    response_format: { type: 'json_schema', json_schema: { name: 'page_answer', strict: true, schema: pageAnswerSchema() } },
    messages: [
      { role: 'system', content: PAGE_MODEL_SYSTEM },
      { role: 'user', content: [{ type: 'text', text }, ...r.images.map((i) => ({ type: 'image_url', image_url: { url: dataUrl(i.png, 'image/png') } }))] },
    ],
  }
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), o.timeoutMs ?? PAGE_MODEL_TIMEOUT_MS)
  try {
    const res = await (o.fetch ?? fetch)(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cfg.apiKey.trim() ? { Authorization: `Bearer ${cfg.apiKey.trim()}` } : {}) },
      body: JSON.stringify(body),
      signal: ctl.signal,
    })
    if (res.status === 401 || res.status === 403) return { status: 'unavailable', why: 'The page reader refused the key.' }
    if (!res.ok) return { status: 'unavailable', why: `The page reader answered ${res.status}.` }
    // the body is read under the same timer: a server can send headers and then stall
    const reply = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    const raw = reply.choices?.[0]?.message?.content ?? ''
    const parsed = parsePageAnswer(raw, r.ev.page)
    return 'answer' in parsed ? { status: 'ok', answer: parsed.answer, raw } : { status: 'invalid', why: parsed.why, raw }
  } catch (e) {
    return ctl.signal.aborted ? { status: 'timeout', why: 'The page reader did not answer in time.' } : { status: 'unavailable', why: (e as Error).message || 'The page reader did not answer.' }
  } finally {
    clearTimeout(timer)
  }
}

export interface Left {
  page: number
  why: string
}

/**
 * Ask each page in turn (one local model, one request at a time). A page that gets no usable answer is "left" with the reason and
 * keeps the engine version. Once the server is not there, the other pages are left without being tried (§b.7 never block).
 */
export async function askPages(cfg: VisionConfig, pages: PageRequest[], o: AskOptions = {}): Promise<{ answers: Map<number, PageAnswer & { raw: string }>; left: Left[] }> {
  const answers = new Map<number, PageAnswer & { raw: string }>()
  const left: Left[] = []
  let down = false
  for (const p of pages) {
    if (down) {
      left.push({ page: p.ev.page, why: 'page reader not available' })
      continue
    }
    const r = await askPage(cfg, p, o)
    if (r.status === 'ok') answers.set(p.ev.page, { ...r.answer, raw: r.raw })
    else if (r.status === 'unavailable') (down = true), left.push({ page: p.ev.page, why: 'page reader not available' })
    else left.push({ page: p.ev.page, why: r.status === 'timeout' ? 'page reader timed out' : `page reader gave no usable answer: ${r.why}` })
  }
  return { answers, left }
}

/** A PNG of a page (or of `rect`, in page points, top-down) at `dpi`: 150 for the page, 300 for a figure crop (§b.4). */
export async function renderPage(raster: Raster, page: unknown, dpi: number, rect?: { x0: number; y0: number; x1: number; y1: number }): Promise<Uint8Array> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vp = (page as any).getViewport({ scale: 1 })
  const points = rect ? rect.y1 - rect.y0 : vp.height
  return raster.page(page, Math.round((points * dpi) / 72), rect, 'png')
}
