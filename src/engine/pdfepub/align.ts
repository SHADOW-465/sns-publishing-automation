// How the printed page aligns its text, read from the lines' positions: justified text ends flush on the right, a centred
// title sits on the middle of the text area, a line that ends on the right edge and starts well inside it is right, anything
// else is left. Used when a setting says "as the printed page", and for each column of a table.
import type { PLine } from './analyze.ts'
import type { PdfTable } from '../pdf/tables.ts'

export type Align = 'left' | 'center' | 'right' | 'justify'

interface PageLines {
  lines: PLine[]
}

/** The text area of a page: the left and right edge of its lines (page furniture is already gone from `lines`). */
function area(lines: PLine[]) {
  const x0 = Math.min(...lines.map((l) => l.x0))
  const x1 = Math.max(...lines.map((l) => l.x1))
  return { x0, x1, mid: (x0 + x1) / 2, width: x1 - x0 }
}

/**
 * Body text: justified when most full lines end flush on the right edge of their column. A line that ends a paragraph is
 * short on purpose, so only lines at least 60% as long as the column count.
 */
export function bodyAlignment(pages: PageLines[], isBody: (l: PLine) => boolean): Align {
  let full = 0
  let flush = 0
  for (const p of pages) {
    const byCol = new Map<number, PLine[]>()
    for (const l of p.lines.filter(isBody)) byCol.set(l.col, [...(byCol.get(l.col) ?? []), l])
    for (const ls of byCol.values()) {
      if (ls.length < 6) continue
      const right = Math.max(...ls.map((l) => l.x1))
      const left = Math.min(...ls.map((l) => l.x0))
      const width = right - left
      for (const l of ls) {
        if (l.x1 - l.x0 < width * 0.6) continue
        full++
        if (right - l.x1 < 2) flush++
      }
    }
  }
  return full >= 20 && flush / full >= 0.5 ? 'justify' : 'left'
}

/**
 * Headings and other single lines: centred when most sit on the middle of the text area and do not share a left edge,
 * right when most end on the right edge instead.
 */
export function lineAlignment(pages: PageLines[], pick: (l: PLine) => boolean): Align {
  let n = 0
  let centred = 0
  let right = 0
  for (const p of pages) {
    const mine = p.lines.filter(pick)
    if (!mine.length || p.lines.length < 3) continue
    const a = area(p.lines)
    if (a.width < 50) continue
    for (const l of mine) {
      n++
      const mid = (l.x0 + l.x1) / 2
      if (l.x0 - a.x0 <= a.width * 0.05) continue
      if (Math.abs(mid - a.mid) < a.width * 0.03) centred++
      else if (a.x1 - l.x1 < a.width * 0.01) right++
    }
  }
  // one line is enough: the heading of a contents page is alone on its page
  if (n >= 1 && centred / n >= 0.6) return 'center'
  return n >= 1 && right / n >= 0.6 ? 'right' : 'left'
}

const NUMBER = /^[-+−–(]?\s*[$€£¥]?\s*\d[\d.,\s]*%?\)?$/

/**
 * Each column of a table, by majority of its cells (the header row and cells spanning columns do not vote): a column
 * that is mostly numbers is right-aligned; otherwise cells that share the column's right edge but not its left vote
 * right, cells on its middle vote centre, the rest left.
 */
export function columnAlignment(t: PdfTable<PLine>): Align[] {
  return Array.from({ length: t.cols.length - 1 }, (_, c) => {
    const cells = t.cells
      .filter((k) => k.c === c && k.colspan === 1 && !(t.head && k.r === 0) && k.lines.some((l) => l.text.trim()))
      .map((k) => ({ x0: Math.min(...k.lines.map((l) => l.x0)), x1: Math.max(...k.lines.map((l) => l.x1)), text: k.lines.map((l) => l.text).join(' ').trim() }))
    if (!cells.length) return 'left'
    if (cells.filter((k) => NUMBER.test(k.text)).length * 2 > cells.length) return 'right'
    const L = Math.min(...cells.map((k) => k.x0))
    const R = Math.max(...cells.map((k) => k.x1))
    const tol = 2
    const votes = { left: 0, center: 0, right: 0 }
    for (const k of cells) {
      if (k.x0 - L < tol) votes.left++
      else if (R - k.x1 < tol) votes.right++
      else if (Math.abs((k.x0 + k.x1) / 2 - (L + R) / 2) < tol) votes.center++
      else votes.left++
    }
    if (votes.right > votes.left && votes.right >= votes.center) return 'right'
    return votes.center > votes.left ? 'center' : 'left'
  })
}

const SANS = /sans|arial|helvetica|gothic|grotesk|myriad|frutiger|futura|calibri|verdana|univers|gill|avenir|segoe|tahoma|trebuchet|optima|din\b|roboto|open ?sans/i

/** The family the printed lines are set in, from their font names ("SabonLTStd 24" is serif, "Helvetica Bold 18" is sans-serif). */
export function fontFamilyOf(keys: string[]): 'serif' | 'sans-serif' {
  return keys.length && keys.every((k) => SANS.test(k)) ? 'sans-serif' : 'serif'
}
