// The staff-fix miner (OPUS_DESIGN2 §c.2 (2), T26): the tool's tag tree against the tag tree staff finished by hand, one page at a time,
// every difference turned into one of the page reader's ops (§b.5: order, role, split, merge, continues, caption link) or, when no op can say
// it, listed as a reference disagreement in plain words (a drop cap tagged as Figure, a heading with no level, a list item, a figure
// count). A staff fix is a person's decision: the ops come out as PageDecisions by 'person', and each page's ops pass the same validator
// as the model's (T13), so the rulebook's guards hold; what it refuses is listed too. No op changes a word.
// The two files are matched to the page's blocks (the page evidence, T9) by their words, not by position: a block is found in a file's
// tag-order text by the longest common run of its words, and the tagged element that holds it gives its role and its place.
// ponytail: roles are compared as classes (P-like, H1-H6, Caption, Note, TOCI, Figure): a list or table part is P-like, because no op builds
// list or table structure; a figure is told from the file's pictures by count only, because the stats hold no boxes.
import { words, type PdfStats } from '../check/pdfstats.ts'
import { alignment, readingDims } from '../check/refscore-pdf.ts'
import type { Dimension } from '../check/refscore.ts'
import { validate, type ValidateOptions } from './validate.ts'
import type { DecisionRole, Op, PageDecision } from './decision.ts'
import type { EvidenceBlock, PageEvidence } from './evidence.ts'

export type El = NonNullable<PdfStats['order']>['elements'][number]

export interface Disagreement {
  page: number
  /** plain words: what the staff file does that no op can say, or the op the validator refused and why */
  msg: string
}

export interface Mined {
  /** the validated ops, per page, as a person's decisions */
  decisions: PageDecision[]
  disagreements: Disagreement[]
  /** every difference found is an op or a disagreement: differences = ops + disagreements */
  counts: { differences: number; ops: number; disagreements: number; byOp: Record<string, number>; pages: number; skipped: number[] }
  /** informational: reading order (LCS) and role F1 of the tool's file against the staff's, on the pages mined */
  reading: Dimension[]
}

export interface MineInput {
  evidence: PageEvidence[]
  /** the full text of each line of a page by its evidence ID (evidence.lineTexts) */
  lineText: (page: number) => Map<string, string>
  mine: PdfStats
  ref: PdfStats
  /** the guards' settings, as the batch runner gives them (runningHeads, captionIn, repeats) */
  guards?: Omit<ValidateOptions, 'lineText' | 'second'>
}

const cls = (tag: string) => (/^(H[1-6]?|Caption|Note|TOCI|Figure)$/.test(tag) ? tag : 'P')
/** the role an op can set for a class; undefined when none can */
const roleOf = (c: string): DecisionRole | undefined => (/^(P|H[1-6]|Caption|Note)$/.test(c) ? (c as DecisionRole) : undefined)
const wordsOfLine = (t: string | undefined) => words(t ?? '')

interface Part { el: El; from: number }
interface Stream { w: string[]; own: El[]; start: Set<number>; end: Set<number> }
const streamOf = (els: El[]): Stream => {
  const start = new Set<number>()
  const end = new Set<number>()
  let n = 0
  for (const e of els) if (e.words.length) (start.add(n), (n += e.words.length), end.add(n - 1))
  return { w: els.flatMap((e) => e.words), own: els.flatMap((e) => e.words.map(() => e)), start, end }
}

/** Where a block's lines are in a tag-order stream: the element that holds each line (undefined where the line is not there), and the stream
 *  place of the first word found. A line is placed where its first words start (so a copy of them later in the page cannot take their
 *  place), at or after the line before; a line that is a whole element beats the same words inside a paragraph (a heading and the
 *  sentence that names it). A line is in an element when most of its words are; under 60% of the block's words found: not there at all.
 *  `straddle`: a line that two elements of different roles share, 2 or more words each. */
