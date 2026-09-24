import { pageLayout, isBoldFont, type Line, type PageLayout } from '../pdf/layout.ts'
import { fillNumbers } from '../pdf/numbers.ts'
import { sectionTypeOf } from '../epub/locale.ts'
import { ISBN_LINE } from '../epub/imprint.ts'
import type { BookMeta } from '../epub/package.ts'
import type { Raster } from '../pdf/raster.ts'

export const MAX_IMAGE_SIDE = 1900 // long side of pictures in the reference EPUB
// =============================================================================================
// Print PDF → EPUB, step 1: read every page and work out what each font style is for.
// Deduced from Automation/WORD-to-EPUB-Automation (print PDF vs the hand-made EPUB).
// =============================================================================================

export const PDF_ROLES = ['body', 'text', 'chapter-number', 'title', 'subhead', 'subhead2', 'caption', 'dropcap', 'drop'] as const
export type PdfRole = (typeof PDF_ROLES)[number]

export const PDF_ROLE_HELP: Record<PdfRole, string> = {
  body: 'Main text (paragraphs, indents and extracts detected from the layout)',
  text: 'Other paragraph text (boxes, lists, notes)',
  'chapter-number': 'Chapter number (starts a chapter)',
  title: 'Chapter / section title',
  subhead: 'Subheading (h2)',
  subhead2: 'Minor heading (h3)',
  caption: 'Picture caption',
  dropcap: 'Drop cap letter',
  drop: 'Remove (print-only furniture)',
}

export interface PLine extends Line {
  key: string
  page: number // pdf page index
  col: number // column start x
  imprint?: boolean
  dropcap?: string
  /** page marker to emit with this line (TOC / index pages, rebuilt from raw lines) */
  mark?: string
}

export interface PdfStyleInfo {
  key: string
  count: number
  samples: string[]
  role: PdfRole
  unsure: boolean
  reason: string
}

export type PdfProfile = Record<string, PdfRole>

export interface PdfBook {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pdfjs: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  doc: any
  pages: (Omit<PageLayout, 'lines'> & { lines: PLine[] })[]
  numbers: number[] // printed page number per PDF page
  styles: PdfStyleInfo[]
  meta: BookMeta
  /** PDF page indexes before the first content section (half-title, title, full-page pictures) */
  front: number[]
  brand: string
  bodyKey: string
  bodySize: number
  lead: number // body line spacing
  step: number // paragraph indent
  imprintPage?: number
}

// InDesign slug: file name + print date/time, often doubled ("02-06-202602-06-2026  19:06") so no \b
const SLUG = /\.indd\b|\d{1,2}[/-]\d{1,2}[/-]\d{4}|\b\d{1,2}:\d{2}:\d{2}/i
const shape = (s: string) => s.replace(/\d+/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
const family = (font: string) => font.replace(/-.*$/, '').replace(/(MT|Std|Pro|LT)$/g, (m) => m)
export const styleKey = (l: Line) => `${family(l.font)}${isBoldFont(l.font) ? ' Bold' : ''} ${Math.round(l.size * 2) / 2}`

export function titleCase(s: string): string {
  if (s !== s.toUpperCase()) return s
  const small = /^(a|an|and|as|at|but|by|for|in|of|on|or|the|to|with|de|la|el|y|del)$/i
  return s.toLowerCase().replace(/\p{L}[\p{L}'’]*/gu, (w, i: number) => (i > 0 && small.test(w) ? w : w[0].toUpperCase() + w.slice(1)))
}

/** pdf.js decodes pictures asynchronously: wait for the object instead of polling it */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function imageObject(page: any, id: string): Promise<unknown> {
  const store = id.startsWith('g_') ? page.commonObjs : page.objs
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 20000)
    try {
      store.get(id, (o: unknown) => (clearTimeout(timer), resolve(o)))
    } catch {
      clearTimeout(timer)
      resolve(null)
    }
  })
}

