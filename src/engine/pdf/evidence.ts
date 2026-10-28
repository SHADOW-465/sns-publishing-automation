// The page evidence packet (OPUS_DESIGN2 §b.4): a page's lines grouped into blocks, each with a stable ID, as JSON.
// It is read from the page as pdf.js gives it, before either pipeline changes the lines, so PDF/UA and PDF→EPUB
// see the same blocks. IDs are p<page>.<kind><n>, numbered top then left: they never depend on the order an engine
// reads the page in. Kinds: b text block, l line, f figure, i picture piece (an image or a vector drawing).
import { rowOrder, isBoldFont, isItalicFont, type Line } from './layout.ts'
import { clusterDrawings, type DrawBox } from './drawings.ts'
import { columnStarts, columnOf } from '../pdfepub/analyze.ts'
import { lcs } from '../check/refscore-pdf.ts'

export type BBox = [number, number, number, number]

export interface EvidenceBlock {
  id: string
  kind: 'text' | 'figure'
  bbox: BBox
  style?: string
  italic?: boolean
  bold?: boolean
  size?: number
  bodySize?: number
  lines?: number
  /** blocks over 40 words keep their first and last 15 */
  text?: string
  lineIds?: string[]
  /** a figure's pieces, top then left */
  pieces?: string[]
  caption?: null
  /** the role the engine gave the first of the block's lines it read, and the role of that line's style (withEngine) */
  role?: string
  styleRole?: string
}

export interface PageEvidence {
  /** 1-based PDF page */
  page: number
  printed: string
  w: number
  h: number
  columns: [number, number][]
  blocks: EvidenceBlock[]
  /** the blocks in the order an engine read them, when it says */
  engineOrder?: string[]
  /** how far engineOrder agrees with the page's own order, 0-1 (orderConfidence) */
  engineConfidence?: number
  prevPageTail?: { id: string; text: string; endsSentence: boolean }
  nextPageHead?: { id: string; text: string }
}

/** A page as pageLayout returns it. */
export interface EvidencePage {
  width: number
  height: number
  lines: Line[]
  images: DrawBox[]
  drawings?: DrawBox[]
  sideways?: DrawBox[]
}

/** Something an engine read: a line, or a picture's box (top-down points), with the role it gave it and the role of its style. */
export type Ordered = ({ x0: number; x1: number; y: number; size: number; text: string } | DrawBox) & { role?: string; styleRole?: string }

const r1 = (n: number) => Math.round(n * 10) / 10
const wordsOf = (s: string) => s.trim().split(/\s+/).filter(Boolean)
const meets = (a: DrawBox, b: DrawBox) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1
const union = (a: DrawBox, b: DrawBox): DrawBox => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) })
const bboxOf = (b: DrawBox): BBox => [r1(b.x0), r1(b.y0), r1(b.x1), r1(b.y1)]
const styleOf = (l: Line) => `${l.font} ${Math.round(l.size * 2) / 2}`

/** The size most characters are set in. */
export function bodySizeOf(lines: Line[]): number {
  const chars = new Map<number, number>()
  for (const l of lines) chars.set(Math.round(l.size * 2) / 2, (chars.get(Math.round(l.size * 2) / 2) ?? 0) + l.text.length)
  return [...chars].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 10
}

