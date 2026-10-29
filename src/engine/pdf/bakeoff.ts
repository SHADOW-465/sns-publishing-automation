// The model bake-off (OPUS_DESIGN2 §b.8, T20): N candidate page models over the eval pages, one row each: reading-order accuracy, role F1
// for Caption and for headings (H* against P), figure grouping, the share of proposed ops the validator rejects, seconds per page at p50 and
// p95, and peak VRAM. The pick is the most accurate model whose p95 is under 20 s, and it is written to config with its weights hash, which
// is part of every cache key (page-cache.ts). The model is asked and its answer validated exactly as in a build (askPage, validate), but
// only the scores come out. The server, the VRAM reading and the files are given, so this is testable; scripts/bakeoff.ts supplies real ones.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { VisionConfig } from '../epub/alt-ai.ts'
import { lcs } from '../check/refscore-pdf.ts'
import type { Op } from './decision.ts'
import { pageOrder } from './evidence.ts'
import { askPage, type PageReply, type PageRequest } from './page-model.ts'
import { validate } from './validate.ts'

/** What the page is, from the client's finished file: the reading order, a role per block, the figures as groups of pieces. */
export interface Expected {
  order: string[]
  roles: Record<string, string>
  figures: string[][]
}
export interface BakeCase {
  req: PageRequest
  /** the full text of each line by its evidence ID (evidence.lineTexts) */
  lineText: Record<string, string>
  expected: Expected
}

export interface Candidate {
  name: string
  cfg: VisionConfig
  /** sha256 of the weights; without it the candidate can be scored but not chosen */
  weightsSha256?: string
  quant?: string
  serverVersion?: string
  /** start the server and unload it again: one model is resident at a time, so the VRAM is its own */
  load?(): Promise<void>
  unload?(): Promise<void>
  /** the GPU memory in use now, in MiB (nvidia-smi) */
  vram?(): Promise<number | undefined>
}

export interface Row {
  model: string
  pages: number
  /** each 0-1; undefined when the eval pages have nothing of that kind */
  order?: number
  captionF1?: number
  headingF1?: number
  figure?: number
  /** ops the validator dropped, over ops proposed (a rejected answer drops all of its ops) */
  rejected: number
  /** pages with no usable answer: they keep the engine version */
  left: number
  p50: number
  p95: number
  vramMiB?: number
}

export interface BakeOptions {
  ask?: (cfg: VisionConfig, req: PageRequest) => Promise<PageReply>
  /** milliseconds */
  now?: () => number
}

export const MAX_P95_S = 20

const isHeading = (r: string) => /^H\d$/.test(r)
const ratio = (n: number, d: number) => (d ? n / d : undefined)
const f1 = (tp: number, fp: number, fn: number) => ratio(2 * tp, 2 * tp + fp + fn)
const mean = (xs: (number | undefined)[]) => {
  const v = xs.filter((x): x is number => x !== undefined)
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : undefined
}
/** nearest rank */
const percentile = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.max(0, Math.ceil(s.length * p) - 1)] : 0
}
const group = (ids: string[]) => [...ids].sort().join('|')

/** The page as the validated ops leave it: the engine's reading, with what the model changed. */
function predict(c: BakeCase, ops: Op[]) {
  const ev = c.req.ev
  let order = ev.engineOrder ?? pageOrder(ev)
  const roles = new Map(ev.blocks.filter((b) => b.kind === 'text').map((b) => [b.id, b.role ?? 'P']))
  const moved: string[][] = []
  for (const op of ops) {
    if (op.op === 'order') order = op.ids
    else if (op.op === 'role') roles.set(op.id, op.role)
    else if (op.op === 'split') roles.set(op.id, op.roles[0])
    else if (op.op === 'caption') roles.set(op.caption, 'Caption')
    else if (op.op === 'figure') {
      moved.push(op.pieces)
      if (op.caption) roles.set(op.caption, 'Caption')
    }
  }
  const touched = new Set(moved.flat())
  const figures = [
    ...ev.blocks.filter((b) => b.kind === 'figure').map((b) => b.pieces ?? [b.id]).filter((g) => !g.some((p) => touched.has(p))),
    ...moved,
  ].map(group)
  return { order, roles, figures }
}

