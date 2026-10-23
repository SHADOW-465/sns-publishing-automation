// Page numbers in an index entry ("48–9, 193, 305n.129"). The number is the link; "n.66" stays with it
// as the note on that page. A number inside the entry name ("World War 2") is not a locator: locators
// follow a comma.

export interface IndexLocator {
  /** the printed page the number points at (the first number of a range) */
  pageNo: number
  /** character offsets in the line, covering the page number only */
  start: number
  end: number
}

const LOCATOR = /^[\s\d.n–—-]+$/

export function indexNumberSpans(text: string): IndexLocator[] {
  const parts = text.split(',')
  if (parts.length < 2) return []
  let first = 0
  for (let i = parts.length - 1; i >= 1; i--) {
    if (LOCATOR.test(parts[i]) && /\d/.test(parts[i])) first = i
    else break
  }
  if (!first) return []
  let base = 0
  for (let i = 0; i < first; i++) base += parts[i].length + 1
  const out: IndexLocator[] = []
  for (const m of text.slice(base).matchAll(/(\d{1,4})(?:\s*[–—-]\s*\d{1,4})?(?:n\.\d+)?/g)) {
    const num = m[1]
    const start = base + (m.index ?? 0) + m[0].indexOf(num)
    out.push({ pageNo: Number(num), start, end: start + num.length })
  }
  return out
}
