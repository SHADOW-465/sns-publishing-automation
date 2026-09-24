// Print-PDF reader shared by the pipelines: printed page numbers and the text of each page.
// Handles single pages and 2-up spreads, drops InDesign slug lines ("file.indd  12", dates),
// running heads and folios. pdf.js is injected so the same code runs in the browser (worker
// build) and in Node (legacy build, tests/CLI).
import { fillNumbers } from './numbers.ts'

export interface PrintPage {
  n: string // printed page number
  text: string // body text, de-hyphenated
  blank: boolean // nothing printed on the page (besides the slug)
}

type PdfJs = {
  getDocument: (src: { data: Uint8Array; disableFontFace?: boolean; isEvalSupported?: boolean }) => { promise: Promise<PdfDoc> }
}
type PdfDoc = { numPages: number; getPage: (i: number) => Promise<PdfPage> }
type PdfPage = { view: number[]; getTextContent: () => Promise<{ items: unknown[] }> }
type Item = { str: string; transform: number[]; width: number; height: number }

const SLUG = /\.indd\b|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\s+\d{1,2}:\d{2}/i
const clean = (s: string) => s.replace(/[\u0000-\u0008\u000b-\u001f�]/g, '')
const shape = (s: string) => s.replace(/\d+/g, '').replace(/\s+/g, ' ').trim().toLowerCase()

/** Text lines of every printed page (spreads split in two), top to bottom. */
async function pageLines(pdfjs: PdfJs, data: Uint8Array): Promise<string[][]> {
  const doc = await pdfjs.getDocument({ data: data.slice(), disableFontFace: true, isEvalSupported: false }).promise
  const out: string[][] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const [x0, y0, x1, y1] = page.view
    const items = (await page.getTextContent()).items.filter((it): it is Item => typeof (it as Item).str === 'string')
    const spread = x1 - x0 > (y1 - y0) * 1.2
    const cols = spread ? [[x0, (x0 + x1) / 2], [(x0 + x1) / 2, x1]] : [[x0, x1]]
    for (const [cx0, cx1] of cols) {
      const mine = items.filter((it) => {
        const cx = it.transform[4] + it.width / 2
        return cx >= cx0 && cx < cx1 && clean(it.str).trim()
      })
      const lines: { y: number; items: Item[] }[] = []
      for (const it of mine.sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4])) {
        const y = it.transform[5]
        const line = lines.find((l) => Math.abs(l.y - y) < Math.max(2, it.height * 0.4))
        if (line) line.items.push(it)
        else lines.push({ y, items: [it] })
      }
      out.push(
        lines
          .map((l) => clean(l.items.sort((a, b) => a.transform[4] - b.transform[4]).map((i) => i.str).join(' ')).replace(/\s+/g, ' ').trim())
          .filter((t) => t && !SLUG.test(t)),
      )
    }
  }
  return out
}

export async function readPrintPages(pdfjs: PdfJs, data: Uint8Array): Promise<PrintPage[]> {
  const pages = await pageLines(pdfjs, data)
  // running heads repeat across pages (book title, chapter title) once the folio is removed
  const freq = new Map<string, number>()
  for (const ls of pages) for (const t of [ls[0], ls[1], ls[ls.length - 1]]) if (t) freq.set(shape(t), (freq.get(shape(t)) ?? 0) + 1)
  const running = (t: string) => (freq.get(shape(t)) ?? 0) >= 3 && t.length < 90
  const folioOf = (t: string) => t.match(/^(\d{1,4})\b|\b(\d{1,4})$/)

  const nums: (number | undefined)[] = []
  const texts: string[] = []
  for (const ls of pages) {
    let folio: number | undefined
    const edge = (i: number) => i < 2 || i >= ls.length - 1
    const body = ls.filter((t, i) => {
      if (!edge(i)) return true
      const isNumber = /^\d{1,4}$/.test(t)
      if (isNumber || running(t)) {
        const m = folioOf(t)
        if (m && folio === undefined) folio = Number(m[1] ?? m[2])
        return false
      }
      return true
    })
    let text = ''
    for (const t of body) text = /\p{L}-$/u.test(text) && /^\p{Ll}/u.test(t) ? text.slice(0, -1) + t : text ? text + ' ' + t : t
    nums.push(folio)
    texts.push(text)
  }
  const numbers = fillNumbers(nums)
  return texts.map((text, i) => ({ n: String(numbers[i]), text, blank: pages[i].length === 0 }))
}
