import type { PLine } from './analyze.ts'
import { sectionTypeOf } from '../epub/locale.ts'

// =============================================================================================
// The printed contents page is the book's own table of parts and chapters. Reading it tells the
// tool where every chapter starts, what its heading looks like (which fonts are chapter labels and
// titles) and how the e-book's contents page must be laid out — for any book, whatever the fonts.
// =============================================================================================

export interface ContentsEntry {
  /** "Capítulo 5. Cómo expresar tu Yo Auténtico a todas horas" (leaders and page number removed) */
  text: string
  /** printed page the entry points to; parts usually have none */
  page?: number
  kind: 'entry' | 'part'
  /** the lines of the contents page that make up the entry */
  lines: PLine[]
  /** the contents page (PDF page index) the entry sits on */
  on: number
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

interface Row {
  lines: PLine[]
  base: number
  x0: number
  x1: number
  text: string
  page: number
  ref?: number | string
  centred: boolean
}

/** Rows of a page: lines on one baseline (title, leaders and page number are separate lines in the PDF). */
function rowsOf(lines: PLine[], width: number, pageIdx: number): Row[] {
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
    if (m && text.length > m[0].length - 1) {
      const raw = m[1]
      // a page reference is the last thing on the row, at the right; roman numerals only as roman pages (not "mix", "civil"…)
      const right = r.x1 > width * 0.6
      if (/^\d+$/.test(raw) ? right : ROMAN.test(raw) && right && /[.·…\s]/.test(text.charAt(text.length - raw.length - 1))) {
        r.ref = /^\d+$/.test(raw) ? Number(raw) : raw
        text = text.slice(0, text.length - m[0].length).replace(/[\s.·…]+$/, '').trim()
      }
    }
    r.text = text
    r.centred = Math.abs((r.x0 + r.x1) / 2 - width / 2) < width * 0.08 && r.x0 > width * 0.12 && r.ref === undefined
  }
  return rows.sort((a, b) => a.base - b.base)
}

const isTocHeading = (l: PLine, bodySize: number) => l.size >= bodySize * 1.2 && sectionTypeOf(l.text.trim().replace(/\s+/g, ' ')) === 'toc'

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
  const entries: ContentsEntry[] = []
  for (const pi of tocPages) {
    const rows = rowsOf(pages[pi].lines, pages[pi].width, pi).filter((r) => !pages[pi].lines.some((l) => isTocHeading(l, bodySize) && r.lines.includes(l)))
    let buf: Row[] = []
    const flushPart = () => {
      if (buf.length) entries.push({ text: buf.map((r) => r.text).join(' ').replace(/\s+/g, ' ').trim(), kind: 'part', lines: buf.flatMap((r) => r.lines), on: pi })
      buf = []
    }
    for (const r of rows) {
      if (r.ref === undefined) {
        // centred, number-less rows are a part heading; anything else wraps the entry that follows
        if (buf.length && buf[0].centred !== r.centred) flushPart()
        buf.push(r)
        continue
      }
      if (buf.length && buf.every((x) => x.centred)) flushPart()
      const text = [...buf, r].map((x) => x.text).join(' ').replace(/\s+/g, ' ').trim()
      entries.push({ text, page: typeof r.ref === 'number' ? r.ref : undefined, kind: 'entry', lines: [...buf, r].flatMap((x) => x.lines), on: pi })
      buf = []
    }
    if (buf.every((x) => x.centred)) flushPart()
    else buf = []
  }
  return entries.length >= 3 ? { pages: tocPages, entries } : undefined
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
    const want = norm(e.text)
    if (!want) continue
    // candidate pages: the printed page (and the next: openers on a spread), or, for parts without a page, everything up to the next entry's page
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
          if (!want.startsWith(acc) && !want.includes(acc)) break
          if (acc === want || (acc.length >= want.length * 0.9 && want.startsWith(acc))) {
            // a heading is not body text: skip matches that are ordinary paragraph lines
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
