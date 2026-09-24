import { type Face, type StyleSheet } from './css.ts'
import { classesOf, esc, epubType, pageBreakOf, tag } from '../xml.ts'

// Converts one InDesign paragraph into clean inline XHTML — the "remove unnecessary italic/bold"
// work the production team used to do by hand:
//  * font-only overrides (CharOverride-N that just repeat the body font) disappear
//  * real formatting becomes semantic classes: italic, bold, bold-italic, nori, underline, sup/sub
//  * small caps are emulated like the house style: capitals stay, lowercase runs are uppercased
//    inside <span class="small-caps"> (reading systems render font-variant unreliably)
//  * words InDesign split across spans (ligatures: "recon|fi|gura") are merged back
//  * empty/placeholder links get a real href, bare URLs and e-mails become links
//  * page markers and footnote references are rewritten to EPUB 3 accessibility patterns

export interface InlineCtx {
  css: StyleSheet
  lang: string
  /** markup for a page marker (and registers the page for the page-list) */
  pageMarker: (n: string) => string
  /** markup for a footnote reference (and registers the footnote with the current section) */
  noteRef: (footnoteId: string) => string
}

export interface InlineOpts {
  heading?: boolean // line breaks become spaces
  stripBullet?: boolean
  stripPageNumber?: boolean
  /** start from this face instead of the paragraph's own (used for table cells) */
  base?: Face
}

type Seg =
  | { k: 't'; text: string; face: Face; href?: string }
  | { k: 'br' }
  | { k: 'raw'; html: string }

export function inlineHtml(p: Element, ctx: InlineCtx, opts: InlineOpts = {}): string {
  const base = opts.base ?? ctx.css.paragraphFace(classesOf(p))
  const segs: Seg[] = []
  const walk = (el: Element, face: Face, href?: string) => {
    for (const n of Array.from(el.childNodes)) {
      if (n.nodeType === 3) {
        segs.push({ k: 't', text: n.textContent ?? '', face, href })
        continue
      }
      if (n.nodeType !== 1) continue
      const c = n as Element
      const pb = pageBreakOf(c)
      if (pb !== null) {
        segs.push({ k: 'raw', html: ctx.pageMarker(pb) })
        continue
      }
      const tg = tag(c)
      if (tg === 'br') segs.push({ k: 'br' })
      else if (tg === 'a' && isNoteRef(c)) segs.push({ k: 'raw', html: ctx.noteRef((c.getAttribute('href') ?? '').split('#')[1] ?? '') })
      else if (tg === 'a') walk(c, face, normalizeHref(c.getAttribute('href') ?? '', c.textContent ?? ''))
      else if (tg === 'img') continue
      else walk(c, ctx.css.spanFace(classesOf(c), face), href)
    }
  }
  walk(p, { ...base, dropcap: false })

  if (opts.stripBullet) stripLeading(segs, /^[\s•●◦▪■·–—-]*\t\s*|^\s*[•●◦▪■·]\s*/)
  if (opts.stripPageNumber) stripTrailing(segs, /\s*\t[\s\t]*(\d+|[ivxlcdm]+)\s*$/i)

  // normalise whitespace: tabs → space, collapse runs, trim the paragraph ends
  for (const s of segs) if (s.k === 't') s.text = s.text.replace(/[\t ]+/g, ' ')
  stripLeading(segs, /^\s+/)
  stripTrailing(segs, /\s+$/)

  return render(autolink(merge(segs)), base, ctx.lang, !!opts.heading)
}

/** Plain text as a reader sees it, for navigation labels: a lone lowercase word in small caps is an
 *  acronym typed in lowercase ("unam" → "UNAM"); other small caps keep their spelling ("Capítulo"). */
