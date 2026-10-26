import type { Op, Paint } from './content.ts'
import type { PLine } from '../pdfepub/analyze.ts'
import type { SNode, Structure } from './structure.ts'

// A contents entry set as one run of topics, "A • B • C" (the italic line under a chapter in the contents), is one TOCI per topic (PTC-002).
// The structure side cuts the entry into topics; the writer cuts the text-showing operators at the bullet, so each topic is its own marked-content sequence.

const BULLET = '•'
const PAGE_END = /(^|\s|\.{2,})(\d{1,4}|[ivxlc]{1,7})\s*$/i

export interface TocSplit {
  /** the lines of the entry, in reading order */
  lines: PLine[]
  /** one TOCI per topic */
  items: SNode[]
  /** for each line, the topic every stretch between bullets belongs to (-1 where the stretch is only space) */
  segItems: Map<PLine, number[]>
}

/**
 * Replace each TOCI that is a run of bulleted topics with one TOCI per topic. A title with a page number is left alone,
 * and so is a run whose bullets do not add up (a bullet that is not a separator).
 */
export function splitBulletEntries(st: Structure): TocSplit[] {
  const splits: TocSplit[] = []
  const parents = new Map<SNode, SNode>()
  const walk = (n: SNode) => n.kids.forEach((k) => (parents.set(k, n), walk(k)))
  walk(st.root)
  for (const entry of [...st.tocEntries]) {
    const parent = parents.get(entry)
    if (!parent || !entry.lines.length || !entry.lines.some((l) => l.text.includes(BULLET))) continue
    if (PAGE_END.test(entry.lines[entry.lines.length - 1].text.trim())) continue
    // topics: the text of the lines cut at every bullet; a topic that carries on to the next line is one topic
    const items: SNode[] = []
    const segItems = new Map<PLine, number[]>()
    let current: SNode | undefined
    for (const l of entry.lines) {
      const seg: number[] = []
      let from = 0
      l.text.split(BULLET).forEach((piece, k) => {
        if (k > 0) current = undefined // a bullet ends the topic
        const start = from
        from += piece.length + 1
        if (!piece.trim()) return void seg.push(-1)
        if (!current) {
          current = { id: -1, tag: 'TOCI', kids: [], lines: [], text: '', span: [] }
          items.push(current)
        }
        current.text = `${current.text ? current.text + ' ' : ''}${piece.trim()}`
        if (!current.lines.includes(l)) current.lines.push(l)
        current.span!.push({ line: l, from: start + (piece.length - piece.trimStart().length), to: start + piece.trimEnd().length })
        seg.push(items.length - 1)
      })
      segItems.set(l, seg)
    }
    if (items.length < 2) continue
    const at = parent.kids.indexOf(entry)
    if (at < 0) continue
    // ids: the writer reads them to map marked content to elements
    let id = st.nodes.reduce((m, n) => Math.max(m, n.id), 0) + 1
    for (const it of items) {
      it.id = id++
      st.nodes.push(it)
    }
    // the topics of a chapter's entry are a nested TOC right after it (TOC > TOCI, TOC > TOCI…); with no entry above them they stay in the list
    const lead = at > 0 ? parent.kids[at - 1] : undefined
    if (lead?.tag === 'TOCI' && !lead.span) {
      const sub: SNode = { id: id++, tag: 'TOC', kids: items, lines: [] }
      st.nodes.push(sub)
      parent.kids.splice(at, 1, sub)
    } else parent.kids.splice(at, 1, ...items)
    st.nodes.splice(st.nodes.indexOf(entry), 1)
    st.tocEntries.splice(st.tocEntries.indexOf(entry), 1, ...items)
    for (const l of entry.lines) {
      const first = items.find((it) => it.lines.includes(l))
      if (first) st.owner.set(l, first)
    }
    splits.push({ lines: entry.lines, items, segItems })
  }
  return splits
}

// ---------------------------------------------------------------------------------------------
// Writer side: cut text-showing operators at the bullet.
// ---------------------------------------------------------------------------------------------

