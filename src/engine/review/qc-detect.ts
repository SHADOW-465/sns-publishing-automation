// Small read-only detectors for the Review page: things a QC checker looks for that the quality check does not say yet.
// They only READ the finished EPUB. Nothing here changes book text; each finding names the file and the nearest printed page so
// the screen can open the preview at that spot. Rule ids are the rulebook's (TXT-006, TXT-010, IDX-001, IDX-002, PGM-001, SEM-005, DOC-012).
import { text, type Files } from '../zip.ts'
import { expandPageEnd } from '../pdfua/indexlinks.ts'

export type QcHeadingKey = 'text' | 'formatting' | 'structure' | 'order' | 'navigation' | 'images' | 'metadata'

export interface QcItem {
  id: string
  level: 'error' | 'warn'
  heading: QcHeadingKey
  /** the sub-group inside a heading: "Index links", "Contents entries not linked" … */
  kind: string
  rule?: string
  msg: string
  /** path relative to the EPUB's content folder (what Preview takes) */
  file?: string
  /** id of an element in that file to scroll to */
  anchor?: string
  /** printed page the spot is on */
  page?: string
  source: string
}

const MARKER = /<(?:span|div|a)\b[^>]*>/g
const idOf = (tag: string) => tag.match(/\bid="([^"]*)"/)?.[1]
const isMarker = (tag: string) => /pagebreak/.test(tag) || /\bid="(?:page-|Page_|pg_)[^"]+"/.test(tag)
const pageOfId = (id: string) => id.replace(/^(?:page-|Page_|pg_)/, '')
const textOf = (s: string) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
const snip = (s: string, n = 40) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

interface Mark { at: number; id?: string; page?: string }
interface Doc { path: string; file: string; html: string; marks: Mark[] }

/** The nearest page marker before an offset. */
function pageAt(d: Doc, at: number): { anchor?: string; page?: string } {
  let lo = 0
  let hi = d.marks.length - 1
  let best = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (d.marks[mid].at <= at) { best = mid; lo = mid + 1 } else hi = mid - 1
  }
  const m = d.marks[best]
  return m?.id ? { anchor: m.id, page: m.page } : {}
}

function docsOf(files: Files, base: string): Doc[] {
  const out: Doc[] = []
  for (const [path, data] of files) {
    if (!path.endsWith('.xhtml')) continue
    const html = text(data)
    const marks: Mark[] = []
    for (const m of html.matchAll(MARKER)) {
      if (!isMarker(m[0])) continue
      const id = idOf(m[0])
      marks.push({ at: m.index ?? 0, id, page: id ? pageOfId(id) : m[0].match(/aria-label="([^"]*)"/)?.[1] })
    }
    out.push({ path, file: path.startsWith(base) ? path.slice(base.length) : path, html, marks })
  }
  return out
}

const isNavDoc = (d: Doc) => /^(nav|toc)\.xhtml$/.test(d.file.split('/').pop() ?? '')
const isIndexDoc = (d: Doc) => /epub:type="[^"]*\bindex\b|role="doc-index"/.test(d.html.slice(0, 3000)) || /(^|\/)index[^/]*\.xhtml$/i.test(d.file)

/** All detectors, in one pass over the package. */
export function detectQc(files: Files, base = 'OEBPS/'): QcItem[] {
  const docs = docsOf(files, base)
  const out: QcItem[] = []
  const n = new Map<string, number>()
  const add = (i: Omit<QcItem, 'id'>) => out.push({ ...i, id: `${i.rule ?? i.kind}|${i.file ?? ''}|${n.set(i.kind, (n.get(i.kind) ?? 0) + 1).get(i.kind)}` })
  const pageHome = new Map<string, { file: string; id: string }>() // printed page → the first marker that carries it
  for (const d of docs) for (const m of d.marks) if (m.page && m.id && !pageHome.has(m.page)) pageHome.set(m.page, { file: d.file, id: m.id })

  for (const d of docs) {
    const body = isNavDoc(d) ? '' : d.html
    formatting(d, body, add)
    markersWithoutId(d, add)
    if (isIndexDoc(d)) indexLinks(d, pageHome, add)
  }
  hyphens(docs.filter((d) => !isNavDoc(d) && !isIndexDoc(d)), add)
  noteLinks(docs, add)
  navOrder(files, docs, base, add)
  return out
}

