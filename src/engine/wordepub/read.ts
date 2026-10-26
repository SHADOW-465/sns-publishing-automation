// Word (.docx) → a book the EPUB builder can walk. Heading styles and outline levels decide the
// chapters; the book's own contents list decides which of those headings really start a chapter.
// Nothing here is named for one title: a style called Heading 1, Überschrift 1, or outline level 0
// is a heading in any manuscript.
import { unzip, text } from '../zip.ts'
import { languageFromBook } from '../lang.ts'
import { safeUrl } from '../indesign/inline.ts'
import { settings } from '../settings.ts'

export interface WordInline {
  t: 'text' | 'page' | 'br'
  text: string
  bold?: boolean
  italic?: boolean
  /** w:smallCaps, or a word the companion PDF drew as small caps */
  smallCaps?: boolean
  /** w:caps. Written with the same span as small caps (FLAGGED: Word all-caps is not always small caps). */
  caps?: boolean
  /** w:vertAlign superscript. w:position is ignored: a converted file uses it for noise of a few half-points. */
  sup?: boolean
  sub?: boolean
  /** external target or #bookmark */
  href?: string
  /** bookmark target, a safe XML id */
  id?: string
}

export interface WordPara {
  role: 'heading' | 'toc' | 'list' | 'body'
  /** heading level 1–6, or list indent level */
  level: number
  ordered: boolean
  /** join this paragraph onto the previous line instead of starting a new one */
  runOn: boolean
  inlines: WordInline[]
  text: string
}

export interface WordTable {
  role: 'table'
  /** a short bold line right above the table: its caption */
  caption?: string
  /** true when this row is a header (Word's header flag, or a first row that is entirely bold) */
  header: boolean[]
  rows: WordInline[][][]
  text: string
}

export interface WordImage {
  role: 'image'
  /** file name inside word/media, used to match a spec-sheet row */
  name: string
  data: Uint8Array
}

/** where the book's own contents list stood: the builder puts a linked contents page here */
export interface WordTocMark {
  role: 'tocmark'
}

export type WordBlock = WordPara | WordTable | WordImage | WordTocMark

/** One entry of the book's own contents list, wrapped lines joined, dot leaders and page number removed. */
export interface WordTocEntry {
  level: number
  text: string
}

export interface WordBook {
  title: string
  authors: string
  publisher: string
  language: string
  blocks: WordBlock[]
  /** normalised level-1 contents entries: a level-1 heading starts a chapter only when it is one of these */
  toc: string[]
  /** contents lines left out of the body, so the checker does not call them lost */
  tocLines: string[]
  /** every level of the contents list, in order */
  tocEntries: WordTocEntry[]
}

const HEADING = /(?:^|[^a-z])(?:heading|u?berschrift|titre|titulo|intestazione|kop|rubrik|encabezado|titolo)\s*(\d)/i
const TOC = /(?:^|[^a-z])(?:toc|inhaltsverzeichnis|tm)\s*(\d)/i
const RUN_ON = /run-?on|noindent|no-indent|continuation/i

const local = (el: Element) => el.localName || el.tagName.replace(/^.*:/, '')

function attr(el: Element | undefined, name: string): string {
  if (!el) return ''
  const direct = el.getAttribute(name) ?? el.getAttribute(`w:${name}`) ?? el.getAttribute(`r:${name}`)
  if (direct) return direct
  for (const a of Array.from(el.attributes)) if (a.localName === name || a.name === name) return a.value
  return ''
}

function child(el: Element, name: string): Element | undefined {
  return Array.from(el.children).find((c) => local(c) === name)
}

function kids(el: Element): Element[] {
  return Array.from(el.children)
}

/** "Capítulo 1. El método 12" and "1 El método" meet as the same contents entry. */
export function normTitle(s: string): string {
  return s
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\d+\s+/, '')
    .replace(/\s+\d+$/, '')
}

interface StyleInfo {
  name: string
  basedOn: string
  outline: string
}

function stylesOf(xml: string): Map<string, StyleInfo> {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const out = new Map<string, StyleInfo>()
  for (const el of Array.from(doc.getElementsByTagName('*')).filter((e) => local(e) === 'style')) {
    const id = attr(el, 'styleId')
    if (!id) continue
    const pPr = child(el, 'pPr')
    out.set(id, {
      name: attr(child(el, 'name'), 'val'),
      basedOn: attr(child(el, 'basedOn'), 'val'),
      outline: pPr ? attr(child(pPr, 'outlineLvl'), 'val') : '',
    })
  }
  return out
}

function styleFacts(styles: Map<string, StyleInfo>, styleId: string): { heading: number; toc: number; runOn: boolean; outline: string } {
  const names: string[] = []
  let outline = ''
  let id = styleId
  for (let guard = 0; id && guard < 6; guard++) {
    const s = styles.get(id)
    names.push(id)
    if (!s) break
    if (s.name) names.push(s.name)
    if (outline === '' && s.outline !== '') outline = s.outline
    id = s.basedOn
  }
  const blob = names.join(' ').toLocaleLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
  const toc = Number(TOC.exec(blob)?.[1] ?? 0)
  const fromName = Number(HEADING.exec(blob)?.[1] ?? 0)
  return { heading: toc ? 0 : fromName, toc, runOn: RUN_ON.test(blob), outline }
}

