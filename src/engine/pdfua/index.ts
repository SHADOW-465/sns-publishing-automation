import { PDFDocument, PDFName, PDFArray, PDFDict, PDFNumber, PDFString, PDFHexString, type PDFObject } from 'pdf-lib'
import { analyzePdf, titleCase, type PdfBook } from '../pdfepub/analyze.ts'
import type { Raster } from '../pdf/raster.ts'
import type { ReviewItem } from '../epub/package.ts'
import { inferUaStyles, buildStructure, type UaStyle, type Figure, type UaRole } from './structure.ts'
import { detectFigures } from './figures.ts'
import { readAltDocx, matchAlt, type AltEntry } from './altdocx.ts'
import { planPages, writeUa, type UaMeta } from './write.ts'
import { trimOf } from './pages.ts'
import { checkUa } from './check.ts'
import { labelsFor } from '../epub/locale.ts'

// =============================================================================================
// Accessible PDF (PDF/UA) workflow: inputs → merged PDF → analysis → human review → tagged PDF.
// =============================================================================================

export interface UaInputs {
  main: Uint8Array
  /** PDFs appended at the end (plates, inserts) */
  extras: Uint8Array[]
  /** front cover image placed as page 1 */
  cover?: { data: Uint8Array; png: boolean }
  /** Word file with the alternative texts */
  altDocx?: Uint8Array
}

export interface UaFigure {
  key: string
  page: number
  caption: string
  alt: string
  thumb?: Uint8Array | null
  vector: boolean
  box: Figure['box']
}

export interface UaAnalysis {
  merged: Uint8Array
  book: PdfBook
  styles: UaStyle[]
  meta: UaMeta & { isbn: string }
  figures: UaFigure[]
  detected: Map<number, Figure[]>
  altUnused: AltEntry[]
  review: ReviewItem[]
}

/** Cover image first, then the book, then extra PDFs; page labels shifted to match. */
export async function mergeInputs(inp: UaInputs): Promise<Uint8Array> {
  if (!inp.cover && !inp.extras.length) return inp.main
  const doc = await PDFDocument.load(inp.main, { updateMetadata: false, ignoreEncryption: true })
  if (inp.cover) {
    const first = doc.getPage(0)
    const trim = first.getTrimBox()
    const img = inp.cover.png ? await doc.embedPng(inp.cover.data) : await doc.embedJpg(inp.cover.data)
    const page = doc.insertPage(0, [trim.width, trim.height])
    page.drawImage(img, { x: 0, y: 0, width: trim.width, height: trim.height })
    // page labels: "Cover" for the new page, the book's own labels shifted by one
    const ctx = doc.context
    const old = doc.catalog.lookupMaybe(PDFName.of('PageLabels'), PDFDict)?.lookupMaybe(PDFName.of('Nums'), PDFArray)?.asArray() ?? []
    const nums: PDFObject[] = [PDFNumber.of(0), ctx.obj({ P: PDFString.of('Cover') })]
    if (!old.length) nums.push(PDFNumber.of(1), ctx.obj({ S: 'D' }))
    for (let i = 0; i < old.length; i += 2) nums.push(PDFNumber.of((old[i] as PDFNumber).asNumber() + 1), old[i + 1])
    doc.catalog.set(PDFName.of('PageLabels'), ctx.obj({ Nums: ctx.obj(nums) }))
  }
  for (const extra of inp.extras) {
    const src = await PDFDocument.load(extra, { updateMetadata: false, ignoreEncryption: true })
    const copied = await doc.copyPages(src, src.getPageIndices())
    for (const p of copied) doc.addPage(p)
  }
  return doc.save({ useObjectStreams: false })
}

const STOP: Record<string, string[]> = {
  de: ['der', 'die', 'und', 'das', 'ist', 'nicht', 'mit', 'von', 'zu', 'den', 'sich', 'auch'],
  en: ['the', 'and', 'of', 'to', 'is', 'in', 'that', 'was', 'for', 'with', 'as', 'were'],
  es: ['el', 'la', 'que', 'los', 'las', 'y', 'en', 'del', 'por', 'una', 'con', 'se'],
  fr: ['le', 'la', 'les', 'et', 'des', 'est', 'que', 'une', 'dans', 'pour', 'qui', 'sur'],
  it: ['il', 'che', 'di', 'la', 'e', 'per', 'una', 'sono', 'della', 'del', 'con', 'non'],
  pt: ['que', 'não', 'uma', 'os', 'as', 'do', 'da', 'em', 'para', 'com', 'se', 'por'],
}
export function detectLanguage(text: string): string {
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? []
  const count = new Map<string, number>()
  for (const w of words.slice(0, 20000)) count.set(w, (count.get(w) ?? 0) + 1)
  return Object.entries(STOP).map(([lang, ws]) => [lang, ws.reduce((n, w) => n + (count.get(w) ?? 0), 0)] as const).sort((a, b) => b[1] - a[1])[0][0]
}

