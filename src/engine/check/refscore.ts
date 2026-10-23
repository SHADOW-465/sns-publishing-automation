// =============================================================================================
// Reference-file diff: how close is a built EPUB to the client's own finished file?
//
// Both books are read into the same small model (sections, text blocks with their class, italic and bold runs, notes,
// pictures with the paragraph before them, page markers, contents, metadata, CSS rules) and compared dimension by
// dimension. Each dimension gets a score from 0 to 100 and a few differences in plain words, so the answer to
// "is the client's correction fixed?" is a number that can be watched, not a screenshot.
//
// The comparison is structural, not byte-for-byte: file names, id values and the order of attributes do not count;
// what the reader sees (headings, paragraphs, emphasis, notes, pictures, page numbers, contents) does.
// =============================================================================================
import { text as zipText, type Files } from '../zip.ts'
import { epubType, OPS_NS } from '../xml.ts'

export interface Block {
  tag: string
  cls: string
  text: string
  norm: string
  /** italic and bold runs inside the block (normalised text of each run) */
  italics: string[]
  bolds: string[]
  links: number
}
export interface Pic { alt: string; cls: string; before: string; section: number }
interface Section {
  file: string
  stem: string
  type: string
  title: string
  blocks: Block[]
  pics: Pic[]
  pages: string[]
  pageStyle: Set<string>
  noteRefs: number
  noteBodies: number
  backLinks: number
  words: Map<string, number>
}
export interface NavEntry { depth: number; label: string; href: string }
export interface BookModel {
  sections: Section[]
  nav: NavEntry[]
  pageList: number
  meta: Record<string, string[]>
  css: Map<string, Record<string, string>>
  hrefs: { file: string; fragment: string; from: string }[]
  ids: Map<string, Set<string>>
  spineLinearNo: number
  hasGuide: boolean
}

export const norm = (s: string) => s.normalize('NFKC').toLocaleLowerCase().replace(/­/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

const LEAF = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'figcaption', 'dt', 'dd', 'td', 'th', 'caption', 'summary'])
const BLOCKISH = new Set(['p', 'div', 'section', 'ul', 'ol', 'table', 'blockquote', 'figure', 'aside', 'nav', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
const ln = (el: Element) => el.localName.toLowerCase()
const attrOps = (el: Element, name: string) => el.getAttributeNS(OPS_NS, name) ?? el.getAttribute(`epub:${name}`) ?? ''

// ---- css ----
export function parseCss(css: string): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>()
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const m of clean.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    const decls: Record<string, string> = {}
    for (const d of m[2].split(';')) {
      const i = d.indexOf(':')
      if (i > 0) decls[d.slice(0, i).trim().toLowerCase()] = d.slice(i + 1).trim().toLowerCase()
    }
    for (const sel of m[1].split(',')) {
      const s = sel.trim().replace(/\s+/g, ' ')
      if (s) out.set(s, { ...(out.get(s) ?? {}), ...decls })
    }
  }
  return out
}
/** declarations of a class, whatever element it sits on ("p.x", ".x", "span.x") */
function cssOf(css: Map<string, Record<string, string>>, cls: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [sel, d] of css) if (new RegExp(`(^|[ >+~])[a-z0-9]*\\.${cls.replace(/[-_]/g, '\\$&')}$`, 'i').test(sel)) Object.assign(out, d)
  return out
}

function resolveHref(from: string, href: string): { file: string; fragment: string } {
  const [path, fragment = ''] = href.split('#')
  if (!path) return { file: from, fragment }
  const base = from.split('/').slice(0, -1)
  for (const part of decodeURIComponent(path).split('/')) part === '..' ? base.pop() : part !== '.' && base.push(part)
  return { file: base.join('/'), fragment }
}

function parse(src: string): Document | null {
  const doc = new DOMParser().parseFromString(src, 'application/xhtml+xml')
  return doc.getElementsByTagName('parsererror').length ? null : doc
}

const STEM_ALIAS: Record<string, string> = { 'half-title': 'halftitle', copy: 'copyright', copyr: 'copyright' }

