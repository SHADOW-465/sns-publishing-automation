// The validator of a page answer (OPUS_DESIGN2 §b.5.1–b.5.4, T13): what the page reader proposes (typed ops, decision.ts) is checked
// against the page evidence before any of it is laid on a build. Four stages: reference checks, the rule guards from the resolved rule
// set, geometry sanity, and text conservation. An op that fails is dropped alone and listed with its reason in plain words (they go
// back to the model on a retry); a failed conservation drops the whole answer, and the page keeps the engine version.
import { figureLabel } from '../pdfua/structure.ts'
import { gap } from './flags.ts'
import type { Op } from './decision.ts'
import type { EvidenceBlock, PageEvidence } from './evidence.ts'

export interface ValidateOptions {
  /** the full text of each line by its evidence ID (evidence.lineTexts) */
  lineText: Map<string, string>
  /** on how many pages of the book this text is set (running heads repeat) */
  repeats?: (text: string) => number
  /** UA-10: running heads are always artifacts when 'artifact' (the default) */
  runningHeads?: 'artifact' | 'keep'
  /** UA captionIn: a caption comes after its figure ('after', the default) or sits inside it, where its place in the order is free */
  captionIn?: 'after' | 'inside'
  /** the order a second opinion gave, when a big change to a sure engine order asks for one (b.5.4) */
  second?: string[]
}

export interface Rejected {
  /** the op's place in the answer */
  index: number
  op: Op
  stage: 'reference' | 'guard' | 'geometry' | 'conservation'
  why: string
  /** downgraded to a review item for a person, not wrong outright */
  review?: boolean
}

export interface Validated {
  /** the ops that passed, in the answer's order */
  ops: Op[]
  rejected: Rejected[]
  /** set when the answer would change the text: all of it is dropped */
  answerRejected?: string
  /** an order op wants a second opinion (b.5.4): run it and validate again with `second` */
  needsSecond?: boolean
}

const ROLES = new Set<string>(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'Caption', 'Note', 'Artifact', 'Aside', 'LI', 'TOCI', 'BlockQuote'])
const FIELDS: Record<string, string[]> = { order: ['ids'], role: ['id', 'role'], split: ['id', 'atLine', 'roles'], merge: ['ids'], continues: ['id', 'from'], figure: ['pieces', 'caption'], caption: ['figure', 'caption'], none: [] }
/** the engine was sure of its order when its confidence is at least this (LOW_CONFIDENCE in flags.ts) and a change this big needs a second opinion */
const SURE = 0.85
const BIG_CHANGE = 0.5
// ponytail: "agrees" is the same tau as a big change; tune on the eval set (T25)
const AGREE = 0.8
const BAND = 0.08
const MAX_HEADING_WORDS = 25

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean)
const strs = (x: unknown): x is string[] => Array.isArray(x) && x.every((s) => typeof s === 'string')
const isHeading = (r: string) => /^H\d$/.test(r)
const firstWins = (bs: EvidenceBlock[]) => {
  const m = new Map<string, EvidenceBlock>()
  for (const b of bs) if (!m.has(b.id)) m.set(b.id, b)
  return m
}

/** Kendall's tau of two orders over the IDs both hold: 1 the same, -1 reversed; 1 when fewer than two are shared. */
export function kendallTau(a: string[], b: string[]): number {
  const pos = new Map(b.map((id, i) => [id, i]))
  const common = a.filter((id) => pos.has(id))
  let s = 0
  for (let i = 0; i < common.length; i++) for (let j = i + 1; j < common.length; j++) s += pos.get(common[i])! < pos.get(common[j])! ? 1 : -1
  const pairs = (common.length * (common.length - 1)) / 2
  return pairs ? s / pairs : 1
}