export function inlineText(p: Element, css: StyleSheet, lang: string): string {
  let out = ''
  const walk = (el: Element, face: Face) => {
    for (const n of Array.from(el.childNodes)) {
      if (n.nodeType === 3) {
        const t = (n.textContent ?? '').replace(/­/g, '')
        out += face.upper || (face.smallCaps && /^\s*\p{Ll}{2,6}\s*$/u.test(t)) ? t.toLocaleUpperCase(lang) : t
      } else if (n.nodeType === 1) {
        const c = n as Element
        if (pageBreakOf(c) !== null || isNoteRef(c)) continue
        if (tag(c) === 'br') out += ' '
        else walk(c, css.spanFace(classesOf(c), face))
      }
    }
  }
  walk(p, css.paragraphFace(classesOf(p)))
  return out.replace(/\s+/g, ' ').trim()
}

const isNoteRef = (a: Element) =>
  epubType(a) === 'noteref' || a.getAttribute('role') === 'doc-noteref' || classesOf(a).includes('_idFootnoteLink')

const URLISH = /^(https?:\/\/|www\.)/i
const EMAIL = /^[\w.+-]+@[\w-]+(\.[\w-]+)+$/

export function normalizeHref(href: string, text: string): string | undefined {
  const t = text.trim()
  if (href && /^(https?:|mailto:)/i.test(href)) return href
  if (href && href.includes('#') && !href.startsWith('#')) return 'xref:' + href.split('#')[1] // resolved by the builder
  if (href.startsWith('#') && href.length > 1) return 'xref:' + href.slice(1)
  if (URLISH.test(t)) return t.startsWith('www.') ? 'https://' + t : t
  if (EMAIL.test(t)) return 'mailto:' + t
  return undefined // dead link (href="") → plain text
}

const sameFace = (a: Face, b: Face) =>
  a.italic === b.italic && a.bold === b.bold && a.smallCaps === b.smallCaps && a.upper === b.upper &&
  a.sup === b.sup && a.sub === b.sub && a.underline === b.underline && a.strike === b.strike && a.dropcap === b.dropcap

function merge(segs: Seg[]): Seg[] {
  const out: Seg[] = []
  for (const s of segs) {
    const last = out[out.length - 1]
    if (s.k === 't' && !s.text) continue
    if (s.k === 't' && last?.k === 't' && last.href === s.href && (sameFace(last.face, s.face) || (!s.text.trim() && !s.face.dropcap && !last.face.dropcap && !s.face.underline))) {
      last.text += s.text
    } else out.push(s.k === 't' ? { ...s } : s)
  }
  // a word split between small caps and normal ("Ca|pítulo") gets the face of its larger part
  for (let i = 1; i < out.length; i++) {
    const a = out[i - 1], b = out[i]
    if (a.k !== 't' || b.k !== 't' || a.href !== b.href || a.face.smallCaps === b.face.smallCaps) continue
    const tail = a.text.match(/\p{L}+$/u)?.[0] ?? ''
    const head = b.text.match(/^\p{L}+/u)?.[0] ?? ''
    if (!tail || !head) continue
    if (tail.length <= head.length && tail.length < a.text.length) {
      a.text = a.text.slice(0, -tail.length)
      b.text = tail + b.text
    } else if (head.length < tail.length && head.length < b.text.length) {
      b.text = b.text.slice(head.length)
      a.text += head
    }
  }
  return out
}

const AUTOLINK = /\b(?:https?:\/\/|www\.)[^\s<>«»"“”]*[^\s<>«»"“”.,;:)\]]|[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}/gi

function autolink(segs: Seg[]): Seg[] {
  const out: Seg[] = []
  for (const s of segs) {
    if (s.k !== 't' || s.href) {
      out.push(s)
      continue
    }
    let last = 0
    for (const m of s.text.matchAll(AUTOLINK)) {
      if (m.index! > last) out.push({ ...s, text: s.text.slice(last, m.index) })
      out.push({ ...s, text: m[0], href: normalizeHref('', m[0]) })
      last = m.index! + m[0].length
    }
    out.push({ ...s, text: s.text.slice(last) })
  }
  return out.filter((s) => s.k !== 't' || s.text)
}