export function bookModel(files: Files): BookModel {
  const opfPath = [...files.keys()].find((p) => p.endsWith('.opf')) ?? ''
  const opfText = zipText(files.get(opfPath) ?? new Uint8Array())
  const opf = parse(opfText)
  const dir = opfPath.split('/').slice(0, -1).join('/')
  const at = (p: string) => (dir ? `${dir}/${p}` : p)
  const meta: Record<string, string[]> = {}
  const add = (k: string, v: string) => (meta[k] ??= []).push(v.trim())
  const manifest = new Map<string, { href: string; type: string; props: string }>()
  const spine: { id: string; linear: boolean }[] = []
  let hasGuide = false
  if (opf) {
    for (const el of Array.from(opf.getElementsByTagName('*'))) {
      const name = ln(el)
      if (name === 'meta') {
        const prop = el.getAttribute('property')
        if (prop) add(prop, el.textContent ?? '')
        else if (el.getAttribute('name')) add(`meta:${el.getAttribute('name')}`, el.getAttribute('content') ?? '')
      } else if (el.namespaceURI === 'http://purl.org/dc/elements/1.1/') add(`dc:${name}`, el.textContent ?? '')
      else if (name === 'item') manifest.set(el.getAttribute('id') ?? '', { href: el.getAttribute('href') ?? '', type: el.getAttribute('media-type') ?? '', props: el.getAttribute('properties') ?? '' })
      else if (name === 'itemref') spine.push({ id: el.getAttribute('idref') ?? '', linear: el.getAttribute('linear') !== 'no' })
      else if (name === 'guide') hasGuide = true
    }
  }
  // stylesheets
  const css = new Map<string, Record<string, string>>()
  for (const m of manifest.values()) if (m.type === 'text/css') for (const [k, v] of parseCss(zipText(files.get(at(m.href)) ?? new Uint8Array()))) css.set(k, { ...(css.get(k) ?? {}), ...v })
  const italicClass = (c: string) => /italic/i.test(c) || /italic/.test(cssOf(css, c)['font-style'] ?? '')
  const boldClass = (c: string) => /^bold$/i.test(c) || /bold|^[6-9]00$/.test(cssOf(css, c)['font-weight'] ?? '')

  const sections: Section[] = []
  const hrefs: BookModel['hrefs'] = []
  const ids = new Map<string, Set<string>>()
  let nav: NavEntry[] = []
  let pageList = 0

  for (const { id } of spine) {
    const item = manifest.get(id)
    if (!item || !/xhtml/.test(item.type)) continue
    const file = at(item.href)
    const doc = parse(zipText(files.get(file) ?? new Uint8Array()))
    if (!doc) continue
    const idset = new Set<string>()
    for (const el of Array.from(doc.getElementsByTagName('*'))) if (el.id) idset.add(el.id)
    ids.set(file, idset)
    for (const a of Array.from(doc.getElementsByTagName('a'))) {
      const h = a.getAttribute('href')
      if (h && !/^[a-z][a-z0-9+.-]*:/i.test(h)) hrefs.push({ ...resolveHref(file, h), from: file })
    }
    const stem0 = file.replace(/^.*\//, '').replace(/\.x?html$/, '')
    const stem = STEM_ALIAS[stem0] ?? stem0
    const body = doc.getElementsByTagName('body')[0]
    if (!body) continue
    const sec: Section = {
      file, stem, type: '', title: doc.getElementsByTagName('title')[0]?.textContent?.trim() ?? '', blocks: [], pics: [], pages: [], pageStyle: new Set(),
      noteRefs: 0, noteBodies: 0, backLinks: 0, words: new Map(),
    }
    sec.type = [...new Set(Array.from(body.getElementsByTagName('*')).map((e) => attrOps(e, 'type')).filter((t) => /^(cover|titlepage|copyright-page|toc|frontmatter|bodymatter|chapter|part|preface|foreword|dedication|index|bibliography|glossary|appendix|acknowledgments|halftitlepage|epigraph)/.test(t)))].join(' ')

    // navigation document
    const navEls = Array.from(body.getElementsByTagName('nav'))
    if (navEls.length && item.props.includes('nav')) {
      for (const n of navEls) {
        const t = attrOps(n, 'type')
        if (t === 'toc') {
          const walk = (ol: Element, depth: number) => {
            for (const li of Array.from(ol.children).filter((c) => ln(c) === 'li')) {
              const a = Array.from(li.children).find((c) => ln(c) === 'a' || ln(c) === 'span')
              if (a) nav.push({ depth, label: (a.textContent ?? '').replace(/\s+/g, ' ').trim(), href: a.getAttribute('href') ?? '' })
              for (const sub of Array.from(li.children).filter((c) => ln(c) === 'ol')) walk(sub, depth + 1)
            }
          }
          const top = Array.from(n.children).find((c) => ln(c) === 'ol')
          if (top) walk(top, 1)
        } else if (t === 'page-list') pageList = n.getElementsByTagName('a').length
      }
      continue
    }

    let last = ''
    const pageNo = (el: Element): string | null => {
      if (attrOps(el, 'type') === 'pagebreak' || el.getAttribute('role') === 'doc-pagebreak') {
        sec.pageStyle.add('epub:type pagebreak')
        return (el.id.replace(/^page-?/i, '') || (el.getAttribute('aria-label') ?? '').replace(/\D+/g, '')) || '?'
      }
      if (ln(el) === 'a' && el.id && !el.textContent?.trim() && /^(page|pg)[_-]?\w+$/i.test(el.id)) {
        sec.pageStyle.add(`anchor ${el.id.replace(/\w+$/, '')}n`)
        return el.id.replace(/^(page|pg)[_-]?/i, '')
      }
      return null
    }
    const inline = (el: Element, b: { italics: string[]; bolds: string[] }) => {
      for (const c of Array.from(el.children)) {
        const n = ln(c)
        const cls = (c.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)
        const t = norm(c.textContent ?? '')
        if (t && (n === 'em' || n === 'i' || cls.some(italicClass))) b.italics.push(t)
        if (t && (n === 'strong' || n === 'b' || cls.some(boldClass))) b.bolds.push(t)
        inline(c, b)
      }
    }
    const textOfBlock = (el: Element): string => {
      let s = ''
      const walk = (n: Node) => {
        for (const c of Array.from(n.childNodes)) {
          if (c.nodeType === 3) s += c.textContent ?? ''
          else if (c.nodeType === 1) {
            const e = c as Element
            if (ln(e) === 'br') s += ' '
            else if (!pageNo(e) && ln(e) !== 'img') walk(e)
          }
        }
      }
      walk(el)
      return s.replace(/­/g, '').replace(/\s+/g, ' ').trim()
    }
    const visit = (el: Element) => {
      const n = ln(el)
      const page = pageNo(el)
      if (page !== null) {
        sec.pages.push(page)
        return
      }
      if (n === 'img') {
        sec.pics.push({ alt: el.getAttribute('alt') ?? '', cls: el.getAttribute('class') ?? '', before: last, section: sections.length })
        return
      }
      const t = attrOps(el, 'type')
      const role = el.getAttribute('role') ?? ''
      if (n === 'a' && (t === 'noteref' || role === 'doc-noteref')) sec.noteRefs++
      if (n === 'a' && (t === 'backlink' || role === 'doc-backlink')) sec.backLinks++
      if (/^(footnote|endnote|rearnote)$/.test(t) || role === 'doc-footnote' || role === 'doc-endnote') sec.noteBodies++
      const leaf = LEAF.has(n) || (n === 'div' && !Array.from(el.children).some((c) => BLOCKISH.has(ln(c))) && !!el.textContent?.trim())
      if (leaf && !(n === 'li' && el.getElementsByTagName('p').length)) {
        const b = { italics: [] as string[], bolds: [] as string[] }
        inline(el, b)
        for (const c of Array.from(el.getElementsByTagName('*'))) {
          const tt = attrOps(c, 'type')
          if (ln(c) === 'a' && (tt === 'noteref' || c.getAttribute('role') === 'doc-noteref')) sec.noteRefs++
          if (ln(c) === 'a' && (tt === 'backlink' || c.getAttribute('role') === 'doc-backlink')) sec.backLinks++
        }
        const tx = textOfBlock(el)
        const blk: Block = { tag: n, cls: el.getAttribute('class') ?? '', text: tx, norm: norm(tx), italics: b.italics, bolds: b.bolds, links: el.getElementsByTagName('a').length }
        for (const img of Array.from(el.getElementsByTagName('img'))) sec.pics.push({ alt: img.getAttribute('alt') ?? '', cls: img.getAttribute('class') ?? '', before: last, section: sections.length })
        for (const c of Array.from(el.getElementsByTagName('*'))) {
          const pg = pageNo(c)
          if (pg !== null) sec.pages.push(pg)
        }
        if (blk.norm || /^h[1-6]$/.test(n)) {
          sec.blocks.push(blk)
          if (blk.norm) last = blk.norm.slice(0, 60)
        }
        return
      }
      for (const c of Array.from(el.children)) visit(c)
    }
    visit(body)
    for (const b of sec.blocks) for (const w of b.norm.split(' ')) if (w) sec.words.set(w, (sec.words.get(w) ?? 0) + 1)
    sections.push(sec)
  }
  // NCX as the contents when the book has no nav
  if (!nav.length) {
    const ncx = [...manifest.values()].find((m) => m.type === 'application/x-dtbncx+xml')
    const d = ncx && parse(zipText(files.get(at(ncx.href)) ?? new Uint8Array()))
    if (d) for (const p of Array.from(d.getElementsByTagName('navPoint'))) {
      let depth = 1
      for (let q = p.parentElement; q && ln(q) === 'navPoint'; q = q.parentElement) depth++
      nav.push({ depth, label: (p.getElementsByTagName('text')[0]?.textContent ?? '').trim(), href: p.getElementsByTagName('content')[0]?.getAttribute('src') ?? '' })
    }
  }
  nav = nav.filter((e) => e.label)
  return { sections, nav, pageList, meta, css, hrefs, ids, spineLinearNo: spine.filter((s) => !s.linear).length, hasGuide }
}

// ---------------------------------------------------------------------------------------------
// comparison
// ---------------------------------------------------------------------------------------------
export interface Dimension {
  id: string
  label: string
  /** 0–100, or null when neither book has this feature */
  score: number | null
  weight: number
  diffs: string[]
}
export interface RefScore {
  overall: number
  dims: Dimension[]
}

const pct = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 1000) / 10
const count = <T>(xs: T[]) => xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<T, number>())
/** F1 of two multisets: 1 = same items. Returns the items only in a / only in b as well. */
function multiset<T>(a: T[], b: T[]) {
  const ca = count(a)
  const cb = count(b)
  let common = 0
  const onlyA: T[] = []
  const onlyB: T[] = []
  for (const [k, n] of ca) {
    const m = cb.get(k) ?? 0
    common += Math.min(n, m)
    for (let i = 0; i < n - m; i++) onlyA.push(k)
  }
  for (const [k, m] of cb) for (let i = 0; i < m - (ca.get(k) ?? 0); i++) onlyB.push(k)
  const f1 = a.length + b.length ? (2 * common) / (a.length + b.length) : 1
  return { f1, recall: a.length ? common / a.length : 1, onlyA, onlyB }
}
const clip = (s: string, n = 70) => (s.length > n ? `${s.slice(0, n)}…` : s)
const more = (xs: string[], n = 6) => (xs.length > n ? [...xs.slice(0, n), `…and ${xs.length - n} more`] : xs)

