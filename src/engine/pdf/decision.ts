// The override layer (OPUS_DESIGN2 §b.5, T12): a page's typed decision, from the page reader or a person, laid on what an engine
// read through the stable IDs of the page evidence (pdf/evidence.ts). Both pipelines resolve it here, on their own lines, and apply
// the same ops: buildStructure (PDF/UA) and buildPdfEpub (PDF→EPUB). No op changes a word; they say what a block is, where it is
// read and what it belongs to. Validation (T13) is not done here: an op that does not resolve is left out and listed in `refused`.
import { rowOrder } from './layout.ts'
import type { BBox, PageEvidence } from './evidence.ts'
import type { PdfBook, PdfRole, PLine } from '../pdfepub/analyze.ts'
import type { UaRole } from '../pdfua/structure.ts'

export type DecisionRole = 'P' | 'H1' | 'H2' | 'H3' | 'H4' | 'H5' | 'H6' | 'Caption' | 'Note' | 'Artifact' | 'Aside' | 'LI' | 'TOCI' | 'BlockQuote'
export type Op =
  /** the full reading order of the page's blocks (text and figures) */
  | { op: 'order'; ids: string[] }
  | { op: 'role'; id: string; role: DecisionRole }
  /** one block was two: the lines from `atLine` on are the second, each part takes its role */
  | { op: 'split'; id: string; atLine: string; roles: [DecisionRole, DecisionRole] }
  /** adjacent pieces of one paragraph or heading */
  | { op: 'merge'; ids: string[] }
  /** this block goes on with a block on the page (or column) before */
  | { op: 'continues'; id: string; from: string }
  /** pictures (pieces p<n>.i<k>, or figures p<n>.f<k>) that are one Figure, in this order */
  | { op: 'figure'; pieces: string[]; caption?: string }
  | { op: 'caption'; figure: string; caption: string }
  | { op: 'none' }

export interface PageDecision {
  /** 1-based PDF page, as in the evidence */
  page: number
  ops: Op[]
  /** who decided: the page reader, or a person, whose decision for a page always wins */
  by?: 'ai' | 'person'
}

/** One decision per page: a person's beats the page reader's. */
export function decisionsByPage(ds: PageDecision[] = []): Map<number, PageDecision> {
  const out = new Map<number, PageDecision>()
  for (const d of ds) if (!out.has(d.page) || (d.by === 'person' && out.get(d.page)!.by !== 'person')) out.set(d.page, d)
  return out
}

type DLine = { x0: number; x1: number; y: number; size: number; base: number; text: string }

/** A book's decisions resolved on one pipeline's lines. Pages are 1-based PDF pages; boxes are top-down page points. */
export interface Decided<L> {
  role: Map<L, DecisionRole>
  /** the line starts a block of its own (the second part of a split) */
  start: Set<L>
  /** the line goes on with the block read before it (the later blocks of a merge, a continued block after its first line) */
  join: Set<L>
  /** the first line of a continued block: the lines of the block it goes on from */
  from: Map<L, L[]>
  /** the page's blocks in the decided order: a text block's lines, or a figure's box */
  order: Map<number, ({ lines: L[] } | { box: BBox })[]>
  /** pictures that are one Figure: the boxes of the figures that hold the pieces, in the given order */
  groups: Map<number, BBox[][]>
  /** a caption linked to a figure (the figure's box; a group's is the union of its boxes) */
  captions: Map<number, { box: BBox; lines: L[] }[]>
  refused: string[]
}

export const centreIn = (x: number, y: number, b: BBox, d = 2) => x >= b[0] - d && x <= b[2] + d && y >= b[1] - d && y <= b[3] + d
const union = (bs: BBox[]): BBox => [Math.min(...bs.map((b) => b[0])), Math.min(...bs.map((b) => b[1])), Math.max(...bs.map((b) => b[2])), Math.max(...bs.map((b) => b[3]))]

/** Resolve the decisions on a pipeline's lines. `pageOf(n)` gives page n's lines and its evidence. A line belongs to the smallest
 *  text block its middle falls in (as withEngine reads an engine's lines). */
