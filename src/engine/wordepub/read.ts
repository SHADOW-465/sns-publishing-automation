// Word (.docx) → a book the EPUB builder can walk. Heading styles and outline levels decide the
// chapters; the book's own contents list decides which of those headings really start a chapter.
// Nothing here is named for one title: a style called Heading 1, Überschrift 1, or outline level 0
// is a heading in any manuscript.
import { unzip, text } from '../zip.ts'
import { languageFromBook } from '../lang.ts'

export interface WordInline {
  t: 'text' | 'page' | 'br'
  text: string
  bold?: boolean
  italic?: boolean
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

/** Runs of one paragraph: text, and a page break as an inline marker rather than its own paragraph. */
function inlinesOf(p: Element, nos: PageNos): WordInline[] {
  const out: WordInline[] = []
  let field: 'none' | 'unknown' | 'page' | 'skip' | 'keep' = 'none'
  let instr = ''
  let inResult = false
  let pagePending = false

  const flushPage = (explicit?: string) => {
    out.push({ t: 'page', text: nos.take(explicit) })
    pagePending = false
  }
  const emit = (s: string, bold: boolean, italic: boolean) => {
    if (!s) return
    if (pagePending) flushPage()
    const prev = out[out.length - 1]
    if (prev?.t === 'text' && !!prev.bold === bold && !!prev.italic === italic) prev.text = (prev.text + s).replace(/[ \t\n\r]+/g, ' ')
    else out.push({ t: 'text', text: s.replace(/[ \t\n\r]+/g, ' '), bold, italic })
  }

  const walk = (el: Element, bold: boolean, italic: boolean) => {
    const name = local(el)
    if (name === 'pPr' || name === 'rPr' || name === 'bookmarkStart' || name === 'bookmarkEnd' || name === 'proofErr' || name === 'commentRangeStart' || name === 'commentRangeEnd') {
      if (name === 'proofErr') for (const c of kids(el)) walk(c, bold, italic)
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
      emit(' ', bold, italic)
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
      for (const c of kids(el)) walk(c, bold, italic)
      return
    }
    if (name === 'r') {
      const rPr = child(el, 'rPr')
      const b = on(rPr && (child(rPr, 'b') ?? child(rPr, 'bCs')), bold)
      const i = on(rPr && (child(rPr, 'i') ?? child(rPr, 'iCs')), italic)
      for (const c of kids(el)) walk(c, b, i)
      return
    }
    if (name === 't') {
      const s = el.textContent ?? ''
      if (field === 'skip' || (field === 'unknown' && !inResult)) return
      if (field === 'page') {
        if (pagePending) flushPage(s)
        return
      }
      emit(s, bold, italic)
      return
    }
    if (name === 'blip' || name === 'imagedata') return
    for (const c of kids(el)) walk(c, bold, italic)
  }

  const pPr = child(p, 'pPr')
  if (pPr && child(pPr, 'pageBreakBefore')) pagePending = true
  for (const c of kids(p)) if (local(c) !== 'pPr') walk(c, false, false)
  if (pagePending) flushPage()
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

function cellInlines(tc: Element, nos: PageNos): WordInline[] {
  const out: WordInline[] = []
  for (const p of kids(tc).filter((c) => local(c) === 'p')) {
    const part = inlinesOf(p, nos)
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

/** Read a .docx manuscript: paragraphs, lists, tables, pictures, and the contents entries that name the chapters. */
export function readWordBook(data: Uint8Array): WordBook {
  const files = unzip(data)
  const docBytes = files.get('word/document.xml')
  if (!docBytes) throw new Error('This is not a Word document (.docx).')
  const doc = new DOMParser().parseFromString(text(docBytes), 'application/xml')
  const body = Array.from(doc.getElementsByTagName('*')).find((e) => local(e) === 'body')
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
    const inlines = inlinesOf(p, nos)
    const plain = plainOf(inlines)
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
        const cells = tcs.map((tc) => cellInlines(tc, nos))
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