function stripLeading(segs: Seg[], re: RegExp) {
  for (const s of segs) {
    if (s.k === 'raw') continue
    if (s.k === 'br') return
    const before = s.text
    s.text = s.text.replace(re, '')
    if (s.text) return
    if (before === s.text) return
  }
}

function stripTrailing(segs: Seg[], re: RegExp) {
  // the pattern may span several segments ("…cuaderno" + " \t\t58"): match on the joined text
  const texts = segs.filter((s): s is Extract<Seg, { k: 't' }> => s.k === 't')
  const joined = texts.map((s) => s.text).join('')
  const m = joined.match(re)
  if (!m) return
  let cut = m[0].length
  for (let i = texts.length - 1; i >= 0 && cut > 0; i--) {
    const take = Math.min(cut, texts[i].text.length)
    texts[i].text = texts[i].text.slice(0, texts[i].text.length - take)
    cut -= take
  }
}

function faceClass(f: Face, base: Face): string[] {
  const cls: string[] = []
  const addI = f.italic && !base.italic
  const addB = f.bold && !base.bold
  if (addI && addB) cls.push('bold-italic')
  else if (addI) cls.push('italic')
  else if (addB) cls.push('bold')
  if (!f.italic && base.italic) cls.push('nori')
  if (!f.bold && base.bold) cls.push('normal_1')
  if (f.underline && !base.underline) cls.push('underline')
  if (f.strike && !base.strike) cls.push('strike')
  return cls
}

/** "Las frecuencias" → L<span class="small-caps">AS FRECUENCIAS</span> */
export function smallCaps(text: string, lang: string): string {
  let out = ''
  let i = 0
  const isLower = (c: string) => c !== c.toLocaleUpperCase(lang)
  const isUpperOrDigit = (c: string) => /\d/.test(c) || (c !== c.toLocaleLowerCase(lang))
  while (i < text.length) {
    if (!isLower(text[i])) {
      out += esc(text[i++])
      continue
    }
    let j = i
    while (j < text.length && !isUpperOrDigit(text[j])) j++
    const run = text.slice(i, j)
    const core = run.replace(/\s+$/, '')
    out += `<span class="small-caps">${esc(core.toLocaleUpperCase(lang))}</span>${run.slice(core.length)}`
    i = j
  }
  return out
}

function render(segs: Seg[], base: Face, lang: string, heading: boolean): string {
  let html = ''
  const texts = segs.filter((s): s is Extract<Seg, { k: 't' }> => s.k === 't' && !!s.text.trim())
  const whole = heading && texts.length ? faceClass(texts[0].face, base).filter((c) => texts.every((t) => faceClass(t.face, base).includes(c))) : []
  for (const s of segs) {
    if (s.k === 'raw') {
      html += s.html
      continue
    }
    if (s.k === 'br') {
      html += heading ? ' ' : '<br/>'
      continue
    }
    const f = s.face
    let t: string
    if (f.dropcap) t = `<span class="dropcap">${esc(s.text)}</span>`
    else {
      t = f.upper ? esc(s.text.toLocaleUpperCase(lang)) : f.smallCaps ? smallCaps(s.text, lang) : esc(s.text)
      const cls = faceClass(f, base).filter((c) => !whole.includes(c))
      if (cls.length && s.text.trim()) t = `<span class="${cls.join(' ')}">${t}</span>`
      if (f.sup && !base.sup) t = `<sup>${t}</sup>`
      if (f.sub && !base.sub) t = `<sub>${t}</sub>`
    }
    if (s.href) t = `<a href="${esc(s.href)}">${t}</a>`
    html += t
  }
  // formatting spans that end with the word boundary: keep the space outside the span
  html = html.replace(/ <\/span>/g, '</span> ').replace(/ {2,}/g, ' ')
  if (heading) html = html.trim()
  return html
}