/** b.5.2: the characters of `out` (whitespace taken out) equal those of `page`. Returns what differs, in plain words, or undefined. */
export function conserved(page: string[], out: string[]): string | undefined {
  const count = (xs: string[]) => {
    const m = new Map<string, number>()
    for (const ch of xs.join('').normalize('NFC').replace(/\s+/g, '')) m.set(ch, (m.get(ch) ?? 0) + 1)
    return m
  }
  const a = count(page)
  const b = count(out)
  const diff = (x: Map<string, number>, y: Map<string, number>) =>
    [...x].flatMap(([ch, n]) => (n > (y.get(ch) ?? 0) ? [`“${ch}”${n - (y.get(ch) ?? 0) > 1 ? ` ×${n - (y.get(ch) ?? 0)}` : ''}`] : [])).slice(0, 8).join(', ')
  const lost = diff(a, b)
  const added = diff(b, a)
  if (!lost && !added) return undefined
  return `the text would change: ${[lost && `lost ${lost}`, added && `added ${added}`].filter(Boolean).join('; ')}`
}

/** What the page would read as if the ops were taken as written, with none of the checks: the text chunks, in reading order. A block
 *  listed twice, or in no place, or a caption linked twice, shows as added or lost text in `conserved`. */
export function applyOps(ev: PageEvidence, lineText: Map<string, string>, ops: Op[]): string[] {
  const byId = firstWins(ev.blocks.filter((b) => b.kind === 'text'))
  const chunk = (id: string) => (byId.has(id) ? byId.get(id)!.lineIds?.map((l) => lineText.get(l) ?? '').join(' ') ?? '' : undefined)
  const role = new Map([...byId].map(([id, b]) => [id, b.role ?? 'P']))
  const merged = new Map<string, string[]>()
  const away = new Set<string>()
  const links: string[] = []
  let order: string[] | undefined
  for (const op of ops) {
    if (op.op === 'order' && Array.isArray(op.ids)) order = op.ids
    else if (op.op === 'role' && role.has(op.id)) role.set(op.id, op.role)
    else if (op.op === 'split' && role.has(op.id)) role.set(op.id, op.roles?.[0] === 'Artifact' && op.roles[1] === 'Artifact' ? 'Artifact' : op.roles?.[0])
    else if (op.op === 'merge' && Array.isArray(op.ids)) {
      for (const id of op.ids.slice(1)) if (byId.has(id)) (merged.set(op.ids[0], [...(merged.get(op.ids[0]) ?? []), id]), away.add(id))
    } else if ((op.op === 'figure' || op.op === 'caption') && op.caption && byId.has(op.caption)) links.push(op.caption)
  }
  const emit = (id: string) => [chunk(id)!, ...(merged.get(id) ?? []).map((m) => chunk(m)!)]
  const linked = new Set(links)
  const flow = order ?? [...(ev.engineOrder ?? []), ...ev.blocks.map((b) => b.id)].filter((id, i, a) => a.indexOf(id) === i && !away.has(id) && role.get(id) !== 'Artifact')
  return [
    ...flow.filter((id) => byId.has(id) && !linked.has(id)).flatMap(emit),
    ...links.flatMap(emit),
    ...[...role].filter(([id, r]) => r === 'Artifact' && !away.has(id)).flatMap(([id]) => emit(id)),
  ]
}