interface NumInfo {
  ordered: boolean
}

function numberingOf(xml: string): Map<string, Map<string, NumInfo>> {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const fmt = new Map<string, Map<string, NumInfo>>()
  for (const abs of Array.from(doc.getElementsByTagName('*')).filter((e) => local(e) === 'abstractNum')) {
    const id = attr(abs, 'abstractNumId')
    const levels = new Map<string, NumInfo>()
    for (const lvl of kids(abs).filter((e) => local(e) === 'lvl')) {
      const kind = attr(child(lvl, 'numFmt'), 'val').toLowerCase()
      levels.set(attr(lvl, 'ilvl') || '0', { ordered: kind !== '' && kind !== 'bullet' && kind !== 'none' })
    }
    fmt.set(id, levels)
  }
  const out = new Map<string, Map<string, NumInfo>>()
  for (const num of Array.from(doc.getElementsByTagName('*')).filter((e) => local(e) === 'num')) {
    const abs = fmt.get(attr(child(num, 'abstractNumId'), 'val'))
    if (abs) out.set(attr(num, 'numId'), abs)
  }
  return out
}

function fieldKind(instr: string): 'page' | 'skip' | 'keep' {
  const key = instr.trim().split(/\s+/)[0]?.replace(/^\\/, '').toUpperCase() ?? ''
  if (key === 'PAGE') return 'page'
  if (key === 'DATE' || key === 'TIME' || key === 'CREATEDATE' || key === 'SAVEDATE' || key === 'PRINTDATE') return 'skip'
  return 'keep'
}

function on(el: Element | undefined, inherited: boolean): boolean {
  if (!el) return inherited
  return !/^(0|false|off)$/i.test(attr(el, 'val') || 'true')
}

interface PageNos {
  /** A PAGE field result wins; otherwise the next unused number. */
  take: (explicit?: string) => string
}

function pageNos(): PageNos {
  let auto = 0
  const used = new Set<string>()
  return {
    take: (explicit?: string) => {
      const raw = explicit?.trim() ?? ''
      if (/^\d+$/.test(raw) && !used.has(raw)) {
        used.add(raw)
        auto = Math.max(auto, Number(raw))
        return raw
      }
      let n = ''
      do {
        auto += 1
        n = String(auto)
      } while (used.has(n))
      used.add(n)
      return n
    },
  }
}

interface Face {
  bold: boolean
  italic: boolean
  smallCaps: boolean
  caps: boolean
  sup: boolean
  sub: boolean
  href: string
}

const FACE: Face = { bold: false, italic: false, smallCaps: false, caps: false, sup: false, sub: false, href: '' }

/** A bookmark name as an XML id. `_GoBack` is Word's cursor and is not a target. */
export function wordAnchorId(name: string): string {
  if (!name || name === '_GoBack') return ''
  let id = name.replace(/[^\w.-]/g, '_')
  if (!/^[A-Za-z_]/.test(id)) id = `b_${id}`
  return id
}

function linkHref(target: string): string {
  let t = target.trim()
  try { t = decodeURIComponent(t) } catch { /* keep the raw target */ }
  if (!t) return ''
  if (/^(https?:|mailto:)/i.test(t)) return safeUrl(t)
  if (t.includes('@') && !/\s/.test(t)) return `mailto:${t}`
  if (/^www\./i.test(t)) return safeUrl(`https://${t}`)
  return t
}

