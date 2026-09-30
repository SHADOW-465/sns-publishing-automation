import type { PLine } from './analyze.ts'
import { sectionTypeOf } from '../epub/locale.ts'

// =============================================================================================
// The printed contents page is the book's own table of parts and chapters. Reading it tells the
// tool where every chapter starts, what its heading looks like (which fonts are chapter labels and
// titles) and how the e-book's contents page must be laid out — for any book, whatever the fonts.
// The same reader serves the "list of exercises" style pages (entries, some under a label).
// =============================================================================================

export interface ContentsEntry {
  /** "Capítulo 5. Cómo expresar tu Yo Auténtico a todas horas" (leaders and page number removed) */
  text: string
  /** printed page the entry points to; parts and labels have none */
  page?: number
  /** part = a centred heading without page ("Segunda parte"); label = a line without page that heads the entries under it ("Capítulo 3") */
  kind: 'entry' | 'part' | 'label'
  /** the lines of the contents page that make up the entry */
  lines: PLine[]
  /** the page (PDF page index) the entry sits on */
  on: number
  /** 2 = a subsection listed under a chapter (set in from the chapter entries) */
  level?: 1 | 2
}

export interface Contents {
  /** PDF page indexes of the contents pages */
  pages: number[]
  entries: ContentsEntry[]
}

export const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, '')
const ROMAN = /^[ivxlcdm]{1,7}$/i
/** a page reference at the end of a row: after leaders, dots or spaces */
const REF = /(?:[.·…]{2,}|\s|\t)\s*(\d{1,4}|[ivxlcdm]{1,7})\s*$/i
const LEADERS = /\s*[.·…_]{2,}\s*/g

export interface Row {
  lines: PLine[]
  base: number
  x0: number
  x1: number // right edge of the text, before the page number
  text: string
  page: number
  ref?: number | string
  centred: boolean
}

/** Rows of a page: lines on one baseline (title, leaders and page number are separate lines in the PDF). */
export function rowsOf(lines: PLine[], width: number, pageIdx: number): Row[] {
  const rows: Row[] = []
  for (const l of [...lines].sort((a, b) => a.base - b.base || a.x0 - b.x0)) {
    if (!l.text.trim()) continue
    const r = rows.find((x) => Math.abs(x.base - l.base) < Math.max(2, l.size * 0.3))
    if (r) r.lines.push(l)
    else rows.push({ lines: [l], base: l.base, x0: 0, x1: 0, text: '', page: pageIdx, centred: false })
  }
  for (const r of rows) {
    r.lines.sort((a, b) => a.x0 - b.x0)
    r.x0 = r.lines[0].x0
    r.x1 = r.lines[r.lines.length - 1].x1
    let text = r.lines.map((l) => l.text.trim()).join(' ').replace(LEADERS, ' ').replace(/\s+/g, ' ').trim()
    const m = text.match(REF)
    if (m && text.length > m[0].length) {
      const raw = m[1]
      // a page reference is the last thing on the row, at the right; roman numerals only as roman pages (not "mix", "civil"…)
      const right = r.x1 > width * 0.6
      if (/^\d+$/.test(raw) ? right : ROMAN.test(raw) && right && /[.·…\s]/.test(text.charAt(text.length - raw.length - 1))) {
        r.ref = /^\d+$/.test(raw) ? Number(raw) : raw
        text = text.slice(0, text.length - m[0].length).replace(/[\s.·…]+$/, '').trim()
        // the text ends before the page number: its right edge is the line before the last one
        const body = r.lines.filter((l) => !/^[\d.·…\s]+$/.test(l.text) && !ROMAN.test(l.text.trim()))
        if (body.length) r.x1 = body[body.length - 1].x1
      }
    }
    r.text = text
  }
  // the text column of the page: number-less rows centred in it are part headings
  const ref = rows.filter((r) => r.ref !== undefined)
  if (ref.length >= 2) {
    const left = ref.map((r) => r.x0).sort((a, b) => a - b)[Math.floor(ref.length / 2)]
    const right = Math.max(...ref.map((r) => Math.max(...r.lines.map((l) => l.x1))))
    const w = right - left
    for (const r of rows) r.centred = r.ref === undefined && Math.abs((r.x0 + r.x1) / 2 - (left + right) / 2) < w * 0.05 && r.x0 > left + w * 0.06
  }
  return rows.sort((a, b) => a.base - b.base)
}

