// Pictures taken from the print PDF, for an InDesign package that lacks them (IMG-009, IMG-011).
// The export names each picture (its src) and keeps the order; the PDF holds the pixels.
import { pageLayout } from '../pdf/layout.ts'
import { imageObject, type Raster } from '../pdf/raster.ts'
import { MAX_IMAGE_SIDE } from '../pdfepub/analyze.ts'
import type { PrintPage } from '../pdf/pages.ts'
import type { Export } from './read.ts'

export interface PdfPicture {
  /** printed page label it stands on ('' when unknown) */
  page: string
  data: Uint8Array
}

/** Pictures the export refers to but the package does not hold (the cover placeholder is the cover's business). */
export function missingPictures(ex: Export): string[] {
  const out: string[] = []
  for (const b of ex.blocks)
    if (b.t === 'img' && b.src !== ex.coverImage && !ex.images.get(b.src)?.length && !out.includes(b.src)) out.push(b.src)
  return out
}

/** Every picture of the print PDF in page order. Full-page backgrounds, hairlines and tiny marks are not pictures. */
export async function readPdfPictures(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pdfjs: any, data: Uint8Array, raster: Raster, printPages: PrintPage[] = [], onProgress?: (done: number, total: number) => void,
): Promise<PdfPicture[]> {
  const doc = await pdfjs.getDocument({ data: data.slice(), disableFontFace: true, isEvalSupported: false }).promise
  const labelOf = (pdfPage: number, half: 0 | 1 | undefined) => printPages.find((p) => p.pdfPage === pdfPage && (p.half ?? half) === half)?.n ?? ''
  const out: PdfPicture[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const layout = await pageLayout(pdfjs, page, i - 1)
    const spread = layout.width > layout.height * 1.2
    for (const im of [...layout.images].sort((a, b) => (a.x0 >= layout.width / 2 && spread ? 1 : 0) - (b.x0 >= layout.width / 2 && spread ? 1 : 0) || a.y0 - b.y0 || a.x0 - b.x0)) {
      const w = im.x1 - im.x0
      const h = im.y1 - im.y0
      if (Math.max(w / h, h / w) > 20 || (w * h > layout.width * layout.height * 0.9 && !spread)) continue
      const obj = await imageObject(page, im.id)
      const jpeg = obj ? await raster.image(obj, im.crop, MAX_IMAGE_SIDE).catch(() => null) : null
      if (jpeg) out.push({ page: labelOf(i, spread ? (im.x0 >= layout.width / 2 ? 1 : 0) : undefined), data: jpeg })
    }
    page.cleanup()
    onProgress?.(i, doc.numPages)
  }
  return out
}

/**
 * Give each missing picture the PDF picture that stands in its place. With as many PDF pictures as missing ones they
 * pair in order; otherwise a printed page that holds as many of each pairs on its own. The rest stay missing.
 */
export function pairPictures(ex: Export, pics: PdfPicture[]): { paired: Map<string, Uint8Array>; unmatched: string[] } {
  const missing = missingPictures(ex)
  const paired = new Map<string, Uint8Array>()
  if (missing.length === pics.length) missing.forEach((src, k) => paired.set(src, pics[k].data))
  else {
    const pageOf = new Map(ex.blocks.flatMap((b) => (b.t === 'img' ? [[b.src, b.page] as const] : [])))
    for (const page of new Set(missing.map((s) => pageOf.get(s) ?? ''))) {
      const mine = missing.filter((s) => (pageOf.get(s) ?? '') === page)
      const theirs = pics.filter((p) => p.page === page)
      if (page && mine.length === theirs.length) mine.forEach((s, k) => paired.set(s, theirs[k].data))
    }
  }
  return { paired, unmatched: missing.filter((s) => !paired.has(s)) }
}