/** Runs of one paragraph: text, and a page break as an inline marker rather than its own paragraph. */
function inlinesOf(p: Element, nos: PageNos, rels: Map<string, string>): WordInline[] {
  const out: WordInline[] = []
  let field: 'none' | 'unknown' | 'page' | 'skip' | 'keep' = 'none'
  let instr = ''
  let inResult = false
  let pagePending = false

  const flushPage = (explicit?: string) => {
    out.push({ t: 'page', text: nos.take(explicit) })
    pagePending = false
  }
  const emit = (s: string, face: Face) => {
    if (!s) return
    if (pagePending) flushPage()
    const prev = out[out.length - 1]
    const same = prev?.t === 'text' && !prev.id && !!prev.bold === face.bold && !!prev.italic === face.italic
      && !!prev.smallCaps === face.smallCaps && !!prev.caps === face.caps && !!prev.sup === face.sup && !!prev.sub === face.sub
      && (prev.href ?? '') === face.href
    if (same) {
      // each piece is already collapsed, so only the join can make a double space
      let add = s.replace(/[ \t\n\r]+/g, ' ')
      // a wrapped URL is split at the line: a hyphen on that boundary is not part of the address,
      // and one trailing space is the wrap ("planalto. " + "gov.br")
      const urlRun = /(?:https?:\/\/|www\.)\S*$/i.test(prev.text) || (/\/\S*$/.test(prev.text) && !/\s/.test(prev.text))
      if (urlRun && /[-\u2010\u2011]$/.test(prev.text) && /^[\p{L}\p{N}]/u.test(add) && !/\s/.test(add)) prev.text = prev.text.replace(/[-\u2010\u2011]$/, '')
      if (/https?:\/\/\S+ $/i.test(prev.text) && /^[\p{L}\p{N}]/u.test(add) && /[./]/.test(add) && !/\s/.test(add)) prev.text = prev.text.replace(/ $/, '')
      prev.text = prev.text.endsWith(' ') && add.startsWith(' ') ? prev.text + add.slice(1) : prev.text + add
    }
    else out.push({
      t: 'text', text: s.replace(/[ \t\n\r]+/g, ' '),
      bold: face.bold || undefined, italic: face.italic || undefined,
      smallCaps: face.smallCaps || undefined, caps: face.caps || undefined,
      sup: face.sup || undefined, sub: face.sub || undefined,
      href: face.href || undefined,
    })
  }

  const walk = (el: Element, face: Face) => {
    const name = local(el)
    if (name === 'bookmarkStart') {
      const id = wordAnchorId(attr(el, 'name'))
      if (id) out.push({ t: 'text', text: '', id })
      return
    }
    if (name === 'hyperlink') {
      const anchor = attr(el, 'anchor')
      const rid = attr(el, 'id')
      const href = anchor ? (wordAnchorId(anchor) ? `#${wordAnchorId(anchor)}` : '') : linkHref(rels.get(rid) ?? '')
      for (const c of kids(el)) walk(c, { ...face, href })
      return
    }
    if (name === 'pPr' || name === 'rPr' || name === 'bookmarkEnd' || name === 'proofErr' || name === 'commentRangeStart' || name === 'commentRangeEnd') {
      if (name === 'proofErr') for (const c of kids(el)) walk(c, face)
      return
    }
    if (name === 'instrText') {
      instr += el.textContent ?? ''
      return
    }
    if (name === 'br') {
      if (attr(el, 'type') === 'page') pagePending = true
      else if (out.length) out.push({ t: 'br', text: ' ' })
      return
    }
    if (name === 'lastRenderedPageBreak' || name === 'pageBreakBefore') {
      pagePending = true
      return
    }
    if (name === 'tab' || name === 'cr') {
      emit(' ', face)
      return
    }
    if (name === 'fldChar') {
      const t = attr(el, 'fldCharType')
      if (t === 'begin') {
        field = 'unknown'
        instr = ''
        inResult = false
      } else if (t === 'separate') {
        field = fieldKind(instr)
        inResult = true
      } else if (t === 'end') {
        field = 'none'
        inResult = false
        instr = ''
      }
      return
    }
    if (name === 'fldSimple') {
      const kind = fieldKind(attr(el, 'instr'))
      if (kind === 'skip') return
      if (kind === 'page') {
        if (pagePending) flushPage(plainText(el))
        return
      }
      for (const c of kids(el)) walk(c, face)
      return
    }
    if (name === 'r') {
      const rPr = child(el, 'rPr')
      const align = attr(rPr && child(rPr, 'vertAlign'), 'val')
      const next: Face = {
        bold: on(rPr && (child(rPr, 'b') ?? child(rPr, 'bCs')), face.bold),
        italic: on(rPr && (child(rPr, 'i') ?? child(rPr, 'iCs')), face.italic),
        smallCaps: on(rPr && child(rPr, 'smallCaps'), false),
        caps: on(rPr && child(rPr, 'caps'), false),
        sup: align === 'superscript',
        sub: align === 'subscript',
        href: face.href,
      }
      for (const c of kids(el)) walk(c, next)
      return
    }
    if (name === 't') {
      const s = el.textContent ?? ''
      if (field === 'skip' || (field === 'unknown' && !inResult)) return
      if (field === 'page') {
        if (pagePending) flushPage(s)
        return
      }
      emit(s, face)
      return
    }
    if (name === 'blip' || name === 'imagedata') return
    for (const c of kids(el)) walk(c, face)
  }

  const pPr = child(p, 'pPr')
  if (pPr && child(pPr, 'pageBreakBefore')) pagePending = true
  for (const c of kids(p)) if (local(c) !== 'pPr') walk(c, FACE)
  if (pagePending) flushPage()
  return joinSplitUrls(out)
}

/** A URL cut where a paragraph ends (a page break) goes on at the start of the paragraph that runs on from it:
 *  the rest of the address moves back into the link, without the line-end hyphen. */