type Add = (i: Omit<QcItem, 'id'>) => void

// ------------------------------------------------------------------ Formatting: italic, bold, bold-italic (TXT-006)
function formatting(d: Doc, html: string, add: Add) {
  if (!html) return
  for (const m of html.matchAll(/<(em|i|strong|b)\b[^>]*>([\s\S]*?)<\/\1>/g)) {
    const at = m.index ?? 0
    const inner = m[2]
    const plain = textOf(inner)
    const tag = m[1]
    const style = /^(em|i)$/.test(tag) ? 'italic' : 'bold'
    const both = style === 'bold' ? /<(?:em|i)\b/.test(inner) || /<(?:em|i)\b[^>]*>$/.test(html.slice(Math.max(0, at - 40), at)) : /<(?:strong|b)\b/.test(inner) || /<(?:strong|b)\b[^>]*>$/.test(html.slice(Math.max(0, at - 40), at))
    const kind = both ? 'bold-italic' : style
    const where = pageAt(d, at)
    const base = { level: 'warn' as const, heading: 'formatting' as const, rule: 'TXT-006', file: d.file, ...where, source: 'Formatting check' }
    const end = at + m[0].length
    const before = html[at - 1] ?? ''
    const after = html[end] ?? ''
    if (!/[\p{L}\p{N}]/u.test(plain)) {
      add({ ...base, kind: 'Styled runs with no letters', msg: `A ${kind} run holds only ${plain ? `“${plain}”` : 'nothing'}: a stray style on a space or a mark.` })
      continue
    }
    if (/\p{L}/u.test(before) && /^\p{L}/u.test(plain)) add({ ...base, kind: 'Styles that start inside a word', msg: `${kind[0].toUpperCase() + kind.slice(1)} starts inside a word: “${before}${snip(plain, 24)}”. Is the whole word meant to be ${kind}?` })
    else if (/\p{L}/u.test(after) && /\p{L}$/u.test(plain)) add({ ...base, kind: 'Styles that stop inside a word', msg: `${kind[0].toUpperCase() + kind.slice(1)} stops inside a word: “${snip(plain, 24)}${after}”. Is the whole word meant to be ${kind}?` })
    const next = html.slice(end, end + 80).match(/^\s?<(em|i|strong|b)\b[^>]*>/)
    if (next && next[1] === tag) add({ ...base, kind: 'Split runs', msg: `One ${kind} passage is split in two: “${snip(plain, 24)}” and the run after it.` })
  }
}

// ------------------------------------------------------------------ Page IDs (PGM-001)
function markersWithoutId(d: Doc, add: Add) {
  for (const m of d.html.matchAll(MARKER)) {
    if (!/epub:type="pagebreak"|role="doc-pagebreak"/.test(m[0]) || idOf(m[0])) continue
    const label = m[0].match(/aria-label="([^"]*)"/)?.[1] ?? m[0].match(/title="([^"]*)"/)?.[1]
    add({ level: 'error', heading: 'navigation', kind: 'Page markers with no ID', rule: 'PGM-001', msg: `A page marker${label ? ` (“${label}”)` : ''} has no ID, so nothing can link to its page.`, file: d.file, ...pageAt(d, m.index ?? 0), source: 'Page check' })
  }
}

// ------------------------------------------------------------------ Index links (IDX-001, IDX-002)
const LINK = /<a\b([^>]*)>([\s\S]*?)<\/a>/g
const hrefPage = (attrs: string) => attrs.match(/href="[^"]*#(?:page-|Page_|pg_|pg:)([^"]+)"/)?.[1]