const isTocHeading = (l: PLine, bodySize: number) => l.size >= bodySize * 1.2 && sectionTypeOf(l.text.trim().replace(/\s+/g, ' ')) === 'toc'

/** Entries of one page's rows: wrapped titles joined, centred part headings and labels told apart. */
export function entriesOf(rows: Row[], pageIdx: number, skipLine?: (l: PLine) => boolean): ContentsEntry[] {
  const entries: ContentsEntry[] = []
  let buf: Row[] = []
  const mk = (rs: Row[], kind: ContentsEntry['kind'], page?: number): ContentsEntry => ({
    text: rs.map((r) => r.text).join(' ').replace(/\s+/g, ' ').trim(), page, kind, lines: rs.flatMap((r) => r.lines), on: pageIdx,
  })
  const flushLoose = () => {
    // rows without a page number: a centred block is a part heading, a left one a label
    if (buf.length) entries.push(mk(buf, buf.every((r) => r.centred) ? 'part' : 'label'))
    buf = []
  }
  for (const r of rows) {
    if (skipLine && r.lines.every(skipLine)) continue
    // a bare chapter label ("Capítulo 3") heads the entries under it: it is not the first line of the next entry
    if (buf.length === 1 && !buf[0].centred && sectionTypeOf(buf[0].text) === 'chapter' && buf[0].text.split(/\s+/).length <= 3) flushLoose()
    if (r.ref === undefined) {
      if (buf.length && buf[0].centred !== r.centred) flushLoose()
      buf.push(r)
      continue
    }
    // a wrapped title continues on an indented row; a row at the same left edge starts its own entry
    if (buf.length && !buf[0].centred && r.x0 > buf[0].x0 + 3) {
      entries.push(mk([...buf, r], 'entry', typeof r.ref === 'number' ? r.ref : undefined))
      buf = []
      continue
    }
    flushLoose()
    entries.push(mk([r], 'entry', typeof r.ref === 'number' ? r.ref : undefined))
  }
  flushLoose()
  return entries.filter((e) => e.text)
}

/** Find and read the printed contents (first pages of the book); undefined when there is none. */
export function readContents(pages: { index: number; width: number; lines: PLine[] }[], bodySize: number): Contents | undefined {
  const limit = Math.min(pages.length, 40)
  let first = -1
  for (let i = 0; i < limit; i++) {
    const rows = rowsOf(pages[i].lines, pages[i].width, i)
    if (pages[i].lines.some((l) => isTocHeading(l, bodySize)) && rows.filter((r) => r.ref !== undefined).length >= 3) {
      first = i
      break
    }
  }
  if (first < 0) return undefined
  const tocPages = [first]
  for (let i = first + 1; i < limit; i++) {
    const rows = rowsOf(pages[i].lines, pages[i].width, i)
    const withRef = rows.filter((r) => r.ref !== undefined).length
    // continuation pages: mostly rows that end in page numbers (plus centred part headings)
    if (withRef >= 3 && withRef >= rows.filter((r) => !r.centred).length * 0.5) tocPages.push(i)
    else break
  }
  const entries = tocPages.flatMap((pi) => entriesOf(rowsOf(pages[pi].lines, pages[pi].width, pi), pi, (l) => isTocHeading(l, bodySize)))
  // a contents page with two levels sets the second one in: its entries are subheads of the chapters, not sections of their own
  const xs = entries.filter((e) => e.kind === 'entry').map((e) => e.lines[0].x0)
  const left = xs.length ? xs.sort((a, b) => a - b)[Math.floor(xs.length * 0.1)] : 0
  for (const e of entries) e.level = e.kind === 'entry' && e.lines[0].x0 > left + 8 && !sectionTypeOf(e.text) ? 2 : 1
  return entries.filter((e) => e.kind !== 'label').length >= 3 ? { pages: tocPages, entries } : undefined
}

