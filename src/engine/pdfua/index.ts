import { PDFDocument, PDFName, PDFArray, PDFDict, PDFNumber, PDFString, PDFHexString, type PDFObject } from 'pdf-lib'
import { analyzePdf, titleCase, type PdfBook } from '../pdfepub/analyze.ts'
import type { Raster } from '../pdf/raster.ts'
import type { ReviewItem } from '../epub/package.ts'
import { inferUaStyles, buildStructure, imageList, type UaOptions, type UaStyle, type Figure, type UaRole, type SNode } from './structure.ts'
import { detectFigures } from './figures.ts'
import { readAltDocx, matchAlt, type AltEntry } from './altdocx.ts'
import { planPages, writeUa, type UaMeta } from './write.ts'
import { trimOf } from './pages.ts'
import { checkUa } from './check.ts'
import { labelsFor } from '../epub/locale.ts'
import { resolveAlt, type SpecPicture } from '../epub/alt.ts'

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
  /** house-style options (heading levels, vector logos) */
  options?: UaOptions
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
  options: UaOptions
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

import { detectLanguage } from '../lang.ts'
export { detectLanguage }

const FILEISH = /\.(docx?|indd|pdf)\b|^microsoft word|^untitled/i

export async function analyzeUa(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pdfjs: any, raster: Raster, inp: UaInputs, onProgress?: (done: number, total: number) => void,
): Promise<UaAnalysis> {
  const review: ReviewItem[] = []
  const merged = await mergeInputs(inp)
  const book = await analyzePdf(pdfjs, merged, raster, {}, onProgress, { structure: false })
  const plan = await planPages(merged)
  // slug notes outside the trim ("[Page v]", job info) are never content
  plan.doc.getPages().forEach((pg, i) => {
    const t = trimOf(pg)
    const p = book.pages[i]
    if (p) p.lines = p.lines.filter((l) => l.x1 > t.x0 + 2 && l.x0 < t.x1 - 2 && l.base > t.top + 2 && l.y < t.bottom - 2)
  })
  const detected = new Map<number, Figure[]>()
  plan.pages.forEach((p, i) => detected.set(i, detectFigures(book.pages[i], p.paints, book.bodySize, { logos: inp.options?.logos })))
  const styles = inferUaStyles(book)

  // alt texts from the Word file, matched to the figures once to prefill the review
  const alt = inp.altDocx ? readAltDocx(inp.altDocx) : []
  const st = buildStructure(book, new Map(styles.map((s) => [s.key, s.role])), cloneFigs(detected), inp.options)
  const pageArea = book.pages[1] ? book.pages[1].width * book.pages[1].height : 1
  // the Word file lists descriptions in the order of the image list: put the figures in that order first
  const il = imageList(st, book)
  const rank = (f: Figure) => [...(il?.byN ?? [])].find(([, x]) => x === f)?.[0] ?? Infinity
  const ordered = il && il.byN.size === il.figures.length ? [...st.figures.filter((f) => !il.figures.includes(f)), ...[...il.figures].sort((a, b) => rank(a) - rank(b))] : st.figures
  const { unused } = matchAlt(ordered, alt, pageArea)
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
  return { merged, book, styles, meta, figures, detected, options: inp.options ?? {}, altUnused: unused, review }
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

const normName = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '')

/** Spec-sheet rows whose file name is part of the figure caption. Rows that do not match are left unused. */
export function specForFigures(figures: { key: string; caption: string }[], specs: SpecPicture[]): Record<string, { alt: string; longDesc?: string; decorative?: boolean }> {
  const used = new Set<SpecPicture>()
  const out: Record<string, { alt: string; longDesc?: string; decorative?: boolean }> = {}
  for (const f of figures) {
    const cap = normName(f.caption)
    if (cap.length < 4) continue
    const hit = specs.find((s) => {
      if (used.has(s)) return false
      const stem = normName(s.file.replace(/\.[a-z0-9]+$/i, ''))
      return stem.length >= 4 && (cap.includes(stem) || stem.includes(cap.slice(0, 40)))
    })
    if (!hit) continue
    used.add(hit)
    out[f.key] = { alt: hit.alt, longDesc: hit.longDesc, decorative: hit.decorative }
  }
  return out
}