export function pageEvidence(p: EvidencePage, o: { page: number; printed?: string; bodySize?: number; order?: Ordered[] }): PageEvidence {
  const id = (kind: string, n: number) => `p${o.page}.${kind}${String(n).padStart(2, '0')}`
  const bodySize = o.bodySize ?? bodySizeOf(p.lines)
  const lines = rowOrder(p.lines)
  const lineId = new Map(lines.map((l, i) => [l, id('l', i + 1)]))

  // a line joins the block above it when it has the same style, sits one line space under it, overlaps it and is not indented
  // past it (a new paragraph) or led by a list mark. Blocks are made top then left, so that is their order.
  const groups: Line[][] = []
  for (const l of lines) {
    const g = groups.find((g) => {
      const last = g[g.length - 1]
      const gap = l.y - last.base
      return styleOf(last) === styleOf(l) && gap > -l.size * 0.5 && gap < l.size * 0.75 && Math.min(l.x1, last.x1) > Math.max(l.x0, last.x0) && l.x0 - last.x0 < l.size * 0.8 && !l.lead && !l.marker
    })
    if (g) g.push(l)
    else groups.push([l])
  }
  const text: EvidenceBlock[] = groups.map((g, i) => {
    const words = wordsOf(g.map((l) => l.text).join(' '))
    return {
      id: id('b', i + 1),
      kind: 'text',
      bbox: bboxOf({ x0: Math.min(...g.map((l) => l.x0)), y0: Math.min(...g.map((l) => l.y)), x1: Math.max(...g.map((l) => l.x1)), y1: Math.max(...g.map((l) => l.base)) }),
      style: styleOf(g[0]),
      italic: isItalicFont(g[0].font),
      bold: isBoldFont(g[0].font),
      size: r1(g[0].size),
      bodySize,
      lines: g.length,
      text: words.length > 40 ? `${words.slice(0, 15).join(' ')} … ${words.slice(-15).join(' ')}` : words.join(' '),
      lineIds: g.map((l) => lineId.get(l)!),
    }
  })

  // pictures: placed images and vector drawings, top then left; pieces that touch are one figure
  const top = (a: DrawBox, b: DrawBox) => a.y0 - b.y0 || a.x0 - b.x0 || a.y1 - b.y1 || a.x1 - b.x1
  const pieces = [...p.images, ...clusterDrawings(p)].map((b) => ({ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 })).sort(top)
  const clusters: { box: DrawBox; ids: string[] }[] = []
  pieces.forEach((b, i) => {
    let c = { box: b, ids: [id('i', i + 1)] }
    for (let k = clusters.length - 1; k >= 0; k--) {
      if (!meets(clusters[k].box, c.box)) continue
      c = { box: union(clusters[k].box, c.box), ids: [...clusters[k].ids, ...c.ids] }
      clusters.splice(k, 1)
    }
    clusters.push(c)
  })
  const figures: EvidenceBlock[] = clusters.sort((a, b) => top(a.box, b.box)).map((c, i) => ({ id: id('f', i + 1), kind: 'figure', bbox: bboxOf(c.box), pieces: c.ids.sort((a, b) => a.localeCompare(b, 'en', { numeric: true })), caption: null }))
  const blocks = [...text, ...figures]

  const starts = columnStarts(p.lines)
  const columns = starts.map((s): [number, number] => [r1(s), r1(Math.max(s, ...p.lines.filter((l) => columnOf(starts, l.x0) === s).map((l) => l.x1)))])
  const ev: PageEvidence = { page: o.page, printed: o.printed ?? String(o.page), w: r1(p.width), h: r1(p.height), columns, blocks }
  return o.order ? withEngine(ev, o.order) : ev
}

/** An engine's reading laid on a page's blocks: the blocks in the order it read them (engineOrder), the role it gave each and the
 *  role of its style (those of the first of its lines it read) and how far that order agrees with the page's own (engineConfidence).
 *  A line is found by its middle, a picture by its centre; where boxes overlap, the smallest holds it. The blocks and their IDs do
 *  not change. A picture the engine read that the layout does not show (pdf.js drops images it cannot decode, JBIG2 in Node) is
 *  added after the layout's figures, top then left. */
export function withEngine(ev: PageEvidence, order: Ordered[]): PageEvidence {
  const blocks = ev.blocks.map((b) => ({ ...b }))
  const area = (b: EvidenceBlock) => (b.bbox[2] - b.bbox[0]) * (b.bbox[3] - b.bbox[1])
  const at = (kind: EvidenceBlock['kind'], x: number, y: number) =>
    blocks.filter((b) => b.kind === kind && x >= b.bbox[0] - 0.5 && x <= b.bbox[2] + 0.5 && y >= b.bbox[1] - 0.5 && y <= b.bbox[3] + 0.5).sort((a, b) => area(a) - area(b))[0]
  const centre = (it: Ordered) => ('text' in it ? [(it.x0 + it.x1) / 2, it.y + it.size / 2] : [(it.x0 + it.x1) / 2, (it.y0 + it.y1) / 2]) as [number, number]
  const unseen = order.filter((it): it is DrawBox => !('text' in it) && !at('figure', ...centre(it))).sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)
  let n = blocks.filter((b) => b.kind === 'figure').length
  for (const p of unseen) blocks.push({ id: `p${ev.page}.f${String(++n).padStart(2, '0')}`, kind: 'figure', bbox: [r1(p.x0), r1(p.y0), r1(p.x1), r1(p.y1)], pieces: [], caption: null })
  const engineOrder: string[] = []
  for (const it of order) {
    const b = at('text' in it ? 'text' : 'figure', ...centre(it))
    if (!b) continue
    if (it.role && !b.role) b.role = it.role
    if (it.styleRole && !b.styleRole) b.styleRole = it.styleRole
    if (!engineOrder.includes(b.id)) engineOrder.push(b.id)
  }
  const v = { ...ev, blocks, engineOrder }
  return { ...v, engineConfidence: orderConfidence(v) }
}