/** "List of exercises / figures / tables" pages after the contents: entries with page numbers that name headings inside the chapters. */
export function readLists(pages: { index: number; width: number; lines: PLine[] }[], bodySize: number, after: number): Contents[] {
  const out: Contents[] = []
  const limit = Math.min(pages.length, 40)
  for (let i = after + 1; i < limit; i++) {
    const head = pages[i].lines.find((l) => l.size >= bodySize * 1.2 && sectionTypeOf(l.text.trim().replace(/\s+/g, ' ')) === 'list')
    if (!head) continue
    const rows = rowsOf(pages[i].lines, pages[i].width, i)
    if (rows.filter((r) => r.ref !== undefined).length < 2) continue
    const idx = [i]
    for (let j = i + 1; j < limit; j++) {
      const rj = rowsOf(pages[j].lines, pages[j].width, j)
      if (rj.filter((r) => r.ref !== undefined).length >= 2 && !pages[j].lines.some((l) => l.size >= bodySize * 1.2 && sectionTypeOf(l.text.trim()))) idx.push(j)
      else break
    }
    const entries = idx.flatMap((pi) => entriesOf(rowsOf(pages[pi].lines, pages[pi].width, pi), pi, (l) => l === head))
    out.push({ pages: idx, entries })
    i = idx[idx.length - 1]
  }
  return out
}

export interface HeadingMatch {
  entry: ContentsEntry
  /** the lines of the body page that make up the heading, first to last */
  lines: PLine[]
}

/** Find each entry's heading in the body: the lines on (or right after) its printed page whose text, joined, is the entry. */
export function matchHeadings(
  c: Contents, pages: { index: number; lines: PLine[]; width: number; height: number }[], numbers: number[], isBody: (l: PLine) => boolean,
): HeadingMatch[] {
  const out: HeadingMatch[] = []
  const skip = new Set(c.pages)
  let searchFrom = Math.max(...c.pages) + 1
  for (const e of c.entries) {
    if (e.kind === 'label') continue
    const want = norm(e.text)
    if (!want) continue
    // candidate pages: the printed page (and its neighbours), or, for parts without a page, everything from the last match on
    let cand: number[] = []
    if (e.page !== undefined) {
      const at = numbers.findIndex((n, i) => n === e.page && !skip.has(i) && i >= searchFrom - 3)
      if (at >= 0) cand = [at, at + 1, at - 1]
    }
    if (!cand.length) cand = pages.map((_, i) => i).filter((i) => i >= searchFrom && !skip.has(i))
    let hit: HeadingMatch | undefined
    for (const pi of cand) {
      const ls = (pages[pi]?.lines ?? []).filter((l) => l.text.trim()).sort((a, b) => a.y - b.y || a.x0 - b.x0)
      for (let i = 0; i < ls.length && !hit; i++) {
        let acc = ''
        const got: PLine[] = []
        for (let j = i; j < ls.length && j < i + 6; j++) {
          acc += norm(ls[j].text)
          got.push(ls[j])
          if (acc.length > want.length) break
          if (!want.startsWith(acc)) break
          if (acc === want || (acc.length >= want.length * 0.9 && want.startsWith(acc))) {
            // a heading is not set in the body font
            if (got.some((l) => !isBody(l))) hit = { entry: e, lines: [...got] }
            break
          }
        }
      }
      if (hit) {
        searchFrom = pi
        break
      }
    }
    if (hit) out.push(hit)
  }
  return out
}
