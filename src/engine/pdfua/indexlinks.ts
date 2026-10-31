// Page numbers in an index entry ("48–9, 193, 305n.129"). The number is the link to its page; "n.129" is a second
// link, to note 129 of that page (U3). A number inside the entry name ("World War 2") is not a locator: locators
// follow a comma.

export interface IndexLocator {
  /** the printed page the number points at (an abbreviated range end is expanded: 48–9 → 49) */
  pageNo: number
  /** set on the locator of an "n.66" part: the number of the note on that page; start/end then cover the "n.66" text */
  note?: number
  /** character offsets in the line, covering the printed digits only (the abbreviated end stays "9") */
  start: number
  end: number
}

/**
 * The page an abbreviated range end names. The short end keeps the start's leading digits, and rolls the prefix
 * up when that would still land before the start: 266-69 → 269, 48-9 → 49, 105-8 → 108, 199-02 → 202.
 */
export function expandPageEnd(start: number, endDigits: string): number {
  const digits = endDigits.replace(/\D/g, '')
  const written = Number(digits)
  if (!digits || !Number.isFinite(written)) return written
  const s = String(Math.abs(start))
  if (digits.length < s.length) {
    const scale = 10 ** digits.length
    const prefix = Number(s.slice(0, s.length - digits.length))
    const lifted = prefix * scale + written
    return lifted >= start ? lifted : (prefix + 1) * scale + written
  }
  // "99-02" is the same width only because of the leading zero. "192-161" is two full page numbers.
  if (digits.length === s.length && digits.startsWith('0') && written < start) return written + 10 ** digits.length
  return written
}

/** A printed line that only carries more page numbers of the entry above it; any other line (even one that starts with a digit, like "101st Field Battery") is a new entry. */
export const continuesIndexLine = (t: string): boolean => /^[\d\s,–—-]+$/.test(t) && /\d/.test(t)

/** Page numbers in index HTML become links. A range keeps its printed text (174–8); both numbers are links, the end to the expanded page (#pg:178). */
export function linkIndexLocators(html: string): string {
  // a number may open or close an emphasis span: the primary reference of an entry is often set in italic or bold
  const ranged = html.replace(/(^|[\s,]|<(?:em|i|strong|b)>)(\d{1,4})(\s*[–—-]\s*)(\d{1,4})(?=$|[\s,–—-]|<\/(?:em|i|strong|b)>)/g, (_m, pre: string, a: string, mid: string, b: string) => {
    const end = expandPageEnd(Number(a), b)
    return `${pre}<a href="#pg:${a}">${a}</a>${mid}<a href="#pg:${end}">${b}</a>`
  })
  // after a range only a comma or space starts a locator: the end of a range is already in place
  return ranged.replace(/(^|[\s,]|<(?:em|i|strong|b)>)(\d{1,4})(?=$|[\s,–—-]|<\/(?:em|i|strong|b)>)/g, (m, pre: string, n: string, offset: number, whole: string) => {
    const before = whole.slice(0, offset)
    if (before.lastIndexOf('<') > before.lastIndexOf('>')) return m
    return `${pre}<a href="#pg:${n}">${n}</a>`
  })
}

/** The anchor is the end of a range (`</a>–<a`), not a locator standing on its own. */
export const rangeEndAnchor = (body: string, offset: number) => /<\/a>\s*[–—-]\s*$/.test(body.slice(Math.max(0, offset - 80), offset))

/**
 * Index links (`#pg:N`) become links to the file that holds page N's marker.
 * A number with no marker (a year, a regiment, a locator whose page was not marked) stays the printed digits.
 * The end of a range is the exception: it links to the nearest marked page at or after the expanded page,
 * or the nearest marked page before it. The printed digits are not changed. `review` is kept for callers.
 */
export function resolvePageLinks(body: string, pageFile: Map<string, string>, review: { level: 'error'; msg: string }[]): string {
  void review
  const pages = [...pageFile.keys()].map(Number).filter((n) => Number.isFinite(n)).sort((a, b) => a - b)
  const nearest = (want: number): number | undefined => {
    const after = pages.find((p) => p >= want)
    if (after !== undefined) return after
    for (let i = pages.length - 1; i >= 0; i--) if (pages[i] < want) return pages[i]
    return undefined
  }
  return body.replace(/<a href="#pg:(\d+)">(\d+)<\/a>/g, (_m, n: string, printed: string, offset: number) => {
    const want = Number(n)
    const exact = pageFile.get(String(want))
    if (exact) return `<a href="${exact}#page-${want}">${printed}</a>`
    if (!rangeEndAnchor(body, offset)) return printed
    const k = nearest(want)
    if (k === undefined) return printed
    return `<a href="${pageFile.get(String(k))}#page-${k}">${printed}</a>`
  })
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
  for (const m of text.slice(base).matchAll(/(\d{1,4})(?:\s*[–—-]\s*(\d{1,4}))?(?:\s*(n\.?\s*(\d+)))?/g)) {
    const num = m[1]
    const at = base + (m.index ?? 0)
    const start = at + m[0].indexOf(num)
    out.push({ pageNo: Number(num), start, end: start + num.length })
    const endDigits = m[2]
    if (endDigits) {
      const endAt = at + m[0].indexOf(endDigits, m[0].indexOf(num) + num.length)
      out.push({ pageNo: expandPageEnd(Number(num), endDigits), start: endAt, end: endAt + endDigits.length })
    }
    if (m[3]) {
      const noteAt = at + m[0].lastIndexOf(m[3])
      out.push({ pageNo: endDigits ? expandPageEnd(Number(num), endDigits) : Number(num), note: Number(m[4]), start: noteAt, end: noteAt + m[3].length })
    }
  }
  return out
}
