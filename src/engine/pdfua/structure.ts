import { type PdfBook, type PLine, columnStarts, columnOf, titleCase } from '../pdfepub/analyze.ts'
import { sectionTypeOf } from '../epub/locale.ts'
import type { Box } from './content.ts'

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
}

export interface Figure {
  page: number
  box: Box // PDF user space (y up)
  lines: PLine[] // labels drawn inside the figure
  caption: string
  node?: SNode
  image?: Uint8Array | null // thumbnail for the review screen
  vector: boolean
}

/** Default tag roles from the analysed font styles. */
export function inferUaStyles(book: PdfBook): UaStyle[] {
  const heads = book.styles
    .filter((s) => ['chapter-number', 'title', 'subhead', 'subhead2'].includes(s.role) && s.role !== 'chapter-number')
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
    else if (r < 0.95 && (bottomShare.get(s.key) ?? 0) / s.count > 0.7 && s.samples.some((x) => /^\d{1,3}(\s|$)/.test(x.trim()))) (role = 'Note'), (reason = 'small numbered text at the page bottom')
    if (s.key === book.bodyKey) (role = 'P'), (reason = 'body text')
    return { key: s.key, count: s.count, samples: s.samples, role, reason }
  })
}

// ---------------------------------------------------------------------------------------------

const CHAPTER_LABEL = /^(chapter|part|book|kapitel|teil|chapitre|partie|cap[ií]tulo|capitolo|parte)\s+([\divxlc]+|\p{L}+)$/iu
const BULLET = /^([•●◦▪■–—-]|\(?\d{1,2}[.)]|[a-z][.)])\s/
const TOC_ENTRY = /(^|\s|\.{2,})(\d{1,4}|[ivxlc]{1,7})\s*$/i

export interface Structure {
  tocEntries: SNode[]
  root: SNode
  owner: Map<PLine, SNode>
  figures: Figure[]
  headings: SNode[]
  nodes: SNode[]
}