/** column starts of a set of lines: clusters of left edges at least 60pt apart */
export function columnStarts(lines: Line[]): number[] {
  const xs = [...new Set(lines.map((l) => Math.round(l.x0)))].sort((a, b) => a - b)
  const starts: number[] = []
  for (const x of xs) if (!starts.length || x - starts[starts.length - 1] > 60) starts.push(x)
  return starts
}
export const columnOf = (starts: number[], x0: number) => [...starts].reverse().find((s) => s <= x0 + 3) ?? starts[0] ?? 0

export async function analyzePdf(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pdfjs: any, data: Uint8Array, raster: Raster, saved: PdfProfile = {}, onProgress?: (done: number, total: number) => void,
): Promise<PdfBook> {
  const doc = await pdfjs.getDocument({ data: data.slice(), disableFontFace: true, isEvalSupported: false }).promise
  const raw: PageLayout[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const layout = await pageLayout(pdfjs, page, i - 1)
    // pictures are decoded while the page is read: encode them now instead of decoding twice
    for (const im of layout.images) {
      const obj = await imageObject(page, im.id)
      im.jpeg = obj ? await raster.image(obj, im.crop, MAX_IMAGE_SIDE).catch(() => null) : null
    }
    raw.push(layout)
    page.cleanup()
    onProgress?.(i, doc.numPages)
  }

  // body text size first: folios are body-sized, chapter numbers (also plain numbers) are huge
  const sizeChars = new Map<number, number>()
  for (const p of raw) for (const l of p.lines) sizeChars.set(Math.round(l.size * 2) / 2, (sizeChars.get(Math.round(l.size * 2) / 2) ?? 0) + l.text.length)
  const textSize = [...sizeChars].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 10

  // ---- slug, running heads, folios → printed page numbers ----
  const band = (p: PageLayout, l: Line) => l.y < p.height * 0.13 || l.y > p.height * 0.87
  const freq = new Map<string, number>()
  for (const p of raw) for (const l of p.lines) if (band(p, l)) freq.set(shape(l.text), (freq.get(shape(l.text)) ?? 0) + 1)
  const folios: (number | undefined)[] = []
  const pages = raw.map((p) => {
    let folio: number | undefined
    let pureFolio = false
    const lines = p.lines.filter((l) => {
      if (SLUG.test(l.text)) return false
      if (!band(p, l) || l.size > textSize * 1.3) return true
      const pure = /^(\d{1,4}|[ivxlc]{1,7})$/i.test(l.text.trim()) // arabic or roman folio
      if (pure || ((freq.get(shape(l.text)) ?? 0) >= 3 && l.text.length < 90)) {
        const m = l.text.trim().match(/^(\d{1,4})\b|\b(\d{1,4})$/)
        if (m && (pure ? !pureFolio : folio === undefined)) (folio = Number(m[1] ?? m[2])), (pureFolio = pure)
        // "Chapter 3" repeats in shape but not in number: numbered lines only go if the number is
        // the folio (checked below, once the page numbers are known)
        return !pure && /\d/.test(l.text)
      }
      return true
    })
    folios.push(folio)
    return { ...p, lines: lines.map((l) => ({ ...l, key: styleKey(l), page: p.index, col: 0 })) as PLine[] }
  })
  // printed page = PDF page + the offset most folios agree on (robust against stray numbers)
  const offsets = new Map<number, number>()
  folios.forEach((f, i) => f !== undefined && offsets.set(f - i, (offsets.get(f - i) ?? 0) + 1))
  const offset = [...offsets].sort((a, b) => b[1] - a[1])[0]?.[0]
  const numbers = offset === undefined ? fillNumbers(folios) : folios.map((_, i) => i + offset)
  // running heads that occur on too few pages to repeat ("Index 191"): small edge line holding the folio
  pages.forEach((p, i) => {
    const n = String(numbers[i])
    p.lines = p.lines.filter((l) => !(band(p, l) && l.size <= textSize * 1.3 && l.text.length < 60 && new RegExp(`^${n}\\b|\\b${n}$`).test(l.text.trim())))
  })

  // ---- style roles ----
  const stats = new Map<string, { lines: PLine[]; chars: number; size: number; bold: boolean }>()
  for (const p of pages)
    for (const l of p.lines) {
      const s = stats.get(l.key) ?? { lines: [], chars: 0, size: l.size, bold: /Bold/.test(l.key) }
      s.lines.push(l)
      s.chars += l.text.length
      stats.set(l.key, s)
    }
  const bodyKey = [...stats].sort((a, b) => b[1].chars - a[1].chars)[0]?.[0] ?? ''
  const bodySize = stats.get(bodyKey)?.size ?? 10
  const imageLines = new Set<PLine>()
  for (const p of pages)
    for (const l of p.lines) if (p.images.some((im) => l.y >= im.y1 - 4 && l.y - im.y1 < 30 && l.x0 < im.x1 && l.x1 > im.x0)) imageLines.add(l)
  const infos: PdfStyleInfo[] = []
  for (const [key, s] of stats) {
    const share = (f: (l: PLine) => boolean) => s.lines.filter(f).length / s.lines.length
    const avg = s.chars / s.lines.length
    const r = s.size / bodySize
    let role: PdfRole
    let reason: string
    let unsure = false
    if (key === bodyKey) (role = 'body'), (reason = 'most text is set in this style')
    else if (r >= 3 && share((l) => /^\d{1,3}$/.test(l.text.trim())) >= 0.8) (role = 'chapter-number'), (reason = 'very large number')
    else if (r >= 2.5 && avg <= 2) (role = 'dropcap'), (reason = 'very large single letter')
    else if (r >= 1.6 && avg < 70) (role = 'title'), (reason = 'large short lines')
    else if (s.bold && r >= 1.05 && avg < 80) (role = 'subhead'), (reason = 'bold, larger than body text')
    else if (r <= 0.88 && (share((l) => l.marker) >= 0.15 || share((l) => imageLines.has(l)) >= 0.3)) (role = 'caption'), (reason = 'small text next to pictures')
    else if (s.bold && avg < 60) (role = 'subhead2'), (reason = 'bold short lines'), (unsure = s.lines.length < 4)
    else (role = 'text'), (reason = 'paragraph text in another style'), (unsure = s.lines.length < 4)
    if (saved[key]) (role = saved[key]), (reason = 'from saved publisher profile'), (unsure = false)
    infos.push({ key, count: s.lines.length, samples: s.lines.slice(0, 3).map((l) => l.text.slice(0, 120)), role, unsure, reason })
  }
  infos.sort((a, b) => b.count - a.count)
  const roleOf = new Map(infos.map((i) => [i.key, i.role]))

  // ---- body metrics: line spacing and paragraph indent ----
  const diffs: number[] = []
  const offs = new Map<number, number>()
  for (const p of pages) {
    const body = p.lines.filter((l) => l.key === bodyKey)
    const starts = columnStarts(body)
    for (const l of p.lines) l.col = columnOf(starts, l.x0)
    const byCol = new Map<number, PLine[]>()
    for (const l of body) byCol.set(l.col, [...(byCol.get(l.col) ?? []), l])
    for (const ls of byCol.values()) {
      ls.sort((a, b) => a.y - b.y)
      for (let i = 1; i < ls.length; i++) diffs.push(Math.round((ls[i].base - ls[i - 1].base) * 2) / 2)
      for (const l of ls) {
        const o = Math.round(l.x0 - l.col)
        if (o > 2 && o < 40) offs.set(o, (offs.get(o) ?? 0) + 1)
      }
    }
  }
  const mode = (xs: number[]) => {
    const m = new Map<number, number>()
    for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1)
    return [...m].sort((a, b) => b[1] - a[1])[0]?.[0]
  }
  const lead = mode(diffs.filter((d) => d > bodySize * 0.9 && d < bodySize * 2)) ?? bodySize * 1.3
  const step = [...offs].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 12

  // ---- front matter: pages before the first real section ----
  const isSectionStart = (l: PLine) =>
    roleOf.get(l.key) === 'chapter-number' ||
    ((roleOf.get(l.key) === 'title' || roleOf.get(l.key) === 'subhead') && !!sectionTypeOf(titleCase(l.text)))
  const firstContent = pages.findIndex((p) => p.lines.some(isSectionStart))
  const front = pages.slice(0, Math.max(0, firstContent)).map((p) => p.index)

  // ---- imprint: the column holding ISBN + copyright wording ----
  let imprintPage: number | undefined
  for (const p of pages) {
    const starts = columnStarts(p.lines)
    for (const s of starts) {
      const col = p.lines.filter((l) => columnOf(starts, l.x0) === s)
      const txt = col.map((l) => l.text).join('\n')
      if (ISBN_LINE.test(txt) && /©|all rights reserved|first published|british library|copyright/i.test(txt)) {
        col.forEach((l) => (l.imprint = true))
        imprintPage = p.index
      }
    }
  }

  // ---- metadata guesses ----
  const frontText = front.map((i) => pages[i]).filter((p) => p.lines.length)
  const half = frontText[0]
  const titlePage = frontText.find((p) => p.lines.length > (half?.lines.length ?? 0)) ?? frontText[1] ?? half
  const big = (p?: { lines: PLine[] }) => {
    if (!p) return { title: '', rest: [] as PLine[] }
    const max = Math.max(...p.lines.map((l) => l.size))
    const t = p.lines.filter((l) => l.size >= max * 0.5)
    return { title: titleCase(t.map((l) => l.text.trim()).join(' ')), rest: p.lines.filter((l) => !t.includes(l)) }
  }
  const h = big(half)
  const subtitle = titleCase(h.rest.map((l) => l.text.trim()).join(' '))
  const author = titlePage && half ? (titlePage.lines.filter((l) => !half.lines.some((x) => shape(x.text) === shape(l.text))).map((l) => l.text.trim())[0] ?? '') : ''
  const imprint = imprintPage !== undefined ? pages[imprintPage].lines.filter((l) => l.imprint).map((l) => l.text) : []
  const publisher = imprint.find((t) => /\b(press|publishing|publishers|books|verlag|editorial|ediciones|éditions)\b/i.test(t) && t.length < 60)?.trim() ?? ''
  const year = imprint.join(' ').match(/\b(19|20)\d{2}\b/)?.[0] ?? String(new Date().getFullYear())
  const printIsbn = imprint.join('\n').match(/i\.?\s?s\.?\s?b\.?\s?n[^\d]*([\d][\d -]{9,16}[\dxX])/i)?.[1] ?? ''
  const info = await doc.getMetadata().catch(() => null)
  const language = (info?.info?.Language as string | undefined)?.replace('_', '-') || 'en'
  const meta: BookMeta = {
    title: h.title || titleCase(info?.info?.Title ?? ''),
    subtitle,
    authors: titleCase(author),
    publisher,
    language,
    eisbn: '',
    printIsbn,
    rights: author ? `Copyright © ${titleCase(author)} ${year}` : '',
    certifiedBy: publisher,
    conformsTo: 'EPUB Accessibility 1.1 - WCAG 2.0 Level AA',
  }

  // brand colour: the most used strong fill colour (headings in the reference use it too)
  const colours = new Map<string, number>()
  for (const p of pages)
    for (const f of p.fills) {
      const area = (f.x1 - f.x0) * (f.y1 - f.y0)
      if (area > p.width * p.height * 0.6) continue
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(f.color.slice(i, i + 2), 16))
      if (Math.max(r, g, b) - Math.min(r, g, b) < 20 || Math.min(r, g, b) > 200) continue // greys and near-whites
      colours.set(f.color, (colours.get(f.color) ?? 0) + area)
    }
  const brand = [...colours].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '#333333'

  return { pdfjs, doc, pages, numbers, styles: infos, meta, front, brand, bodyKey, bodySize, lead, step, imprintPage }
}