function carryUrlOver(prev: WordInline[], next: WordInline[]): boolean {
  const a = prev[prev.length - 1]
  let k = 0
  while (k < next.length && next[k].t === 'page') k++
  const b = next[k]
  if (!a || a.t !== 'text' || !b || b.t !== 'text' || b.href || !(a.href || /(?:https?:\/\/|www\.)\S*$/i.test(a.text))) return false
  const hyphen = /[-\u2010\u2011]$/.test(a.text)
  const m = b.text.match(/^[\p{L}\p{N}./:?=&%#~_+-]+/u)
  if (!m || (!hyphen && !/[./?=&]/.test(m[0]))) return false
  if (hyphen) a.text = a.text.slice(0, -1)
  a.text += m[0]
  if (a.href) a.href = safeUrl(a.text.trim().replace(/[.,;)]+$/, ''))
  b.text = b.text.slice(m[0].length)
  if (!b.text) next.splice(k, 1)
  return true
}

/** A hyperlink that covers only the start of a URL, and a URL broken after a hyphen at a line end.
 * Word splits a wrapped URL into the next run with no break element: a hyphen at that boundary is the
 * line-end hyphen, and a single leading space is the wrap, not a new sentence. */
function joinSplitUrls(inlines: WordInline[]): WordInline[] {
  const urlChar = /^[\p{L}\p{N}./:?=&%#~_+-]+$/u
  // the next run of a wrapped URL, without the single wrap space. A space after "_" or "/" ("del_ Consejo") is the same wrap.
  const continuation = (raw: string): string => {
    let t = raw.startsWith(' ') && !raw.startsWith('  ') ? raw.slice(1) : raw
    t = t.replace(/([/_\-=?&.]) +(?=[\p{L}\p{N}_])/gu, '$1')
    return t.match(/^[\p{L}\p{N}./:?=&%#~_+-]+/u)?.[0] ?? ''
  }
  const out = [...inlines]
  for (let i = 0; i < out.length - 1; i++) {
    const a = out[i]
    const b = out[i + 1]
    if (a.t === 'text' && !a.href && /https?:\/\/\s*$/i.test(a.text) && b.t === 'text' && b.href && /^www\./i.test(b.text.trim())) {
      const m = a.text.match(/^(.*?)(https?:\/\/)\s*$/i)
      if (!m) continue
      b.text = `${m[2]}${b.text.trim()}`
      b.href = safeUrl(b.text.replace(/[.,;)]+$/, ''))
      if (m[1].trim()) a.text = m[1]
      else { out.splice(i, 1); i-- }
    }
  }
  for (let i = 0; i < out.length; i++) {
    const a = out[i]
    if (a.t !== 'text') continue
    const urlish = !!a.href || /https?:\/\/\S*\s?$/i.test(a.text)
    if (!urlish) continue
    let j = i + 1
    while (j < out.length && (out[j].t === 'br' || (out[j].t === 'text' && !out[j].href && out[j].text.trim() === ''))) j++
    const b = out[j]
    if (!b || b.t !== 'text' || (b.href && b.href !== a.href)) continue
    const gap = j > i + 1
    const tight = !gap && !/\s$/.test(a.text) && !/^\s/.test(b.text)
    if (b.href === a.href && (tight || gap)) {
      a.text += b.text
      out.splice(i + 1, j - i)
      i--
      continue
    }
    if (!/(https?:|www\.|\/)/i.test(a.text)) continue
    const leadSpace = !tight && !gap && /^ \S/u.test(b.text)
    const extra = continuation(leadSpace || /^\s/.test(b.text) ? b.text.replace(/^ +/, ' ') : b.text)
    if (!extra || !urlChar.test(extra)) continue
    const dotSpace = /https?:\/\/\S+ $/i.test(a.text)
    const hyphenBreak = /[-\u2010\u2011]$/.test(a.text.trimEnd())
    const urlTail = /[./?=&]|[\p{Ll}\p{Lu}]|\d.*\p{L}|\p{L}.*\d|^\d{3,}/u.test(extra)
    // a word with no whitespace after the URL ("Pickerill") is the next sentence, not the address
    if (!urlTail && !hyphenBreak) continue
    if (!tight && !leadSpace && !dotSpace && !gap) continue
    if ((gap || leadSpace || dotSpace) && /^\p{Lu}/u.test(extra) && !/\//.test(extra) && !hyphenBreak && !/\.[a-z]{2,}/i.test(extra)) continue
    if (/[-\u2010\u2011]$/.test(a.text.trimEnd()) && /^[\p{L}\p{N}]/u.test(extra)) a.text = a.text.replace(/[-\u2010\u2011](\s*)$/, '$1')
    if (dotSpace) a.text = a.text.replace(/ $/, '')
    a.text += extra
    const whole = a.text.trim().replace(/[.,;)]+$/, '')
    if (/^https?:\/\//i.test(whole)) a.href = safeUrl(whole)
    a.text = a.text.replace(/\/ +(?=[\p{L}\p{N}])/gu, '/')
    const collapsed = (b.text.startsWith(' ') && !b.text.startsWith('  ') ? b.text.slice(1) : b.text).replace(/([/_\-=?&.]) +(?=[\p{L}\p{N}_])/gu, '$1')
    const rest = collapsed.startsWith(extra) ? collapsed.slice(extra.length) : ''
    if (!rest.trim()) out.splice(i + 1, j - i)
    else {
      b.text = rest
      if (j > i + 1) out.splice(i + 1, j - i - 1)
    }
    i--
  }
  for (const a of out) {
    if (a.t !== 'text' || !(a.href || /https?:\/\//i.test(a.text))) continue
    a.text = a.text.replace(/\/ +(?=[\p{L}\p{N}])/gu, '/')
    if (a.href && /^https?:\/\//i.test(a.text.trim())) a.href = safeUrl(a.text.trim().replace(/[.,;)]+$/, ''))
  }
  return out
}

function plainText(el: Element): string {
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim()
}

function plainOf(inlines: WordInline[]): string {
  return inlines
    .filter((i) => i.t !== 'page')
    .map((i) => i.text)
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}

function blipIds(el: Element): string[] {
  const ids: string[] = []
  const walk = (n: Element) => {
    if (local(n) === 'blip' || local(n) === 'imagedata') {
      const id = attr(n, 'embed') || attr(n, 'id')
      if (id) ids.push(id)
    }
    for (const c of kids(n)) walk(c)
  }
  walk(el)
  return ids
}

/** A typed bullet at the start of a line. (A dash or asterisk is not one: dialogue and note marks begin that way.) */
const BULLET_GLYPH = /^\s*[•●◦▪■‣∙·○]\s*/

function splitAtBreaks(inlines: WordInline[]): WordInline[][] {
  const out: WordInline[][] = [[]]
  for (const i of inlines) {
    if (i.t === 'br') out.push([])
    else out[out.length - 1].push(i)
  }
  return out.filter((seg) => seg.length)
}

function withoutGlyph(inlines: WordInline[]): WordInline[] {
  const out = inlines.map((i) => ({ ...i }))
  const k = out.findIndex((i) => i.t === 'text' && i.text.trim())
  if (k >= 0) out[k].text = out[k].text.replace(BULLET_GLYPH, '')
  return out
}

const TOC_END = /(?:\s|\.{2,}|…+)\s*(\d{1,4}|[ivxlc]{1,6})\s*$/i

/** Contents lines to entries. A manuscript's contents often wraps one entry over several lines: the entry ends where the page number is. */
function tocEntriesOf(raw: { level: number; text: string }[]): WordTocEntry[] {
  const numbered = raw.filter((e) => TOC_END.test(e.text)).length * 2 >= raw.length
  const clean = (t: string) => t.replace(/[\s.…·]*(\d{1,4}|[ivxlc]{1,6})\s*$/i, '').replace(/\s+/g, ' ').trim()
  const out: WordTocEntry[] = []
  let open: { level: number; text: string } | undefined
  for (const e of raw) {
    if (!numbered) {
      out.push({ level: e.level, text: e.text })
      continue
    }
    open = open ? { level: open.level, text: `${open.text} ${e.text}` } : { ...e }
    if (TOC_END.test(e.text)) {
      out.push({ level: open.level, text: clean(open.text) })
      open = undefined
    }
  }
  if (open) out.push({ level: open.level, text: clean(open.text) })
  return out.filter((e) => e.text)
}

function cellInlines(tc: Element, nos: PageNos, rels: Map<string, string>): WordInline[] {
  const out: WordInline[] = []
  for (const p of kids(tc).filter((c) => local(c) === 'p')) {
    const part = inlinesOf(p, nos, rels)
    if (out.length && part.length) out.push({ t: 'text', text: ' ' })
    out.push(...part)
  }
  return out
}

function allBold(inlines: WordInline[]): boolean {
  const text = inlines.filter((i) => i.t === 'text' && i.text.trim())
  return text.length > 0 && text.every((i) => i.bold)
}

function dcText(doc: Document, name: string): string {
  for (const el of Array.from(doc.getElementsByTagName('*'))) {
    const dc = el.tagName.startsWith('dc:') || el.prefix === 'dc' || (el.namespaceURI ?? '').includes('purl.org/dc')
    if (dc && local(el) === name) return (el.textContent ?? '').replace(/\s+/g, ' ').trim()
  }
  return ''
}

function declaredLang(files: Map<string, Uint8Array>): string {
  for (const path of ['word/styles.xml', 'word/document.xml', 'word/settings.xml']) {
    const raw = files.get(path)
    if (!raw) continue
    const doc = new DOMParser().parseFromString(text(raw), 'application/xml')
    const langs = Array.from(doc.getElementsByTagName('*')).filter((e) => local(e) === 'lang')
    const preferred = langs.find((el) => {
      let p: Element | null = el
      while (p) {
        if (local(p) === 'docDefaults') return true
        p = p.parentElement
      }
      return false
    }) ?? langs[0]
    const v = attr(preferred, 'val')
    if (v) return v
  }
  return ''
}

function relTargets(xml: string): Map<string, string> {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const out = new Map<string, string>()
  for (const el of Array.from(doc.getElementsByTagName('*')).filter((e) => local(e) === 'Relationship')) {
    const id = el.getAttribute('Id') ?? attr(el, 'Id')
    const target = el.getAttribute('Target') ?? attr(el, 'Target')
    if (id && target) out.set(id, target)
  }
  return out
}

function mediaPath(target: string): string {
  const t = decodeURIComponent(target).replace(/\\/g, '/').replace(/^\//, '')
  if (t.startsWith('word/')) return t
  return `word/${t.replace(/^\.\//, '')}`
}

function bookHasPage(book: WordBook): boolean {
  const hit = (ins: WordInline[]) => ins.some((i) => i.t === 'page')
  return book.blocks.some((b) => b.role === 'table' ? b.rows.some((r) => r.some(hit)) : 'inlines' in b && hit(b.inlines))
}

/** Letters and digits, lower case, hyphenation undone. Shared by the page matcher and its tests. */
export function foldPageText(s: string): string {
  return s.toLocaleLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/(\p{L})-(\p{L})/gu, '$1$2').replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim()
}

interface StampSlot { inlines: WordInline[]; index: number; offset: number }

function pageStream(book: WordBook): { stream: string; map: StampSlot[] } {
  let stream = ''
  const map: StampSlot[] = []
  const add = (text: string, inlines: WordInline[], index: number) => {
    let pending = stream.length > 0 && !stream.endsWith(' ')
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]
      if ((ch === '-' || ch === '\u00ad') && /\p{L}/u.test(text[i - 1] ?? '') && /\p{L}/u.test(text[i + 1] ?? '')) continue
      let letter = ''
      for (const c of ch.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase()) if (/[\p{L}\p{N}]/u.test(c)) letter += c
      if (!letter) {
        if (stream.length) pending = true
        continue
      }
      if (pending && !stream.endsWith(' ')) {
        stream += ' '
        map.push({ inlines, index, offset: i })
        pending = false
      }
      for (const c of letter) {
        stream += c
        map.push({ inlines, index, offset: i })
      }
    }
  }
  for (const b of book.blocks) {
    if (b.role === 'table') {
      for (const row of b.rows) for (const cell of row) cell.forEach((inline, index) => { if (inline.t === 'text' && inline.text) add(inline.text, cell, index) })
    } else if ('inlines' in b) b.inlines.forEach((inline, index) => { if (inline.t === 'text' && inline.text) add(inline.text, b.inlines, index) })
  }
  return { stream, map }
}

function pageNeedles(text: string): string[] {
  const folded = foldPageText(text)
  if (folded.length < 24) return []
  // A running head, or a table of bare numbers, is not in the manuscript as the page's first words.
  // Windows of real words further down the page still land on that page. The first one that matches wins.
  const out: string[] = []
  const limit = Math.min(folded.length - 24, 900)
  for (let i = 0; i <= limit && out.length < 14; i += 12) {
    const n = folded.slice(i, i + 48).trim()
    if (n.length < 24) continue
    if ((n.match(/\p{L}/gu)?.length ?? 0) < 16) continue
    out.push(n)
  }
  return out
}

/**
 * When the manuscript has no page breaks, mark where each companion print page starts.
 * Search moves only forward, so a phrase that repeats (a contents line and the chapter) is used once.
 * Returns how many markers were inserted. A second call does nothing.
 */
export function stampPagesFromPdf(book: WordBook, pages: { n: string; text: string }[]): number {
  if (!settings().wordPagesFromPdf || bookHasPage(book)) return 0
  const { stream, map } = pageStream(book)
  if (!stream) return 0
  const hits: { at: number; n: string }[] = []
  const used = new Set<string>()
  let cursor = 0
  for (const p of pages) {
    if (!p.n || used.has(p.n)) continue
    // The earliest hit wins. The first window is often a running head whose next copy is many pages later;
    // a window further down the page is the text that actually follows the cursor.
    let found = -1
    for (const needle of pageNeedles(p.text)) {
      const at = stream.indexOf(needle, cursor)
      if (at >= 0 && (found < 0 || at < found)) found = at
    }
    // a hit many pages ahead is a repeated phrase, not this page: leave the cursor so later pages can still match
    if (found < 0 || found - cursor > 25000) continue
    hits.push({ at: found, n: p.n })
    used.add(p.n)
    cursor = found + 18
  }
  const placed = new Set<string>()
  for (const hit of hits.sort((a, b) => b.at - a.at)) {
    const slot = map[hit.at]
    if (!slot || placed.has(hit.n)) continue
    const inline = slot.inlines[slot.index]
    if (!inline || inline.t !== 'text') continue
    const before = inline.text.slice(0, slot.offset)
    const after = inline.text.slice(slot.offset)
    const parts: WordInline[] = []
    if (before) parts.push({ ...inline, text: before })
    parts.push({ t: 'page', text: hit.n })
    if (after) parts.push({ ...inline, text: after, id: before ? undefined : inline.id })
    slot.inlines.splice(slot.index, 1, ...parts)
    placed.add(hit.n)
  }
  return placed.size
}

const reEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Mark whole words the companion PDF drew as small caps. A word already marked is left alone,
 * and "uaem" does not match inside "uaemex". A second call changes nothing.
 */
export function markWordSmallCaps(book: WordBook, tokens: string[]): number {
  if (!settings().wordSmallCapsFromPdf) return 0
  const list = [...new Set(tokens.map((t) => t.toLocaleLowerCase()).filter((t) => t.length >= 2))].sort((a, b) => b.length - a.length)
  if (!list.length) return 0
  const re = new RegExp(`(?<![\\p{L}\\p{N}.])(${list.map(reEscape).join('|')})(?!\\p{L}|\\p{N}|\\.(?=\\p{L}))`, 'giu')
  let n = 0
  const split = (ins: WordInline[]) => {
    const next: WordInline[] = []
    for (const r of ins) {
      if (r.t !== 'text' || r.smallCaps || r.caps || !r.text) {
        next.push(r)
        continue
      }
      re.lastIndex = 0
      let cursor = 0
      let hit = false
      let m: RegExpExecArray | null
      while ((m = re.exec(r.text))) {
        hit = true
        if (m.index > cursor) next.push({ ...r, text: r.text.slice(cursor, m.index) })
        next.push({ ...r, text: m[1], smallCaps: true })
        n += 1
        cursor = m.index + m[1].length
        if (m.index === re.lastIndex) re.lastIndex += 1
      }
      if (!hit) next.push(r)
      else if (cursor < r.text.length) next.push({ ...r, text: r.text.slice(cursor), smallCaps: undefined })
    }
    ins.splice(0, ins.length, ...next)
  }
  for (const b of book.blocks) {
    if (b.role === 'table') for (const row of b.rows) for (const cell of row) split(cell)
    else if ('inlines' in b) split(b.inlines)
  }
  return n
}

/** How many runs ask for the small-caps span. The guard compares this with the spans in the e-book. */
export function smallCapsRunCount(book: WordBook): number {
  let n = 0
  const walk = (ins: WordInline[]) => { for (const i of ins) if (i.t === 'text' && (i.smallCaps || i.caps) && i.text.trim()) n += 1 }
  for (const b of book.blocks) {
    if (b.role === 'table') for (const row of b.rows) for (const cell of row) walk(cell)
    else if ('inlines' in b) walk(b.inlines)
  }
  return n
}

/** Read a .docx manuscript: paragraphs, lists, tables, pictures, and the contents entries that name the chapters. */
export function readWordBook(data: Uint8Array): WordBook {
  const files = unzip(data)
  const docBytes = files.get('word/document.xml')
  if (!docBytes) throw new Error('This is not a Word document (.docx).')
  const doc = new DOMParser().parseFromString(text(docBytes), 'application/xml')
  // body is a direct child. Indexing getElementsByTagName('*') is quadratic on a long manuscript.
  const body = Array.from(doc.documentElement?.children ?? []).find((e) => local(e) === 'body')
  if (!body) throw new Error('This Word document has no body.')
  const styles = files.get('word/styles.xml') ? stylesOf(text(files.get('word/styles.xml')!)) : new Map<string, StyleInfo>()
  const nums = files.get('word/numbering.xml') ? numberingOf(text(files.get('word/numbering.xml')!)) : new Map<string, Map<string, NumInfo>>()
  const rels = files.get('word/_rels/document.xml.rels') ? relTargets(text(files.get('word/_rels/document.xml.rels')!)) : new Map<string, string>()
  const nos = pageNos()
  const blocks: WordBlock[] = []
  const toc: string[] = []
  const tocLines: string[] = []
  const tocRaw: { level: number; text: string }[] = []
  let tocMarked = false
  let prevBody = ''

  const pushPara = (p: Element) => {
    for (const id of blipIds(p)) {
      const target = rels.get(id)
      const path = target ? mediaPath(target) : ''
      const bytes = path ? files.get(path) : undefined
      if (!bytes) continue
      const name = path.split('/').pop() || 'image'
      blocks.push({ role: 'image', name, data: bytes })
    }
    const pPr = child(p, 'pPr')
    const styleId = attr(pPr && child(pPr, 'pStyle'), 'val')
    const facts = styleFacts(styles, styleId)
    const paraOutline = attr(pPr && child(pPr, 'outlineLvl'), 'val')
    const numPr = pPr ? child(pPr, 'numPr') : undefined
    const ilvl = attr(numPr && child(numPr, 'ilvl'), 'val') || '0'
    const numId = attr(numPr && child(numPr, 'numId'), 'val')
    const inlines = inlinesOf(p, nos, rels)
    let plain = plainOf(inlines)
    const hasPage = inlines.some((i) => i.t === 'page')
    if (!plain && !hasPage) return
    const tocLevel = facts.toc
    if (tocLevel === 1 && plain) toc.push(normTitle(plain))
    if (tocLevel > 0) {
      if (plain) (tocLines.push(plain), tocRaw.push({ level: tocLevel, text: plain }))
      if (!tocMarked) (blocks.push({ role: 'tocmark' }), (tocMarked = true))
      return
    }
    const heading = facts.heading || (paraOutline !== '' && Number(paraOutline) >= 0 && Number(paraOutline) <= 5 ? Number(paraOutline) + 1 : 0)
    let role: WordPara['role'] = 'body'
    let level = 0
    let ordered = false
    if (heading >= 1 && heading <= 6 && plain) {
      role = 'heading'
      level = heading
    } else if (numId && numId !== '0') {
      role = 'list'
      level = Number(ilvl) || 0
      ordered = nums.get(numId)?.get(ilvl)?.ordered ?? false
    }
    // lines typed with their own bullet, joined by line breaks or one paragraph each, are a list
    if (role === 'body') {
      const segs = splitAtBreaks(inlines)
      if (segs.some((seg) => BULLET_GLYPH.test(plainOf(seg)))) {
        for (const seg of segs) {
          const t = plainOf(seg)
          if (BULLET_GLYPH.test(t)) {
            const item = withoutGlyph(seg)
            blocks.push({ role: 'list', level: 0, ordered: false, runOn: false, inlines: item, text: plainOf(item) })
          } else if (t || seg.some((i) => i.t === 'page')) blocks.push({ role: 'body', level: 0, ordered: false, runOn: false, inlines: seg, text: t })
        }
        prevBody = ''
        return
      }
    }
    const styleRun = facts.runOn
    const startsLower = /^\p{Ll}/u.test(plain)
    const prevOpen = !!prevBody && !/[.!?…:;]$/.test(prevBody)
    const runOn = role === 'body' && (styleRun || (startsLower && prevOpen) || (!plain && hasPage))
    if (runOn) {
      const before = blocks[blocks.length - 1]
      if (before?.role === 'body' && carryUrlOver(before.inlines, inlines)) {
        before.text = plainOf(before.inlines)
        plain = plainOf(inlines)
        if (!inlines.length) return
      }
    }
    blocks.push({ role, level, ordered, runOn, inlines, text: plain })
    if (role === 'body' && plain) prevBody = plain
    if (role === 'heading') prevBody = ''
  }

  let lastPara: WordBlock | undefined
  for (const el of kids(body)) {
    const name = local(el)
    if (name === 'p') (pushPara(el), (lastPara = blocks[blocks.length - 1]))
    else if (name === 'tbl') {
      const rows: WordInline[][][] = []
      const header: boolean[] = []
      const shaded: boolean[] = []
      for (const tr of kids(el).filter((c) => local(c) === 'tr')) {
        const tcs = kids(tr).filter((c) => local(c) === 'tc')
        const cells = tcs.map((tc) => cellInlines(tc, nos, rels))
        const flagged = !!child(child(tr, 'trPr') ?? tr, 'tblHeader')
        rows.push(cells)
        header.push(flagged)
        shaded.push(tcs.length > 0 && tcs.every((tc) => { const f = attr(child(child(tc, 'tcPr') ?? tc, 'shd'), 'fill').toLowerCase(); return !!f && f !== 'auto' && f !== 'ffffff' }))
      }
      // a header row: Word's flag, a first row that is all bold, or a shaded first row above unshaded ones
      if (rows.length && !header.some(Boolean) && (rows[0].every(allBold) || (shaded[0] && !shaded[1]))) header[0] = true
      // a short bold line directly above the table is its caption
      let caption = ''
      const last = blocks[blocks.length - 1]
      if (last && last.role === 'body' && lastPara === last && allBold(last.inlines) && last.text.length <= 120 && !/[.:;!?]$/.test(last.text)) {
        caption = last.text
        blocks.pop()
      }
      const text = [caption, ...rows.map((r) => r.map(plainOf).join(' '))].filter(Boolean).join('\n')
      if (text.trim()) blocks.push({ role: 'table', caption: caption || undefined, header, rows, text })
    }
  }

  const core = files.get('docProps/core.xml')
  const coreDoc = core ? new DOMParser().parseFromString(text(core), 'application/xml') : undefined
  const firstHeading = blocks.find((b): b is WordPara => b.role === 'heading')?.text ?? ''
  const spoken = blocks.map((b) => (b.role === 'image' || b.role === 'tocmark' ? '' : b.text)).join('\n')
  return {
    title: (coreDoc && dcText(coreDoc, 'title')) || firstHeading,
    authors: coreDoc ? dcText(coreDoc, 'creator') : '',
    publisher: coreDoc ? dcText(coreDoc, 'publisher') : '',
    language: languageFromBook(declaredLang(files), spoken),
    blocks,
    toc,
    tocLines,
    tocEntries: tocEntriesOf(tocRaw),
  }
}