function locate(lines: string[][], s: Stream): { lineEl: (El | undefined)[]; at: number; straddle: boolean } {
  const w = lines.flat()
  const pos: number[] = []
  let cursor = 0
  for (const L of lines) {
    if (!L.length) continue
    const k = Math.min(4, L.length)
    const slack = Math.max(6, Math.ceil(L.length * 0.3))
    type Placed = { score: number; a: number[] }
    const best = (xs: Placed[]) => xs.reduce<Placed | undefined>((x, y) => (!x || y.score > x.score ? y : x), undefined)
    const place = (min: number, anchored: boolean): Placed | undefined => {
      if (!anchored) {
        // the line starts differently in the file (a hyphen, a dropped letter): its words in the rest of the page
        const a = alignment(L, s.w.slice(min)).map((j) => (j < 0 ? j : j + min))
        return { score: a.filter((j) => j >= 0).length, a }
      }
      const xs: Placed[] = []
      for (let p = s.w.indexOf(L[0], min); p >= 0; p = s.w.indexOf(L[0], p + 1)) {
        if (!L.slice(0, k).every((x, j) => s.w[p + j] === x)) continue
        const head = L.slice(0, k).map((_, j) => p + j)
        const a = [...head, ...alignment(L.slice(k), s.w.slice(p + k, p + L.length + slack)).map((j) => (j < 0 ? j : j + p + k))]
        const hit = a.filter((j) => j >= 0)
        xs.push({ score: hit.length + (hit.length === L.length && s.start.has(Math.min(...hit)) && s.end.has(Math.max(...hit)) ? 0.5 : 0), a })
      }
      return best(xs)
    }
    let got = place(cursor, true)
    if (!got || got.score < L.length * 0.6) got = best([got, place(0, true), place(cursor, false)].filter((x): x is Placed => !!x))
    if (got && got.score >= L.length * 0.6) cursor = Math.max(0, got.a.find((j) => j >= 0)! + L.length - 2)
    pos.push(...(got?.a ?? L.map(() => -1)))
  }
  const hit = pos.filter((p) => p >= 0)
  if (!w.length || hit.length < w.length * 0.6) return { lineEl: lines.map(() => undefined), at: -1, straddle: false }
  let straddle = false
  let n = 0
  const lineEl = lines.map((L) => {
    const count = new Map<El, number>()
    for (const p of pos.slice(n, n + L.length)) if (p >= 0) count.set(s.own[p], (count.get(s.own[p]) ?? 0) + 1)
    n += L.length
    const [main, ...rest] = [...count].sort((x, y) => y[1] - x[1])
    if (rest.some(([e, c]) => c >= 2 && cls(e.role) !== cls(main[0].role))) straddle = true
    return main && main[1] >= L.length * 0.5 ? main[0] : undefined
  })
  return { lineEl, at: Math.min(...hit), straddle }
}

/** The elements that hold a block, in order, each with the first word of the block it holds: runs of lines, the lines `keep` says. */
function partsOf(lineEl: (El | undefined)[], start: number[], keep: (line: number) => boolean = () => true): Part[] {
  const parts: Part[] = []
  lineEl.forEach((el, k) => {
    if (el && keep(k) && !parts.some((p) => p.el === el)) parts.push({ el, from: start[k] })
  })
  return parts
}

const byPage = (els: El[]) => {
  const m = new Map<number, El[]>()
  for (const e of els) m.set(e.page, [...(m.get(e.page) ?? []), e])
  return m
}
const snip = (ws: string[]) => `“${ws.slice(0, 6).join(' ')}${ws.length > 6 ? '…' : ''}”`

interface Found {
  b: EvidenceBlock
  w: string[]
  /** the elements that hold the block in the tool's file and the staff's, over the lines both files have */
  mp: Part[]
  rp: Part[]
  /** lines one file has tagged where the other does not */
  onlyM: number
  onlyR: number
  /** a line two elements of different roles share, in the tool's file and the staff's */
  straddle: [boolean, boolean]
  mAt: number
  rAt: number
}

