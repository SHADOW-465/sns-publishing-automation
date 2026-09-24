import type { Block, Export, Role } from './read.ts'
import { sectionTypeOf } from '../epub/locale.ts'

// =============================================================================================
// Front matter by content, not by position: every printed page before the body is classified
// from what is on it (the title repeated on half-title and title page, © / ISBN lines, short
// quoted lines…), and the book's metadata is read from those pages. Layouts differ from book to
// book and InDesign styles are named freely, so no style names are relied on here.
// =============================================================================================

type PBlock = Extract<Block, { t: 'p' }>
export type FrontKind = 'halftitle' | 'title' | 'copyright' | 'dedication' | 'epigraph' | 'other'
export interface FrontPage {
  kind: FrontKind
  blocks: Block[]
}

export const norm = (s: string) => s.toLocaleLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, '')

const IMPRINT_ANY =
  /©|\(c\)\s*\d{4}|\bi\.?\s?s\.?\s?b\.?\s?n\b|\bedici[óo]n\b|\bedition\b|\bauflage\b|\bderechos\b|\brights\b|copyright|dep[óo]sito legal|printed in|impreso en|published (by|in)|publicado por|t[íi]tulo original|original title|traducci[óo]n|translat|www\.|@|\bs\.\s?a\.|\bs\.\s?l\.|\bltd\b|\binc\b|\bgmbh\b/i
const DEDICATION = /^(para|a mis?|a la memoria|a mi|en memoria|dedicad[oa]|con amor|to\b|for\b|in (loving )?memory|in memoriam|für|à|pour|per\b|ai miei|al mio|alla mia)/i
const CREDIT = /^(autor|autora|author|traducci[óo]n|traducido|translated|pr[óo]logo de|foreword by|introducci[óo]n de|ilustraciones|illustrat|edited|editado|edici[óo]n (de|a cargo)|coordinad|compilad|selecci[óo]n)/i
export const COMPANY =
  /\b(grupo editorial|editorial|ediciones|editores|publishing|publishers|press|books|verlag|[ée]ditions|edizioni|editora|random house|distribuciones|s\.?\s?a\.?\s?de\s?c\.?\s?v\.?|s\.?\s?a\.?\s?u\.?|s\.\s?a\.|s\.\s?l\.|ltd|limited|llc|inc|gmbh|ag)\b/i
const LEGAL_FORM = /,?\s*\b(s\.?\s?a\.?\s?(de\s?c\.?\s?v\.?|u\.?)?|s\.\s?l\.(\s?u\.)?|ltd\.?|limited|llc|inc\.?|gmbh|ag|s\.?\s?r\.?\s?l\.?)\s*\.?$/i
const PARTICLE = /^(de|del|la|las|los|y|e|van|von|der|den|di|da|dos|das|do|le|du|des|ben|bin|al|el|st\.?|zu|af)$/i
/** "Elena Chávez", "RJ Spina", "Ana María de la Fuente", "J. R. R. Tolkien" */
const NAME = /^(\p{Lu}[\p{L}'’.-]*\.?)(\s+((de|del|la|las|los|y|e|van|von|der|den|di|da|dos|das|do|le|du|des|ben|bin|al|st\.?|zu)\s+)*\p{Lu}[\p{L}'’.-]*\.?){1,4}$/u
const NOT_A_NAME = /derechos|rights|edici[óo]n|edition|traducci|translat|ilustr|illustr|fotograf|photo|cubierta|cover|dise[ñn]o|design|texto|text|reservados|reserved|grupo|editorial|books|press/i

const isCaps = (s: string) => /\p{L}/u.test(s) && s === s.toLocaleUpperCase() && s !== s.toLocaleLowerCase()
const words = (s: string) => s.split(/\s+/).filter(Boolean).length

/** "ELENA CHÁVEZ" → "Elena Chávez", "ANA DE LA FUENTE" → "Ana de la Fuente" */
export function nameCase(s: string, lang = 'es'): string {
  if (!isCaps(s)) return s
  return s.toLocaleLowerCase(lang).split(/(\s+|-)/).map((w, i) => (i > 0 && PARTICLE.test(w) ? w : w.charAt(0).toLocaleUpperCase(lang) + w.slice(1))).join('')
}

