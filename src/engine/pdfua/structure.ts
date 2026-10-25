import { type PdfBook, type PLine, columnStarts, columnOf, titleCase } from '../pdfepub/analyze.ts'
import { sectionTypeOf } from '../epub/locale.ts'
import { detectTables } from '../pdf/tables.ts'
import { LIST_MARK } from '../pdf/layout.ts'
import type { Box } from './content.ts'
import { splitBulletEntries, type TocSplit } from './tocsplit.ts'

// =============================================================================================
// Accessible PDF: the logical structure (tag tree) rebuilt from the page layout.
// Mirrors what the production team produced with Acrobat for the Automation samples:
// Document > Sect (one per H1) > H1–H6, P, L/LI/LBody, Note, Figure (+ caption P), TOC/TOCI.
// =============================================================================================

export const UA_ROLES = ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'Caption', 'Note', 'Inline', 'Artifact'] as const
export type UaRole = (typeof UA_ROLES)[number]
export const UA_ROLE_HELP: Record<UaRole, string> = {
  P: 'Paragraph text',
  H1: 'Heading level 1 (starts a section)',
  H2: 'Heading level 2',
  H3: 'Heading level 3',
  H4: 'Heading level 4',
  H5: 'Heading level 5',
  H6: 'Heading level 6',
  Caption: 'Figure / table caption',
  Note: 'Footnote',
  Inline: 'Part of the surrounding line (superscript note numbers, drop caps)',
  Artifact: 'Decoration — not read aloud (running heads, page furniture)',
}

export interface UaStyle {
  key: string
  count: number
  samples: string[]
  role: UaRole
  reason: string
}

export interface SNode {
  id: number
  tag: string
  kids: SNode[]
  lines: PLine[] // content drawn by these lines belongs to this element
  alt?: string
  figure?: Figure
  text?: string // plain text (headings: bookmarks; links)
  /** PDF/UA header scope, set on TH */
  scope?: 'Column' | 'Row'
  rowSpan?: number
  colSpan?: number
  /** an index entry: its page numbers become links */
  indexEntry?: boolean
  /** a topic of a contents run "A • B • C": the stretches of the lines it is made of (character range of the line's text) */
  span?: { line: PLine; from: number; to: number }[]
  /** an entry of a list of illustrations: the figure number it names ("1.5") and the lines holding that number and the page */
  illus?: { label: string; numLine: PLine; pageLine?: PLine }
}

export interface Figure {
  page: number
  box: Box // PDF user space (y up)
  lines: PLine[] // labels drawn inside the figure
  caption: string
  node?: SNode
  image?: Uint8Array | null // thumbnail for the review screen
  vector: boolean
  /** a mark drawn from many paths (publisher device, FSC) */
  logo?: boolean
  /** a small picture with no caption and no text in it: a chapter ornament, a divider, a dingbat */
  ornament?: boolean
}

/** Default tag roles from the analysed font styles. */
export function inferUaStyles(book: PdfBook): UaStyle[] {
  const heads = book.styles
    // a "Chapter 1" label in display type is part of the chapter heading, never a level of its own
    .filter((s) => ['chapter-number', 'title', 'subhead', 'subhead2'].includes(s.role) && s.role !== 'chapter-number' && !(s.samples.length && s.samples.every((x) => CHAPTER_LABEL.test(x.trim()))))
    .map((s) => ({ s, size: Number(s.key.split(' ').pop()) }))
  // heading levels: heading styles used across the book (3+ pages) ranked by size; display type
  // that only appears on the title pages joins the nearest level
  const pagesOf = new Map<string, Set<number>>()
  for (const p of book.pages) for (const l of p.lines) pagesOf.set(l.key, (pagesOf.get(l.key) ?? new Set()).add(p.index))
  const tiny = (s: { samples: string[] }) => s.samples.every((x) => x.trim().length <= 3)
  const frequent = [...new Set(heads.filter((h) => (pagesOf.get(h.s.key)?.size ?? 0) >= 3 && !tiny(h.s)).map((h) => h.size))].sort((a, b) => b - a)
  const levelOf = (size: number) => {
    const i = frequent.findIndex((f) => size >= f - 0.25)
    return Math.min(6, (i < 0 ? frequent.length : i) + 1)
  }
  const bottomShare = new Map<string, number>()
  for (const p of book.pages)
    for (const l of p.lines) bottomShare.set(l.key, (bottomShare.get(l.key) ?? 0) + (l.y > p.height * 0.6 ? 1 : 0))
  return book.styles.map((s) => {
    const size = Number(s.key.split(' ').pop())
    const r = size / book.bodySize
    let role: UaRole = 'P'
    let reason = 'text'
    if (s.role === 'drop') (role = 'Artifact'), (reason = 'print furniture')
    else if (s.role === 'chapter-number' || s.role === 'dropcap') (role = 'Inline'), (reason = s.role === 'dropcap' ? 'drop cap' : 'chapter number (joins the chapter title)')
    else if (s.samples.length && s.samples.every((x) => CHAPTER_LABEL.test(x.trim()))) (role = 'Inline'), (reason = 'chapter label (joins the chapter title)')
    else if (s.role === 'caption') (role = 'Caption'), (reason = 'small text next to pictures')
    else if (heads.some((h) => h.s === s) && tiny(s)) (role = 'Inline'), (reason = 'bold first letters of a line')
    else if (heads.some((h) => h.s === s)) (role = `H${levelOf(size)}` as UaRole), (reason = `heading style, level by size`)
    else if (r < 0.75 && s.samples.every((x) => x.trim().length <= 3)) (role = 'Inline'), (reason = 'superscript note numbers')
    else if (r < 0.95 && (bottomShare.get(s.key) ?? 0) / s.count > 0.7 && s.samples.some((x) => /^\d{1,3}(\s|$)/.test(x.trim())) && s.samples.some((x) => x.trim().length > 8)) (role = 'Note'), (reason = 'small numbered text at the page bottom')
    if (s.key === book.bodyKey) (role = 'P'), (reason = 'body text')
    return { key: s.key, count: s.count, samples: s.samples, role, reason }
  })
}