export function mineStaffFixes(i: MineInput): Mined {
  if (!i.mine.order || !i.ref.order) throw new Error('mineStaffFixes needs both files read with pdfjs (pdfStats(data, pdfjs))')
  const M = byPage(i.mine.order.elements)
  const R = byPage(i.ref.order.elements)
  const untagged = i.ref.order.untagged
  const decisions: PageDecision[] = []
  const disagreements: Disagreement[] = []
  const byOp: Record<string, number> = {}
  const skipped: number[] = []
  const pages: number[] = []
  let differences = 0
  const found = new Map<number, Map<string, Found>>()

  // pass 1: every block of every page, found in both files
  for (const ev of i.evidence) {
    if (!R.has(ev.page)) {
      skipped.push(ev.page)
      continue
    }
    pages.push(ev.page)
    const lines = i.lineText(ev.page)
    const ms = streamOf(M.get(ev.page) ?? [])
    const rs = streamOf(R.get(ev.page) ?? [])
    const m = new Map<string, Found>()
    for (const b of ev.blocks) {
      if (b.kind !== 'text') continue
      const ls = (b.lineIds ?? []).map((l) => words(lines.get(l) ?? ''))
      const w = ls.flat()
      if (!w.length) continue
      const a = locate(ls, ms)
      const r = locate(ls, rs)
      const start = ls.map((_, k) => ls.slice(0, k).reduce((n, L) => n + L.length, 0))
      const one = a.lineEl.every((e) => !e) || r.lineEl.every((e) => !e) // a block only one file has: compared whole
      const both = (k: number) => one || (!!a.lineEl[k] && !!r.lineEl[k])
      m.set(b.id, {
        b, w,
        mp: partsOf(a.lineEl, start, both),
        rp: partsOf(r.lineEl, start, both),
        onlyM: one ? 0 : a.lineEl.filter((e, k) => e && !r.lineEl[k]).length,
        onlyR: one ? 0 : r.lineEl.filter((e, k) => e && !a.lineEl[k]).length,
        straddle: [a.straddle, r.straddle],
        mAt: a.at, rAt: r.at,
      })
    }
    found.set(ev.page, m)
  }

  // pass 2: the ops of each page
  for (const ev of i.evidence) {
    const blocks = found.get(ev.page)
    if (!blocks) continue
    const ops: Op[] = []
    const say = (msg: string) => (differences++, disagreements.push({ page: ev.page, msg }))
    const add = (op: Op) => (differences++, ops.push(op))
    const tmpl = [...(ev.engineOrder ?? []), ...ev.blocks.map((b) => b.id)].filter((id, k, a) => a.indexOf(id) === k)
    const text = tmpl.filter((id) => blocks.has(id)).map((id) => blocks.get(id)!)
    const away = new Set<string>()
    const lines = i.lineText(ev.page)
    const caps = new Set<string>() // drop caps already listed through their own block

    // merge: blocks the staff file holds in one element that the tool holds in several, adjacent in the engine's order
    const inRef = new Map<El, Found[]>()
    for (const f of text) if (f.rp.length === 1 && f.mp.length) inRef.set(f.rp[0].el, [...(inRef.get(f.rp[0].el) ?? []), f])
    const merges: Found[][] = []
    for (const g of inRef.values()) {
      const run: Found[] = []
      const flush = () => (run.length > 1 && new Set(run.map((f) => f.mp[0].el)).size > 1 && merges.push([...run]), (run.length = 0))
      for (const f of g) {
        const last = run[run.length - 1]
        if (last && tmpl.indexOf(f.b.id) !== tmpl.indexOf(last.b.id) + 1) flush()
        run.push(f)
      }
      flush()
    }
    for (const g of merges) for (const f of g.slice(1)) away.add(f.b.id)

    // roles, splits
    for (const f of text) {
      if (away.has(f.b.id)) continue
      const what = snip(f.w)
      if (f.onlyM) say(`The staff file does not tag ${f.onlyM} of the ${f.b.lineIds!.length} lines of ${what} at this place; the build does.`)
      if (f.onlyR) say(`The staff file tags ${f.onlyR} of the ${f.b.lineIds!.length} lines of ${what} that the build does not tag here.`)
      if (f.straddle[1]) say(`The staff file cuts a line of ${what} in the middle between two elements of different roles; no op can say it.`)
      if (f.straddle[0]) say(`The build cuts a line of ${what} in the middle between two elements of different roles; no op can say it.`)
      if (!f.rp.length) {
        if (!f.mp.length) continue
        // the staff file has no tag on it: left out as an artifact, unless it is there as untagged text
        const u = locate([f.w], streamOf([{ id: -1, role: 'P', page: ev.page, words: untagged[ev.page] ?? [] }]))
        if (u.lineEl[0]) say(`The staff file leaves ${what} untagged (not marked as an artifact); the build tags it.`)
        else add({ op: 'role', id: f.b.id, role: 'Artifact' })
        continue
      }
      const rc = f.rp.map((p) => cls(p.el.role))
      const mc = f.mp.map((p) => cls(p.el.role))
      if (f.rp.length === 1) {
        if (f.mp.length && mc.every((c) => c === rc[0])) {
          if (f.mp.length > 1) say(`The build cuts ${what} into ${f.mp.length} elements; the staff file keeps it as one ${f.rp[0].el.role}.`)
          continue
        }
        const role = roleOf(rc[0])
        if (rc[0] === 'Figure' && f.w.join('').length <= 2) caps.add(f.w.join(''))
        if (!role) say(`The staff file tags ${what} as ${f.rp[0].el.role}${rc[0] === 'Figure' && f.w.join('').length <= 2 ? ' (a drop cap)' : ''}; the build tags it as ${f.mp.map((p) => p.el.role).join(' + ') || 'nothing'}. No op sets ${f.rp[0].el.role} on text.`)
        else add({ op: 'role', id: f.b.id, role })
        continue
      }
      // the staff file cuts the block into more elements than the tool did
      if (f.mp.length !== 1) {
        if (f.mp.length !== f.rp.length || mc.some((c, k) => c !== rc[k])) say(`The staff file cuts ${what} into ${f.rp.map((p) => p.el.role).join(' + ')}; the build into ${f.mp.map((p) => p.el.role).join(' + ') || 'nothing'}.`)
        continue
      }
      const at = (() => {
        let n = 0
        const cut = f.rp[1].from
        for (const [k, l] of (f.b.lineIds ?? []).entries()) {
          if (Math.abs(n - cut) <= 1 && k > 0) return k
          n += wordsOfLine(lines.get(l)).length
        }
        return -1
      })()
      const roles = [roleOf(rc[0]), roleOf(rc[1])]
      if (at < 1 || !roles[0] || !roles[1]) say(`The staff file cuts ${what} into ${f.rp.map((p) => p.el.role).join(' + ')}${at < 1 ? ' in the middle of a line' : ''}; no op can say it.`)
      else add({ op: 'split', id: f.b.id, atLine: f.b.lineIds![at], roles: roles as [DecisionRole, DecisionRole] })
      if (f.rp.length > 2) say(`The staff file cuts ${what} into ${f.rp.length} elements; a split makes two, the rest is left.`)
    }
    for (const g of merges) add({ op: 'merge', ids: g.map((f) => f.b.id) })

    // pictures: counts only; a caption under a picture the staff file links and the build does not is linked by place
    const figs = ev.blocks.filter((b) => b.kind === 'figure')
    const pure = (els: El[]) => els.filter((e) => e.role === 'Figure' && !e.words.length)
    const rf = pure(R.get(ev.page) ?? [])
    const mf = pure(M.get(ev.page) ?? [])
    if (rf.length !== mf.length) say(`The staff file tags ${rf.length} picture${rf.length === 1 ? '' : 's'} as Figure on this page; the build ${mf.length}. Grouping pictures needs their boxes, which the file does not give.`)
    // a letter the staff file tags as a picture is a drop cap: text, not a Figure (PDF/UA, the rulebook); the one the build tags the same is no difference
    const dropCaps = (els: El[]) => els.filter((e) => e.role === 'Figure' && /^\p{L}{1,2}$/u.test(e.words.join('')))
    const builtCaps = new Set(dropCaps(M.get(ev.page) ?? []).map((e) => e.words.join('')))
    for (const e of dropCaps(R.get(ev.page) ?? [])) if (!builtCaps.has(e.words.join('')) && !caps.has(e.words.join(''))) say(`The staff file tags the letter “${e.words.join('')}” as Figure (a drop cap); the build keeps it as text. No op sets Figure on text.`)
    const prevFigure = (els: El[], el: El) => {
      const k = els.indexOf(el)
      return k > 0 && els[k - 1].role === 'Figure' && !els[k - 1].words.length ? pure(els).indexOf(els[k - 1]) : -1
    }
    for (const f of text) {
      if (away.has(f.b.id) || !f.rp.length || !f.mp.length || cls(f.rp[0].el.role) !== 'Caption' || cls(f.mp[0].el.role) !== 'Caption') continue
      const k = prevFigure(R.get(ev.page)!, f.rp[0].el)
      if (k < 0 || k === prevFigure(M.get(ev.page) ?? [], f.mp[0].el)) continue
      if (rf.length === mf.length && rf.length === figs.length) add({ op: 'caption', figure: figs[k].id, caption: f.b.id })
      else say(`The staff file puts ${snip(f.w)} under picture ${k + 1} of the page as its caption; the build does not, and the pictures cannot be matched by count (${rf.length} in the staff file, ${mf.length} in the build, ${figs.length} in the layout).`)
    }

    // across the page break
    {
      const was = (m: Map<number, El[]>, e: El) => (m.get(ev.page - 1) ?? []).some((x) => x.id === e.id)
      const first = text.find((f) => !away.has(f.b.id) && (f.rp[0]?.from === 0 || f.mp[0]?.from === 0) && ((f.rp.length && was(R, f.rp[0].el)) || (f.mp.length && was(M, f.mp[0].el))))
      const prev = found.get(ev.page - 1)
      if (first && prev) {
        const refGoes = first.rp.length > 0 && was(R, first.rp[0].el)
        const mineGoes = first.mp.length > 0 && was(M, first.mp[0].el)
        if (refGoes && !mineGoes) {
          const from = [...prev.values()].filter((f) => f.rp.some((p) => p.el.id === first.rp[0].el.id)).sort((a, b) => b.rAt - a.rAt)[0]
          if (from) add({ op: 'continues', id: first.b.id, from: from.b.id })
          else say(`The staff file goes on from the page before with ${snip(first.w)}; the block it goes on from is not in the layout.`)
        } else if (mineGoes && !refGoes) say(`The build goes on across the page break with ${snip(first.w)}; the staff file starts a new element there. No op breaks a paragraph at a page.`)
      }
    }

    // the guards of the model's answer apply to the staff's ops too; what they refuse is a disagreement (still one difference)
    const check = (os: Op[], more?: Partial<ValidateOptions>) => {
      const v = validate(ev, os, { lineText: lines, ...i.guards, ...more })
      for (const r of v.rejected) (differences--, say(`Not an op: ${r.op.op} refused (${r.why}).`))
      return v.ops
    }
    let good = ops.length ? check(ops) : []

    // reading order: the staff file's, laid on the slots the tool's order has for these blocks. Pictures go in it when both files
    // have as many as the layout: the k-th Figure in tag order is the k-th picture of the page. Blocks the ops above took out of the
    // page (merged, artifacts) are not listed.
    const placed = text.filter((f) => !away.has(f.b.id) && f.mp.length && f.rp.length && !ops.some((o) => o.op === 'role' && o.id === f.b.id && o.role === 'Artifact'))
    const at = (els: El[]) => {
      let n = 0
      return els.flatMap((e) => (n += e.words.length, e.role === 'Figure' && !e.words.length ? [n - 0.5] : []))
    }
    const rAt = at(R.get(ev.page) ?? [])
    const mAt = at(M.get(ev.page) ?? [])
    const items = [...placed.map((f) => ({ id: f.b.id, r: f.rAt, m: f.mAt })), ...(rAt.length === mAt.length && mAt.length === figs.length ? figs.map((b, k) => ({ id: b.id, r: rAt[k], m: mAt[k] })) : [])]
    const theirs = [...items].sort((x, y) => x.r - y.r).map((x) => x.id)
    const ours = [...items].sort((x, y) => x.m - y.m).map((x) => x.id)
    if (theirs.some((id, k) => id !== ours[k])) {
      const slots = new Set(theirs)
      const queue = [...theirs]
      const gone = new Set(good.flatMap((o) => (o.op === 'merge' ? o.ids.slice(1) : o.op === 'role' && o.role === 'Artifact' ? [o.id] : [])))
      const order: Op = { op: 'order', ids: tmpl.filter((id) => !gone.has(id)).map((id) => (slots.has(id) ? queue.shift()! : id)) }
      differences++
      // the staff file is the second opinion on a big change to the order
      good = check([...good, order], { second: order.ids })
    }

    for (const o of good) byOp[o.op] = (byOp[o.op] ?? 0) + 1
    if (good.length) decisions.push({ page: ev.page, ops: good, by: 'person' })
  }

  const n = Object.values(byOp).reduce((s, x) => s + x, 0)
  return {
    decisions,
    disagreements,
    counts: { differences, ops: n, disagreements: disagreements.length, byOp, pages: pages.length, skipped },
    reading: readingDims(i.mine, i.ref, pages),
  }
}