const HEADLIKE = /(^|[-_ ])(h\d|head|heading|title|titulo|tit|chap|chapter|sub|subhead|ladillo|antetitulo|capitulo|part|parte)([-_ \d]|$)/i
const isHead = (b: Block) => (/^h[1-6]$/.test(b.tag) || HEADLIKE.test(b.cls)) && b.norm.length > 0 && b.text.length < 220
const allBlocks = (m: BookModel) => m.sections.flatMap((s) => s.blocks)
const wordsF1 = (a: Map<string, number>, b: Map<string, number>) => {
  let common = 0
  let na = 0
  let nb = 0
  for (const [w, n] of a) (na += n), (common += Math.min(n, b.get(w) ?? 0))
  for (const n of b.values()) nb += n
  return na + nb ? (2 * common) / (na + nb) : 1
}

export function compareBooks(mine: BookModel, ref: BookModel): RefScore {
  const dims: Dimension[] = []
  const dim = (id: string, label: string, weight: number, score: number | null, diffs: string[]) => dims.push({ id, label, weight, score: score === null ? null : pct(score), diffs })
  const A = allBlocks(mine)
  const R = allBlocks(ref)

  // ---- sections: every reference section's text is somewhere in the build ----
  {
    const diffs: string[] = []
    const scores: number[] = []
    for (const r of ref.sections) {
      const size = [...r.words.values()].reduce((s, n) => s + n, 0)
      if (size < 8) continue
      const best = mine.sections.map((m) => ({ m, f: wordsF1(r.words, m.words) })).sort((x, y) => y.f - x.f)[0]
      const f = best?.f ?? 0
      scores.push(f)
      if (f < 0.9) diffs.push(`The reference section “${r.stem}”${r.title ? ` (${clip(r.title, 40)})` : ''} has ${Math.round(f * 100)}% of its words in the closest section of the build${best ? ` (${best.m.stem})` : ''}.`)
    }
    const extra = mine.sections.length - ref.sections.length
    if (extra) diffs.push(`The build has ${Math.abs(extra)} ${extra > 0 ? 'more' : 'fewer'} content file${Math.abs(extra) === 1 ? '' : 's'} than the reference (${mine.sections.length} against ${ref.sections.length}).`)
    dim('sections', 'Sections and their text', 10, scores.length ? scores.reduce((s, x) => s + x, 0) / scores.length : null, more(diffs))
  }

  // ---- headings ----
  {
    const rh = R.filter(isHead)
    const ah = A.filter(isHead)
    if (!rh.length && !ah.length) dim('headings', 'Headings', 15, null, [])
    else {
      const byText = new Map<string, Block[]>()
      for (const b of ah) byText.set(b.norm, [...(byText.get(b.norm) ?? []), b])
      const diffs: string[] = []
      let found = 0
      let sameTag = 0
      const plain = new Set(A.filter((b) => !isHead(b)).map((b) => b.norm))
      for (const r of rh) {
        const hit = byText.get(r.norm)?.[0] ?? ah.find((b) => b.norm.includes(r.norm) || r.norm.includes(b.norm))
        if (hit) {
          found++
          if (hit.tag === r.tag) sameTag++
          else if (diffs.length < 40) diffs.push(`“${clip(r.text, 50)}” is <${hit.tag}> in the build and <${r.tag}> in the reference.`)
        } else diffs.push(plain.has(r.norm) ? `“${clip(r.text, 50)}” is a heading in the reference but plain text in the build.` : `The heading “${clip(r.text, 50)}” is missing from the build.`)
      }
      const extra = ah.filter((b) => !rh.some((r) => r.norm === b.norm || r.norm.includes(b.norm) || b.norm.includes(r.norm)))
      if (extra.length) diffs.push(`${extra.length} heading${extra.length === 1 ? '' : 's'} in the build are not headings in the reference, for example “${clip(extra[0].text, 50)}”.`)
      const recall = rh.length ? found / rh.length : 1
      const precision = ah.length ? 1 - extra.length / ah.length : 1
      dim('headings', 'Headings', 15, 0.6 * recall + 0.15 * precision + 0.25 * (found ? sameTag / found : 1), more(diffs, 8))
    }
  }

  // ---- paragraphs: same text, same breaks ----
  {
    const ra = R.filter((b) => b.norm.length > 2).map((b) => b.norm)
    const aa = A.filter((b) => b.norm.length > 2).map((b) => b.norm)
    const m = multiset(ra, aa)
    const diffs: string[] = []
    let merged = 0
    let split = 0
    const missing: string[] = []
    for (const t of m.onlyA) {
      if (aa.some((x) => x.includes(t) && x !== t)) merged++
      else if (!aa.join(' ').includes(t)) missing.push(t)
      else split++
    }
    const gained = m.onlyB.filter((t) => !ra.some((x) => t.includes(x))).length
    if (merged) diffs.push(`${merged} reference paragraph${merged === 1 ? ' is' : 's are'} joined into a longer paragraph in the build (paragraphs merged).`)
    if (split) diffs.push(`${split} reference paragraph${split === 1 ? ' is' : 's are'} cut into pieces in the build (paragraphs split).`)
    if (missing.length) diffs.push(`${missing.length} reference paragraph${missing.length === 1 ? ' is' : 's are'} missing or reworded in the build, for example “${clip(missing[0], 60)}”.`)
    if (gained > 0) diffs.push(`${gained} paragraph${gained === 1 ? '' : 's'} of the build are not in the reference (leaked running heads, page numbers or extra text), for example “${clip(m.onlyB.find((t) => !ra.some((x) => t.includes(x))) ?? '', 60)}”.`)
    dim('paragraphs', 'Paragraphs and breaks', 20, ra.length || aa.length ? m.f1 : null, diffs)
  }

  // ---- paragraph classes (the roles) among paragraphs with the same text ----
  {
    const byText = new Map<string, string>()
    for (const b of A) if (b.norm.length > 2 && !byText.has(b.norm)) byText.set(b.norm, b.cls)
    let both = 0
    let same = 0
    const pairs = new Map<string, number>()
    for (const r of R) {
      if (r.norm.length <= 2 || !byText.has(r.norm)) continue
      both++
      const c = byText.get(r.norm)!
      if (c === r.cls) same++
      else pairs.set(`${r.cls || '(no class)'} → ${c || '(no class)'}`, (pairs.get(`${r.cls || '(no class)'} → ${c || '(no class)'}`) ?? 0) + 1)
    }
    const diffs = [...pairs].sort((x, y) => y[1] - x[1]).map(([k, n]) => `${n} paragraph${n === 1 ? '' : 's'}: the reference class → the build class: ${k}.`)
    dim('classes', 'Paragraph classes (roles)', 5, both ? same / both : null, more(diffs, 6))
  }

  // ---- emphasis ----
  {
    const ri = R.flatMap((b) => b.italics)
    const ai = A.flatMap((b) => b.italics)
    const rb = R.flatMap((b) => b.bolds)
    const ab = A.flatMap((b) => b.bolds)
    const diffs: string[] = []
    const mi = multiset(ri, ai)
    const mb = multiset(rb, ab)
    if (mi.onlyA.length) diffs.push(`${mi.onlyA.length} italic run${mi.onlyA.length === 1 ? '' : 's'} of the reference ${mi.onlyA.length === 1 ? 'is' : 'are'} not italic in the build, for example “${clip(mi.onlyA[0], 50)}” (italics lost).`)
    if (mi.onlyB.length) diffs.push(`${mi.onlyB.length} italic run${mi.onlyB.length === 1 ? '' : 's'} in the build ${mi.onlyB.length === 1 ? 'is' : 'are'} not italic in the reference, for example “${clip(mi.onlyB[0], 50)}”.`)
    if (mb.onlyA.length) diffs.push(`${mb.onlyA.length} bold run${mb.onlyA.length === 1 ? '' : 's'} of the reference ${mb.onlyA.length === 1 ? 'is' : 'are'} not bold in the build, for example “${clip(mb.onlyA[0], 50)}”.`)
    if (mb.onlyB.length) diffs.push(`${mb.onlyB.length} bold run${mb.onlyB.length === 1 ? '' : 's'} in the build ${mb.onlyB.length === 1 ? 'is' : 'are'} not bold in the reference.`)
    dim('emphasis', 'Italics and bold', 10, ri.length + rb.length + ai.length + ab.length ? (mi.f1 * (ri.length + ai.length || 0) + mb.f1 * (rb.length + ab.length || 0)) / ((ri.length + ai.length || 0) + (rb.length + ab.length || 0)) : null, more(diffs, 6))
  }

  // ---- notes ----
  {
    const sum = (m: BookModel, k: 'noteRefs' | 'noteBodies' | 'backLinks') => m.sections.reduce((s, x) => s + x[k], 0)
    const parts = (['noteRefs', 'noteBodies', 'backLinks'] as const).map((k) => ({ k, r: sum(ref, k), a: sum(mine, k) }))
    if (parts.every((p) => !p.r && !p.a)) dim('notes', 'Notes', 10, null, [])
    else {
      const names = { noteRefs: 'note calls in the text', noteBodies: 'notes', backLinks: 'links back from a note' }
      const diffs = parts.filter((p) => p.r !== p.a).map((p) => `The reference has ${p.r} ${names[p.k]}, the build ${p.a}.`)
      const active = parts.filter((p) => p.r || p.a)
      dim('notes', 'Notes', 10, active.reduce((s, p) => s + Math.min(p.r, p.a) / Math.max(p.r, p.a), 0) / active.length, diffs)
    }
  }

  // ---- contents (navigation document) and printed contents page ----
  {
    const diffs: string[] = []
    const rl = ref.nav.map((e) => norm(e.label))
    const al = mine.nav.map((e) => norm(e.label))
    const m = multiset(rl, al)
    for (const t of m.onlyA.slice(0, 4)) diffs.push(`The contents entry “${clip(t, 60)}” of the reference is missing or worded differently in the build.`)
    if (m.onlyA.length > 4) diffs.push(`…${m.onlyA.length - 4} more reference entries missing.`)
    const depth = (e: NavEntry[]) => Math.max(0, ...e.map((x) => x.depth))
    if (depth(ref.nav) !== depth(mine.nav) && ref.nav.length) diffs.push(`The contents go ${depth(mine.nav)} level${depth(mine.nav) === 1 ? '' : 's'} deep in the build and ${depth(ref.nav)} in the reference.`)
    const broken = mine.hrefs.filter((h) => !mine.ids.has(h.file) || (h.fragment && !mine.ids.get(h.file)!.has(h.fragment)))
    if (broken.length) diffs.push(`${broken.length} link${broken.length === 1 ? '' : 's'} in the build point nowhere (for example ${broken[0].from.replace(/^.*\//, '')} → ${broken[0].file.replace(/^.*\//, '')}${broken[0].fragment ? `#${broken[0].fragment}` : ''}).`)
    const linkedPct = (mod: BookModel) => {
      const toc = mod.sections.find((s) => /^(toc|contents|indice|inhalt)$/i.test(s.stem))
      if (!toc) return null
      const ents = toc.blocks.filter((b) => b.tag !== 'h1' && !isHead(b) && b.norm)
      return { n: ents.length, linked: ents.filter((b) => b.links).length, numbers: ents.filter((b) => /\s\d{1,4}$/.test(b.text)).length }
    }
    const rp = linkedPct(ref)
    const ap = linkedPct(mine)
    let pageScore: number | null = null
    if (rp && ap) {
      const rl2 = rp.n ? rp.linked / rp.n : 1
      const al2 = ap.n ? ap.linked / ap.n : 1
      if (Math.abs(rl2 - al2) > 0.2) diffs.push(`${Math.round(al2 * 100)}% of the entries on the printed contents page are links in the build, ${Math.round(rl2 * 100)}% in the reference.`)
      const rn = rp.n ? rp.numbers / rp.n > 0.5 : false
      const an = ap.n ? ap.numbers / ap.n > 0.5 : false
      if (rn !== an) diffs.push(an ? 'The contents page shows page numbers in the build; the reference has none.' : 'The contents page has no page numbers in the build; the reference shows them.')
      pageScore = 1 - Math.abs(rl2 - al2) / 2 - (rn !== an ? 0.25 : 0)
    }
    const navScore = rl.length || al.length ? m.f1 * (broken.length ? 0.8 : 1) : null
    dim('contents', 'Contents (menu and contents page)', 10, navScore === null ? pageScore : pageScore === null ? navScore : (navScore + pageScore) / 2, more(diffs, 6))
  }

  // ---- index links ----
  {
    const idx = (m: BookModel) => {
      const s = m.sections.filter((x) => /^index$/i.test(x.stem) || x.blocks.some((b) => /^index/i.test(b.cls)))
      const bs = s.flatMap((x) => x.blocks).filter((b) => !isHead(b))
      const nums = bs.reduce((n, b) => n + (b.text.match(/\b\d{1,4}\b/g)?.length ?? 0), 0)
      return { n: bs.length, nums, links: bs.reduce((n, b) => n + b.links, 0) }
    }
    const ri = idx(ref)
    const ai = idx(mine)
    if (!ri.n && !ai.n) dim('index', 'Index and its page-number links', 4, null, [])
    else {
      const rr = ri.nums ? ri.links / ri.nums : 0
      const ar = ai.nums ? ai.links / ai.nums : 0
      const diffs: string[] = []
      if (ri.n !== ai.n) diffs.push(`The index has ${ai.n} entries in the build and ${ri.n} in the reference.`)
      if (Math.abs(rr - ar) > 0.1) diffs.push(`${Math.round(ar * 100)}% of the page numbers in the index are links in the build, ${Math.round(rr * 100)}% in the reference.`)
      dim('index', 'Index and its page-number links', 4, ri.n ? 0.5 * Math.min(ri.n, ai.n) / Math.max(ri.n, ai.n) + 0.5 * (1 - Math.min(1, Math.abs(rr - ar))) : 0, diffs)
    }
  }

  // ---- pictures ----
  {
    const rp = ref.sections.flatMap((s) => s.pics)
    const ap = mine.sections.flatMap((s) => s.pics)
    if (!rp.length && !ap.length) dim('pictures', 'Pictures, captions and placement', 8, null, [])
    else {
      const diffs: string[] = []
      const countScore = Math.min(rp.length, ap.length) / Math.max(rp.length, ap.length, 1)
      if (rp.length !== ap.length) diffs.push(`The build has ${ap.length} picture${ap.length === 1 ? '' : 's'}; the reference has ${rp.length}.`)
      const keys = new Set(ap.map((p) => p.before))
      const placed = rp.filter((p) => keys.has(p.before)).length
      const placeScore = rp.length ? placed / rp.length : 1
      if (placed < rp.length) diffs.push(`${rp.length - placed} picture${rp.length - placed === 1 ? ' is' : 's are'} not after the same paragraph as in the reference (picture placement).`)
      const kind = (p: Pic): string => (p.alt === '' ? 'empty' : /^(image|images|imagen|bild|picture|decorative|cover|dekorativ)$/i.test(p.alt.trim()) ? 'generic' : 'described')
      const rk = count(rp.map(kind))
      const ak = count(ap.map(kind))
      let altScore = 1
      for (const k of ['empty', 'generic', 'described']) if ((rk.get(k) ?? 0) !== (ak.get(k) ?? 0)) diffs.push(`Picture descriptions: reference ${rk.get('described') ?? 0} real, ${rk.get('generic') ?? 0} generic word, ${rk.get('empty') ?? 0} empty; build ${ak.get('described') ?? 0} real, ${ak.get('generic') ?? 0} generic word, ${ak.get('empty') ?? 0} empty.`)
      if (diffs.some((d) => d.startsWith('Picture descriptions'))) altScore = 1 - multisetDistance(rk, ak, rp.length || 1)
      dim('pictures', 'Pictures, captions and placement', 8, 0.25 * countScore + 0.55 * placeScore + 0.2 * altScore, [...new Set(diffs)])
    }
  }

  // ---- page markers ----
  {
    const rp = ref.sections.flatMap((s) => s.pages)
    const ap = mine.sections.flatMap((s) => s.pages)
    if (!rp.length && !ap.length) dim('pages', 'Printed page numbers', 5, null, [])
    else {
      const m = multiset(rp, ap)
      const diffs: string[] = []
      if (m.onlyA.length) diffs.push(`${m.onlyA.length} printed page marker${m.onlyA.length === 1 ? '' : 's'} of the reference are missing in the build (for example page ${m.onlyA[0]}).`)
      if (m.onlyB.length) diffs.push(`${m.onlyB.length} page marker${m.onlyB.length === 1 ? '' : 's'} in the build are not in the reference (for example page ${m.onlyB[0]}).`)
      const styles = (mod: BookModel) => [...new Set(mod.sections.flatMap((s) => [...s.pageStyle]))].sort().join(', ') || 'none'
      if (styles(ref) !== styles(mine)) diffs.push(`Page markers are written as ${styles(mine)} in the build and ${styles(ref)} in the reference.`)
      if (!!ref.pageList !== !!mine.pageList) diffs.push(mine.pageList ? 'The build has a page list in the menu; the reference has none.' : 'The reference has a page list in the menu; the build has none.')
      dim('pages', 'Printed page numbers', 5, 0.8 * m.f1 + 0.1 * (styles(ref) === styles(mine) ? 1 : 0) + 0.1 * (!!ref.pageList === !!mine.pageList ? 1 : 0), diffs)
    }
  }

  // ---- package metadata ----
  {
    const v = (m: BookModel, k: string) => (m.meta[k] ?? []).map(norm).filter(Boolean).sort().join('|')
    const a11y = (m: BookModel) => Object.keys(m.meta).filter((k) => /^schema:accessib|^schema:accessMode|conformsTo|certifiedBy|pageBreakSource/.test(k)).flatMap((k) => (m.meta[k] ?? []).map((x) => `${k}=${norm(x)}`)).sort()
    const checks: [string, boolean, string][] = [
      ['title', v(mine, 'dc:title') === v(ref, 'dc:title'), `title “${clip(ref.meta['dc:title']?.[0] ?? '', 50)}” (build: “${clip(mine.meta['dc:title']?.[0] ?? '', 50)}”)`],
      ['author', v(mine, 'dc:creator') === v(ref, 'dc:creator'), `author “${ref.meta['dc:creator']?.join(', ') ?? ''}” (build: “${mine.meta['dc:creator']?.join(', ') ?? ''}”)`],
      ['language', v(mine, 'dc:language') === v(ref, 'dc:language'), `language ${ref.meta['dc:language']?.[0] ?? ''} (build: ${mine.meta['dc:language']?.[0] ?? ''})`],
      ['publisher', v(mine, 'dc:publisher') === v(ref, 'dc:publisher'), `publisher “${ref.meta['dc:publisher']?.[0] ?? ''}” (build: “${mine.meta['dc:publisher']?.[0] ?? ''}”)`],
      ['rights', v(mine, 'dc:rights') === v(ref, 'dc:rights'), `rights line “${clip(ref.meta['dc:rights']?.[0] ?? '', 50)}” (build: “${clip(mine.meta['dc:rights']?.[0] ?? '', 50)}”)`],
      ['identifier', norm((mine.meta['dc:identifier'] ?? [''])[0]).replace(/ /g, '').replace(/^urnisbn/, '') === norm((ref.meta['dc:identifier'] ?? [''])[0]).replace(/ /g, '').replace(/^urnisbn/, ''), `identifier ${ref.meta['dc:identifier']?.[0] ?? ''} (build: ${mine.meta['dc:identifier']?.[0] ?? ''})`],
      ['accessibility', a11y(mine).length > 0 === a11y(ref).length > 0, a11y(ref).length ? 'accessibility metadata (the reference has it, the build has not)' : 'accessibility metadata (the build claims accessibility; the reference does not)'],
      ['cover', !!mine.meta['meta:cover'] === !!ref.meta['meta:cover'], 'cover declared in the package'],
    ]
    const diffs = checks.filter((c) => !c[1]).map((c) => `Package metadata differs: ${c[2]}.`)
    const ra = a11y(ref)
    const aa = a11y(mine)
    if (ra.length && aa.length) {
      const m = multiset(ra, aa)
      if (m.onlyA.length) diffs.push(`${m.onlyA.length} accessibility statement${m.onlyA.length === 1 ? '' : 's'} of the reference are missing in the build (for example ${m.onlyA[0].replace('schema:', '')}).`)
      if (m.onlyB.length) diffs.push(`${m.onlyB.length} accessibility statement${m.onlyB.length === 1 ? '' : 's'} in the build are not in the reference (for example ${m.onlyB[0].replace('schema:', '')}).`)
      dim('metadata', 'Package metadata', 4, 0.6 * (checks.filter((c) => c[1]).length / checks.length) + 0.4 * m.f1, diffs)
    } else dim('metadata', 'Package metadata', 4, checks.filter((c) => c[1]).length / checks.length, diffs)
  }

  // ---- css roles ----
  {
    const used = new Set(R.flatMap((b) => b.cls.split(/\s+/).filter(Boolean)))
    const props = ['text-align', 'font-style', 'font-weight', 'font-size', 'text-indent', 'margin-left', 'font-family']
    const generic = (v: string) => (/sans/.test(v) ? 'sans' : /serif|garamond|times|georgia|minion|berling/.test(v) ? 'serif' : v)
    const num = (v: string) => (/^-?[\d.]+(em|%|rem)?$/.test(v) ? parseFloat(v) : NaN)
    let tested = 0
    let agree = 0
    const diffs: string[] = []
    for (const c of used) {
      const rc = cssOf(ref.css, c)
      if (!Object.keys(rc).length) continue
      const ac = cssOf(mine.css, c)
      for (const p of props) {
        if (!(p in rc)) continue
        tested++
        const rv = p === 'font-family' ? generic(rc[p]) : rc[p]
        const av = p === 'font-family' ? generic(ac[p] ?? '') : ac[p]
        const rn = num(rc[p])
        const an = num(ac[p] ?? '')
        const ok = rv === av || (!isNaN(rn) && !isNaN(an) && Math.abs(rn - an) <= Math.max(0.15, Math.abs(rn) * 0.2)) || (p === 'font-weight' && /bold|[6-9]00/.test(rc[p]) && /bold|[6-9]00/.test(ac[p] ?? ''))
        if (ok) agree++
        else if (diffs.length < 60) diffs.push(`.${c}: ${p} is ${rc[p]} in the reference and ${ac[p] ?? 'not set'} in the build.`)
      }
    }
    dim('css', 'Stylesheet roles (alignment, size, face)', 3, tested ? agree / tested : null, more(diffs, 8))
  }

  const live = dims.filter((d) => d.score !== null)
  const overall = live.length ? Math.round((live.reduce((s, d) => s + d.score! * d.weight, 0) / live.reduce((s, d) => s + d.weight, 0)) * 10) / 10 : 0
  return { overall, dims }
}

function multisetDistance(a: Map<string, number>, b: Map<string, number>, total: number): number {
  let d = 0
  for (const k of new Set([...a.keys(), ...b.keys()])) d += Math.abs((a.get(k) ?? 0) - (b.get(k) ?? 0))
  return Math.min(1, d / 2 / total)
}

/** Score a built EPUB (its files) against the client's finished EPUB. */
export const scoreEpub = (built: Files, reference: Files): RefScore => compareBooks(bookModel(built), bookModel(reference))

/** The score as plain text: one line per dimension, then the differences. */
export function formatScore(name: string, s: RefScore): string {
  const out = [`${name}: ${s.overall}% like the client’s finished file`]
  for (const d of s.dims) out.push(`  ${(d.score === null ? 'n/a' : `${d.score}%`).padStart(6)}  ${d.label}`)
  for (const d of s.dims) if (d.score !== null && d.diffs.length) out.push(`  ${d.label}:`, ...d.diffs.map((x) => `    - ${x}`))
  return out.join('\n')
}