export interface UaBuildInput {
  styles: UaStyle[]
  meta: UaAnalysis['meta']
  /** Text the reviewer typed. An empty string means they cleared it. */
  alt: Record<string, string>
  cropToTrim: boolean
  sourceName?: string
  /** replaces the options the analysis was made with (the client's layer is known only after reading the book) */
  options?: UaOptions
  spec?: Record<string, { alt: string; longDesc?: string; decorative?: boolean }>
  ai?: Record<string, { alt: string; approved?: boolean }>
  fileAlt?: Record<string, { alt: string; longDesc?: string }>
  /** The reviewer marked this picture as decoration. It is tagged as an artifact, not a figure. */
  decorative?: Record<string, boolean>
}

const dropNode = (root: SNode, gone: SNode) => {
  const walk = (n: SNode) => {
    n.kids = n.kids.filter((k) => k !== gone)
    n.kids.forEach(walk)
  }
  walk(root)
}

/** Typed text, then the spec sheet, then file text, then a decorative mark, then an AI draft. */
export function figureChoice(input: {
  key: string
  caption: string
  remembered?: string
  alt: Record<string, string>
  spec?: UaBuildInput['spec']
  ai?: UaBuildInput['ai']
  fileAlt?: UaBuildInput['fileAlt']
  decorative?: Record<string, boolean>
}): { alt: string; decorative: boolean; pendingAi: boolean } {
  if (input.decorative?.[input.key]) return { alt: '', decorative: true, pendingAi: false }
  const typedRaw = (input.alt[input.key] ?? '').trim()
  const typedGiven = Object.prototype.hasOwnProperty.call(input.alt, input.key)
  const choice = resolveAlt({
    typed: typedGiven && typedRaw ? { alt: typedRaw } : null,
    spec: input.spec?.[input.key] ?? null,
    file: input.fileAlt?.[input.key] ?? (!typedGiven && input.remembered ? { alt: input.remembered } : null),
    ai: input.ai?.[input.key] ?? null,
    caption: input.caption,
  })
  const approvedAi = choice.source === 'ai' && !!input.ai?.[input.key]?.approved
  return { alt: choice.decorative ? '' : choice.alt, decorative: choice.decorative, pendingAi: choice.source === 'ai' && !approvedAi && !!choice.alt }
}

export async function buildUa(
  a: UaAnalysis, input: UaBuildInput,
): Promise<{ pdf: Uint8Array; review: ReviewItem[]; stats: Record<string, number>; fileName: string }> {
  const roles = new Map<string, UaRole>(input.styles.map((s) => [s.key, s.role]))
  const st = buildStructure(a.book, roles, cloneFigs(a.detected), input.options ?? a.options)
  const extra: ReviewItem[] = []
  let pendingAi = 0
  let decorativeN = 0
  const remembered = new Map(a.figures.map((f) => [f.key, f.alt.trim()]))
  const hide = (f: Figure) => {
    decorativeN++
    const node = f.node
    f.node = undefined
    if (!node) return
    dropNode(st.root, node)
    // text drawn on the ornament is no longer a figure, so the writer marks it as an artifact
    for (const l of f.lines) if (st.owner.get(l) === node) st.owner.delete(l)
  }
  for (const f of st.figures) {
    if (!f.node) continue
    const key = figKey(f)
    const choice = figureChoice({
      key, caption: f.caption, remembered: remembered.get(key), alt: input.alt, spec: input.spec, ai: input.ai, fileAlt: input.fileAlt, decorative: input.decorative,
    })
    if (choice.decorative) {
      hide(f)
      continue
    }
    f.node.alt = choice.alt
    if (choice.pendingAi) pendingAi++
  }
  if (decorativeN) extra.push({ level: 'info', msg: `Marked ${decorativeN} decorative picture(s) as artifacts, so a screen reader skips them.` })
  if (pendingAi) extra.push({ level: 'warn', msg: `${pendingAi} picture description(s) are unapproved AI drafts.` })
  const plan = await planPages(a.merged) // fresh copy: writing modifies the document
  const out = writeUa(plan, a.book, st, input.meta, { cropToTrim: input.cropToTrim, frontPages: frontPages(a) })
  const pdf = await out.pdf
  const review = [...a.review.filter((r) => !/alt text/.test(r.msg)), ...extra, ...out.review, ...(await checkUa(pdf))]
  // as in the samples: the source file's name, plus the e-ISBN when there is one
  const base = (input.sourceName?.replace(/\.pdf$/i, '') || input.meta.title.split(':')[0]).replace(/[\\/:*?"<>|]+/g, '').trim() || 'document'
  return { pdf, review, stats: out.stats, fileName: `${base}${input.meta.isbn ? '_' + input.meta.isbn.replace(/[^\dXx]/g, '') : ''}.pdf` }
}

export { PDFHexString }
