// Retries, rounds and revert for the page reader (OPUS_DESIGN2 §b.7, T16). Per page and round: a transport error or timeout is retried
// once; an answer the validator refuses on references or text (b.5.1, b.5.2) is retried up to twice with the refusal in plain words; and
// no page is asked more than 3 times in a round. Per book: up to 3 rounds. A page's edits are reverted, and REVIEW_NOTES says so, when they
// raise the book's error count or lower a reference-score dimension. A server that is down means no edits and a build that goes on.
// Every op that was applied, refused or reverted is one DecisionLine (DECISIONS.jsonl) and one note (REVIEW_NOTES), T18 (§b.9).
// The model itself is `ask` (askPage, or askPage behind the cache), so this file never talks to a server and never throws on a bad answer.
import { noteOf, type DecisionLine, type DecisionNote } from '../review/decisions.ts'
import type { Op, PageDecision } from './decision.ts'
import type { PageAnswer, Left, PageReply, PageRequest } from './page-model.ts'
import type { PageEvidence } from './evidence.ts'
import type { Rejected, Validated } from './validate.ts'

export const MAX_ASKS = 3
export const MAX_ROUNDS = 3
const STEP = 'Page reader'

export type Ask = (r: PageRequest) => Promise<PageReply>
export type CheckAnswer = (ev: PageEvidence, ops: PageAnswer['ops']) => Validated

export type Asked =
  | { status: 'ok'; answer: PageAnswer; validated: Validated; asks: number }
  | { status: 'left'; why: string; asks: number; rejected?: Rejected[] }
  /** the server is not there: the other pages are not tried */
  | { status: 'down'; why: string; asks: number }

/** The words of a refusal that is worth another try: a bad reference or a change to the text. Other refusals drop their own op only. */
const refusal = (v: Validated) => v.answerRejected ?? (v.rejected.filter((x) => x.stage === 'reference').map((x) => x.why).join('; ') || undefined)

/** One page, one round: at most MAX_ASKS asks. */
export async function askWithRetries(req: PageRequest, ask: Ask, check: CheckAnswer): Promise<Asked> {
  let hints = req.hints ?? []
  let asks = 0
  let transport = 0
  let content = 0
  let why = 'page reader gave no usable answer'
  let rejected: Rejected[] | undefined
  while (asks < MAX_ASKS) {
    asks++
    const r = await ask({ ...req, hints })
    let msg: string | undefined
    if (r.status === 'ok') {
      const v = check(req.ev, r.answer.ops)
      msg = refusal(v)
      rejected = v.rejected
      if (!msg) return { status: 'ok', answer: r.answer, validated: v, asks }
    } else if (r.status === 'invalid') msg = r.why
    else {
      why = r.status === 'timeout' ? 'page reader timed out' : 'page reader not available'
      if (transport++ >= 1) return r.status === 'timeout' ? { status: 'left', why, asks } : { status: 'down', why, asks }
      continue
    }
    why = `page reader gave no usable answer: ${msg}`
    if (content++ >= 2) break
    hints = [...(req.hints ?? []), `Your last answer was refused: ${msg}. Answer again and fix this.`]
  }
  return { status: 'left', why, asks, ...(rejected?.length ? { rejected } : {}) }
}

/** What a rebuild with the decisions laid on found: the checks' findings by PDF page (0 for none in particular), and the scores if the book has a reference. */
export interface Check {
  errors: Map<number, string[]>
  scores?: Record<string, number>
}

export interface RoundsInput {
  /** round 1: the flagged pages */
  pages: PageRequest[]
  ask: Ask
  validate: CheckAnswer
  /** rebuild the book with these decisions and run the checks */
  rebuild: (decisions: PageDecision[]) => Promise<Check>
  maxRounds?: number
  /** for DECISIONS.jsonl: the model that answered and the page key of each page's answer (page-cache.ts) */
  model?: string
  keyOf?: (page: number) => string | undefined
}

