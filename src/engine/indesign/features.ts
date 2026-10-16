// InDesign reader → BlockFeatures (structure/features.ts): the look, wording and place of every paragraph.
import type { BlockFeatures, Pattern } from '../structure/features.ts'
import { sectionTypeOf } from '../epub/locale.ts'
import { px, em, type Decls } from './css.ts'
import { tag } from '../xml.ts'
import { TOC_NAME } from '../structure/dict.ts'
import type { Block, Export } from './read.ts'

export const CHAPTER_WORD = /^(cap[ií]tulo|chapter|kapitel|chapitre|capitolo|cap[ií]tol|hoofdstuk|ap[ée]ndice|appendix|anhang|annexe|ep[ií]logo|epilogue|pr[óo]logo|prologue)\b/i
export const PART_WORD = /\b(parte|part|teil|partie|deel)\b/i
export const BULLET = /^[•●◦▪■·–—-]\s*\t|^[•●◦▪■]\s/
export const TOC_LINE = /\t\s*\d+\s*$/
export const IMPRINT = /i\.?s\.?b\.?n|©|copyright|dep[óo]sito legal|all rights reserved|todos los derechos|primera edici[óo]n|first published|alle rechte vorbehalten/i
const ROMAN = /^[ivxlcdm]{1,8}\.?$/i

type PBlock = Extract<Block, { t: 'p' }>
export const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '')

export interface FeatureCtx {
  bodyKey: string
  decl: (k: string) => Decls
  isTocLine: (b: PBlock) => boolean
  tocText: (b: PBlock) => string
  /** the entries of the export's own navigation document */
  nav: { text: string; level: number }[]
}

const patternOf = (b: PBlock, toc: boolean): Pattern | undefined => {
  const raw = b.el.textContent ?? ''
  const t = b.text
  if (BULLET.test(raw)) return 'bullet'
  if (toc) return 'tocLine'
  if (IMPRINT.test(t)) return 'imprint'
  if (PART_WORD.test(t) && t.length < 60) return 'partWord'
  if (CHAPTER_WORD.test(t)) return 'chapterWord'
  if (/^\d{1,3}$/.test(t)) return 'numberOnly'
  if (ROMAN.test(t)) return 'roman'
  if (t.length < 60 && sectionTypeOf(t)) return 'sectionKeyword'
}

/** One record per non-empty paragraph, in reading order. */
export function indesignFeatures(ex: Export, ctx: FeatureCtx): Map<PBlock, BlockFeatures> {
  const out = new Map<PBlock, BlockFeatures>()
  const stream = ex.blocks
  const texts = stream.filter((b): b is PBlock => b.t === 'p' && !!b.text)
  const freq = new Map<string, number>()
  for (const b of texts) freq.set(b.key, (freq.get(b.key) ?? 0) + 1)
  const bodySize = em(ctx.decl(ctx.bodyKey)['font-size'])

  // the printed contents: every line that ends in a page number names a chapter or section; its style's size ranks the level
  // a contents style named as such counts even where its lines carry no page number (sub-entries)
  const tocish = (b: PBlock) => ctx.isTocLine(b) || (TOC_NAME.test(b.key) && (freq.get(b.key) ?? 0) >= 2)
  const tocLines = texts.filter(tocish)
  const levelOf = new Map(
    [...new Set(tocLines.map((b) => b.key))].sort((a, b) => em(ctx.decl(b)['font-size']) - em(ctx.decl(a)['font-size'])).map((k, i) => [k, i + 1] as const),
  )
  const entries = new Map<string, { level: number; entry: string }>()
  let lastToc = -1
  const at = new Map(texts.map((b, i) => [b, i] as const))
  texts.forEach((b, i) => {
    if (!tocish(b)) return
    lastToc = i
    const before = texts[i - 1]
    // a title line, then its author/page line; or one line "Title <tab> page"
    const t = before && !tocish(before) && before.key !== b.key ? before.text : ctx.tocText(b)
    const titled = t !== ctx.tocText(b)
    if (norm(t).length > 3 && !entries.has(norm(t))) entries.set(norm(t), { level: titled ? 1 : (levelOf.get(b.key) ?? 1), entry: t })
  })
  const navEntries = ctx.nav.map((n) => ({ ...n, n: norm(n.text) })).filter((n) => n.n.length > 3)

  let prevPb = false
  for (const [i, b] of stream.entries()) {
    if (b.t === 'pb') {
      prevPb = true
      continue
    }
    if (b.t !== 'p') {
      prevPb = false
      continue
    }
    const first = prevPb
    prevPb = false
    if (!b.text) continue
    const d = ctx.decl(b.key)
    const face = ex.css.paragraphFace(b.classes)
    const toc = ctx.isTocLine(b)
    const nb = nextText(stream, i)
    const nk = norm(b.text)
    const nav = !toc && b.text.length <= 140 ? navEntries.find((n) => n.n === nk || (nk.length >= 6 && n.n.startsWith(nk))) : undefined
    const cont = !toc && (at.get(b) ?? 0) > lastToc ? entries.get(nk) : undefined
    const f: BlockFeatures = {
      styleKey: b.key,
      styleName: /^(_id|ParaOverride)/.test(b.key) ? undefined : b.key,
      tag: tag(b.el),
      fontFamily: d['font-family'],
      sizeRatio: em(d['font-size']) / bodySize,
      bold: face.bold,
      italic: face.italic,
      caps: face.upper || face.smallCaps,
      align: ['left', 'center', 'right', 'justify'].includes(d['text-align']) ? (d['text-align'] as 'left') : undefined,
      spaceAbove: px(d['margin-top']) / 12,
      spaceBelow: px(d['margin-bottom']) / 12,
      page: b.page,
      firstOnPage: first,
      afterPageBreak: first,
      textLen: b.text.length,
      endsWithPunct: /[.;,:!?…»”"')]$/.test(b.text),
      pattern: patternOf(b, toc),
      contentsMatch: nav ? { level: nav.level, entry: nav.text, source: 'nav' } : cont ? { ...cont, source: 'contents' } : undefined,
      styleFreq: freq.get(b.key) ?? 0,
      nextStyleKey: nb?.key,
    }
    out.set(b, f)
  }
  return out
}

function nextText(stream: Block[], i: number): PBlock | undefined {
  for (let j = i + 1; j < stream.length; j++) {
    const n = stream[j]
    if (n.t === 'p' && n.text) return n
  }
}