/** All-caps titles: sentence case (Spanish/French/Italian/Portuguese convention), otherwise Title Case. */
export function titleCaseFor(s: string, lang: string): string {
  if (!isCaps(s)) return s
  const low = s.toLocaleLowerCase(lang)
  if (/^(es|fr|it|pt|ca)/i.test(lang)) return low.charAt(0).toLocaleUpperCase(lang) + low.slice(1)
  const small = /^(a|an|the|and|or|of|in|on|at|to|for|by|with|from|der|die|das|und|von|zu)$/
  return low.split(' ').map((w, i) => (i > 0 && small.test(w) ? w : w.charAt(0).toLocaleUpperCase(lang) + w.slice(1))).join(' ')
}

/** Titles InDesign takes from the document file name: "La cara oculta de la presidenta_Grijalbo". */
export const FILEISH = /_|\.(indd|idml|pdf|docx?|epub)\b|^untitled\b|^sin t[íi]tulo|^\d{4,}\b|\b(int|interior|maqueta|final|v\d+|epub|ebook)\s*$/i

/** Index of the first block that starts the body: chapter/part openers, or a heading of a known section type. */
export function bodyStart(blocks: Block[], roleOf: (b: PBlock) => Role): number {
  const i = blocks.findIndex((b) => {
    if (b.t !== 'p' || !b.text) return false
    const r = roleOf(b)
    if (r === 'chapter-label' || r === 'part-label' || r === 'chapter-title') return true
    return r === 'section-title' && !!sectionTypeOf(b.text)
  })
  return i < 0 ? blocks.length : i
}

/** Printed pages: blocks between page markers; blank pages fold into the next page with content. */
export function splitPages(blocks: Block[]): Block[][] {
  const pages: Block[][] = [[]]
  for (const b of blocks) {
    const g = pages[pages.length - 1]
    if (b.t === 'pb' && g.some((x) => x.t !== 'pb')) pages.push([b])
    else g.push(b)
  }
  const out: Block[][] = []
  let carry: Block[] = []
  for (const g of pages) {
    if (!g.some((x) => x.t === 'p' && x.text) && !g.some((x) => x.t === 'img')) carry.push(...g)
    else (out.push([...carry, ...g]), (carry = []))
  }
  if (carry.length) out.length ? out[out.length - 1].push(...carry) : out.push(carry)
  return out
}

const linesOf = (g: Block[]) => g.filter((b): b is PBlock => b.t === 'p' && !!b.text)
export const isImprintPage = (g: Block[], roleOf: (b: PBlock) => Role) => {
  const ls = linesOf(g)
  return ls.some((b) => roleOf(b) === 'imprint') || ls.filter((b) => IMPRINT_ANY.test(b.text)).length >= 2
}
const displayPage = (g: Block[]) => {
  const ls = linesOf(g)
  return ls.length > 0 && ls.length <= 8 && ls.every((b) => b.text.length <= 110) && ls.reduce((n, b) => n + words(b.text), 0) <= 45
}

/** The title as printed on the title pages: the line repeated on half-title and title page, or the half-title itself. */
function printedTitle(pages: Block[][], roleOf: (b: PBlock) => Role): string {
  const disp = pages.filter((g) => displayPage(g) && !isImprintPage(g, roleOf))
  const seen = new Map<string, { text: string; n: number }>()
  for (const g of disp) for (const k of new Set(linesOf(g).map((b) => norm(b.text)))) {
    const t = linesOf(g).find((b) => norm(b.text) === k)!.text
    seen.set(k, { text: t, n: (seen.get(k)?.n ?? 0) + 1 })
  }
  const repeated = [...seen.values()].filter((x) => x.n >= 2 && !NAME.test(nameCase(x.text)))
  if (repeated.length) return repeated.sort((a, b) => b.text.length - a.text.length)[0].text
  const first = disp[0] ? linesOf(disp[0]) : []
  return first.length && first.length <= 3 ? first.map((b) => b.text).join(' ') : ''
}

