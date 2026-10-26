// Pictures taken from the print PDF, for an InDesign package that lacks them (IMG-009, IMG-011).
// The export names each picture (its src) and keeps the order; the PDF holds the pixels.
import { pageLayout } from '../pdf/layout.ts'
import { clusterDrawings } from '../pdf/drawings.ts'
import { imageObject, type Raster } from '../pdf/raster.ts'
import { settings } from '../settings.ts'
import { imageSize } from '../epub/image.ts'
import type { PrintPage } from '../pdf/pages.ts'
import type { Export } from './read.ts'

/** A box on a PDF page, in points, top-down. */
export interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface PdfPicture {
  /** printed page label it stands on ('' when unknown) */
  page: string
  data: Uint8Array
  /** fills the page (a full-page photo or map, or a background): only used for a picture the package lacks */
  full?: boolean
  /** where it is: the 1-based PDF page and its box, so the page can be drawn there when the picture file does not fit */
  pdfPage?: number
  rect?: Rect
  /** no picture file at all (a chart or map drawn as vectors): `data` is empty and only the box can be drawn */
  vector?: true
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

/** Pictures the export refers to but the package does not hold, or holds only as InDesign's grey placeholder. An original from the Links folder is never a placeholder. */
export function missingPictures(ex: Export): string[] {
  return exportPictures(ex).filter((src) => !ex.images.get(src)?.length || (!ex.links.used.has(src) && isInDesignPlaceholder(ex.images.get(src))))
}

/** Every picture of the print PDF in page order. Full-page backgrounds, hairlines and tiny marks are not pictures. */
export async function readPdfPictures(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pdfjs: any, data: Uint8Array, raster: Raster, printPages: PrintPage[] = [], onProgress?: (done: number, total: number) => void,
): Promise<PdfPicture[]> {
  const doc = await pdfjs.getDocument({ data: data.slice(), disableFontFace: true, isEvalSupported: false }).promise
  const labelOf = (pdfPage: number, half: 0 | 1 | undefined) => printPages.find((p) => p.pdfPage === pdfPage && (p.half ?? half) === half)?.n ?? ''
  const out: PdfPicture[] = []
  try {
    // one page at a time: its operator list, bitmaps and glyphs are released before the next (a 70 MB book never sits in memory whole)
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const decoded: unknown[] = []
      try {
        const layout = await pageLayout(pdfjs, page, i - 1)
        const spread = layout.width > layout.height * 1.2
        const halfOf = (x0: number) => (spread ? (x0 >= layout.width / 2 ? 1 : 0) : undefined)
        for (const im of [...layout.images].sort((a, b) => (halfOf(a.x0) ?? 0) - (halfOf(b.x0) ?? 0) || a.y0 - b.y0 || a.x0 - b.x0)) {
          const w = im.x1 - im.x0
          const h = im.y1 - im.y0
          if (Math.max(w / h, h / w) > 20) continue
          const full = w * h > layout.width * layout.height * 0.9 && !spread
          const obj = await imageObject(page, im.id)
          const jpeg = obj ? await raster.image(obj, im.crop, settings().imageMaxPx).catch(() => null) : null
          if (obj) decoded.push(obj)
          // an image the picture decoder cannot read is still a place on the page that can be drawn
          const rect = { x0: Math.max(0, im.x0), y0: Math.max(0, im.y0), x1: Math.min(layout.width, im.x1), y1: Math.min(layout.height, im.y1) }
          const base = { page: labelOf(i, halfOf(im.x0)), pdfPage: i, rect, ...(full ? { full } : {}) }
          out.push(jpeg ? { ...base, data: jpeg } : { ...base, data: new Uint8Array(0), vector: true })
        }
        // a chart or map drawn as vectors has no picture object: its box is kept so it can be drawn
        for (const box of clusterDrawings(layout)) out.push({ page: labelOf(i, halfOf(box.x0)), data: new Uint8Array(0), vector: true, pdfPage: i, rect: box })
      } finally {
        // a decoded bitmap holds memory until the page is cleaned up (a picture drawn twice on the page needs it until here)
        for (const o of decoded) (o as { bitmap?: { close?: () => void } }).bitmap?.close?.()
        page.cleanup()
      }
      onProgress?.(i, doc.numPages)
    }
  } finally {
    await doc.destroy?.()
  }
  return out
}