// ---------------------------------------------------------------------------------------------

/** An uncaptioned picture is an ornament when its longer side is at most this share of the page width. */
export const ORNAMENT_MAX = 0.3

/** The number a caption names ("Figura 1.5. Caption" → "1.5"), the same way a list of illustrations prints it. */
export const figureLabel = (caption: string): string | undefined =>
  caption.match(/^\s*(?:figura|figure|fig\.|abb\.|abbildung|ilustraci[oó]n|gr[aá]fico|plate|l[áa]mina)\s*(\d{1,2}|[ivxlc]{1,4})\s*\.\s*(\d{1,2})/i)?.slice(1, 3).join('.').toUpperCase()

/** "1.5", "I.2", "1. 5": a figure number as a list of illustrations prints it. */
const FIG_NO = /^(\d{1,2}|[IVXLC]{1,4})\s*\.\s*\d{1,2}\.?$/
const isFigListHeading = (t: string) => sectionTypeOf(titleCase(t)) === 'list' && /ilustraci|figur|abbild|illustr|image|plates?|l[áa]min|gr[áa]fic/i.test(t)

const CHAPTER_LABEL = /^(chapter|part|book|kapitel|teil|chapitre|partie|cap[ií]tulo|capitolo|parte)\s+([\divxlc]+|\p{L}+)$/iu
const BULLET = /^([•●◦▪■–—-]|\(?\d{1,2}[.)]|[a-z][.)])\s/

/**
 * The line ends a contents entry. A digit at the end is a page number ("Title 12", or "64" on its own).
 * A roman token is one only when it stands apart from the words: "la" at the end of "El dosel de luz de la" is Spanish.
 */
export function endsTocEntry(l: PLine): boolean {
  const t = l.text.trim()
  if (/^\d{1,4}$/.test(t) || /^[ivxlcdm]{1,7}$/i.test(t)) return true
  const m = t.match(/^(.*?)(?:\s+|\.{2,}\s*)(\d{1,4}|[ivxlcdm]{1,7})$/i)
  if (!m) return false
  const num = m[2]
  if (/^\d+$/.test(num)) return true
  if (/\.{2,}\s*[ivxlcdm]+\s*$/i.test(t)) return true
  const runs = l.runs ?? []
  if (runs.length >= 2) {
    const last = runs[runs.length - 1]
    const prev = runs[runs.length - 2]
    if (last.text.trim().toLowerCase() === num.toLowerCase() && last.x0 - prev.x1 > Math.max(l.size, 1)) return true
  }
  return false
}

export interface Structure {
  tocEntries: SNode[]
  root: SNode
  owner: Map<PLine, SNode>
  figures: Figure[]
  headings: SNode[]
  nodes: SNode[]
  /** pictures the reviewer or the ornaments setting turned into decoration: painted as artifacts on purpose (PFG-007) */
  hidden: Figure[]
  /** contents runs "A • B • C" cut into one TOCI per topic */
  splits: TocSplit[]
}

export interface UaOptions {
  /** heading level of a chapter title when the book has a title heading: 2 (default) puts H1 on the title alone */
  chapterLevel?: 1 | 2
  /** vector logos (a mark drawn from many paths): a 'figure' with alt (default, the client tags the FSC mark) or 'artifact' */
  logos?: 'artifact' | 'figure'
  /** heading levels that get a bookmark (1 = top level only) */
  bookmarkLevels?: number
  /** bookmark an appended plates PDF, and what the bookmark says */
  plateBookmark?: boolean
  plateLabel?: string
  /** page numbers in an index become links to those pages */
  indexLinks?: boolean
  /** a note number links to its note and back */
  noteLinks?: boolean
  /** ornaments (small uncaptioned pictures): a 'figure' with a description, or 'artifact' = decoration a screen reader skips */
  ornaments?: 'figure' | 'artifact'
  /** where the Caption element sits: 'after' its Figure as a sibling (default), or 'inside' the Figure */
  captionIn?: 'after' | 'inside'
  /** running heads and folios: 'artifact' (default) or 'keep' them in the reading order */
  runningHeads?: 'artifact' | 'keep'
  /** 'contiguous' (default) never skips a heading level, so a section under a chapter with no subtitle moves up a level; 'consistent' gives every heading style the same level everywhere */
  headingLevels?: 'contiguous' | 'consistent'
  /** link rectangles stacked on the same picture (the hidden layouts of a button): 'topmost' keeps the last one (default), 'all' keeps every one */
  stackedLinks?: 'topmost' | 'all'
}

/** The accessible-PDF options a resolved settings object carries (UA-01 … UA-07). */
export const uaOptionsFrom = (s: { uaChapterLevel: number; uaLogos: 'artifact' | 'figure'; uaBookmarkLevels: number; uaPlateBookmark: boolean; uaPlateLabel: string; uaIndexLinks: boolean; uaNoteLinks: boolean; uaOrnaments: 'artifact' | 'figure'; uaCaptionIn: 'after' | 'inside'; uaRunningHeads: 'artifact' | 'keep'; uaHeadingLevels: 'contiguous' | 'consistent'; uaStackedLinks: 'topmost' | 'all' }): UaOptions => ({
  chapterLevel: s.uaChapterLevel === 1 ? 1 : 2,
  logos: s.uaLogos,
  bookmarkLevels: s.uaBookmarkLevels,
  plateBookmark: s.uaPlateBookmark,
  plateLabel: s.uaPlateLabel,
  indexLinks: s.uaIndexLinks,
  noteLinks: s.uaNoteLinks,
  ornaments: s.uaOrnaments,
  captionIn: s.uaCaptionIn,
  runningHeads: s.uaRunningHeads,
  headingLevels: s.uaHeadingLevels,
  stackedLinks: s.uaStackedLinks,
})

