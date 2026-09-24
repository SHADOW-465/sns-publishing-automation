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

    // figures and their captions: the caption is the Caption-role text touching the figure
    for (const f of figs) {
      const n = mk('Figure')
      n.figure = f
      f.node = n
      figures.push(f)
      const capLines = lines.filter((l) => roleOf(l) === 'Caption' && Math.abs(page.height - l.y - f.box.y0) < 40 + l.size * 3 && l.x0 < f.box.x1 && l.x1 > f.box.x0)
      const byLabel = lines.filter((l) => /^(abb\.|abbildung|fig\.|figure|tab\.|tabelle|table|plate|map|mapa|lámina|imagen)\s*[\divxlc]/i.test(l.text.trim()) && Math.abs(page.height - l.y - l.size - f.box.y1) < 40)
      const cap = [...new Set([...byLabel, ...capLines])]
      f.caption = cap.map((l) => l.text.trim()).join(' ')
      if (cap.length) {
        const c = mk('Caption')
        for (const l of cap) own(l, c)
        c.text = f.caption
        // read the caption where it is printed: before the figure when it sits above it
        const above = cap.every((l) => page.height - l.y > f.box.y1 - 4)
        floats.push(...(above ? [c, n] : [n, c]))
        lines.splice(0, lines.length, ...lines.filter((l) => !cap.includes(l)))
      } else floats.push(n)
    }

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
