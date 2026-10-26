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

/** Page numbers in index HTML become links. A range is two links; the second targets the expanded page. */
export function linkIndexLocators(html: string): string {
  const ranged = html.replace(/(^|[\s,])(\d{1,4})(\s*[–—-]\s*)(\d{1,4})(?=$|[\s,–—-])/g, (_m, pre: string, a: string, mid: string, b: string) =>
    `${pre}<a href="#pg:${a}">${a}</a>${mid}<a href="#pg:${expandPageEnd(Number(a), b)}">${b}</a>`)
  return ranged.replace(/(^|[\s,–—-])(\d{1,4})(?=$|[\s,–—-])/g, (m, pre: string, n: string, offset: number, whole: string) => {
    const before = whole.slice(0, offset)
    if (before.lastIndexOf('<') > before.lastIndexOf('>')) return m
    return `${pre}<a href="#pg:${n}">${n}</a>`
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
    if (m[3]) {
      const noteAt = at + m[0].lastIndexOf(m[3])
      out.push({ pageNo: endDigits ? expandPageEnd(Number(num), endDigits) : Number(num), note: Number(m[4]), start: noteAt, end: noteAt + m[3].length })
    }
    if (endDigits) {
      const endAt = at + m[0].indexOf(endDigits, m[0].indexOf(num) + num.length)
      out.push({ pageNo: expandPageEnd(Number(num), endDigits), start: endAt, end: endAt + endDigits.length })
    }
  }
  return out
}