export function buildStructure(book: PdfBook, roles: Map<string, UaRole>, figuresByPage: Map<number, Figure[]>, options: UaOptions = {}, tick?: () => void): Structure {
  const chapterLevel = options.chapterLevel ?? 2
  let nextId = 0
  const nodes: SNode[] = []
  const mk = (tag: string, lines: PLine[] = []): SNode => {
    const n = { id: nextId++, tag, kids: [], lines }
    nodes.push(n)
    return n
  }
  const root = mk('Document')
  const owner = new Map<PLine, SNode>()
  const headings: SNode[] = []
  const figures: Figure[] = []
  const roleOf = (l: PLine): UaRole => roles.get(l.key) ?? 'P'
  const front = new Set(book.front)
  // the book title is the heading on the front page with the biggest display type; half titles repeat it as text
  const headSize = (i: number) => Math.max(0, ...book.pages[i].lines.filter((l) => /^H\d$/.test(roles.get(l.key) ?? '')).map((l) => l.size))
  const titlePage = [...front].filter((i) => headSize(i) > 0).sort((a, b) => headSize(b) - headSize(a) || b - a)[0]
  const lead = book.lead
  const step = book.step

  // a list marker is its own text piece: split it off its line, then pair each marker with the text beside it (the Lbl of an LI)
  for (const p of book.pages)
    for (const l of [...p.lines]) {
      if (!l.lead) continue
      const m = { ...l, text: l.lead.text, x1: l.lead.x1, runs: [{ ...l.runs[0], text: l.lead.text, x0: l.x0, x1: l.lead.x1 }], lead: undefined }
      l.text = l.text.replace(/^\s*\S+\s*/, '')
      l.runs = [{ ...l.runs[0], text: l.runs[0].text.replace(/^\s*\S+\s*/, ''), x0: l.lead.next }, ...l.runs.slice(1)].filter((r) => r.text)
      l.x0 = l.lead.next
      l.lead = undefined
      p.lines.splice(p.lines.indexOf(l), 0, m)
    }
  const labelOf = new Map<PLine, PLine>()
  for (const p of book.pages)
    for (const m of p.lines) {
      if (!LIST_MARK.test(m.text.trim())) continue
      const body = p.lines.filter((b) => b !== m && Math.abs(b.base - m.base) < 2 && b.x0 >= m.x1 - 1 && b.x0 - m.x1 < m.size * 5 && !LIST_MARK.test(b.text.trim())).sort((a, b) => a.x0 - b.x0)[0]
      if (body && !labelOf.has(body)) labelOf.set(body, m)
    }
  const labels = new Set(labelOf.values())

  let sect: SNode = root
  let container: SNode = root // where paragraphs go (Sect, or TOC)
  let para: { node: SNode; last: PLine; kind: 'P' | 'LI' | 'Note'; first?: PLine } | null = null
  let list: SNode | null = null
  let lastLevel = 0
  const levelBefore = new Map<SNode, number>() // the level in force before each heading, for a kicker that takes its title's level
  // text set with hanging indents: their indented lines mostly follow full lines (turnovers),
  // while first-line indents follow the short last line of the paragraph before
  const full = (x: PLine) => x.x1 > Math.max(...book.pages[x.page].lines.filter((y) => y.col === x.col).map((y) => y.x1)) - 6
  const votes = new Map<string, number>()
  for (const p of book.pages) {
    const starts = columnStarts(p.lines)
    const col = new Map(p.lines.map((l) => [l, columnOf(starts, l.x0)]))
    const right = new Map<number, number>()
    for (const [l, c] of col) right.set(c, Math.max(right.get(c) ?? 0, l.x1))
    const ls = [...p.lines].sort((a, b) => col.get(a)! - col.get(b)! || a.y - b.y)
    ls.forEach((l, k) => {
      const prev = ls[k - 1]
      const c = col.get(l)!
      if (!prev || col.get(prev) !== c || prev.key !== l.key || l.x0 - c <= step * 0.5) return
      votes.set(`${p.index}|${l.key}`, (votes.get(`${p.index}|${l.key}`) ?? 0) + (prev.x1 > right.get(c)! - 6 || /,$/.test(prev.text.trim()) ? 1 : -1))
    })
  }
  const hanging = new Set([...votes].filter(([, v]) => v >= 3).map(([k]) => k)) // per page: notes and bibliography often share a style
  let itemStart: PLine | undefined // first line of the current list item
  let pendingPrefix: PLine[] = [] // chapter numbers wait for their title
  let floats: SNode[] = []
  let inToc = false
  let inFigList = false // under the heading of a list of illustrations
  let inNotes = false // under the heading of the notes
  let notesLevel = 0
  let figList: SNode | null = null
  let tocAfter: { sect: SNode; nodes: SNode[] } | null = null
  const flushToc = () => {
    if (tocAfter) tocAfter.sect.kids.push(...tocAfter.nodes)
    tocAfter = null
  }
  let inIndex = false
  let indexLevel = 6
  let tocLevel = 1
  const tocEntries: SNode[] = []

  const own = (l: PLine, n: SNode) => {
    n.lines.push(l)
    owner.set(l, n)
  }
  const closePara = () => {
    para = null
    for (const f of floats) container.kids.push(f)
    floats = []
  }
  const closeList = () => {
    list = null
  }

  for (const page of book.pages) {
    tick?.()
    const figs = figuresByPage.get(page.index) ?? []
    const inFig = (l: PLine) => figs.find((f) => {
      const top = page.height - f.box.y1
      const bottom = page.height - f.box.y0
      // a label of a chart may run a little past the edge of the drawing: it belongs to the picture when most of it lies inside (PHD-007)
      const inside = Math.min(l.x1, f.box.x1 + 2) - Math.max(l.x0, f.box.x0 - 2)
      return inside >= (l.x1 - l.x0) * 0.5 && l.y >= top - 2 && l.y + l.size <= bottom + 2
    })
    const lines: PLine[] = []
    for (const l of page.lines) {
      const f = inFig(l)
      if (f) {
        f.lines.push(l)
        continue
      }
      if (l.imprint && roleOf(l) === 'Artifact') continue
      if (labels.has(l)) continue // list marker: the Lbl of the item beside it
      if (roleOf(l) !== 'Artifact') lines.push(l)
    }

    // ruled grids become tables. A heading, a note, or a long cell is prose in a box, not a table.
    const tables = detectTables({ width: page.width, height: page.height, lines, rules: page.rules, shades: page.shades }).filter((t) => {
      const filled = t.cells.filter((c) => c.lines.some((l) => l.text.trim() && !/^H\d$/.test(roleOf(l)) && roleOf(l) !== 'Note'))
      if (filled.length < 4) return false
      if (t.cells.some((c) => c.lines.length > 8 || c.lines.some((l) => /^H\d$/.test(roleOf(l)) || roleOf(l) === 'Note'))) return false
      const colsUsed = new Set(filled.map((c) => c.c))
      const rowsUsed = new Set(filled.map((c) => c.r))
      return colsUsed.size >= 2 && rowsUsed.size >= 2
    })
    const tableLineSet = new Set(tables.flatMap((t) => t.lines))
    const tableNodes: { y: number; node: SNode }[] = []
    for (const t of tables) {
      const table = mk('Table')
      const nR = t.rows.length - 1
      for (let r = 0; r < nR; r++) {
        const tr = mk('TR')
        for (const cell of t.cells.filter((c) => c.r === r).sort((a, b) => a.c - b.c)) {
          const header = t.head && r === 0
          const td = mk(header ? 'TH' : 'TD')
          if (header) td.scope = 'Column'
          if (cell.rowspan > 1) td.rowSpan = cell.rowspan
          if (cell.colspan > 1) td.colSpan = cell.colspan
          for (const l of cell.lines) own(l, td)
          td.text = cell.lines.map((l) => l.text.trim()).filter(Boolean).join(' ')
          tr.kids.push(td)
        }
        if (tr.kids.length) table.kids.push(tr)
      }
      if (table.kids.length) tableNodes.push({ y: t.y0, node: table })
    }
    tableNodes.sort((a, b) => a.y - b.y)
    if (tableLineSet.size) {
      const kept = lines.filter((l) => !tableLineSet.has(l))
      lines.length = 0
      lines.push(...kept)
    }
    let tableAt = 0
    const flushTables = (y: number) => {
      while (tableAt < tableNodes.length && tableNodes[tableAt].y <= y + 1) {
        closePara()
        closeList()
        container.kids.push(tableNodes[tableAt].node)
        tableAt++
      }
    }

    // figures and their captions: each caption block (Caption-role text, or a "Figure 3" label line) belongs to the nearest figure
    // beside, above or below it; the pair is read figure first, then caption, pairs in page order (rows top to bottom, left to right)
    const LABEL = /^(abb\.|abbildung|fig\.|figure|figura|ilustraci[oó]n|gr[aá]fic[oa]|tab\.|tabelle|table|tabla|cuadro|plate|map|mapa|lámina|imagen)\s*[\divxlc]/i
    // a page of pictures (plates) has no other text than captions, whatever their font
    const pictured = figs.length > 1 && lines.length <= 30 && figs.every((f) => !f.vector) && figs.reduce((t, f) => t + (f.box.x1 - f.box.x0) * (f.box.y1 - f.box.y0), 0) > page.width * page.height * 0.25
    const seeds = lines.filter((l) => roleOf(l) === 'Caption' || LABEL.test(l.text.trim()) || (pictured && ['P', 'Caption'].includes(roleOf(l)))).sort((a, b) => a.y - b.y || a.x0 - b.x0)
    type Blk = { lines: PLine[]; x0: number; x1: number; top: number; bottom: number }
    const blocks: Blk[] = []
    for (const l of seeds) {
      const b = blocks.find((k) => l.x0 < k.x1 + 12 && l.x1 > k.x0 - 12 && l.y - k.bottom < l.size * 1.8 && l.y >= k.top - 2)
      if (b) (b.lines.push(l), (b.x0 = Math.min(b.x0, l.x0)), (b.x1 = Math.max(b.x1, l.x1)), (b.bottom = Math.max(b.bottom, l.y + l.size)))
      else blocks.push({ lines: [l], x0: l.x0, x1: l.x1, top: l.y, bottom: l.y + l.size })
    }
    const box = (f: Figure) => ({ x0: f.box.x0, x1: f.box.x1, top: page.height - f.box.y1, bottom: page.height - f.box.y0 })
    const gapOf = (f: Figure, k: Blk) => {
      const fb = box(f)
      return Math.max(0, fb.x0 - k.x1, k.x0 - fb.x1) + Math.max(0, fb.top - k.bottom, k.top - fb.bottom)
    }
    const pairs = figs.flatMap((f) => blocks.map((k) => ({ f, k, d: gapOf(f, k) }))).filter((x) => x.d < 50).sort((a, b) => a.d - b.d)
    const capOf = new Map<Figure, Blk>()
    const usedBlk = new Set<Blk>()
    for (const { f, k } of pairs) if (!capOf.has(f) && !usedBlk.has(k)) (capOf.set(f, k), usedBlk.add(k))
    // a "Figure 3" label line may stand to the side of a chart: match it by height alone
    for (const f of figs) {
      if (capOf.has(f)) continue
      const fb = box(f)
      const k = blocks.filter((x) => !usedBlk.has(x) && LABEL.test(x.lines[0].text.trim()) && Math.max(0, fb.top - x.bottom, x.top - fb.bottom) < 40).sort((p, q) => gapOf(f, p) - gapOf(f, q))[0]
      if (k) (capOf.set(f, k), usedBlk.add(k))
    }
    const figNodes: { f: Figure; nodes: SNode[] }[] = []
    for (const f of figs) {
      const n = mk('Figure')
      n.figure = f
      f.node = n
      const k = capOf.get(f)
      f.caption = k ? k.lines.map((l) => l.text.trim()).join(' ') : ''
      const nodes = [n]
      // a picture with no caption and nothing written in it is an ornament (a chapter break, a divider, a dingbat)
      f.ornament = !k && !f.logo && !f.lines.length && Math.max(f.box.x1 - f.box.x0, f.box.y1 - f.box.y0) <= page.width * ORNAMENT_MAX
      if (k) {
        const c = mk('Caption') // its own element right after the figure (PFG-003); a client can nest it in the Figure
        for (const l of k.lines) own(l, c)
        c.text = f.caption
        if (options.captionIn === 'inside') n.kids.push(c)
        else nodes.push(c)
      }
      figNodes.push({ f, nodes })
    }
    // reading order of the pairs: XY-cut, columns before rows (a grid of plates is read down its left column first, as the production team does)
    type Cell = { item: (typeof figNodes)[number]; x0: number; x1: number; top: number; bottom: number }
    const cells: Cell[] = figNodes.map((item) => {
      const fb = box(item.f)
      const k = capOf.get(item.f)
      return { item, x0: Math.min(fb.x0, k?.x0 ?? fb.x0), x1: Math.max(fb.x1, k?.x1 ?? fb.x1), top: Math.min(fb.top, k?.top ?? fb.top), bottom: Math.max(fb.bottom, k?.bottom ?? fb.bottom) }
    })
    const cut = (cs: Cell[], lo: 'x0' | 'top', hi: 'x1' | 'bottom'): Cell[][] | null => {
      const sorted = [...cs].sort((a, b) => a[lo] - b[lo])
      let reach = sorted[0][hi]
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i][lo] > reach + 2) return [sorted.slice(0, i), ...(cut(sorted.slice(i), lo, hi) ?? [sorted.slice(i)])]
        reach = Math.max(reach, sorted[i][hi])
      }
      return null
    }
    const xy = (cs: Cell[]): Cell[] => {
      if (cs.length < 2) return cs
      const cols = cut(cs, 'x0', 'x1')
      if (cols) return cols.flatMap(xy)
      const rows = cut(cs, 'top', 'bottom')
      if (rows) return rows.flatMap(xy)
      return [...cs].sort((a, b) => a.top - b.top || a.x0 - b.x0)
    }
    const cellOrder = xy(cells)
    figNodes.splice(0, figNodes.length, ...cellOrder.map((c) => c.item))
    for (const { f } of figNodes) figures.push(f)
    const taken = new Set([...capOf.values()].flatMap((k) => k.lines))
    if (taken.size) lines.splice(0, lines.length, ...lines.filter((l) => !taken.has(l)))

    // reading order: body columns left to right, full-width lines where they fall
    const body = lines.filter((l) => roleOf(l) === 'P')
    const starts = columnStarts(body.length > 3 ? body : lines)
    for (const l of lines) l.col = columnOf(starts, l.x0)
    // a heading centred over the columns (an index title) reads before the columns under it, not as part of one of them
    const spans = (l: PLine) => /^H\d$/.test(roleOf(l)) && starts.length > 1 && !starts.some((s) => Math.abs(s - l.x0) < 12) && (l.x0 + l.x1) / 2 > starts[0] + (starts[1] - starts[0]) / 2
    const isFull = (l: PLine) => spans(l) || starts.some((s) => s > l.x0 + 20 && l.x1 > s + 10)
    const fulls = lines.filter(isFull).sort((a, b) => a.y - b.y)
    const ordered: PLine[] = []
    // contents pages are rows (number · title · page), not columns
    // a list of illustrations: rows of figure number, caption and page, read row by row like a contents page (PLS-002)
    const figNo = (l: PLine) => FIG_NO.test(l.text.trim()) && l.x0 < page.width * 0.4
    const listPage = (inFigList || lines.some((l) => /^H\d$/.test(roleOf(l)) && isFigListHeading(l.text.trim()))) && lines.filter(figNo).length >= 3
    const tocPage = inToc || listPage || lines.some((l) => /^H\d$/.test(roleOf(l)) && sectionTypeOf(titleCase(l.text.trim())) === 'toc')
    if (tocPage) ordered.push(...[...lines].sort((a, b) => (Math.abs(a.base - b.base) < 2 ? a.x0 - b.x0 : a.base - b.base)))
    // pictures with their captions are read where they stand: a picture across the columns splits them like a full-width line,
    // any other picture goes before the first line below its top that sits over it
    const wide = (c: Cell) => starts.filter((s) => s > c.x0 - 20 && s < c.x1 - 20).length >= 2
    const seps = [...fulls.map((line) => ({ y: line.y, line, cell: undefined as Cell | undefined })), ...(tocPage ? [] : cellOrder.filter(wide).map((cell) => ({ y: cell.top, line: undefined as PLine | undefined, cell })))].sort((a, b) => a.y - b.y)
    const before = new Map<PLine, Cell[]>()
    let carry: Cell[] = []
    const put = (ls: PLine[]) => {
      if (ls.length && carry.length) (before.set(ls[0], carry), (carry = []))
      ordered.push(...ls)
    }
    let top = -Infinity
    for (const f of tocPage ? [] : [...seps, null]) {
      const bottom = f ? f.y : Infinity
      const band = lines.filter((l) => !isFull(l) && l.y >= top && l.y < bottom)
      for (const c of starts) put(band.filter((l) => l.col === c).sort((a, b) => a.y - b.y))
      if (f?.line) put([f.line])
      else if (f?.cell) carry.push(f.cell)
      top = bottom
    }
    const tail = carry
    for (const c of cellOrder) {
      if (!tocPage && wide(c)) continue
      const at = ordered.find((l) => l.y >= c.top - 2 && l.x0 < c.x1 && l.x1 > c.x0)
      if (at) before.set(at, [...(before.get(at) ?? []), c])
      else tail.push(c)
    }
    const emit = (cs: Cell[]) => {
      closePara()
      closeList()
      // a contents list holds only entries: a picture on its page (an ornament under the last entry) follows the list (PRO-008)
      if (container.tag === 'TOC') (tocAfter ??= { sect, nodes: [] }).nodes.push(...cs.flatMap((c) => c.item.nodes))
      else for (const c of cs) container.kids.push(...c.item.nodes)
    }

    for (let i = 0; i < ordered.length; i++) {
      const l = ordered[i]
      flushTables(l.y)
      if (before.has(l)) emit(before.get(l)!)
      const text = l.text.trim()
      // title pages: the title is the heading; subtitle and author lines in display type are text
      const lastH = headings[headings.length - 1]
      const prevL = ordered[i - 1]
      // the wrapped last word of a chapter name in the notes ("PLEYADIANAS") stays in that heading (PHD-006)
      if (inNotes && lastH && prevL && owner.get(prevL) === lastH && l.key === prevL.key && l.page === prevL.page && l.y - prevL.y < Math.max(l.size, prevL.size) * 2.2 && text.length >= 3 && text === text.toUpperCase() && /\p{Lu}/u.test(text) && !/^\d/.test(text)) {
        own(l, lastH)
        lastH.text += ' ' + text
        continue
      }
      // a line that starts in lower case right under a body line is the rest of that paragraph, whatever its style says (PHD-005)
      const continues = /^H\d$/.test(roleOf(l)) && /^\p{Ll}/u.test(text) && !!prevL && prevL.page === l.page && roleOf(prevL) === 'P' && l.y - prevL.y < lead * 1.6 && !inToc
      const r = continues ? 'P' : /^H\d$/.test(roleOf(l)) && front.has(l.page) && (l.page !== titlePage || lastH?.lines[0]?.page === l.page) && !(prevL && roleOf(prevL) === roleOf(l) && owner.get(prevL) === lastH && l.y - prevL.y < l.size * 2.2) ? 'P' : roleOf(l)
      if (r === 'Inline') {
        if ((/^\d{1,3}$/.test(text) && l.size > book.bodySize * 2) || CHAPTER_LABEL.test(text)) pendingPrefix.push(l) // chapter number / label
        continue // attached to its neighbour line afterwards
      }
      // H1 is the book title alone: chapters and subheads move down by chapterLevel - 1 once a title heading exists
      const hasTitle = headings.some((h) => front.has(h.lines[0].page))
      // inside the notes, a line of capitals that is followed by a numbered note is the name of a chapter: a heading one level down (PHD-006)
      const noteHead = inNotes && r === 'P' && text.length >= 8 && text === text.toUpperCase() && /\p{Lu}{3}/u.test(text) && !/^\d/.test(text) && /\s/.test(text) && l.size >= book.bodySize * 0.95 && ((!!ordered[i + 1] && ordered[i + 1].key === l.key && ordered[i + 1].text.trim() === ordered[i + 1].text.trim().toUpperCase() && ordered[i + 1].y - l.y < l.size * 2.2) || /^\d{1,3}[.)]/.test((ordered[i + 1]?.text ?? '').trim()) || (!!ordered[i + 1] && labelOf.has(ordered[i + 1])))
      const lvl = noteHead ? Math.min(6, notesLevel + 1) : /^H\d$/.test(r) ? Math.min(6, Number(r[1]) + (hasTitle && !front.has(l.page) ? chapterLevel - 1 : 0)) : 0
      if (lvl && !(inToc && lvl > tocLevel)) {
        closePara()
        closeList()
        let level = lvl
        const prev = ordered[i - 1]
        const last = headings[headings.length - 1]
        // multi-line heading: same style, directly below
        if (last && prev && roleOf(prev) === r && owner.get(prev) === last && l.y - prev.y < l.size * 2.2) {
          own(l, last)
          last.text += ' ' + text
          continue
        }
        flushToc()
        // a kicker set above the title ("INTRODUCCIÓN DE BARBARA", "UNO") gets the title's level and goes into the title's section (PHD-002)
        const kicker = !!last && !!prev && owner.get(prev) === last && prev.page === l.page && last.lines.every((x) => x.page === l.page) && Number(last.tag[1]) > lvl && prev.size <= l.size && l.y - prev.y < Math.max(l.size, prev.size) * 3.5
        // never skip a level, unless the client wants each style to keep its own level wherever it occurs (PHD-008)
        const before = kicker ? levelBefore.get(last!) ?? 0 : lastLevel
        level = options.headingLevels === 'consistent' ? lvl : Math.min(level, before + 1)
        lastLevel = level
        let opened = false
        if (kicker) {
          last!.tag = `H${level}`
          const at = sect.kids.indexOf(last!)
          if (at >= 0) sect.kids.splice(at, 1)
          if (level === 1 || (hasTitle && level === chapterLevel)) {
            sect = mk('Sect')
            root.kids.push(sect)
            opened = true
          }
          sect.kids.push(last!)
          container = sect
        }
        const h = mk(`H${level}`)
        levelBefore.set(h, before)
        for (const p of pendingPrefix) own(p, h)
        own(l, h)
        h.text = [...pendingPrefix.map((p) => p.text.trim()), text].join(' ')
        pendingPrefix = []
        headings.push(h)
        if (!opened && (level === 1 || (hasTitle && level === chapterLevel))) {
          sect = mk('Sect')
          root.kids.push(sect)
        }
        inToc = sectionTypeOf(titleCase(text)) === 'toc'
        inFigList = isFigListHeading(text)
        figList = null
        if (sectionTypeOf(titleCase(text)) === 'notes') (inNotes = true), (notesLevel = level)
        else if (inNotes && level <= notesLevel) inNotes = false
        if (sectionTypeOf(titleCase(text)) === 'index') (inIndex = true), (indexLevel = level)
        else if (level <= indexLevel) inIndex = false
        tocLevel = level
        container = sect
        sect.kids.push(h)
        if (inToc) {
          container = mk('TOC')
          sect.kids.push(container)
        }
        continue
      }
      if (r === 'Caption') {
        closePara()
        const c = mk('P')
        own(l, c)
        container.kids.push(c)
        continue
      }
      if (listPage && (figNo(l) || figList)) {
        // one LI per illustration: the number is its Lbl, the caption and the page number its LBody
        const rowEnd = (x: PLine) => x.x0 > page.width * 0.6 && /^\d{1,4}$/.test(x.text.trim())
        if (figNo(l)) {
          if (!figList) {
            figList = mk('L')
            container.kids.push(figList)
          }
          const li = mk('LI')
          const lbl = mk('Lbl')
          own(l, lbl)
          lbl.text = l.text.trim()
          const lb = mk('LBody')
          li.kids.push(lbl, lb)
          li.illus = { label: l.text.replace(/\s+/g, '').toUpperCase().replace(/\.$/, ''), numLine: l }
          figList.kids.push(li)
          para = { node: lb, last: l, kind: 'LI', first: l }
        } else if (para?.kind === 'LI') {
          const li = figList!.kids[figList!.kids.length - 1]
          own(l, para.node)
          if (rowEnd(l) && li.illus) li.illus.pageLine = l
          para.last = l
        } else {
          const p = mk('P')
          own(l, p)
          container.kids.push(p)
        }
        continue
      }
      if (inToc) {
        // one TOCI per entry; an entry ends with its page number
        const cur = para as { node: SNode; last: PLine } | null
        // ponytail: page numbers are assumed right-aligned; ragged "Title 12" TOCs would merge entries
        const right = Math.max(...book.pages[cur?.last.page ?? l.page].lines.map((x) => x.x1))
        // a run of bulleted topics (set in its own style) ends where the style changes: the next line is the next entry, not part of the run
        // the bullet run ends when its own style changes (the next chapter title), not when it differs from the first line of the entry
        const bulletKey = [...(cur?.node.lines ?? [])].reverse().find((x) => x.text.includes('•'))?.key
        const run = !!bulletKey && bulletKey !== l.key
        const pageNumber = !!cur && /^\d{1,4}$|^[ivxlcdm]{1,7}$/i.test(cur.last.text.trim())
        if (!cur || run || (endsTocEntry(cur.last) && (pageNumber || cur.last.x1 > right - 12))) {
          const t = mk('TOCI')
          container.kids.push(t)
          tocEntries.push(t)
          para = { node: t, last: l, kind: 'P' }
        }
        own(l, para!.node)
        para!.last = l
        continue
      }
      if (r === 'Note') {
        const cur = para as { node: SNode; last: PLine; kind: string } | null
        const starts = /^\d{1,3}(\s|$)|^[*†‡]/.test(text)
        // the footnote number is its own line to the left of the text, and the text may be ordered first
        const label = /^\d{1,3}$/.test(text) && cur?.kind === 'Note' && Math.abs(l.base - cur.last.base) < 2
        if (cur?.kind === 'Note' && (!starts || label)) {
          if (label) cur.node.lines.unshift(l)
          else cur.node.lines.push(l)
          owner.set(l, cur.node)
          if (!label) cur.last = l
          continue
        }
        const n = mk('Note')
        own(l, n)
        // footnotes sit at the page bottom: they follow the paragraph they interrupt
        if (para && para.kind !== 'Note') floats.push(n)
        else container.kids.push(n)
        para = { node: n, last: l, kind: 'Note' }
        continue
      }
      // ---- paragraphs and list items ----
      const prev = para?.kind !== 'Note' ? para?.last : undefined
      const off = l.x0 - l.col
      const sameFlow = prev && prev.page === l.page && prev.col === l.col
      const gap = sameFlow && l.y - prev!.y > lead * 1.45
      // a dash that wraps to the start of a line (or page) is prose: the line before is full and mid-sentence
      const bullet = (labelOf.has(l) || BULLET.test(text)) && !(prev && para?.kind === 'P' && full(prev) && !/[.:;!?]$/.test(prev.text.trim()))
      const indented = off > step * 0.5
      const prevShort = prev && /[.!?:)’”]$/.test(prev.text.trim()) && prev.x1 - prev.col < (Math.max(...ordered.filter((x) => x.col === prev.col).map((x) => x.x1)) - prev.col) * 0.72
      // centred text (title pages, imprints): only vertical space separates paragraphs
      const mid = (x: PLine) => (x.x0 + x.x1) / 2
      const centred = !!prev && sameFlow && Math.abs(mid(l) - mid(prev)) < 4 && Math.abs(l.x0 - prev.x0) > 3
      let start = !para || para.kind === 'Note' || gap || bullet || (indented && !(para.kind === 'LI' && Math.abs(l.x0 - para.last.x0) < 3)) || (!!prevShort && /^[\p{Lu}‘“(]/u.test(text))
      if (prev && Math.abs(l.x0 - prev.x0) < 2 && !bullet && !gap && !prevShort && para?.kind === 'P') start = false // wrapped text keeps its paragraph
      if (centred && para?.kind === 'P' && !bullet && l.size === prev!.size) start = l.y - prev!.y > prev!.size * 1.9
      // hanging indents (bibliographies): a flush line starts the entry, indented lines continue it
      // (a flush line after a full line that stops mid-sentence is a wrapped line, not a new entry: a cover note beside a hanging list)
      if (hanging.has(`${l.page}|${l.key}`) && para?.kind === 'P' && !bullet) start = gap || (!indented && !(prev && full(prev) && /\p{Ll}$/u.test(prev.text.trim())))
      // an index: every entry is a paragraph. A flush line starts one; an indented line continues the entry before it until that
      // entry ends in a number or a colon, and then it starts a sub-entry
      if (inIndex && para?.kind === 'P' && !bullet && para.last) start = l.x0 - l.col < 4 || /[\d.:;]$/.test(para.last.text.trim())
      if (para?.kind === 'LI' && para.first && !bullet && !gap && l.x0 > para.first.x0 + 2 && sameFlow) start = false // hanging indent of a list item
      if (!start) {
        own(l, para!.node)
        para!.last = l
        continue
      }
      const wasList = para?.kind === 'LI'
      const itemFirst = para?.kind === 'LI' ? (para.first ?? itemStart) : undefined
      closePara()
      if (bullet) {
        if (!list || !wasList) {
          list = mk('L')
          container.kids.push(list)
        }
        const li = mk('LI')
        if (labelOf.has(l)) {
          const lbl = mk('Lbl')
          own(labelOf.get(l)!, lbl)
          lbl.text = labelOf.get(l)!.text.trim()
          li.kids.push(lbl)
        }
        const lb = mk('LBody')
        li.kids.push(lb)
        list.kids.push(li)
        own(l, lb)
        para = { node: lb, last: l, kind: 'LI', first: l }
        itemStart = l
      } else if (wasList && list && itemFirst && l.x0 > itemFirst.x0 + step * 1.5) {
        // indented continuation paragraph inside a list item
        const lb = mk('LBody')
        own(l, lb)
        para = { node: lb, last: l, kind: 'LI' }
        list.kids[list.kids.length - 1].kids.push(lb)
      } else {
        closeList()
        const p = mk('P')
        if (inIndex) p.indexEntry = true
        own(l, p)
        container.kids.push(p)
        para = { node: p, last: l, kind: 'P', first: l }
      }
    }
    flushTables(Infinity)
    if (tail.length) emit(tail)
  }
  closePara()
  flushToc()

  // inline pieces (superscript note numbers, drop caps) belong to the line they sit on
  for (const page of book.pages)
    for (const l of page.lines) {
      if (owner.has(l) || roleOf(l) === 'Artifact' || figures.some((f) => f.lines.includes(l)) || !l.text.trim()) continue
      // stray pieces join the closest tagged line on their page (superscripts, drop caps, placeholders)
      const near = page.lines
        .filter((x) => owner.has(x) && x !== l)
        .sort((a, b) => Math.abs(a.base - l.base) + Math.abs(a.x0 - l.x0) / 10 - (Math.abs(b.base - l.base) + Math.abs(b.x0 - l.x0) / 10))[0]
      if (near) own(l, owner.get(near)!)
      else {
        const p = mk('P')
        own(l, p)
        root.kids.push(p)
      }
    }
  // empty sections/containers are dropped by the writer
  const st: Structure = { root, owner, figures, headings, nodes, tocEntries, hidden: [], splits: [] }
  st.splits = splitBulletEntries(st)
  return st
}