/** Draws boxes of the print PDF as pictures (300 dpi, long side capped), one page open at a time. Keys of the result are the jobs' `src`. */
export type Render = (jobs: RenderJob[], onProgress?: (done: number, total: number) => void) => Promise<Map<string, Uint8Array>>
export interface RenderJob {
  src: string
  /** printed page label, for the notes */
  page: string
  pdfPage: number
  rect: Rect
}

export function pdfRenderer(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pdfjs: any, data: Uint8Array, raster: Raster,
): Render {
  return async (jobs, onProgress) => {
    const out = new Map<string, Uint8Array>()
    if (!jobs.length) return out
    const doc = await pdfjs.getDocument({ data: data.slice(), disableFontFace: true, isEvalSupported: false }).promise
    try {
      const byPage = [...new Set(jobs.map((j) => j.pdfPage))].sort((a, b) => a - b)
      let done = 0
      for (const n of byPage) {
        const page = await doc.getPage(n)
        try {
          for (const j of jobs.filter((x) => x.pdfPage === n)) {
            const w = j.rect.x1 - j.rect.x0
            const h = j.rect.y1 - j.rect.y0
            const k = Math.min(settings().imageDpi / 72, settings().imageMaxPx / Math.max(w, h))
            const jpeg = await raster.page(page, Math.max(16, Math.round(h * k)), j.rect).catch(() => null)
            if (jpeg) out.set(j.src, jpeg)
            onProgress?.(++done, jobs.length)
          }
        } finally {
          page.cleanup()
        }
      }
    } finally {
      await doc.destroy?.()
    }
    return out
  }
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

/** The client's files are often named after the printed page they stand on: p_199_shutterstock_…, pag_124_…, p242-243_… */
export const namedPage = (src: string): string | undefined => src.split('/').pop()!.match(/^p(?:ag)?[_ ]?(\d{1,4})(?:-\d+)?(?=[_ a-z])/i)?.[1]
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const boxRatio = (r: Rect) => (r.x1 - r.x0) / (r.y1 - r.y0)

export interface Pairing {
  paired: Map<string, Uint8Array>
  /** pictures to draw from a box of the print PDF: found by their page or the text around them, but no picture file fits */
  render: RenderJob[]
  unmatched: string[]
  all: boolean
  /** indexes into `pics` of the PDF pictures taken */
  used: Set<number>
  /** pictures placed by their page, not by order: worth a look. The printed page of the picture taken. */
  late: Map<string, string>
}

/**
 * Line up the pictures of the export with the pictures of the print PDF, both in reading order. A pair must have the
 * same shape (InDesign's grey placeholder keeps its frame's shape); a picture the package lacks pairs with any shape.
 * Order is kept, either side may skip (icons the PDF draws as text, PDF pictures the export leaves out).
 * Paired pictures the package lacks, or holds only as a placeholder, take the PDF picture; a real picture takes it when
 * the PDF one is larger (the client asks for pictures from the PDF). `keep` pictures (taken from the Links folder) are
 * lined up but never replaced.
 * What order could not place is looked for by position: on the printed page the picture's frame is on, or the page where the
 * text around it is printed. A picture of the right shape there that no one else took is used; a box that is no picture
 * file, or a file of the wrong shape (a map cropped by its frame), is drawn from the page instead (`render`).
 */
export function pairPictures(ex: Export, pics: PdfPicture[], o: { printPages?: PrintPage[]; keep?: Set<string> } = {}): Pairing {
  const every = exportPictures(ex)
  const missing = new Set(missingPictures(ex))
  const er = every.map((s) => ratio(ex.images.get(s)))
  const pr = pics.map((p) => ratio(p.data))
  const order = new Map((o.printPages ?? []).map((p, k) => [p.n, k]))
  const hint = every.map(namedPage)
  const score = (i: number, j: number) => {
    if (!pr[j]) return -1
    if (pics[j].full && !missing.has(every[i])) return -1
    const sc = missing.has(every[i]) && !er[i] ? 0.5 : !er[i] ? -1 : Math.abs(Math.log(er[i] / pr[j])) < 0.06 ? 1 : -1
    if (sc < 0) return sc
    // a file named after its page is not paired with a picture printed far from that page, and is the likelier pair near it
    const h = hint[i]
    if (!h || !order.has(h) || !order.has(pics[j].page)) return sc
    return Math.abs(order.get(h)! - order.get(pics[j].page)!) <= 2 ? sc + 0.5 : -1
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
  const used = new Set<number>()
  let matched = 0
  for (let i = 0, j = 0; i < n && j < m; ) {
    const sc = score(i, j)
    if (sc > 0 && best[i * W + j] === sc + best[(i + 1) * W + j + 1]) {
      matched++
      used.add(j)
      const src = every[i]
      if (!o.keep?.has(src) && (missing.has(src) || longSide(pics[j].data) > longSide(ex.images.get(src)))) paired.set(src, pics[j].data)
      i++, j++
    } else if (best[i * W + j] === best[(i + 1) * W + j]) i++
    else j++
  }

  // by position, what order could not place
  const render: RenderJob[] = []
  const late = new Map<string, string>()
  const pp = o.printPages ?? []
  const left = [...missing].filter((s) => !paired.has(s))
  if (left.length && pp.length) {
    const texts = pp.map((p) => norm(p.text))
    for (const src of left) {
      const at = ex.blocks.findIndex((b) => b.t === 'img' && b.src === src)
      const r = ratio(ex.images.get(src))
      if (at < 0 || !r) continue
      const own = (ex.blocks[at] as { page: string }).page
      // the page where the text around the picture is printed (a phrase found on one to three pages), else the page the export put it on
      const found = new Set<string>()
      for (let k = Math.max(0, at - 4); k <= Math.min(ex.blocks.length - 1, at + 4); k++) {
        const b = ex.blocks[k]
        const t = b.t === 'p' ? norm(b.text).slice(0, 40) : ''
        if (t.length < 14) continue
        const hit = pp.filter((_, q) => texts[q].includes(t))
        if (hit.length >= 1 && hit.length <= 3) for (const h of hit) found.add(h.n)
      }
      // the client's files are often named after the page: p_199_shutterstock_…, pag_124_…
      const named = namedPage(src)
      // the page in its name outranks the page the export put it on (frames InDesign gathers at the end of a page all say that page)
      const anchors = [...new Set([...found, ...(named ? [named] : found.size || !own ? [] : [own])])]
      const near = (label: string) => Math.min(...anchors.map((a) => (order.has(a) && order.has(label) ? Math.abs(order.get(a)! - order.get(label)!) : a === label ? 0 : 99)))
      const cands = pics
        .map((p, j) => ({ p, j, d: near(p.page), off: Math.abs(Math.log(boxRatio(p.rect ?? { x0: 0, y0: 0, x1: 0, y1: 0 }) / r)) }))
        .filter((c) => !used.has(c.j) && c.p.rect && c.p.pdfPage && c.d <= 1 && c.off < (c.d === 0 ? 0.25 : 0.12))
        .sort((a, b) => a.d - b.d || a.off - b.off)
      const c = cands[0]
      if (!c) continue
      used.add(c.j)
      late.set(src, c.p.page)
      // the picture file as printed (its shape is the shape of its box): use the file. A file the page stretches or crops
      // (a map clipped by its frame) or a box with no file (vectors): draw the box.
      if (pr[c.j] && Math.abs(Math.log(boxRatio(c.p.rect!) / pr[c.j])) < 0.06) paired.set(src, c.p.data)
      else render.push({ src, page: c.p.page, pdfPage: c.p.pdfPage!, rect: c.p.rect! })
    }
  }
  const drawing = new Set(render.map((j) => j.src))
  return { paired, render, unmatched: left.filter((s) => !paired.has(s) && !drawing.has(s)), all: n > 0 && matched === n, used, late }
}
