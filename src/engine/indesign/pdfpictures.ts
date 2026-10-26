// Pictures taken from the print PDF, for an InDesign package that lacks them (IMG-009, IMG-011).
// The export names each picture (its src) and keeps the order; the PDF holds the pixels.
import { pageLayout } from '../pdf/layout.ts'
import { imageObject, type Raster } from '../pdf/raster.ts'
import { settings } from '../settings.ts'
import { imageSize } from '../epub/image.ts'
import type { PrintPage } from '../pdf/pages.ts'
import type { Export } from './read.ts'

export interface PdfPicture {
  /** printed page label it stands on ('' when unknown) */
  page: string
  data: Uint8Array
  /** fills the page (a full-page photo or map, or a background): only used for a picture the package lacks */
  full?: boolean
}

/**
 * InDesign writes a flat grey box with a cross when a link is missing at export time. Such a file is tiny for its size
 * (under 0.07 byte per pixel; real pictures in the client books start at 0.12), so it is told apart without decoding it.
 */
export function isInDesignPlaceholder(data: Uint8Array | undefined): boolean {
  if (!data?.length) return false
  try {
    const { width, height } = imageSize(data)
    return width >= 150 && height >= 150 && data.length / (width * height) < 0.07
  } catch {
    return false
  }
}

/** Every picture of the export in order, once (the cover placeholder is the cover's business). */
export function exportPictures(ex: Export): string[] {
  const out: string[] = []
  for (const b of ex.blocks) if (b.t === 'img' && b.src !== ex.coverImage && !out.includes(b.src)) out.push(b.src)
  return out
}

/** Pictures the export refers to but the package does not hold, or holds only as InDesign's grey placeholder. */
export function missingPictures(ex: Export): string[] {
  return exportPictures(ex).filter((src) => !ex.images.get(src)?.length || isInDesignPlaceholder(ex.images.get(src)))
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
      if (Math.max(w / h, h / w) > 20) continue
      const full = w * h > layout.width * layout.height * 0.9 && !spread
      const obj = await imageObject(page, im.id)
      const jpeg = obj ? await raster.image(obj, im.crop, settings().imageMaxPx).catch(() => null) : null
      if (jpeg) out.push({ page: labelOf(i, spread ? (im.x0 >= layout.width / 2 ? 1 : 0) : undefined), data: jpeg, ...(full ? { full } : {}) })
    }
    page.cleanup()
    onProgress?.(i, doc.numPages)
  }
  return out
}

const ratio = (d: Uint8Array | undefined) => {
  if (!d?.length) return 0
  try {
    const { width, height } = imageSize(d)
    return width && height ? width / height : 0
  } catch {
    return 0
  }
}
const longSide = (d: Uint8Array | undefined) => {
  try {
    const { width, height } = d ? imageSize(d) : { width: 0, height: 0 }
    return Math.max(width, height)
  } catch {
    return 0
  }
}

/**
 * Line up the pictures of the export with the pictures of the print PDF, both in reading order. A pair must have the
 * same shape (InDesign's grey placeholder keeps its frame's shape); a picture the package lacks pairs with any shape.
 * Order is kept, either side may skip (icons the PDF draws as text, PDF pictures the export leaves out).
 * Paired pictures the package lacks, or holds only as a placeholder, take the PDF picture; a real picture takes it when
 * the PDF one is larger (the client asks for pictures from the PDF). The rest of the missing ones stay listed.
 */
export function pairPictures(ex: Export, pics: PdfPicture[]): { paired: Map<string, Uint8Array>; unmatched: string[]; all: boolean } {
  const every = exportPictures(ex)
  const missing = new Set(missingPictures(ex))
  const er = every.map((s) => ratio(ex.images.get(s)))
  const pr = pics.map((p) => ratio(p.data))
  const score = (i: number, j: number) => {
    if (!pr[j]) return -1
    if (pics[j].full && !missing.has(every[i])) return -1
    if (missing.has(every[i]) && !er[i]) return 0.5
    if (!er[i]) return -1
    return Math.abs(Math.log(er[i] / pr[j])) < 0.06 ? 1 : -1
  }
  const n = every.length, m = pics.length
  const W = m + 1
  const best = new Float64Array((n + 1) * W)
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) {
      const sc = score(i, j)
      best[i * W + j] = Math.max(best[(i + 1) * W + j], best[i * W + j + 1], sc > 0 ? sc + best[(i + 1) * W + j + 1] : -Infinity)
    }
  const paired = new Map<string, Uint8Array>()
  let matched = 0
  for (let i = 0, j = 0; i < n && j < m; ) {
    const sc = score(i, j)
    if (sc > 0 && best[i * W + j] === sc + best[(i + 1) * W + j + 1]) {
      matched++
      const src = every[i]
      if (missing.has(src) || longSide(pics[j].data) > longSide(ex.images.get(src))) paired.set(src, pics[j].data)
      i++, j++
    } else if (best[i * W + j] === best[(i + 1) * W + j]) i++
    else j++
  }
  return { paired, unmatched: [...missing].filter((s) => !paired.has(s)), all: n > 0 && matched === n }
}
