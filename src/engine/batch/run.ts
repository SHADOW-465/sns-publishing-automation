// The batch runner (OPUS_DESIGN2 §b.2, T19; OPUS_PLAN 5.1–5.2), without any I/O of its own: the stages and the model are given, so the order
// and the failure handling are testable. Phases: build every book, load the model once and let it read every book, unload it, rebuild with
// its answers, validate, score. A book that fails is a line in the queue, never the end of the run. scripts/batch.ts supplies real stages.

export type Phase = 'build' | 'ai' | 'apply' | 'validate'

export interface Item {
  /** 0-1: how sure the tool is that this is right. Under 0.6 a person should look (review/confidence.ts) */
  score: number
  msg: string
  where?: string
}
export interface Validation {
  /** the validators found nothing to fix */
  pass: boolean
  items: Item[]
}

/** A stage is told to stop (signal) when its time is up; a real one kills its process. */
export type Stage<T = unknown> = (book: string, signal: AbortSignal) => Promise<T>
export interface Stages {
  build: Stage
  /** the page reader over this book's flagged pages. Only called between model.load and model.unload */
  ai: Stage
  /** rebuild with the page reader's answers. Only called with the model unloaded */
  apply: Stage
  validate: Stage<Validation>
}
export interface Model {
  load(): Promise<void>
  unload(): Promise<void>
}

export interface BookResult {
  book: string
  /** 0-1, see bookScore */
  score: number
  /** items under 0.6 */
  low: number
  pass: boolean
  items: Item[]
  /** a build or a validation that did not finish: the book has no score of its own and goes first */
  failed?: { stage: Phase; error: string }
  /** what went wrong without failing the book: the page reader missing or failing */
  notes: string[]
  ms: number
}

export interface BatchOptions {
  books: string[]
  stages: Stages
  model: Model
  /** per stage and book; a number for all phases, or per phase (the page reader is slower than the rest). Default 8 minutes (PVA-003) */
  timeoutMs: number | Partial<Record<Phase, number>>
  /** the clock, for the time each book took */
  ms?: () => number
  log?: (line: string) => void
}

export const DEFAULT_TIMEOUT_MS = 8 * 60_000
export const LOW = 0.6

/**
 * One score per book: the weaker of "the validators pass" (1 or 0) and the 10th-percentile item score (nearest rank, so a short list is its
 * lowest item). `low` counts the items under 0.6 and breaks ties in the queue.
 */
export function bookScore(v: Validation): { score: number; low: number } {
  const s = v.items.map((i) => i.score).sort((a, b) => a - b)
  const p10 = s.length ? s[Math.ceil(s.length * 0.1) - 1] : 1
  return { score: v.pass ? p10 : 0, low: s.filter((x) => x < LOW).length }
}

const say = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/\s+/g, ' ').trim()

export function duration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`
}

/** Runs `go` for at most `limit` ms. On time-out the stage is told to stop and the wait ends with an error, whether or not it listens. */
async function within<T>(label: string, limit: number, go: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const stop = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => (stop.abort(), reject(new Error(`${label} timed out after ${duration(limit)}`))), limit)
  })
  try {
    return await Promise.race([go(stop.signal), late])
  } finally {
    clearTimeout(timer)
  }
}

interface State {
  book: string
  ms: number
  notes: string[]
  failed?: BookResult['failed']
  /** the page reader answered for this book */
  asked?: boolean
  v?: Validation
}

export async function runBatch(o: BatchOptions): Promise<BookResult[]> {
  const clock = o.ms ?? Date.now
  const log = o.log ?? (() => {})
  const all: State[] = o.books.map((book) => ({ book, ms: 0, notes: [] }))
  const live = () => all.filter((s) => !s.failed)
  const limit = (p: Phase) => (typeof o.timeoutMs === 'number' ? o.timeoutMs : (o.timeoutMs[p] ?? DEFAULT_TIMEOUT_MS))

  /** One phase over the books still in. `hard`: a failure ends the book; otherwise it is a note and the book goes on as it was. */
  const phase = async (p: Phase, hard: boolean, books: State[], run: (s: State, signal: AbortSignal) => Promise<unknown>) => {
    for (const s of books) {
      const t = clock()
      log(`${p}: ${s.book}`)
      try {
        await within(`${p} of ${s.book}`, limit(p), (signal) => run(s, signal))
      } catch (e) {
        if (hard) s.failed = { stage: p, error: say(e) }
        else s.notes.push(`page reader ${p === 'ai' ? 'failed' : 'changes not applied'}: ${say(e)}`)
        log(`${p}: ${s.book} ${hard ? 'FAILED' : 'noted'}: ${say(e)}`)
      } finally {
        s.ms += clock() - t
      }
    }
  }

  await phase('build', true, live(), (s, signal) => o.stages.build(s.book, signal))

  // the model is in memory for this phase only
  if (live().length) {
    let loaded = false
    try {
      await o.model.load()
      loaded = true
    } catch (e) {
      for (const s of live()) s.notes.push(`page reader not available: ${say(e)}`)
    }
    if (loaded) {
      try {
        await phase('ai', false, live(), async (s, signal) => (await o.stages.ai(s.book, signal), (s.asked = true)))
      } finally {
        try {
          await o.model.unload()
        } catch (e) {
          // ponytail: carries on; a model that would not unload is named on every book so nobody trusts the memory figures
          for (const s of live()) s.notes.push(`page reader could not be unloaded: ${say(e)}`)
        }
      }
    }
  }

  await phase('apply', false, live().filter((s) => s.asked), (s, signal) => o.stages.apply(s.book, signal))
  await phase('validate', true, live(), async (s, signal) => (s.v = await o.stages.validate(s.book, signal)))

  return all
    .map((s): BookResult => {
      const v = s.v ?? { pass: false, items: [] }
      const sc = s.failed ? { score: 0, low: 0 } : bookScore(v)
      return { book: s.book, ...sc, pass: !s.failed && v.pass, items: v.items, failed: s.failed, notes: s.notes, ms: s.ms }
    })
    .sort((a, b) => a.score - b.score || Number(!!b.failed) - Number(!!a.failed) || b.low - a.low || a.book.localeCompare(b.book))
}

/** QUEUE.md: the books from worst to best, each with its score, the 3 worst items and where they are, and the time it took. */
export function queueMd(results: BookResult[], at: Date = new Date()): string {
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
  const out = ['# Review queue', '', `${at.toISOString().slice(0, 16).replace('T', ' ')} UTC · ${plural(results.length, 'book')}, worst first`, '']
  results.forEach((r, i) => {
    const head = r.failed
      ? `failed at ${r.failed.stage}: ${r.failed.error}`
      : `score ${Math.round(r.score * 100)}${r.pass ? '' : ' (validators found problems)'} · ${plural(r.low, 'item')} under ${LOW}`
    out.push(`${i + 1}. **${r.book}** — ${head} · ${duration(r.ms)}`)
    for (const it of [...r.items].sort((a, b) => a.score - b.score).slice(0, 3)) out.push(`   - ${it.msg.replace(/\s+/g, ' ')}${it.where ? ` (${it.where})` : ''}`)
    for (const n of r.notes) out.push(`   - note: ${n}`)
  })
  return out.join('\n') + '\n'
}