const FILEISH = /\.(docx?|indd|pdf)\b|^microsoft word|^untitled/i

export async function analyzeUa(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pdfjs: any, raster: Raster, inp: UaInputs, onProgress?: (done: number, total: number) => void,
): Promise<UaAnalysis> {
  const review: ReviewItem[] = []
  const merged = await mergeInputs(inp)
  const book = await analyzePdf(pdfjs, merged, raster, {}, onProgress)
  const plan = await planPages(merged)
  // slug notes outside the trim ("[Page v]", job info) are never content
  plan.doc.getPages().forEach((pg, i) => {
    const t = trimOf(pg)
    const p = book.pages[i]
    if (p) p.lines = p.lines.filter((l) => l.x1 > t.x0 + 2 && l.x0 < t.x1 - 2 && l.base > t.top + 2 && l.y < t.bottom - 2)
  })
  const detected = new Map<number, Figure[]>()
  plan.pages.forEach((p, i) => detected.set(i, detectFigures(book.pages[i], p.paints, book.bodySize)))
  const styles = inferUaStyles(book)

  // alt texts from the Word file, matched to the figures once to prefill the review
  const alt = inp.altDocx ? readAltDocx(inp.altDocx) : []
  const st = buildStructure(book, new Map(styles.map((s) => [s.key, s.role])), cloneFigs(detected))
  const pageArea = book.pages[1] ? book.pages[1].width * book.pages[1].height : 1
  const { unused } = matchAlt(st.figures, alt, pageArea)
  if (unused.length) review.push({ level: 'warn', msg: `${unused.length} alt text(s) from the Word file were not matched to a figure — check the figure list.` })

  // metadata: document info if meaningful, else title pages / first heading
  const info = await PDFDocument.load(inp.main, { updateMetadata: false, ignoreEncryption: true })
  const infoTitle = info.getTitle() ?? ''
  const firstHeading = st.headings[0]?.text ?? ''
  // title page: the biggest type is the title, the next size down (above body size) the subtitle
  const tp = book.front.map((i) => book.pages[i]).filter((p) => p.lines.length).sort((a, b) => Math.max(...b.lines.map((l) => l.size)) - Math.max(...a.lines.map((l) => l.size)))[0]
  const sizes = tp ? [...new Set(tp.lines.map((l) => l.size))].sort((a, b) => b - a) : []
  const tpTitle = tp ? tp.lines.filter((l) => l.size === sizes[0]).map((l) => l.text.trim()).join(' ') : ''
  const tpSub = tp && sizes[1] && sizes[1] > book.bodySize * 1.4 ? tp.lines.filter((l) => l.size === sizes[1]).map((l) => l.text.trim()).join(' ') : ''
  const titleFromPages = tpTitle ? [tpTitle, tpSub].filter(Boolean).join(': ') : book.meta.title && !FILEISH.test(book.meta.title) ? [book.meta.title, book.meta.subtitle].filter(Boolean).join(': ') : ''
  // authors: a names line on the first pages ("Anna Muster / Ben Beispiel") beats a login name in the PDF info
  const NAME = String.raw`\p{Lu}[\p{L}.'’-]+(?:\s+\p{Lu}[\p{L}.'’-]+)+`
  const namesLine = new RegExp(String.raw`^${NAME}(?:\s*(?:/|,|&|und|and|y|et)\s*${NAME})*$`, 'u')
  const titleWords = (titleFromPages + ' ' + (st.headings[0]?.text ?? '')).toLowerCase()
  const pageAuthors = book.pages.slice(0, 5).flatMap((p) => p.lines).map((l) => l.text.trim()).find((t) => t.length < 90 && namesLine.test(t) && !titleWords.includes(t.toLowerCase()) && (/[/,&]| und | and /.test(t) || t.split(/\s+/).length <= 4)) ?? ''
  const infoAuthor = info.getAuthor() ?? ''
  const allText = book.pages.flatMap((p) => p.lines.map((l) => l.text)).join(' ')
  const meta = {
    title: (infoTitle && !FILEISH.test(infoTitle) ? infoTitle : titleFromPages || titleCase(firstHeading)).replace(/\s+/g, ' ').trim(),
    author: (/\s/.test(infoAuthor) ? infoAuthor : '') || pageAuthors || (/^[\p{L} .'’-]+$/u.test(book.meta.authors) ? book.meta.authors : '') || infoAuthor,
    lang: detectLanguage(allText),
    subject: '',
    keywords: book.meta.printIsbn,
    isbn: '',
  }

  const figures: UaFigure[] = st.figures.map((f) => ({
    key: figKey(f), page: f.page, caption: f.caption, alt: f.node?.alt ?? '', thumb: f.image, vector: f.vector, box: f.box,
  }))
  // charts drawn as vectors have no image to show the reviewer: render their page region
  if (figures.some((f) => !f.thumb)) {
    const task = pdfjs.getDocument({ data: merged.slice(), disableFontFace: true, isEvalSupported: false })
    const doc = await task.promise
    for (const f of figures.filter((x) => !x.thumb)) {
      const H = book.pages[f.page].height
      f.thumb = await raster.page(await doc.getPage(f.page + 1), 360, { x0: f.box.x0, y0: H - f.box.y1, x1: f.box.x1, y1: H - f.box.y0 }).catch(() => null)
    }
    await task.destroy()
  }
  return { merged, book, styles, meta, figures, detected, altUnused: unused, review }
}

/** Bookmark names for front pages without a heading (as in the reference: Cover, Half Title, Title, Copyright). */
function frontPages(a: UaAnalysis): { page: number; label: string }[] {
  const L = labelsFor(a.meta.lang)
  const out: { page: number; label: string }[] = []
  const first = a.book.pages[0]
  if (first && !first.lines.length && first.images.length) out.push({ page: 0, label: L.cover })
  const textFront = a.book.front.filter((i) => a.book.pages[i].lines.length)
  const biggest = (i: number) => Math.max(...a.book.pages[i].lines.map((l) => l.size))
  const titleIdx = [...textFront].sort((x, y) => biggest(y) - biggest(x))[0]
  for (const i of textFront) if (i < titleIdx) out.push({ page: i, label: L.halftitle })
  if (titleIdx !== undefined) out.push({ page: titleIdx, label: L.title })
  if (a.book.imprintPage !== undefined) out.push({ page: a.book.imprintPage, label: L.copyright })
  return out
}

const figKey = (f: Figure) => `${f.page}:${Math.round(f.box.x0)}:${Math.round(f.box.y0)}`
const cloneFigs = (m: Map<number, Figure[]>) => new Map([...m].map(([k, fs]) => [k, fs.map((f) => ({ ...f, lines: [], caption: '', node: undefined }))]))

export async function buildUa(
  a: UaAnalysis, input: { styles: UaStyle[]; meta: UaAnalysis['meta']; alt: Record<string, string>; cropToTrim: boolean; sourceName?: string },
): Promise<{ pdf: Uint8Array; review: ReviewItem[]; stats: Record<string, number>; fileName: string }> {
  const roles = new Map<string, UaRole>(input.styles.map((s) => [s.key, s.role]))
  const st = buildStructure(a.book, roles, cloneFigs(a.detected))
  for (const f of st.figures) if (f.node) f.node.alt = input.alt[figKey(f)] ?? ''
  const plan = await planPages(a.merged) // fresh copy: writing modifies the document
  const out = writeUa(plan, a.book, st, input.meta, { cropToTrim: input.cropToTrim, frontPages: frontPages(a) })
  const pdf = await out.pdf
  const review = [...a.review.filter((r) => !/alt text/.test(r.msg)), ...out.review, ...(await checkUa(pdf))]
  // as in the samples: the source file's name, plus the e-ISBN when there is one
  const base = (input.sourceName?.replace(/\.pdf$/i, '') || input.meta.title.split(':')[0]).replace(/[\\/:*?"<>|]+/g, '').trim() || 'document'
  return { pdf, review, stats: out.stats, fileName: `${base}${input.meta.isbn ? '_' + input.meta.isbn.replace(/[^\dXx]/g, '') : ''}.pdf` }
}

export { PDFHexString }