function indexLinks(d: Doc, pageHome: Map<string, { file: string; id: string }>, add: Add) {
  for (const p of d.html.matchAll(/<(p|li)\b[^>]*>([\s\S]*?)<\/\1>/g)) {
    const para = p[2]
    const at = p.index ?? 0
    const entry = snip(textOf(para.replace(/<a\b[\s\S]*?<\/a>/g, '')).replace(/[,;\s]+$/, '') || textOf(para), 40)
    const here = { file: d.file, ...pageAt(d, at) }
    const err = { level: 'error' as const, heading: 'navigation' as const, source: 'Index check', ...here }
    for (const a of para.matchAll(LINK)) if (!textOf(a[2])) add({ ...err, kind: 'Index links with no text', rule: 'IDX-001', msg: `Index entry “${entry}” has a link with no link text.` })
    // 174-8 : the end is plain text
    for (const m of para.matchAll(/<a\b([^>]*)>(\d{1,4})<\/a>\s*[–—-]\s*(\d{1,4})\b/g)) {
      if (!hrefPage(m[1])) continue
      add({ ...err, level: 'warn', kind: 'Range ends not linked', rule: 'IDX-002', msg: `Index entry “${entry}”: the range ${m[2]}-${m[3]} links ${m[2]} but not ${m[3]} (page ${expandPageEnd(Number(m[2]), m[3])}).` })
    }
    // bare locators: ", 305" after the links were taken out
    const bare = textOf(para.replace(/<a\b[\s\S]*?<\/a>/g, '\u0001')).match(/[,;]\s*(\d{1,4})(?:\s*[–—-]\s*\d{1,4})?\s*(?=[,;]|$)/)
    if (bare && /<a\b/.test(para)) add({ ...err, level: 'warn', kind: 'Page numbers not linked', rule: 'IDX-001', msg: `Index entry “${entry}” has a page number that is not a link: ${bare[1]}.` })
    // each link must reach the page it prints
    const links = [...para.matchAll(LINK)].map((a) => ({ attrs: a[1], t: textOf(a[2]), end: (a.index ?? 0) + a[0].length, start: a.index ?? 0 }))
    links.forEach((l, i) => {
      const target = hrefPage(l.attrs)
      if (!target || !/^\d+$/.test(l.t)) return
      const prev = links[i - 1]
      const rangeEnd = !!prev && /^\s*[–—-]\s*$/.test(para.slice(prev.end, l.start)) && /^\d+$/.test(prev.t)
      const want = rangeEnd && l.t.length <= prev.t.length && !(l.t.length === prev.t.length && !l.t.startsWith('0')) ? String(expandPageEnd(Number(prev.t), l.t)) : l.t
      if (target === want) return
      if (rangeEnd && Number(target) < Number(prev.t)) return // the guard already says this one
      const text = rangeEnd ? `${prev.t}-${l.t}` : l.t
      if (pageHome.has(want)) add({ ...err, kind: 'Index links to the wrong page', rule: 'IDX-002', msg: `Index entry “${entry}”: ${rangeEnd ? `the end of ${text}` : text} should link to page ${want} but links to page ${target}.` })
      else add({ ...err, level: 'warn', kind: 'Index links that fall back', rule: 'IDX-002', msg: `Index entry “${entry}”: page ${want} has no marker in the book, so ${rangeEnd ? `the end of ${text}` : text} falls back to page ${target}.` })
    })
  }
}

// ------------------------------------------------------------------ Hyphens kept vs unsure (TXT-010)
function hyphens(docs: Doc[], add: Add) {
  const words = new Set<string>()
  const hy = new Map<string, { d: Doc; at: number; n: number; shown: string }>()
  for (const d of docs) {
    let soft = 0
    let firstSoft = -1
    for (const t of d.html.matchAll(/>([^<>]+)</g)) {
      const s = t[1]
      const at = (t.index ?? 0) + 1
      if (s.includes('­')) { soft += s.split('­').length - 1; if (firstSoft < 0) firstSoft = at }
      for (const w of s.replace(/­/g, '').matchAll(/\p{L}+(?:-\p{L}+)?/gu)) {
        const k = w[0].toLowerCase()
        if (!k.includes('-')) { words.add(k); continue }
        const cur = hy.get(k)
        if (cur) cur.n++
        else hy.set(k, { d, at: at + (w.index ?? 0), n: 1, shown: w[0] })
      }
      // a line-end hyphen the build left in the middle of a paragraph: "recon- figura"
      const left = s.match(/\p{Ll}{2,}-\s+\p{Ll}{2,}/u)
      if (left) add({ level: 'warn', heading: 'text', kind: 'Line-end hyphens left in the text', rule: 'TXT-010', msg: `A line-end hyphen is still in the text: “${left[0].replace(/\s+/g, ' ')}”.`, file: d.file, ...pageAt(d, at), source: 'Hyphen check' })
    }
    if (soft) add({ level: 'warn', heading: 'text', kind: 'Soft hyphens', rule: 'TXT-010', msg: `${soft} soft hyphen${soft === 1 ? '' : 's'} (invisible, from InDesign) in this file. The rule says there are none.`, file: d.file, ...pageAt(d, firstSoft), source: 'Hyphen check' })
  }
  for (const [k, v] of hy) {
    const joined = k.replace('-', '')
    if (!words.has(joined)) continue // hyphen kept, and only ever written that way: fine
    add({ level: 'warn', heading: 'text', kind: 'Hyphens: kept in one place, joined in another', rule: 'TXT-010', msg: `“${v.shown}” is hyphenated ${v.n} time${v.n === 1 ? '' : 's'} but also written “${joined}”. Which does the book use?`, file: v.d.file, ...pageAt(v.d, v.at), source: 'Hyphen check' })
  }
}