export function decide<L extends DLine>(decisions: PageDecision[] | undefined, pageOf: (page: number) => { lines: L[]; ev: PageEvidence } | undefined): Decided<L> {
  const out: Decided<L> = { role: new Map(), start: new Set(), join: new Set(), from: new Map(), order: new Map(), groups: new Map(), captions: new Map(), refused: [] }
  const byPage = new Map<number, Map<string, L[]>>()
  const pageOfId = (id: string) => Number(id.match(/^p(\d+)\./)?.[1])
  const blocks = (n: number) => {
    if (byPage.has(n)) return byPage.get(n)!
    const m = new Map<string, L[]>()
    const p = pageOf(n)
    const area = (b: BBox) => (b[2] - b[0]) * (b[3] - b[1])
    const text = p?.ev.blocks.filter((b) => b.kind === 'text').sort((a, b) => area(a.bbox) - area(b.bbox)) ?? []
    for (const l of p?.lines ?? []) {
      const b = text.find((b) => centreIn((l.x0 + l.x1) / 2, l.y + l.size / 2, b.bbox, 0.5))
      if (b) m.set(b.id, [...(m.get(b.id) ?? []), l])
    }
    for (const [id, ls] of m) m.set(id, rowOrder(ls))
    byPage.set(n, m)
    return m
  }
  const linesOf = (id: string) => blocks(pageOfId(id)).get(id)
  /** a figure's box; a piece's is the box of the figure that holds it */
  const boxOf = (id: string) => pageOf(pageOfId(id))?.ev.blocks.find((b) => b.kind === 'figure' && (b.id === id || b.pieces?.includes(id)))?.bbox
  const push = <T>(m: Map<number, T[]>, n: number, v: T) => m.set(n, [...(m.get(n) ?? []), v])

  for (const d of decisionsByPage(decisions).values()) {
    const no = (op: Op, why: string) => out.refused.push(`page ${d.page}: ${op.op} ${why}`)
    for (const op of d.ops) {
      if (op.op === 'role') {
        const ls = linesOf(op.id)
        if (!ls) no(op, `${op.id}: no such block`)
        for (const l of ls ?? []) out.role.set(l, op.role)
      } else if (op.op === 'split') {
        const ls = linesOf(op.id)
        const b = pageOf(pageOfId(op.id))?.ev.blocks.find((b) => b.id === op.id)
        const at = b?.lineIds?.indexOf(op.atLine) ?? -1
        // ponytail: lines are matched to the evidence's by rank in the block; a pipeline that joined two of them refuses the split
        if (!ls || at < 1 || ls.length !== b!.lineIds!.length) {
          no(op, `${op.id} at ${op.atLine}: not a line boundary of the block`)
          continue
        }
        ls.forEach((l, i) => out.role.set(l, op.roles[i < at ? 0 : 1]))
        out.start.add(ls[at])
      } else if (op.op === 'merge') {
        const parts = op.ids.map(linesOf)
        if (parts.some((p) => !p)) {
          no(op, `${op.ids.join(' ')}: no such block`)
          continue
        }
        const r = out.role.get(parts[0]![0])
        for (const l of parts.slice(1).flatMap((p) => p!)) (out.join.add(l), r && out.role.set(l, r))
      } else if (op.op === 'continues') {
        const ls = linesOf(op.id)
        const from = linesOf(op.from)
        if (!ls || !from) {
          no(op, `${op.id} from ${op.from}: no such block`)
          continue
        }
        out.from.set(ls[0], from)
        for (const l of ls.slice(1)) out.join.add(l)
      } else if (op.op === 'order') {
        const seq = op.ids.map((id) => (linesOf(id) ? { lines: linesOf(id)! } : boxOf(id) ? { box: boxOf(id)! } : undefined))
        if (seq.some((x) => !x)) no(op, `names a block that is not on the page`)
        else out.order.set(d.page, seq as { lines: L[] }[])
      } else if (op.op === 'figure') {
        const found = op.pieces.map(boxOf)
        if (found.some((b) => !b)) {
          no(op, `${op.pieces.join(' ')}: no such picture`)
          continue
        }
        const boxes = [...new Set(found as BBox[])] // two pieces of one figure: its box once
        push(out.groups, d.page, boxes)
        const cap = op.caption ? linesOf(op.caption) : undefined
        if (cap) push(out.captions, d.page, { box: union(boxes), lines: cap })
      } else if (op.op === 'caption') {
        const box = boxOf(op.figure)
        const cap = linesOf(op.caption)
        if (!box || !cap) no(op, `${op.figure} ← ${op.caption}: no such figure or block`)
        else push(out.captions, d.page, { box, lines: cap })
      }
    }
  }
  return out
}

/** A book's decisions resolved on its lines. A book with no decisions costs nothing. Spreads read as two pages share their PDF page's evidence. */
export function decideBook(book: PdfBook, decisions: PageDecision[] | undefined): Decided<PLine> {
  return decide(decisions, (n) => {
    const ev = book.evidence?.[n - 1]
    return ev ? { ev, lines: book.pages.filter((p) => (p.src ?? p.index) === n - 1).flatMap((p) => p.lines) } : undefined
  })
}

// ponytail: Aside, LI, TOCI and BlockQuote have no tag of their own in either pipeline yet; they read as body text
export const uaRoleOf = (r: DecisionRole): UaRole => (r === 'Aside' || r === 'LI' || r === 'TOCI' || r === 'BlockQuote' ? 'P' : r)
export const pdfRoleOf = (r: DecisionRole): PdfRole =>
  r === 'H1' ? 'title' : r === 'H2' ? 'subhead' : /^H\d$/.test(r) ? 'subhead2' : r === 'Caption' ? 'caption' : r === 'Artifact' ? 'drop' : r === 'Note' ? 'text' : 'body'