export function classifyFront(pages: Block[][], roleOf: (b: PBlock) => Role, title: string): FrontPage[] {
  const t = norm(title)
  const hasTitle = (g: Block[]) => !!t && linesOf(g).some((b) => norm(b.text) === t || (norm(b.text).length > 4 && t.startsWith(norm(b.text))))
  const out: FrontPage[] = []
  const titleIdx = pages.map((g, i) => [g, i] as const).filter(([g]) => displayPage(g) && hasTitle(g) && !isImprintPage(g, roleOf)).map(([, i]) => i)
  // the title page is the richest display page carrying the title; one before it with only the title is the half-title
  const tp = titleIdx.sort((a, b) => linesOf(pages[b]).length - linesOf(pages[a]).length || a - b)[0]
  pages.forEach((g, i) => {
    const ls = linesOf(g)
    if (isImprintPage(g, roleOf)) out.push({ kind: 'copyright', blocks: g })
    else if (i === tp) out.push({ kind: 'title', blocks: g })
    else if (tp !== undefined && i < tp && hasTitle(g) && displayPage(g)) out.push({ kind: 'halftitle', blocks: g })
    else if (ls.length && ls.every((b) => roleOf(b) !== 'section-title') && ls.reduce((n, b) => n + words(b.text), 0) <= 120 && (tp === undefined || i > tp)) {
      // short pages after the title page: dedication and/or epigraph, split line by line
      let cur: FrontPage | undefined
      for (const b of g) {
        const kind: FrontKind = b.t === 'p' && b.text ? (DEDICATION.test(b.text) ? 'dedication' : 'epigraph') : (cur?.kind ?? 'epigraph')
        if (!cur || (cur.kind !== kind && b.t === 'p' && !!b.text && cur.blocks.some((x) => x.t === 'p' && x.text))) out.push((cur = { kind, blocks: [] }))
        if (b.t === 'p' && b.text && !cur.blocks.some((x) => x.t === 'p' && x.text)) cur.kind = kind
        cur.blocks.push(b)
      }
    } else out.push({ kind: 'other', blocks: g })
  })
  return out
}

export interface FrontMeta {
  title: string
  subtitle: string
  author: string
  publisher: string
  rights: string
  printIsbn: string
  /** where each value came from, shown to the reviewer */
  source: Record<'title' | 'subtitle' | 'author' | 'publisher', string>
}