export interface ListItem {
  n: number
  body: SNode
  ls: PLine[]
  text: string
}

/** The numbered list of pictures ("Images", "Illustrations") and the pictures that follow it, each matched to its entry by caption where it can. */
export function imageList(st: Structure, book: PdfBook): { heading: SNode; items: ListItem[]; figures: Figure[]; byN: Map<number, Figure> } | undefined {
  const cn = (t: string) => t.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '').slice(0, 40)
  for (const heading of st.headings) {
    if (!/^(images|illustrations|plates|list of (images|illustrations|plates|figures))$/i.test((heading.text ?? '').trim()) || !heading.lines.length) continue
    // read the entries off the pages: a line starting "12." begins one, the lines after it (up to the next entry) finish it
    const first = heading.lines[0].page
    const items: ListItem[] = []
    let open: ListItem | undefined
    scan: for (let pi = first; pi < Math.min(book.pages.length, first + 4); pi++) {
      // top to bottom, the number before its text on the same line: sorting by column first would put every number before every text line
      for (const l of [...book.pages[pi].lines].sort((a, b) => (Math.abs(a.base - b.base) < 2 ? a.x0 - b.x0 : a.base - b.base))) {
        const node = st.owner.get(l)
        if (node && /^H\d$/.test(node.tag) && node !== heading) break scan
        if (!node || node === heading) continue
        const t = l.text.trim()
        const n = Number(t.match(/^(\d{1,3})[.)](\s|$)/)?.[1])
        if (n) {
          open = { n, body: node.tag === 'LBody' || node.tag === 'P' ? node : node, ls: [l], text: t.replace(/^\d{1,3}[.)]\s*/, '') }
          items.push(open)
        } else if (open && open.ls.length < 6 && open.ls[open.ls.length - 1].page === l.page && Math.abs(l.x0 - open.ls[0].x0) < 40 && l.y - open.ls[open.ls.length - 1].y < l.size * 2.2 && !/^(front|back) cover/i.test(t)) {
          open.ls.push(l)
          open.text += ' ' + t
        }
      }
    }
    const figures = st.figures.filter((f) => f.page > first && f.node)
    const byN = new Map<number, Figure>()
    for (const it of items) {
      const k = cn(it.text)
      const f = k.length >= 15 ? figures.find((x) => (x.caption ? cn(x.caption).startsWith(k) || k.startsWith(cn(x.caption)) : false) && ![...byN.values()].includes(x)) : undefined
      if (f) byN.set(it.n, f)
    }
    return { heading, items, figures, byN }
  }
  return undefined
}