/** Where the columns of running text start, after the first: the left of a block of 2+ lines, 6 em wide or more, with another such
 *  block wholly to its left. A folio, a note number, a list indent or a centred line starts none (ev.columns counts those). */
export function textColumns(ev: PageEvidence): number[] {
  const tall = ev.blocks.filter((b) => b.kind === 'text' && (b.lines ?? 1) >= 2 && b.bbox[2] - b.bbox[0] >= (b.bodySize ?? 10) * 6)
  const starts: number[] = []
  for (const x of tall.filter((b) => tall.some((a) => a.bbox[2] < b.bbox[0])).map((b) => b.bbox[0]).sort((a, b) => a - b)) if (!starts.length || x - starts[starts.length - 1] > 12) starts.push(x)
  return starts
}

/** The blocks as the page alone reads: blocks across the columns cut it into bands, each band read column by column, top down. */
export function pageOrder(ev: PageEvidence): string[] {
  const starts = textColumns(ev)
  const col = (b: EvidenceBlock) => starts.filter((s) => s <= b.bbox[0] + 3).length
  const across = (b: EvidenceBlock) => starts.some((s) => s > b.bbox[0] + 20 && b.bbox[2] > s + 10)
  const wide = ev.blocks.filter(across).sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0])
  const out: string[] = []
  let top = -Infinity
  for (const w of [...wide, null]) {
    const bottom = w ? w.bbox[1] : Infinity
    out.push(...ev.blocks.filter((b) => !across(b) && b.bbox[1] >= top && b.bbox[1] < bottom).sort((a, b) => col(a) - col(b) || a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0]).map((b) => b.id))
    if (w) out.push(w.id)
    top = bottom
  }
  return out
}

/** The engine's page order confidence: the longest run of blocks it reads in the page's own order (pageOrder), over the blocks
 *  it read. 1 when no engine has read the page. */
export function orderConfidence(ev: PageEvidence): number {
  const eng = ev.engineOrder ?? []
  if (!eng.length) return 1
  const own = pageOrder(ev).filter((id) => eng.includes(id))
  return Math.round((lcs(eng, own) / eng.length) * 100) / 100
}

/** Every page of a book, with the size of its body text and the words either side of each page break. */
export function bookEvidence(pages: EvidencePage[], printed: (i: number) => string): PageEvidence[] {
  const bodySize = bodySizeOf(pages.flatMap((p) => p.lines))
  const evs = pages.map((p, i) => pageEvidence(p, { page: i + 1, printed: printed(i), bodySize }))
  // the body text a page ends and starts with: body-sized blocks of 4 words or more, by column, then down the page
  const body = (e: PageEvidence) => {
    const starts = e.columns.map((c) => c[0])
    const col = (b: EvidenceBlock) => starts.filter((s) => s <= b.bbox[0] + 3).length
    return e.blocks
      .filter((b) => b.text !== undefined && Math.abs(b.size! - bodySize) < 0.6 && wordsOf(b.text).length >= 4)
      .sort((a, b) => col(a) - col(b) || a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0])
  }
  evs.forEach((e, i) => {
    const tail = i > 0 ? body(evs[i - 1]).at(-1) : undefined
    const head = i + 1 < evs.length ? body(evs[i + 1])[0] : undefined
    if (tail) e.prevPageTail = { id: tail.id, text: `…${wordsOf(tail.text!).slice(-12).join(' ')}`, endsSentence: /[.!?…:;]["'”’»)\]]*$/.test(tail.text!.trim()) }
    if (head) e.nextPageHead = { id: head.id, text: `${wordsOf(head.text!).slice(0, 12).join(' ')}…` }
  })
  return evs
}