/** Title, subtitle, author, publisher from the front pages and the imprint (wherever it is printed). */
export function detectMeta(ex: Export, roleOf: (b: PBlock) => Role): FrontMeta {
  const lang = ex.lang
  const region = ex.blocks.slice(0, bodyStart(ex.blocks, roleOf))
  const pages = splitPages(region)
  const imprintLines = [
    ...pages.filter((g) => isImprintPage(g, roleOf)).flatMap(linesOf),
    ...ex.blocks.slice(region.length).filter((b): b is PBlock => b.t === 'p' && !!b.text && roleOf(b) === 'imprint'),
  ].map((b) => b.text)
  const allFront = [...pages.flatMap(linesOf).map((b) => b.text), ...imprintLines]
  const source = { title: '', subtitle: '', author: '', publisher: '' }

  // ---- title ----
  const opf = ex.opfTitle.replace(/^\d[\w-]*\s+/, '').trim()
  const printed = printedTitle(pages, roleOf)
  const cased = (s: string) => allFront.find((x) => norm(x) === norm(s) && !isCaps(x))
  let title = ''
  if (printed && cased(printed)) (title = cased(printed)!), (source.title = 'title page, spelled as on the copyright page')
  else if (printed && opf && norm(opf) === norm(printed)) (title = opf), (source.title = 'title page')
  else if (printed) (title = titleCaseFor(printed, lang)), (source.title = isCaps(printed) ? 'title page (capitals converted — check the spelling)' : 'title page')
  else if (opf && !FILEISH.test(opf)) (title = opf), (source.title = 'InDesign document title')
  else {
    const h = ex.blocks.find((b): b is PBlock => b.t === 'p' && !!b.text)
    title = h ? titleCaseFor(h.text, lang) : opf
    source.title = 'first line of the book — check it'
  }

  // ---- author: the © holder who is a person, confirmed by the title page when possible ----
  const tpLines = pages.filter((g) => displayPage(g) && !isImprintPage(g, roleOf)).flatMap(linesOf).map((b) => b.text)
  const holders: string[] = []
  for (const line of imprintLines) {
    if (!line.includes('©') && !/^copyright\b/i.test(line)) continue
    if (/traducci|translat|ilustr|illustr|fotograf|photograph|cubierta|cover|dise[ñn]o|prólogo|foreword/i.test(line)) continue
    const m = line.replace(/^(d\.\s?r\.|copyright)\s*/i, '').match(/©\s*(?:\d{4}\s*[,.]?\s*)?(?:(?:by|por|de)\s+)?([^,;:(]+?)(?:\s*[,.]\s*\d{4})?\s*\.?$/i)
    const name = m?.[1].trim()
    if (name && NAME.test(name) && !COMPANY.test(name) && !NOT_A_NAME.test(name)) holders.push(name)
  }
  const onTitlePage = (n: string) => tpLines.some((l) => norm(l) === norm(n) || norm(l).includes(norm(n)))
  let author = holders.find(onTitlePage) ?? holders[0] ?? ''
  if (author) source.author = holders.length > 1 && !onTitlePage(author) ? 'copyright line (several holders — check)' : 'copyright line'
  else {
    const cand = tpLines.find((l) => norm(l) !== norm(printed) && norm(l) !== norm(title) && words(l) <= 5 && !CREDIT.test(l) && NAME.test(nameCase(l, lang)))
    if (cand) (author = nameCase(cand, lang)), (source.author = 'title page')
  }

  // ---- subtitle: the title-page line after the title that is neither the author nor a credit ----
  const tp = pages
    .filter((g) => displayPage(g) && !isImprintPage(g, roleOf) && linesOf(g).some((b) => norm(b.text) === norm(printed || title)))
    .sort((a, b) => linesOf(b).length - linesOf(a).length)[0]
  let subtitle = ''
  if (tp) {
    const ls = linesOf(tp).map((b) => b.text)
    const at = ls.findIndex((l) => norm(l) === norm(printed || title))
    const cands = ls.filter((l, i) => i !== at && !CREDIT.test(l) && !(author && norm(l).includes(norm(author))) && !(words(l) <= 4 && NAME.test(nameCase(l, lang))))
    const after = cands.find((l) => ls.indexOf(l) > at) ?? cands[0]
    if (after) {
      subtitle = cased(after) ?? titleCaseFor(after, lang)
      source.subtitle = 'title page'
    }
  }

  // ---- publisher: the company named in the imprint ----
  let publisher = ''
  const copyLines = imprintLines.map((l, i) => (/[:]\s*$/.test(l) && imprintLines[i + 1] ? `${l} ${imprintLines[i + 1]}` : l))
  const companyOf = (line: string) => {
    const segs = line.replace(/^(d\.\s?r\.\s*)?©\s*(\d{4}\s*,?\s*)?/i, '').split(/[:;]|,(?!\s*(s\.|ltd|inc|llc|gmbh))/i).map((s) => (s ?? '').trim()).filter((s) => s && !/^\d{4}$/.test(s))
    // the last company named is the imprint ("© Distribuciones Alfaomega S.L., Arkano Books" → Arkano Books)
    const seg = [...segs].reverse().find((s) => COMPANY.test(s) && !/^(s\.|ltd|inc)/i.test(s) && !/derechos|rights|edici[óo]n|reserv/i.test(s))
    return seg?.replace(LEGAL_FORM, '').replace(LEGAL_FORM, '').trim() ?? ''
  }
  for (const l of copyLines.filter((l) => l.includes('©'))) if (!publisher) publisher = companyOf(l)
  if (!publisher) for (const l of copyLines) if (!publisher && l.length < 120 && !/apoya|supports|estimula|www\.|https?:/i.test(l)) publisher = companyOf(l)
  if (publisher) source.publisher = 'copyright page'

  const printIsbn = imprintLines.join('\n').match(/i\.?\s?s\.?\s?b\.?\s?n[^\d\n]*([\d][\d -]{9,16}[\dxX])/i)?.[1] ?? ''
  const copies = copyLines.filter((l) => l.includes('©')).map((l) => l.replace(/^d\.\s?r\.\s*/i, '').trim())
  const rights = (publisher && copies.find((l) => norm(l).includes(norm(publisher)))) || copies[0] || ''
  return { title, subtitle, author, publisher, rights, printIsbn, source }
}