async function bakeModel(cand: Candidate, cases: BakeCase[], o: BakeOptions): Promise<Row> {
  const ask = o.ask ?? ((cfg, req) => askPage(cfg, req))
  const now = o.now ?? Date.now
  await cand.load?.()
  try {
    const secs: number[] = []
    const orders: (number | undefined)[] = []
    const figs: (number | undefined)[] = []
    const cap = { tp: 0, fp: 0, fn: 0 }
    const head = { tp: 0, fp: 0, fn: 0 }
    let proposed = 0
    let rejected = 0
    let left = 0
    let vram: number | undefined
    for (const c of cases) {
      const t0 = now()
      const reply = await ask(cand.cfg, c.req)
      secs.push((now() - t0) / 1000)
      const v = await cand.vram?.()
      if (v !== undefined) vram = Math.max(vram ?? 0, v)
      let ops: Op[] = []
      if (reply.status !== 'ok') left++
      else {
        const r = validate(c.req.ev, reply.answer.ops, { lineText: new Map(Object.entries(c.lineText)) })
        proposed += reply.answer.ops.length
        rejected += r.answerRejected ? reply.answer.ops.length : r.rejected.length
        ops = r.answerRejected ? [] : r.ops
      }
      const p = predict(c, ops)
      const e = c.expected
      orders.push(ratio(lcs(p.order, e.order), e.order.length))
      const want = e.figures.map(group)
      figs.push(ratio(want.filter((g) => p.figures.includes(g)).length, new Set([...want, ...p.figures]).size))
      for (const [id, role] of Object.entries(e.roles)) {
        const got = p.roles.get(id) ?? 'P'
        for (const [acc, is] of [[cap, (r: string) => r === 'Caption'], [head, isHeading]] as const) {
          if (is(role) && is(got)) acc.tp++
          else if (is(got)) acc.fp++
          else if (is(role)) acc.fn++
        }
      }
    }
    return {
      model: cand.name, pages: cases.length, order: mean(orders), captionF1: f1(cap.tp, cap.fp, cap.fn), headingF1: f1(head.tp, head.fp, head.fn),
      figure: mean(figs), rejected: ratio(rejected, proposed) ?? 0, left, p50: percentile(secs, 0.5), p95: percentile(secs, 0.95), vramMiB: vram,
    }
  } finally {
    await cand.unload?.()
  }
}

/** One row per candidate, in the order given. A candidate runs alone: it is loaded, asked every page, and unloaded. */
export async function runBakeoff(cands: Candidate[], cases: BakeCase[], o: BakeOptions = {}): Promise<Row[]> {
  const rows: Row[] = []
  for (const c of cands) rows.push(await bakeModel(c, cases, o))
  return rows
}

/** The comparison table, as markdown. */
export function bakeoffTable(rows: Row[]): string {
  const pct = (x?: number) => (x === undefined ? '–' : `${(x * 100).toFixed(1)}%`)
  const cols = ['Model', 'Pages', 'Reading order', 'Caption F1', 'Heading F1', 'Figures', 'Rejected', 'Left', 'p50 s', 'p95 s', 'Peak VRAM GB']
  return [
    `| ${cols.join(' | ')} |`,
    `|${cols.map(() => '---').join('|')}|`,
    ...rows.map((r) => `| ${[r.model, r.pages, pct(r.order), pct(r.captionF1), pct(r.headingF1), pct(r.figure), pct(r.rejected), r.left, r.p50.toFixed(1), r.p95.toFixed(1), r.vramMiB === undefined ? '–' : (r.vramMiB / 1024).toFixed(1)].join(' | ')} |`),
  ].join('\n') + '\n'
}

/** How accurate a row is: the mean of the four accuracy columns it has. */
export const accuracy = (r: Row) => mean([r.order, r.captionF1, r.headingF1, r.figure]) ?? 0

/** The most accurate row whose p95 is under `maxP95` seconds (a tie goes to the faster); undefined when none is fast enough. */
export function chooseModel(rows: Row[], maxP95 = MAX_P95_S): Row | undefined {
  return rows.filter((r) => r.p95 < maxP95).sort((a, b) => accuracy(b) - accuracy(a) || a.p95 - b.p95)[0]
}

export interface Choice {
  model: string
  weightsSha256: string
  quant?: string
  serverVersion?: string
  accuracy: number
  p95: number
  chosenAt: string
}

/** Writes the chosen model and its weights hash to `file` (config/page-model.json). No hash, no record: every cache key names the weights. */
export function recordChoice(file: string, row: Row, cand: Candidate, at: Date = new Date()): Choice {
  if (!cand.weightsSha256) throw new Error(`The weights of ${cand.name} have no hash, so the choice cannot be recorded. Give weightsSha256 or the weights path.`)
  const c: Choice = { model: cand.cfg.model, weightsSha256: cand.weightsSha256, quant: cand.quant, serverVersion: cand.serverVersion, accuracy: Math.round(accuracy(row) * 1000) / 1000, p95: row.p95, chosenAt: at.toISOString() }
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(`${file}.tmp`, JSON.stringify(c, null, 2) + '\n')
  renameSync(`${file}.tmp`, file)
  return c
}

/** The recorded choice, or undefined when there is none yet. */
export function readChoice(file: string): Choice | undefined {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Choice
  } catch {
    return undefined
  }
}