export function validate(ev: PageEvidence, ops: Op[], o: ValidateOptions): Validated {
  const byId = firstWins(ev.blocks)
  const text = (b: EvidenceBlock) => (b.lineIds ?? []).map((l) => o.lineText.get(l) ?? '').join(' ')
  const em = ev.blocks.find((b) => b.kind === 'text')?.bodySize ?? 10
  const figs = ev.blocks.filter((b) => b.kind === 'figure')
  const textBlock = (id: unknown) => (typeof id === 'string' && byId.get(id)?.kind === 'text' ? byId.get(id) : undefined)
  const figureOf = (id: unknown) => figs.find((f) => f.id === id || (typeof id === 'string' && f.pieces?.includes(id)))
  const engine = ev.engineOrder ?? ev.blocks.map((b) => b.id)
  const prev = `p${ev.page - 1}.`
  const repeats = (b: EvidenceBlock) => o.repeats?.(words(text(b)).join(' ')) ?? 0
  const inBand = (b: EvidenceBlock) => b.bbox[1] < ev.h * BAND || b.bbox[3] > ev.h * (1 - BAND)
  const insideFigure = (b: EvidenceBlock) => figs.some((f) => (b.bbox[0] + b.bbox[2]) / 2 > f.bbox[0] && (b.bbox[0] + b.bbox[2]) / 2 < f.bbox[2] && (b.bbox[1] + b.bbox[3]) / 2 > f.bbox[1] && (b.bbox[1] + b.bbox[3]) / 2 < f.bbox[3])

  // the page as this answer changes it, op by op
  const role = new Map(ev.blocks.filter((b) => b.kind === 'text').map((b) => [b.id, b.role ?? 'P']))
  const away = new Map<string, string>() // merged into
  const heads = new Set<string>()
  const linked = new Map<string, string>() // caption block → figure block ID
  const groups: { figs: string[]; cap: string }[] = []

  const rejected: Rejected[] = []
  const fail = (index: number, stage: Rejected['stage'], why: string, review?: boolean) => void rejected.push({ index, op: ops[index], stage, why, ...(review ? { review } : {}) })
  type Verdict = { stage: Rejected['stage']; why: string; review?: boolean } | undefined
  const ref = (why: string): Verdict => ({ stage: 'reference', why })
  const guard = (why: string, review?: boolean): Verdict => ({ stage: 'guard', why, review })

  /** b.5.3 for one block taking a role, `t` being the words that take it (a part of a split is not the whole block) */
  const roleGuard = (b: EvidenceBlock, r: string, t: string, near: EvidenceBlock[] = figs): Verdict => {
    const ornament = !/[\p{L}\p{N}]/u.test(t)
    if (r === 'Artifact') {
      if (!inBand(b) && repeats(b) < 3 && !ornament) return guard(`${b.id} “${t.slice(0, 30)}” is not in the top or bottom band, not repeated on 3 pages and not an ornament: left to a person to review, not made an artifact`, true)
    } else if (o.runningHeads !== 'keep' && inBand(b) && repeats(b) >= 3) return guard(`${b.id} is a running head, always an artifact (uaRunningHeads = artifact), not ${r}`)
    if (isHeading(r)) {
      if (words(t).length > MAX_HEADING_WORDS) return guard(`${b.id} has ${words(t).length} words: a heading has ${MAX_HEADING_WORDS} words or fewer, so it cannot be ${r}`)
      if (/^\s*(https?:\/\/|www\.)\S+\s*$/i.test(t)) return guard(`${b.id} is a URL line, not ${r}`)
      if (insideFigure(b)) return guard(`${b.id} is inside a figure, not ${r}`)
    }
    if (r === 'Caption' && !figureLabel(t) && !near.some((f) => gap(b, f) <= em * 3)) return guard(`${b.id} is not within 3 em of a figure and is not a figure label, so it is not a Caption`)
  }
  const merged = (id: string) => (away.has(id) ? ref(`${id} is already merged into ${away.get(id)}`) : undefined)

  const check = (op: Op): Verdict => {
    const o2 = op as unknown as Record<string, unknown>
    if (!(op && typeof o2.op === 'string' && o2.op in FIELDS)) return ref(`${String(o2?.op)} is not an op`)
    const extra = Object.keys(o2).filter((k) => k !== 'op' && !FIELDS[op.op].includes(k))
    if (extra.length) return ref(`${op.op} carries ${extra.join(', ')}, which an op may not: no op changes the words`)
    switch (op.op) {
      case 'role': {
        const b = textBlock(op.id)
        if (!b) return ref(`${op.id} is not a text block on this page`)
        if (!ROLES.has(op.role)) return ref(`${op.role} is not a role`)
        const v = merged(op.id) ?? roleGuard(b, op.role, text(b))
        if (!v && op.role === 'Artifact' && linked.has(op.id)) return ref(`${op.id} is a caption of ${linked.get(op.id)}, not an artifact`)
        if (!v) role.set(op.id, op.role)
        return v
      }
      case 'split': {
        const b = textBlock(op.id)
        if (!b) return ref(`${op.id} is not a text block on this page`)
        if (!Array.isArray(op.roles) || op.roles.length !== 2 || !op.roles.every((r) => ROLES.has(r))) return ref(`split roles must be two roles`)
        const at = b.lineIds?.indexOf(op.atLine) ?? -1
        if (at < 0) return ref(`${op.atLine} is not a line of ${op.id}`)
        if (at === 0) return guard(`${op.atLine} is the first line of ${op.id}: a split is at a line boundary inside the block`)
        const lines = (b.lineIds ?? []).map((l) => o.lineText.get(l) ?? '')
        const v = merged(op.id) ?? roleGuard(b, op.roles[0], lines.slice(0, at).join(' ')) ?? roleGuard(b, op.roles[1], lines.slice(at).join(' '))
        if (!v) role.set(op.id, op.roles[0] === 'Artifact' && op.roles[1] === 'Artifact' ? 'Artifact' : op.roles[0])
        return v
      }
      case 'merge': {
        if (!strs(op.ids) || op.ids.length < 2 || new Set(op.ids).size !== op.ids.length) return ref('merge needs two or more different blocks')
        const bad = op.ids.find((id) => !textBlock(id))
        if (bad) return ref(`${bad} is not a text block on this page`)
        const [head, ...rest] = op.ids
        const taken = merged(head) ?? rest.map((id) => (away.has(id) || heads.has(id) ? ref(`${id} is already merged`) : linked.has(id) ? ref(`${id} is a caption of ${linked.get(id)}`) : undefined)).find(Boolean)
        if (taken) return taken
        if (op.ids.some((id) => role.get(id) === 'Artifact')) return ref('an artifact is not merged into text')
        // adjacent in the order the engine read, and in the one the answer proposes when it lists them
        const proposed = [...ops].reverse().find((x): x is Extract<Op, { op: 'order' }> => x.op === 'order' && strs(x.ids))?.ids
        for (const seq of [engine, proposed ?? []])
          for (let i = 0; i + 1 < op.ids.length; i++) {
            const a = seq.indexOf(op.ids[i])
            const b = seq.indexOf(op.ids[i + 1])
            if ((seq === engine || (a >= 0 && b >= 0)) && b !== a + 1) return guard(`${op.ids[i]} and ${op.ids[i + 1]} are not adjacent in the ${seq === engine ? 'page' : 'proposed'} order, so they are not joined`)
          }
        heads.add(head)
        for (const id of rest) away.set(id, head)
        return
      }
      case 'continues': {
        if (!textBlock(op.id)) return ref(`${op.id} is not a text block on this page`)
        if (!textBlock(op.from) && !(typeof op.from === 'string' && op.from.startsWith(prev) && /^p\d+\.b\d+$/.test(op.from))) return ref(`${op.from} is not a block on this page or the page before`)
        return op.id === op.from ? ref(`${op.id} cannot go on with itself`) : undefined
      }
      case 'figure':
      case 'caption': {
        const pieces = op.op === 'figure' ? op.pieces : [op.figure]
        if (!strs(pieces) || !pieces.length) return ref(`${op.op} needs a picture`)
        const found = pieces.map(figureOf)
        const missing = pieces.find((_, i) => !found[i])
        if (missing) return ref(`${missing} is not a picture on this page`)
        const fs = [...new Set(found as EvidenceBlock[])]
        const cap = op.caption
        const c = cap === undefined ? undefined : textBlock(cap)
        if (cap !== undefined && !c) return ref(`${cap} is not a text block on this page`)
        if (op.op === 'caption' && cap === undefined) return ref('caption needs a caption block')
        if (c) {
          if (away.has(c.id) || linked.has(c.id) || role.get(c.id) === 'Artifact') return ref(`${c.id} is already ${away.has(c.id) ? 'merged' : linked.has(c.id) ? `the caption of ${linked.get(c.id)}` : 'an artifact'}`)
          const v = roleGuard(c, 'Caption', text(c), fs)
          if (v) return v
        }
        if (op.op === 'figure') {
          const x0 = Math.min(...fs.map((f) => f.bbox[0])) - em * 2
          const y0 = Math.min(...fs.map((f) => f.bbox[1])) - em * 2
          const x1 = Math.max(...fs.map((f) => f.bbox[2])) + em * 2
          const y1 = Math.max(...fs.map((f) => f.bbox[3])) + em * 2
          const prose = ev.blocks.find((b) => {
            if (b.kind !== 'text' || b.italic || insideFigure(b) || figureLabel(text(b)) || words(text(b)).length < 4 || Math.abs((b.size ?? 0) - (b.bodySize ?? 0)) >= 0.6) return false
            const cx = (b.bbox[0] + b.bbox[2]) / 2
            const cy = (b.bbox[1] + b.bbox[3]) / 2
            return cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1
          })
          if (prose) return guard(`${prose.id} is body-size prose within 2 em of the pieces, so they are not one figure`)
        }
        if (c) {
          linked.set(c.id, fs[0].id)
          groups.push({ figs: fs.map((f) => f.id), cap: c.id })
        }
        return
      }
      case 'order':
        return
    }
  }

  const ok = new Set<number>()
  ops.forEach((op, i) => {
    if (op?.op === 'order') return
    const v = check(op)
    if (v) fail(i, v.stage, v.why, v.review)
    else ok.add(i)
  })

  // orders last: they are judged against the page as the other ops leave it
  const expected = ev.blocks.map((b) => b.id).filter((id, i, a) => a.indexOf(id) === i)
  let needsSecond = false
  ops.forEach((op, i) => {
    if (op?.op !== 'order') return
    const extra = Object.keys(op).filter((k) => k !== 'op' && k !== 'ids')
    if (extra.length) return fail(i, 'reference', `order carries ${extra.join(', ')}, which an op may not: no op changes the words`)
    if (!strs(op.ids)) return fail(i, 'reference', 'order needs a list of block IDs')
    const want = expected.filter((id) => !away.has(id) && role.get(id) !== 'Artifact')
    const seen = new Map<string, number>()
    for (const id of op.ids) seen.set(id, (seen.get(id) ?? 0) + 1)
    const problems = [
      ...op.ids.filter((id, k, a) => !byId.has(id) && a.indexOf(id) === k).map((id) => `${id} is not a block on this page`),
      ...op.ids.filter((id, k, a) => (away.has(id) || role.get(id) === 'Artifact') && a.indexOf(id) === k).map((id) => `${id} should not be listed: it is ${away.has(id) ? `merged into ${away.get(id)}` : 'an artifact'}`),
      ...want.filter((id) => !seen.has(id)).map((id) => `block ${id} is missing from order`),
      ...want.filter((id) => (seen.get(id) ?? 0) > 1).map((id) => `${id} appears ${seen.get(id) === 2 ? 'twice' : `${seen.get(id)} times`}`),
    ]
    if (problems.length) return fail(i, 'reference', problems.join('; '))
    const at = (id: string) => op.ids.indexOf(id)
    if (o.captionIn !== 'inside') {
      const bad = groups.find((g) => at(g.cap) < Math.max(...g.figs.map(at)))
      if (bad) return fail(i, 'guard', `caption ${bad.cap} must come after its figure ${bad.figs.join(' ')} (captionIn = after)`)
    }
    // ponytail: the paragraph with the call is taken as the text block the engine read just before the note; a call-mark search waits for T14's real pages
    for (const n of op.ids.filter((id) => role.get(id) === 'Note')) {
      const anchor = engine.slice(0, engine.indexOf(n)).reverse().find((id) => textBlock(id) && role.get(id) !== 'Note')
      if (anchor && at(anchor) >= 0 && at(anchor) > at(n)) return fail(i, 'guard', `note ${n} must stay after ${anchor}, the paragraph before it that holds its call`)
    }
    const conf = ev.engineConfidence ?? 1
    if (ev.engineOrder && kendallTau(op.ids, ev.engineOrder) < BIG_CHANGE && conf >= SURE) {
      if (!o.second) {
        needsSecond = true
        return fail(i, 'geometry', `this order differs a lot from the engine’s, which was sure (confidence ${conf}): it needs a second opinion`)
      }
      if (kendallTau(op.ids, o.second) < AGREE) return fail(i, 'geometry', 'the second opinion disagrees with this order: keep the engine order and list the page as left')
    }
    ok.add(i)
  })

  const passed = ops.filter((_, i) => ok.has(i))
  const page = ev.blocks.filter((b) => b.kind === 'text').map(text)
  const lost = conserved(page, applyOps(ev, o.lineText, passed))
  if (lost) {
    ops.forEach((_, i) => ok.has(i) && fail(i, 'conservation', lost))
    return { ops: [], rejected: rejected.sort((a, b) => a.index - b.index), answerRejected: lost }
  }
  return { ops: passed, rejected: rejected.sort((a, b) => a.index - b.index), ...(needsSecond ? { needsSecond } : {}) }
}
