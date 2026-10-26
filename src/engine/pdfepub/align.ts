// How the printed page aligns its text, read from the lines' positions: justified text ends flush on the right, a centred
// title sits on the middle of the text area, anything else is left. Used when a setting says "as the printed page".
import type { PLine } from './analyze.ts'

export type Align = 'left' | 'center' | 'justify'

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

/** Headings and other single lines: centred when most sit on the middle of the text area and do not share a left edge. */
export function lineAlignment(pages: PageLines[], pick: (l: PLine) => boolean): Align {
  let n = 0
  let centred = 0
  for (const p of pages) {
    const mine = p.lines.filter(pick)
    if (!mine.length || p.lines.length < 3) continue
    const a = area(p.lines)
    if (a.width < 50) continue
    for (const l of mine) {
      n++
      const mid = (l.x0 + l.x1) / 2
      if (Math.abs(mid - a.mid) < a.width * 0.03 && l.x0 - a.x0 > a.width * 0.05) centred++
    }
  }
  // one line is enough: the heading of a contents page is alone on its page
  return n >= 1 && centred / n >= 0.6 ? 'center' : 'left'
}

const SANS = /sans|arial|helvetica|gothic|grotesk|myriad|frutiger|futura|calibri|verdana|univers|gill|avenir|segoe|tahoma|trebuchet|optima|din|roboto|open ?sans/i

/** The family the printed lines are set in, from their font names ("SabonLTStd 24" is serif, "Helvetica Bold 18" is sans-serif). */
export function fontFamilyOf(keys: string[]): 'serif' | 'sans-serif' {
  return keys.length && keys.every((k) => SANS.test(k)) ? 'sans-serif' : 'serif'
}