// ------------------------------------------------------------------ Footnote links (SEM-005)
function noteLinks(docs: Doc[], add: Add) {
  const ids = new Map<string, Set<string>>()
  for (const d of docs) ids.set(d.file.split('/').pop()!, new Set([...d.html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1])))
  const called = new Set<string>()
  for (const d of docs) {
    for (const m of d.html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)) {
      if (!/noteref/.test(m[1])) continue
      const href = m[1].match(/href="([^"]*)"/)?.[1] ?? ''
      const [f, id = ''] = href.split('#')
      const file = f ? f.split('/').pop()! : d.file.split('/').pop()!
      called.add(`${file}#${id}`)
      const mark = textOf(m[2])
      if (!id || !ids.get(file)?.has(id)) add({ level: 'error', heading: 'navigation', kind: 'Note calls with no note', rule: 'SEM-005', msg: `Note call ${mark ? `“${mark}” ` : ''}points to ${href || 'nothing'}, which is not in the book.`, file: d.file, ...pageAt(d, m.index ?? 0), source: 'Note check' })
    }
  }
  for (const d of docs) {
    for (const m of d.html.matchAll(/<(?:aside|li|div|p)\b[^>]*\b(?:epub:type|role)="[^"]*(?:footnote|endnote)[^"]*"[^>]*>/g)) {
      const id = idOf(m[0])
      if (id && !called.has(`${d.file.split('/').pop()}#${id}`)) add({ level: 'warn', heading: 'navigation', kind: 'Notes nothing calls', rule: 'SEM-005', msg: `Note “${id}” has no note call in the text.`, file: d.file, anchor: id, ...pageAt(d, m.index ?? 0), source: 'Note check' })
    }
  }
}

// ------------------------------------------------------------------ Reading order: the menu against the spine (DOC-012)
function navOrder(files: Files, docs: Doc[], base: string, add: Add) {
  const opfPath = text(files.get('META-INF/container.xml') ?? new Uint8Array()).match(/full-path="([^"]+)"/)?.[1]
  if (!opfPath || !files.has(opfPath)) return
  const opf = text(files.get(opfPath)!)
  const manifest = new Map([...opf.matchAll(/<item\b[^>]*>/g)].map((m) => [m[0].match(/\bid="([^"]*)"/)?.[1] ?? '', m[0].match(/\bhref="([^"]*)"/)?.[1] ?? '']))
  const order = [...opf.matchAll(/<itemref\b[^>]*idref="([^"]*)"/g)].map((m) => (manifest.get(m[1]) ?? '').split('/').pop()!)
  const nav = docs.find((d) => /<nav\b[^>]*epub:type="toc"/.test(d.html))
  if (!nav) return
  const seq = [...(nav.html.match(/<nav\b[^>]*epub:type="toc"[\s\S]*?<\/nav>/)?.[0] ?? '').matchAll(/<a\b[^>]*href="([^"#]*)(?:#[^"]*)?"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => ({ f: m[1].split('/').pop()!, t: textOf(m[2]) }))
  let last = -1
  let lastT = ''
  let shown = 0
  for (const s of seq) {
    const at = order.indexOf(s.f)
    if (at < 0) continue
    if (at < last && shown++ < 20) add({ level: 'warn', heading: 'order', kind: 'Menu and reading order disagree', rule: 'DOC-012', msg: `The menu lists “${snip(s.t, 50)}” after “${snip(lastT, 50)}”, but the reading order has it earlier.`, file: s.f, source: 'Reading order check' })
    else if (at >= last) { last = at; lastT = s.t }
  }
}
