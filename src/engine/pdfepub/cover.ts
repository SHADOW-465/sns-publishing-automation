import type { Raster } from '../pdf/raster.ts'
import type { ReviewItem } from '../epub/package.ts'

// Front cover from the print cover spread PDF (back | spine | front), as supplied with the
// Word→EPUB sample. The front panel is the right-hand part of the trim box, one book-page wide.

const TRIM = /\/TrimBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/

export async function coverFromSpread(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pdfjs: any, data: Uint8Array, book: { width: number; height: number }, raster: Raster, review: ReviewItem[], height = 1600,
): Promise<Uint8Array> {
  const task = pdfjs.getDocument({ data: data.slice(), disableFontFace: true, isEvalSupported: false })
  const doc = await task.promise
  const page = await doc.getPage(1)
  const [mx0, my0, mx1, my1] = page.view as number[]
  const W = mx1 - mx0
  const H = my1 - my0
  // the trim box is plain text in InDesign PDFs; fall back to the whole page
  const m = new TextDecoder('latin1').decode(data.subarray(0, Math.min(data.length, 4_000_000))).match(TRIM)
  const [tx0, ty0, tx1, ty1] = m ? m.slice(1).map(Number) : [mx0, my0, mx1, my1]
  const margin = (H - (ty1 - ty0)) / 2
  let frontW: number
  if (Math.abs(book.height - H) < 2) frontW = book.width - 2 * margin // same export settings as the book pages
  else {
    frontW = (ty1 - ty0) * 0.8
    review.push({ level: 'warn', msg: 'Cover spread and book pages have different sizes: the front cover width was estimated — check the cover.' })
  }
  if (W < frontW * 1.5) frontW = tx1 - tx0 // already a single front cover
  const jpg = await raster.page(page, height, { x0: tx1 - frontW, x1: tx1, y0: H - ty1, y1: H - ty0 })
  page.cleanup()
  await task.destroy()
  return jpg
}