export interface RoundsResult {
  /** the decisions that stay */
  decisions: PageDecision[]
  reverted: { page: number; why: string }[]
  left: Left[]
  notes: DecisionNote[]
  /** every op applied, refused or reverted, once: DECISIONS.jsonl (decisionsJsonl) */
  log: DecisionLine[]
  rounds: number
}

const total = (c: Check) => [...c.errors.values()].reduce((n, e) => n + e.length, 0)
const count = (c: Check, page: number) => c.errors.get(page)?.length ?? 0
const same = (a?: PageDecision, b?: PageDecision) => JSON.stringify(a?.ops ?? []) === JSON.stringify(b?.ops ?? [])
const short = (id: string) => id.replace(/^p\d+\./, '')
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

/** The op in words: what it does, and the block(s) as they were and as they would read. */
export function describeOp(ev: PageEvidence, op: Op): Pick<DecisionLine, 'item' | 'before' | 'after'> {
  const snip = (id: string, role?: string) => {
    const b = ev.blocks.find((x) => x.id === id)
    const text = (b?.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)
    return `${role ?? b?.role ?? (b?.kind === 'figure' ? 'Figure' : 'P')} ${text ? `“${text}”` : short(id)}`
  }
  const ids = (xs: string[] = []) => xs.map(short).join(' ')
  const page = `Page ${ev.page}${ev.printed && ev.printed !== String(ev.page) ? ` (printed ${ev.printed})` : ''}`
  const at = (item: string, before?: string, after?: string) => ({ item: `${page}: ${item}`, before, after })
  switch (op.op) {
    case 'order': return at('reading order changed', ids(ev.engineOrder), ids(op.ids))
    case 'role': return at(`${short(op.id)} read as ${op.role}`, snip(op.id), snip(op.id, op.role))
    case 'split': return at(`${short(op.id)} split at ${short(op.atLine)}`, snip(op.id), `${op.roles?.join(' · ')} (second part from ${short(op.atLine)})`)
    case 'merge': return at(`${ids(op.ids)} joined`, ids(op.ids), 'one block')
    case 'continues': return at(`${short(op.id)} goes on from ${short(op.from)}`, undefined, `${short(op.id)} after ${short(op.from)}`)
    case 'figure': return at(`${ids(op.pieces)} grouped as one figure`, undefined, `Figure ${ids(op.pieces)}${op.caption ? ` + caption ${short(op.caption)}` : ''}`)
    case 'caption': return at(`${short(op.caption)} linked to ${short(op.figure)}`, undefined, `Caption ${short(op.caption)} of ${short(op.figure)}`)
    default: return at('no change')
  }
}

