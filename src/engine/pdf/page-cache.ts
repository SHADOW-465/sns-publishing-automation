// Cache and replay for the page reader (OPUS_DESIGN2 §b.6, T15). Determinism comes from the cache, not the model: the first answer for a
// page is stored under a key that names everything the answer could depend on, and is reused after. With `--replay` the model is never
// called: a page that is not in the cache fails the build loudly, so a rebuild is the same bytes as the first build.
// A person's override is stored on the same key and always wins over the model, on later rebuilds too.
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { VisionConfig } from '../epub/alt-ai.ts'
import type { Op, PageDecision } from './decision.ts'
import { askPage, type AskOptions, type Left, type PageAnswer, type PageRequest } from './page-model.ts'

export const REPLAY_FLAG = '--replay'
export const isReplay = (argv: string[] = process.argv) => argv.includes(REPLAY_FLAG)

/** Who answered: the model and everything about the server that could change its answer (§b.6). */
export interface ModelId {
  modelId: string
  weightsSha256?: string
  quant?: string
  serverVersion?: string
  promptVersion: string
  schemaVersion: string
}

export interface KeyParts {
  /** sha256 of the page's content stream */
  pdfPageHash: string
  req: PageRequest
  model: ModelId
}

const sha = (x: string | Uint8Array) => createHash('sha256').update(x).digest('hex')
/** JSON with object keys sorted, so the same data is the same text */
const canon = (v: unknown): string =>
  Array.isArray(v) ? `[${v.map(canon).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => JSON.stringify(k) + ':' + canon((v as Record<string, unknown>)[k])).join(',')}}` : JSON.stringify(v)

/**
 * The key of one page's answer. The rules are the cards that apply to this page type and the hints for this page (not the whole rule
 * set), so changing a card changes the keys of the pages it applies to and no others.
 */
export function pageKey({ pdfPageHash, req, model }: KeyParts): string {
  return sha(canon({
    pdfPageHash,
    layout: req.ev,
    images: req.images.map((i) => [i.dpi, sha(i.png)]),
    model,
    system: req.system, // the generated prompt (T27): a card edit changes it only on the pages the card applies to
    rules: req.rules ?? [],
    hints: req.hints ?? [],
  }))
}

export interface CacheEntry {
  key: string
  page: number
  /** the model's raw text, kept even when it did not parse */
  raw?: string
  answer?: PageAnswer
  /** the page was "left": why (a live build asks again; replay keeps it left) */
  left?: string
  /** the validation of each op and which were applied, written by the caller once it has them */
  validation?: unknown
  applied?: number[]
  /** a person's ops for this page: they win over the model's answer */
  override?: { ops: Op[]; by: string; at: string }
  created: string
  updated: string
}

/** Thrown in replay mode when a page is not in the cache. Not caught anywhere: the build stops. */
export class ReplayMiss extends Error {
  page: number
  key: string
  constructor(page: number, key: string) {
    super(`Replay: page ${page} is not in the cache (key ${key.slice(0, 12)}). The page, the model, the prompt or a rule has changed since the first build.`)
    this.page = page
    this.key = key
  }
}

/** `cache/ai/<bookHash>/<pageKey>.json` */
export class PageCache {
  readonly dir: string
  constructor(root: string, bookHash: string) {
    this.dir = join(root, 'ai', bookHash)
  }
  private file = (key: string) => join(this.dir, `${key}.json`)
  get(key: string): CacheEntry | undefined {
    try {
      return JSON.parse(readFileSync(this.file(key), 'utf8')) as CacheEntry
    } catch {
      return undefined
    }
  }
  put(e: CacheEntry): void {
    mkdirSync(this.dir, { recursive: true })
    const tmp = this.file(e.key) + '.tmp'
    writeFileSync(tmp, JSON.stringify(e, null, 2))
    renameSync(tmp, this.file(e.key))
  }
  /** a person's ops for the page stored on its key; the model's answer stays beside it */
  setOverride(key: string, page: number, ops: Op[], by: string): CacheEntry {
    const now = new Date().toISOString()
    const e = this.get(key) ?? { key, page, created: now, updated: now }
    e.override = { ops, by, at: now }
    e.updated = now
    this.put(e)
    return e
  }
}

export interface CachedPage extends PageRequest {
  pdfPageHash: string
}
export interface CachedOptions extends AskOptions {
  cache: PageCache
  model: ModelId
  /** answer from the cache only; a miss throws ReplayMiss */
  replay?: boolean
}

/**
 * askPages with the cache in front. A hit is the stored answer (a person's override if there is one); a miss asks the model and stores
 * the answer. `decisions` are ready for decide(): by 'person' where a person overrode. Like askPages, a bad answer leaves the page "left".
 */
export async function askPagesCached(cfg: VisionConfig, pages: CachedPage[], o: CachedOptions): Promise<{ decisions: PageDecision[]; answers: Map<number, PageAnswer>; left: Left[]; keys: Map<number, string> }> {
  const decisions: PageDecision[] = []
  const answers = new Map<number, PageAnswer>()
  const left: Left[] = []
  const keys = new Map<number, string>()
  let down = false
  for (const p of pages) {
    const page = p.ev.page
    const key = pageKey({ pdfPageHash: p.pdfPageHash, req: p, model: o.model })
    keys.set(page, key)
    let e = o.cache.get(key)
    if (e?.override) {
      decisions.push({ page, ops: e.override.ops, by: 'person' })
      continue
    }
    if (!e || (e.left && !o.replay)) {
      if (o.replay) throw new ReplayMiss(page, key)
      if (down) {
        left.push({ page, why: 'page reader not available' })
        continue
      }
      const r = await askPage(cfg, p, o)
      const now = new Date().toISOString()
      if (r.status === 'ok') e = { key, page, raw: r.raw, answer: r.answer, created: e?.created ?? now, updated: now }
      else {
        if (r.status === 'unavailable') down = true
        const why = r.status === 'unavailable' ? 'page reader not available' : r.status === 'timeout' ? 'page reader timed out' : `page reader gave no usable answer: ${r.why}`
        // only a bad answer is worth keeping (replay then keeps the page left); a server that is off is not an answer
        if (r.status === 'invalid') o.cache.put({ key, page, raw: r.raw, left: why, created: now, updated: now })
        left.push({ page, why })
        continue
      }
      o.cache.put(e)
    }
    if (e.answer) {
      answers.set(page, e.answer)
      decisions.push({ page, ops: e.answer.ops, by: 'ai' })
    } else left.push({ page, why: e.left ?? 'page reader gave no usable answer' })
  }
  return { decisions, answers, left, keys }
}