export function buildStructure(book: PdfBook, roles: Map<string, UaRole>, figuresByPage: Map<number, Figure[]>): Structure {
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
  const lead = book.lead
  const step = book.step

  let sect: SNode = root
  let container: SNode = root // where paragraphs go (Sect, or TOC)
  let para: { node: SNode; last: PLine; kind: 'P' | 'LI' | 'Note'; first?: PLine } | null = null
  let list: SNode | null = null
  let lastLevel = 0
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
      votes.set(`${p.index}|${l.key}`, (votes.get(`${p.index}|${l.key}`) ?? 0) + (prev.x1 > right.get(c)! - 6 ? 1 : -1))
    })
  }
  const hanging = new Set([...votes].filter(([, v]) => v >= 3).map(([k]) => k)) // per page: notes and bibliography often share a style
  let itemStart: PLine | undefined // first line of the current list item
  let pendingPrefix: PLine[] = [] // chapter numbers wait for their title
  let floats: SNode[] = []
  let inToc = false
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
    const figs = figuresByPage.get(page.index) ?? []
    const inFig = (l: PLine) => figs.find((f) => {
      const top = page.height - f.box.y1
      const bottom = page.height - f.box.y0
      return l.x0 >= f.box.x0 - 2 && l.x1 <= f.box.x1 + 2 && l.y >= top - 2 && l.y + l.size <= bottom + 2
    })
    const lines: PLine[] = []
    for (const l of page.lines) {
      const f = inFig(l)
      if (f) {
        f.lines.push(l)
        continue
      }
      if (l.imprint && roleOf(l) === 'Artifact') continue
      if (roleOf(l) !== 'Artifact') lines.push(l)
    }

    // figures and their captions: each caption block (Caption-role text, or a "Figure 3" label line) belongs to the nearest figure
    // beside, above or below it; the pair is read figure first, then caption, pairs in page order (rows top to bottom, left to right)
    const LABEL = /^(abb\.|abbildung|fig\.|figure|tab\.|tabelle|table|plate|map|mapa|lámina|imagen)\s*[\divxlc]/i
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
      if (k) {
        const c = mk('P') // a plain paragraph right after its figure, as in the hand-tagged files
        for (const l of k.lines) own(l, c)
        c.text = f.caption
        nodes.push(c)
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
    figNodes.splice(0, figNodes.length, ...xy(cells).map((c) => c.item))
    for (const { f } of figNodes) figures.push(f)
    for (const { nodes } of figNodes) floats.push(...nodes)
    const taken = new Set([...capOf.values()].flatMap((k) => k.lines))
    if (taken.size) lines.splice(0, lines.length, ...lines.filter((l) => !taken.has(l)))

    // reading order: body columns left to right, full-width lines where they fall
    const body = lines.filter((l) => roleOf(l) === 'P')
    const starts = columnStarts(body.length > 3 ? body : lines)
    for (const l of lines) l.col = columnOf(starts, l.x0)
    const isFull = (l: PLine) => starts.some((s) => s > l.x0 + 20 && l.x1 > s + 10)
    const fulls = lines.filter(isFull).sort((a, b) => a.y - b.y)
    const ordered: PLine[] = []
    // contents pages are rows (number · title · page), not columns
    const tocPage = inToc || lines.some((l) => /^H\d$/.test(roleOf(l)) && sectionTypeOf(titleCase(l.text.trim())) === 'toc')
    if (tocPage) ordered.push(...[...lines].sort((a, b) => (Math.abs(a.base - b.base) < 2 ? a.x0 - b.x0 : a.base - b.base)))
    let top = -Infinity
    for (const f of tocPage ? [] : [...fulls, null]) {
      const bottom = f ? f.y : Infinity
      const band = lines.filter((l) => !isFull(l) && l.y >= top && l.y < bottom)
      for (const c of starts) ordered.push(...band.filter((l) => l.col === c).sort((a, b) => a.y - b.y))
      if (f) ordered.push(f)
      top = bottom
    }

    for (let i = 0; i < ordered.length; i++) {
      const l = ordered[i]
      const text = l.text.trim()
      // title pages: the title is the heading; subtitle and author lines in display type are text
      const lastH = headings[headings.length - 1]
      const prevL = ordered[i - 1]
      const r = /^H\d$/.test(roleOf(l)) && front.has(l.page) && lastH?.lines[0]?.page === l.page && !(prevL && roleOf(prevL) === roleOf(l) && owner.get(prevL) === lastH && l.y - prevL.y < l.size * 2.2) ? 'P' : roleOf(l)
      if (r === 'Inline') {
        if ((/^\d{1,3}$/.test(text) && l.size > book.bodySize * 2) || CHAPTER_LABEL.test(text)) pendingPrefix.push(l) // chapter number / label
        continue // attached to its neighbour line afterwards
      }
      if (/^H\d$/.test(r) && !(inToc && Number(r[1]) > tocLevel)) {
        closePara()
        closeList()
        let level = Number(r[1])
        const prev = ordered[i - 1]
        const last = headings[headings.length - 1]
        // multi-line heading: same style, directly below
        if (last && prev && roleOf(prev) === r && owner.get(prev) === last && l.y - prev.y < l.size * 2.2) {
          own(l, last)
          last.text += ' ' + text
          continue
        }
        level = Math.min(level, lastLevel + 1) // never skip a level
        lastLevel = level
        const h = mk(`H${level}`)
        for (const p of pendingPrefix) own(p, h)
        own(l, h)
        h.text = [...pendingPrefix.map((p) => p.text.trim()), text].join(' ')
        pendingPrefix = []
        headings.push(h)
        if (level === 1) {
          sect = mk('Sect')
          root.kids.push(sect)
        }
        inToc = sectionTypeOf(titleCase(text)) === 'toc'
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
      if (inToc) {
        // one TOCI per entry; an entry ends with its page number
        const cur = para as { node: SNode; last: PLine } | null
        // ponytail: page numbers are assumed right-aligned; ragged "Title 12" TOCs would merge entries
        const right = Math.max(...book.pages[cur?.last.page ?? l.page].lines.map((x) => x.x1))
        if (!cur || (TOC_ENTRY.test(cur.last.text) && cur.last.x1 > right - 12)) {
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
        if (cur?.kind === 'Note' && !starts) {
          own(l, cur.node)
          cur.last = l
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
      const bullet = BULLET.test(text) && !(prev && para?.kind === 'P' && full(prev) && !/[.:;!?]$/.test(prev.text.trim()))
      const indented = off > step * 0.5
      const prevShort = prev && /[.!?:)’”]$/.test(prev.text.trim()) && prev.x1 - prev.col < (Math.max(...ordered.filter((x) => x.col === prev.col).map((x) => x.x1)) - prev.col) * 0.72
      // centred text (title pages, imprints): only vertical space separates paragraphs
      const mid = (x: PLine) => (x.x0 + x.x1) / 2
      const centred = !!prev && sameFlow && Math.abs(mid(l) - mid(prev)) < 4 && Math.abs(l.x0 - prev.x0) > 3
      let start = !para || para.kind === 'Note' || gap || bullet || (indented && !(para.kind === 'LI' && Math.abs(l.x0 - para.last.x0) < 3)) || (!!prevShort && /^[\p{Lu}‘“(]/u.test(text))
      if (prev && Math.abs(l.x0 - prev.x0) < 2 && !bullet && !gap && !prevShort && para?.kind === 'P') start = false // wrapped text keeps its paragraph
      if (centred && para?.kind === 'P' && !bullet && l.size === prev!.size) start = l.y - prev!.y > prev!.size * 1.9
      // hanging indents (bibliographies): a flush line starts the entry, indented lines continue it
      if (hanging.has(`${l.page}|${l.key}`) && para?.kind === 'P' && !bullet) start = gap || !indented
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
        own(l, p)
        container.kids.push(p)
        para = { node: p, last: l, kind: 'P', first: l }
      }
    }
  }
  closePara()

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
  return { root, owner, figures, headings, nodes, tocEntries }
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
      for (const l of [...book.pages[pi].lines].sort((a, b) => a.col - b.col || a.y - b.y)) {
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