const BULLET_BYTE = 0x95 // WinAnsi
type Tok = { kind: 'str'; raw: string; hex: boolean; bytes: number[] } | { kind: 'num'; raw: string }

/** Decode a text-showing operand into strings and adjustments. Returns undefined for anything that is not a plain one-byte string. */
function parseOperand(op: Op, src: string): Tok[] | undefined {
  const body = op.op === 'Tj' ? op.args[0] : op.args[0]?.startsWith('[') ? op.args[0].slice(1, -1) : undefined
  if (body === undefined) return undefined
  const toks: Tok[] = []
  let i = 0
  while (i < body.length) {
    const c = body[i]
    if (/\s/.test(c)) {
      i++
    } else if (c === '(') {
      let depth = 1
      let j = i + 1
      const bytes: number[] = []
      while (j < body.length && depth) {
        const ch = body[j]
        if (ch === '\\') {
          const oct = body.slice(j + 1, j + 4).match(/^[0-7]{1,3}/)
          if (oct) (bytes.push(parseInt(oct[0], 8) & 0xff), (j += 1 + oct[0].length))
          else {
            const e = body[j + 1]
            const map: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12, '(': 40, ')': 41, '\\': 92 }
            if (e in map) bytes.push(map[e])
            else if (e !== '\n' && e !== '\r') bytes.push(e.charCodeAt(0) & 0xff)
            j += 2
          }
          continue
        }
        if (ch === '(') depth++
        if (ch === ')') {
          depth--
          if (!depth) break
        }
        bytes.push(ch.charCodeAt(0) & 0xff)
        j++
      }
      toks.push({ kind: 'str', raw: body.slice(i, j + 1), hex: false, bytes })
      i = j + 1
    } else if (c === '<') {
      const j = body.indexOf('>', i)
      if (j < 0) return undefined
      const hex = body.slice(i + 1, j).replace(/\s+/g, '')
      if (hex.length % 2 || /[^0-9a-f]/i.test(hex)) return undefined
      toks.push({ kind: 'str', raw: body.slice(i, j + 1), hex: true, bytes: (hex.match(/../g) ?? []).map((h) => parseInt(h, 16)) })
      i = j + 1
    } else {
      const m = body.slice(i).match(/^[+-]?[\d.]+/)
      if (!m) return undefined
      toks.push({ kind: 'num', raw: m[0] })
      i += m[0].length
    }
  }
  void src
  return toks
}

const literal = (bytes: number[]) => '(' + bytes.map((b) => (b === 40 || b === 41 || b === 92 ? '\\' + String.fromCharCode(b) : b < 32 || b > 126 ? '\\' + b.toString(8).padStart(3, '0') : String.fromCharCode(b))).join('') + ')'
const hexString = (bytes: number[]) => '<' + bytes.map((b) => b.toString(16).padStart(2, '0')).join('') + '>'

/** Bullets one operator shows, or -1 when it is not something that can be cut safely. */
export function bulletsIn(op: Op, src: string): number {
  const toks = parseOperand(op, src)
  return toks ? toks.reduce((n, t) => n + (t.kind === 'str' ? t.bytes.filter((b) => b === BULLET_BYTE).length : 0), 0) : -1
}

export interface Piece {
  /** the operator text of this piece */
  text: string
  /** true for the bullet itself */
  bullet: boolean
}