export async function runRounds(inp: RoundsInput): Promise<RoundsResult> {
  const kept = new Map<number, PageDecision>()
  const reverted: RoundsResult['reverted'] = []
  const left = new Map<number, string>()
  const log: DecisionLine[] = []
  const lines = new Map<PageDecision, DecisionLine[]>() // what each decision does, written down once it is applied or reverted
  const refused = new Set<string>()
  const refuse = (ev: PageEvidence, rejected: Rejected[] = []) => {
    for (const x of rejected) {
      const k = `${ev.page}|${JSON.stringify(x.op)}|${x.why}`
      if (!refused.has(k)) (refused.add(k), log.push({ page: ev.page, key: inp.keyOf?.(ev.page), model: inp.model, op: x.op, ...describeOp(ev, x.op), status: 'refused', validator: x.stage, reason: x.why }))
    }
  }
  const undone = new Map<number, PageDecision>() // reverted decisions: the same answer is not tried again
  const tried = new Map<number, PageDecision['ops']>() // the last answer per page, shown to the model in the next round
  let cur = await inp.rebuild([])
  let down = false
  let rounds = 0
  const all = () => [...kept.values()]

  for (let round = 1; round <= (inp.maxRounds ?? MAX_ROUNDS); round++) {
    const targets = round === 1 ? inp.pages : inp.pages.filter((p) => count(cur, p.ev.page) > 0)
    if (!targets.length) break
    rounds = round
    const fresh = new Map<number, PageDecision>()
    for (const p of targets) {
      const page = p.ev.page
      if (down) {
        left.set(page, 'page reader not available')
        continue
      }
      const req = round === 1 ? p : { ...p, hints: [...(p.hints ?? []), `Your earlier answer for this page: ${JSON.stringify(tried.get(page) ?? [])}`, `The checks still find: ${(cur.errors.get(page) ?? []).join('; ')}`] }
      const r = await askWithRetries(req, inp.ask, inp.validate)
      if (r.status === 'ok') {
        left.delete(page)
        tried.set(page, r.validated.ops)
        refuse(p.ev, r.validated.rejected)
        // the reasons are by the op's place in the answer; the ops that passed keep their order
        const gone = new Set(r.validated.rejected.map((x) => x.index))
        const place = r.answer.ops.map((_, i) => i).filter((i) => !gone.has(i))
        const ops = r.validated.ops.filter((o) => o.op !== 'none')
        if (ops.length) {
          const d: PageDecision = { page, ops, by: 'ai' }
          fresh.set(page, d)
          lines.set(d, r.validated.ops.flatMap((op, k) => {
            const why = r.answer.reasons?.find((x) => x.op === place[k])
            return op.op === 'none' ? [] : [{ page, key: inp.keyOf?.(page), model: inp.model, op, ...describeOp(p.ev, op), status: 'applied' as const, validator: 'passed', ...(why?.rule ? { rule: why.rule } : {}), ...(why?.why ? { reason: why.why } : {}) }]
          }))
        }
      } else {
        if (r.status === 'left') refuse(p.ev, r.rejected)
        if (r.status === 'down') down = true
        left.set(page, r.status === 'down' ? 'page reader not available' : r.why)
      }
    }
    // a decision equal to the one already kept, or to one already reverted, changes nothing
    for (const [page, d] of fresh) if (same(d, kept.get(page)) || (undone.has(page) && same(d, undone.get(page)))) fresh.delete(page)
    if (!fresh.size) break

    const before = new Map(kept)
    const revert = (page: number, why: string) => {
      const was = before.get(page)
      const d = fresh.get(page)!
      undone.set(page, d)
      log.push(...lines.get(d)!.map((l) => ({ ...l, status: 'reverted' as const, reason: why })))
      was ? kept.set(page, was) : kept.delete(page)
      fresh.delete(page)
      reverted.push({ page, why })
    }
    for (const [page, d] of fresh) kept.set(page, d)
    let after = await inp.rebuild(all())
    // a page whose own findings went up
    const worse = [...fresh.keys()].filter((p) => count(after, p) > count(cur, p))
    for (const p of worse) revert(p, `the checks found ${plural(count(after, p), 'problem')} on it instead of ${count(cur, p)} after the page reader’s changes.`)
    if (worse.length) after = await inp.rebuild(all())
    // the book as a whole, or a score against the client’s own file
    const dropped = Object.entries(cur.scores ?? {}).find(([k, v]) => (after.scores?.[k] ?? v) < v)?.[0]
    const why = total(after) > total(cur) ? `the book as a whole had ${plural(total(after), 'problem')} instead of ${total(cur)} after the page reader’s changes.` : dropped ? `the score for “${dropped}” against the client’s file went down.` : undefined
    if (why) {
      for (const p of [...fresh.keys()]) revert(p, why)
      after = await inp.rebuild(all())
    }
    cur = after
    if (!fresh.size) break
  }

  log.push(...all().flatMap((d) => lines.get(d) ?? []))
  log.sort((a, b) => a.page - b.page)
  const notes = log.map(noteOf)
  const leftList: Left[] = [...left].map(([page, why]) => ({ page, why }))
  for (const l of leftList) notes.push({ step: STEP, item: `Page ${l.page}`, chosen: `Left as the engine read it: ${l.why}.`, how: 'left', where: `page ${l.page}` })
  return { decisions: all(), reverted, left: leftList, notes, log, rounds }
}