/** The pieces of one operator, cut at every bullet: text before, the bullet, text after… */
export function cutOperator(op: Op, src: string): Piece[] | undefined {
  const toks = parseOperand(op, src)
  if (!toks) return undefined
  const pieces: Piece[] = []
  let run: Tok[] = []
  const flush = () => {
    if (run.some((t) => t.kind === 'str' && t.bytes.length)) pieces.push({ text: `[${run.map((t) => t.raw).join(' ')}] TJ`, bullet: false })
    run = []
  }
  for (const t of toks) {
    if (t.kind === 'num' || !t.bytes.includes(BULLET_BYTE)) {
      run.push(t)
      continue
    }
    let from = 0
    t.bytes.forEach((b, i) => {
      if (b !== BULLET_BYTE) return
      if (i > from) run.push({ kind: 'str', raw: t.hex ? hexString(t.bytes.slice(from, i)) : literal(t.bytes.slice(from, i)), hex: t.hex, bytes: t.bytes.slice(from, i) })
      flush()
      pieces.push({ text: `[${t.hex ? hexString([b]) : literal([b])}] TJ`, bullet: true })
      from = i + 1
    })
    if (from < t.bytes.length) run.push({ kind: 'str', raw: t.hex ? hexString(t.bytes.slice(from)) : literal(t.bytes.slice(from)), hex: t.hex, bytes: t.bytes.slice(from) })
  }
  flush()
  return pieces
}

export interface PageOps {
  src: string
  ops: Op[]
  paints: (Paint | null)[]
}

/**
 * Cut the text-showing operators of a page that hold the topics of a split entry at their bullets. The bullet itself becomes
 * its own operator, which is an artifact (a separator, not content); every other piece belongs to its topic's TOCI.
 * `owners` maps the index of each new operator to its element (null = artifact). Splits whose bullets cannot be counted
 * the way the text reads are left alone, and `left` says how many.
 */
export function cutPage(
  page: PageOps, index: number, splits: TocSplit[], lineAt: (p: Extract<Paint, { kind: 'text' }>, lines: PLine[]) => PLine | undefined,
  read: (src: string) => PageOps,
): (PageOps & { owners: Map<number, SNode | null>; left: number }) | undefined {
  type Plan = { k: number; split: TocSplit; line: PLine; pieces: Piece[] }
  const plans: Plan[] = []
  let left = 0
  for (const split of splits) {
    const lines = split.lines.filter((l) => l.page === index)
    if (!lines.length) continue
    const mine: Plan[] = []
    const seen = new Map<PLine, number>()
    let ok = true
    page.ops.forEach((op, k) => {
      const p = page.paints[k]
      if (!ok || p?.kind !== 'text' || (op.op !== 'Tj' && op.op !== 'TJ')) return
      const line = lineAt(p, lines)
      if (!line) return
      const pieces = cutOperator(op, page.src)
      if (!pieces) return void (ok = false)
      seen.set(line, (seen.get(line) ?? 0) + pieces.filter((x) => x.bullet).length)
      mine.push({ k, split, line, pieces })
    })
    // the bullets in the operators must be the bullets the text reads
    for (const l of lines) if ((seen.get(l) ?? 0) !== l.text.split(BULLET).length - 1) ok = false
    if (ok) plans.push(...mine)
    else left++
  }
  if (!plans.length) return left ? { ...page, owners: new Map(), left } : undefined
  const byOp = new Map(plans.map((p) => [p.k, p]))
  const count = new Map<PLine, number>()
  const marks: { at: number; owner: SNode | null }[] = []
  let out = ''
  let pos = 0
  page.ops.forEach((op, k) => {
    const plan = byOp.get(k)
    if (!plan) return
    out += page.src.slice(pos, op.start)
    pos = op.end
    const seg = plan.split.segItems.get(plan.line) ?? []
    let carry: SNode | null = null
    plan.pieces.forEach((piece, j) => {
      const b = count.get(plan.line) ?? 0
      const owner = piece.bullet ? null : plan.split.items[seg[b] ?? -1] ?? carry
      if (!piece.bullet && owner) carry = owner
      if (piece.bullet) count.set(plan.line, b + 1)
      marks.push({ at: out.length + (j ? 1 : 0), owner })
      out += (j ? '\n' : '') + piece.text
    })
  })
  out += page.src.slice(pos)
  const next = read(out)
  const owners = new Map<number, SNode | null>()
  for (const m of marks) {
    const k = next.ops.findIndex((o) => o.start === m.at)
    if (k >= 0) owners.set(k, m.owner)
  }
  return { ...next, owners, left }
}

export type { Paint }
