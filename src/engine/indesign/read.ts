import { StyleSheet, isOverride, px, em, type Decls } from './css.ts'
import { type Files, text } from '../zip.ts'
import { parseXml, resolvePath, tag, classesOf, textOf, pageBreakOf, epubType } from '../xml.ts'
import { pickLanguage } from '../lang.ts'
import { settings } from '../settings.ts'

// ---------------------------------------------------------------------------------------------
// Reading an InDesign "Export > EPUB (reflowable)" package and flattening it to a block stream.
// ---------------------------------------------------------------------------------------------

export type Block =
  | { t: 'pb'; n: string }
  | { t: 'p'; el: Element; key: string; classes: string[]; text: string; page: string; list?: { ordered: boolean; depth: number; start?: number } }
  | { t: 'table'; el: Element; page: string }
  | { t: 'img'; src: string; page: string; alt: string }

export interface Export {
  opfPath: string
  lang: string
  opfTitle: string
  /** dc:creator values, when the export has them */
  opfCreators: string[]
  css: StyleSheet
  blocks: Block[]
  footnotes: Map<string, Element>
  /** zip path -> bytes, images only */
  images: Map<string, Uint8Array>
  coverImage?: string
}

export function readExport(files: Files): Export {
  const container = files.get('META-INF/container.xml')
  if (!container) throw new Error('Not an EPUB export: META-INF/container.xml is missing.')
  const opfPath = text(container).match(/full-path="([^"]+)"/)?.[1]
  if (!opfPath || !files.has(opfPath)) throw new Error('Package document (OPF) not found in the export.')
  const opf = parseXml(text(files.get(opfPath)!), opfPath)

  const items = new Map<string, { href: string; type: string; props: string }>()
  for (const it of Array.from(opf.getElementsByTagName('item'))) {
    items.set(it.getAttribute('id')!, {
      href: resolvePath(opfPath, it.getAttribute('href')!),
      type: it.getAttribute('media-type') ?? '',
      props: it.getAttribute('properties') ?? '',
    })
  }
  const spine = Array.from(opf.getElementsByTagName('itemref')).map((r) => items.get(r.getAttribute('idref')!)!)
  const coverImage = [...items.values()].find((i) => i.props.includes('cover-image'))?.href

  let cssText = ''
  for (const it of items.values()) if (it.type === 'text/css' && files.has(it.href)) cssText += text(files.get(it.href)!) + '\n'
  const css = new StyleSheet(cssText)

  const images = new Map<string, Uint8Array>()
  for (const it of items.values()) if (it.type.startsWith('image/') && files.has(it.href)) images.set(it.href, files.get(it.href)!)

  const pkg = opf.documentElement
  // InDesign lists every language used in the document (en-GB, en-US, es-ES…): the text decides
  const declared = [
    pkg.getAttribute('xml:lang') || pkg.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'lang') || '',
    ...Array.from(opf.getElementsByTagName('dc:language')).map((e) => (e.textContent ?? '').trim()),
  ].filter(Boolean)

  const blocks: Block[] = []
  const footnotes = new Map<string, Element>()
  let page = ''
  for (const it of spine) {
    if (!it || it.props.includes('nav') || !files.has(it.href)) continue
    const doc = parseXml(text(files.get(it.href)!), it.href)
    // the cover page InDesign generates holds only the placeholder cover image
    if (it.href === resolvePath(opfPath, 'cover.xhtml') || /cover/i.test(doc.body?.id ?? '')) continue
    // a list whose items are all harvested notes: not body text (the bibliography beside it still is)
    const pureNoteList = (el: Element) => {
      const items = Array.from(el.children).filter((ch) => tag(ch) === 'li')
      return items.length > 0 && items.every((li) => !!li.id && footnotes.has(li.id))
    }
    const visit = (c: Element) => {
      const n = pageBreakOf(c)
      if (n !== null) {
        blocks.push({ t: 'pb', n })
        page = n
        return
      }
      const tg = tag(c)
      const et = epubType(c)
      if (/footnotes|endnotes/.test(et) || classesOf(c).includes('_idFootnotes') || et === 'footnote') {
        for (const li of Array.from(c.querySelectorAll('li, aside'))) if (li.id) footnotes.set(li.id, li)
        if (et === 'footnote' && c.id) footnotes.set(c.id, c)
        // InDesign often marks a whole frame "endnotes" that also holds the bibliography and credits
        if (et !== 'footnote') walk(c)
        return
      }
      if ((tg === 'ol' || tg === 'ul') && pureNoteList(c)) {
        // a printed page can start mid-note; keep that marker here, not at the note's reference
        for (const el of Array.from(c.querySelectorAll('*'))) {
          const pn = pageBreakOf(el)
          if (pn !== null) {
            blocks.push({ t: 'pb', n: pn })
            page = pn
          }
        }
        return
      }
      if (/^(p|h[1-6])$/.test(tg)) {
        // inline page markers inside the paragraph still count for "page of this block"
        blocks.push({ t: 'p', el: c, key: styleKey(c), classes: classesOf(c), text: textOf(c), page })
        const inner = Array.from(c.querySelectorAll('*')).map(pageBreakOf).filter((x) => x !== null)
        if (inner.length) page = inner[inner.length - 1]!
      } else if (tg === 'ul' || tg === 'ol') {
          // a real list: every item keeps its place (and depth) in it
          const list = (l: Element, depth: number) => {
            let first = true
            for (const li of Array.from(l.children)) {
              if (tag(li) !== 'li') continue
              const own = li.cloneNode(true) as Element
              for (const n of Array.from(own.querySelectorAll('ul, ol'))) n.remove()
              const start = first && tag(l) === 'ol' && l.getAttribute('start') ? Number(l.getAttribute('start')) : undefined
              blocks.push({ t: 'p', el: own, key: styleKey(li) || styleKey(l) || 'li', classes: classesOf(li).length ? classesOf(li) : classesOf(l), text: textOf(own), page, list: { ordered: tag(l) === 'ol', depth, start } })
              for (const n of Array.from(li.children).filter((x) => /^(ul|ol)$/.test(tag(x)))) list(n, depth + 1)
              first = false
            }
          }
          list(c, 0)
        } else if (tg === 'li') {
          blocks.push({ t: 'p', el: c, key: styleKey(c) || 'li', classes: classesOf(c), text: textOf(c), page })
        } else if (tg === 'table') {
          blocks.push({ t: 'table', el: c, page })
        } else if (tg === 'img') {
          blocks.push({ t: 'img', src: resolvePath(it.href, c.getAttribute('src') ?? ''), page, alt: (c.getAttribute('alt') ?? '').trim() })
        } else if (tg !== 'hr' && tg !== 'script' && tg !== 'style') {
          walk(c)
        }
    }
    const walk = (el: Element) => {
      for (const c of Array.from(el.children)) visit(c)
    }
    walk(doc.body ?? doc.documentElement)
  }

  const lang = pickLanguage(declared, blocks.slice(0, 3000).map((b) => (b.t === 'p' ? b.text : '')).join(' '))
  const creators = Array.from(opf.getElementsByTagName('dc:creator')).map((e) => (e.textContent ?? '').trim()).filter(Boolean)
  return { opfPath, lang, opfTitle: opf.getElementsByTagName('dc:title')[0]?.textContent ?? '', opfCreators: creators, css, blocks, footnotes, images, coverImage }
}

/** Paragraph grouping key: the named paragraph style, or the override classes if it has none. */
export function styleKey(el: Element): string {
  const cls = classesOf(el)
  return cls.find((c) => !isOverride(c)) ?? (cls.join(' ') || '(no style)')
}

// ---------------------------------------------------------------------------------------------
// Style profile: what each paragraph style means. Inferred automatically, confirmed by a human.
// ---------------------------------------------------------------------------------------------

export const ROLES = [
  'p', 'h2', 'h3', 'h4', 'h5', 'chapter-label', 'chapter-title', 'part-label', 'part-title',
  'section-title', 'bullet', 'toc', 'imprint', 'drop',
] as const
export type Role = (typeof ROLES)[number]

export const ROLE_HELP: Record<Role, string> = {
  p: 'Paragraph (kept, with its own CSS class)',
  h2: 'Subheading (h2)',
  h3: 'Subheading (h3)',
  h4: 'Sub-subheading (h4)',
  h5: 'Minor heading (h5)',
  'chapter-label': 'Starts a chapter: label such as "Chapter 1" / "Capítulo 1"',
  'chapter-title': 'Chapter title (joined to the label above it, or starts a chapter on its own)',
  'part-label': 'Starts a part: label such as "Part One"',
  'part-title': 'Part title (joined to the part label)',
  'section-title': 'Starts a front/back-matter section (Dedication, Introduction, Glossary…)',
  bullet: 'Bulleted list item',
  toc: 'Table-of-contents entry (page number is removed, entry becomes a link)',
  imprint: 'Copyright / imprint line (moved to the copyright page)',
  drop: 'Remove from the EPUB',
}

export interface StyleInfo {
  key: string
  count: number
  samples: string[]
  role: Role
  outClass: string
  /** true when the guess is weak and a human should look at it */
  unsure: boolean
  reason: string
}

export type Profile = Record<string, { role: Role; outClass: string }>

const CHAPTER_WORD = /^(cap[ií]tulo|chapter|kapitel|chapitre|capitolo|cap[ií]tol|hoofdstuk|ap[ée]ndice|appendix|anhang|annexe|ep[ií]logo|epilogue|pr[óo]logo|prologue)\b/i
const PART_WORD = /\b(parte|part|teil|partie|deel)\b/i
const BULLET = /^[•●◦▪■·–—-]\s*\t|^[•●◦▪■]\s/
const TOC_LINE = /\t\s*\d+\s*$/
const IMPRINT = /i\.?s\.?b\.?n|©|copyright|dep[óo]sito legal|all rights reserved|todos los derechos|primera edici[óo]n|first published|alle rechte vorbehalten/i
/** Style names InDesign and other exporters use for structure, in any language. Not a book list. */
const TOC_NAME = /^(toc|ihv|inhalt|contents|indice|sumario|sommario|table[-_ ]?of[-_ ]?contents)([-_ ]?[0-9ivx]+|[a-z])?$/i
const IMPRINT_NAME = /impressum|imprint|colophon|copyright|copy-?right|legal/i
const PAGE_NUM_CLASS = /seitenzahl|pagenum(?:ber)?|page[-_ ]?number|toc[-_ ]?page/i

/** A contents page-number span: a named page-number class, or a trailing optical span that is only the number.
 *  A chapter number earlier in the line ("Capítulo 1") is not a page number. */
const isTocPageSpan = (el: Element) => {
  const cls = el.getAttribute('class') ?? ''
  if (PAGE_NUM_CLASS.test(cls)) return true
  if (!/optisch|toc|ihv/i.test(cls) || !/^\s*(\d{1,4}|[ivxlcdm]{1,8})\s*$/i.test(el.textContent ?? '')) return false
  let n: Node | null = el
  while (n && (n as Element).localName !== 'body') {
    for (let s = n.nextSibling; s; s = s.nextSibling) if ((s.textContent ?? '').trim()) return false
    const p = n.parentNode
    if (!p || /^(p|h[1-6]|body)$/.test((p as Element).localName ?? '')) break
    n = p
  }
  return true
}

/** Contents entry with the printed page number taken off. A number that is part of the title ("Capítulo 3") stays. */
export function tocEntryText(el: Element): string {
  const clone = el.cloneNode(true) as Element
  for (const s of Array.from(clone.querySelectorAll('[class]'))) if (isTocPageSpan(s)) s.remove()
  // textOf turns the tab before a page number into a space, so remember the tab first
  const hadTab = /\t\s*(\d+|[ivxlcdm]+)\s*$/i.test(clone.textContent ?? '')
  const t = textOf(clone)
  return (hadTab ? t.replace(/\s+(\d+|[ivxlcdm]+)\s*$/i, '') : t).trim()
}

const hasPageSpan = (el: Element) =>
  Array.from(el.querySelectorAll('[class]')).some((s) => PAGE_NUM_CLASS.test(s.getAttribute('class') ?? '') && /\d/.test(s.textContent ?? ''))

const headingRoleOfTag = (tg: string): Role | undefined =>
  tg === 'h1' ? 'chapter-title' : tg === 'h2' ? 'h2' : tg === 'h3' ? 'h3' : tg === 'h4' ? 'h4' : tg === 'h5' || tg === 'h6' ? 'h5' : undefined

/** Named paragraph styles that mean a heading level. h1 opens a chapter; h2–h6 stay inside it. */
const NAMED_HEAD: [Role, RegExp][] = [
  ['chapter-title', /^(h1|heading[-_ ]?1|chapter([-_ ]?(title|name|head(ing)?))?|kapitel([-_ ]?titel)?|titulo[-_ ]?capitulo)$/i],
  ['h2', /^(h2|heading[-_ ]?2)$/i],
  ['h3', /^(h3|heading[-_ ]?3)$/i],
  ['h4', /^(h4|heading[-_ ]?4)$/i],
  ['h5', /^(h5|h6|heading[-_ ]?[56])$/i],
]

export const cssClassName = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^(\d)/, 'c$1')

export function inferProfile(ex: Export, saved: Profile = {}): StyleInfo[] {
  type Group = { blocks: Extract<Block, { t: 'p' }>[]; next: Map<string, number> }
  const byKey = new Map<string, Group>()
  const ps = ex.blocks.filter((b): b is Extract<Block, { t: 'p' }> => b.t === 'p')
  const nonEmpty = ps.filter((b) => b.text)
  for (let i = 0; i < nonEmpty.length; i++) {
    const b = nonEmpty[i]
    const e: Group = byKey.get(b.key) ?? { blocks: [], next: new Map() }
    e.blocks.push(b)
    const nx = nonEmpty[i + 1]
    if (nx) e.next.set(nx.key, (e.next.get(nx.key) ?? 0) + 1)
    byKey.set(b.key, e)
  }
  for (const b of ps) if (!byKey.has(b.key)) byKey.set(b.key, { blocks: [], next: new Map() })

  const decl = (k: string): Decls => {
    const b = byKey.get(k)!.blocks[0] ?? ps.find((p) => p.key === k)!
    // an <h1 class="h1"> is styled by `h1.h1`, not `p.h1`
    const tg = tag(b.el)
    return ex.css.decls(/^h[1-6]$/.test(tg) ? tg : 'p', b.classes)
  }
  const chars = (k: string) => byKey.get(k)!.blocks.reduce((n, b) => n + b.text.length, 0)
  const avgLen = (k: string) => chars(k) / Math.max(1, byKey.get(k)!.blocks.length)
  const share = (k: string, re: RegExp, src: 'text' | 'raw' = 'text') => {
    const bl = byKey.get(k)!.blocks
    if (!bl.length) return 0
    return bl.filter((b) => re.test(src === 'raw' ? (b.el.textContent ?? '') : b.text)).length / bl.length
  }
  const keys = [...byKey.keys()]
  const bodyKey = keys.filter((k) => avgLen(k) > 80).sort((a, b) => chars(b) - chars(a))[0] ?? keys[0]
  const bodySize = em(decl(bodyKey)['font-size'])
  const bodySans = isSans(decl(bodyKey)['font-family'])

  const size = (k: string) => em(decl(k)['font-size']) / bodySize
  const centered = (k: string) => decl(k)['text-align'] === 'center'
  const display = (k: string) => centered(k) && size(k) >= 1.15 && avgLen(k) < 120
  const follower = (k: string) => {
    const nx = [...byKey.get(k)!.next.entries()].sort((a, b) => b[1] - a[1])[0]
    return nx && nx[1] / byKey.get(k)!.blocks.length >= 0.7 ? nx[0] : undefined
  }

  const infos: StyleInfo[] = []
  const roles = new Map<string, [Role, string, boolean]>()
  const mark = (k: string, role: Role, reason: string, unsure: boolean) => {
    if (!roles.has(k)) roles.set(k, [role, reason, unsure])
  }
  const isTocLine = (b: Extract<Block, { t: 'p' }>) => TOC_LINE.test(b.el.textContent ?? '') || hasPageSpan(b.el) || (TOC_NAME.test(b.key) && /\d/.test(b.el.textContent ?? ''))
  // the export already tagged the heading, or the style is named h1 / h2 / impressum / toc
  for (const k of keys) {
    const bl = byKey.get(k)!.blocks.filter((b) => b.text)
    if (!bl.length || k === bodyKey) continue
    const tg = tag(bl[0].el)
    const fromTag = bl.every((b) => tag(b.el) === tg) ? headingRoleOfTag(tg) : undefined
    if (fromTag && avgLen(k) < 180) mark(k, fromTag, `paragraphs are <${tg}> elements`, false)
    const named = NAMED_HEAD.find(([, re]) => re.test(k))
    if (named && avgLen(k) < 180) mark(k, named[0], `style name “${k}” is a heading`, false)
    if (TOC_NAME.test(k)) mark(k, 'toc', `style name “${k}” is a contents entry`, false)
    if (IMPRINT_NAME.test(k)) mark(k, 'imprint', `style name “${k}” is the imprint`, false)
  }
  // pass 1: label/title pairs
  for (const k of keys) {
    const f = follower(k)
    if (!f || byKey.get(k)!.blocks.length < 2 || f === k || roles.has(k) || roles.has(f)) continue
    if (centered(k) && avgLen(k) < 40 && display(f)) {
      const part = share(k, PART_WORD) >= 0.6
      roles.set(k, [part ? 'part-label' : 'chapter-label', 'short centred line always followed by a large title style', false])
      roles.set(f, [part ? 'part-title' : 'chapter-title', `title that follows "${k}"`, false])
    }
  }
  // pass 1b: no chapter style yet (a book whose chapter heads are one line, "I. Coordenadas…").
  // The contents page names every chapter: a title line, then its author/page line, or one line "Title <tab> page".
  // A named contents style found earlier must not block this.
  if (![...roles.values()].some(([r]) => r === 'chapter-title')) {
    const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '')
    const isToc = (b: Extract<Block, { t: 'p' }>) => TOC_LINE.test(b.el.textContent ?? '') || hasPageSpan(b.el)
    const entries = new Set<string>()
    let last = -1
    nonEmpty.forEach((b, i) => {
      if (!isToc(b)) return
      last = i
      const before = nonEmpty[i - 1]
      // a title line, then its author/page line; or one line "Title <tab> page"
      const t = before && !isToc(before) && before.key !== b.key ? before.text : tocEntryText(b.el)
      if (norm(t).length > 3) entries.add(norm(t))
    })
    if (entries.size >= 3) {
      const hits = new Map<string, number>()
      for (const b of nonEmpty.slice(last + 1)) if (!isToc(b) && entries.has(norm(b.text))) hits.set(b.key, (hits.get(b.key) ?? 0) + 1)
      for (const [k, n] of hits) {
        const total = byKey.get(k)!.blocks.length
        if (n >= 3 && n >= total * 0.5 && k !== bodyKey) mark(k, 'chapter-title', 'its lines are the chapters named in the contents', false)
      }
    }
  }
  for (const k of keys) {
    if (roles.has(k)) continue
    const bl = byKey.get(k)!.blocks
    const d = decl(k)
    const indent = px(d['text-indent'])
    const left = px(d['margin-left'])
    let r: [Role, string, boolean]
    const tocLines = bl.filter((b) => b.text && isTocLine(b)).length
    if (!bl.length) r = ['drop', 'only ever empty', false]
    else if (tocLines / Math.max(1, bl.filter((b) => b.text).length) >= 0.6) r = ['toc', 'lines end with a page number', false]
    else if (share(k, BULLET, 'raw') >= 0.6) r = ['bullet', 'lines start with a bullet character', false]
    else if (k !== bodyKey && (IMPRINT_NAME.test(k) || share(k, IMPRINT) >= 0.5)) r = ['imprint', 'ISBN / © / legal lines', !IMPRINT_NAME.test(k)]
    else if (display(k)) r = ['section-title', 'large centred heading not paired with a label', false]
    else if (k !== bodyKey && isHeading(ex, k, d, bl, bodySans, avgLen(k))) r = ['h3', 'short, bold/small-caps/sans line with space around it', bl.length < 3]
    else if (CHAPTER_WORD.test(bl[0]?.text ?? '') && centered(k) && bl.length < 3) r = ['p', 'centred short line', true]
    else r = ['p', k === bodyKey ? 'main body text style' : indent < 0 ? 'hanging indent' : left > 0 ? 'indented block' : 'paragraph', false]
    roles.set(k, r)
  }
  for (const k of keys) {
    const [role, reason, unsure] = roles.get(k)!
    const auto = { role, outClass: outClassFor(ex, k, role, decl(k)) }
    const s = saved[k]
    infos.push({
      key: k,
      count: byKey.get(k)!.blocks.length,
      samples: byKey.get(k)!.blocks.slice(0, 3).map((b) => b.text.slice(0, 140)),
      role: s?.role ?? auto.role,
      outClass: s?.outClass ?? auto.outClass,
      unsure: s ? false : unsure,
      reason: s ? 'from saved publisher profile' : reason,
    })
  }
  return infos.sort((a, b) => b.count - a.count)
}

const isSans = (fam = '') => /sans|avenir|helvetica|arial|futura|gill|myriad|frutiger|univers|verdana|din\b/i.test(fam)

function isHeading(ex: Export, k: string, d: Decls, bl: Extract<Block, { t: 'p' }>[], bodySans: boolean, avg: number) {
  if (avg > 150 || px(d['margin-left']) > 0 || d['text-align'] === 'center') return false
  if (bl.filter((b) => /[.;,]$/.test(b.text)).length / bl.length > 0.3) return false
  const face = ex.css.paragraphFace(bl[0].classes)
  const spaced = d['page-break-after'] === 'avoid' || px(d['margin-top']) >= 10 || px(d['margin-bottom']) >= 10
  const distinct = face.bold || face.smallCaps || isSans(d['font-family']) !== bodySans
  if (distinct && spaced && !isOverride(k)) return true
  // override-only paragraphs that are entirely bold: a heading typed by hand
  return bl.every((b) => b.text.length < 90 && fullyBold(ex, b.el))
}

function fullyBold(ex: Export, p: Element) {
  let total = 0
  let bold = 0
  const base = ex.css.paragraphFace(classesOf(p))
  const walk = (el: Element, face: typeof base) => {
    for (const n of Array.from(el.childNodes)) {
      if (n.nodeType === 3) {
        const len = (n.textContent ?? '').trim().length
        total += len
        if (face.bold) bold += len
      } else if (n.nodeType === 1) walk(n as Element, ex.css.spanFace(classesOf(n as Element), face))
    }
  }
  walk(p, base)
  return total > 0 && bold === total
}

function outClassFor(ex: Export, k: string, role: Role, d: Decls): string {
  if (!isOverride(k.split(' ')[0]) && k !== '(no style)' && k !== 'li') return cssClassName(k)
  if (role === 'h2' || role === 'h3' || role === 'h4' || role === 'h5') return 'sec1'
  const indent = px(d['text-indent'])
  const left = px(d['margin-left'])
  // a hanging indent starts its first line at the margin (bibliographies); an indented block whose
  // first line still sits inside the margin reads as an extract (Pregunta/Respuesta, client feedback V3)
  if (indent < 0 && left + indent <= 2) return 'hang'
  if (left > 0) return settings().blockClass
  if (d['text-align'] === 'center') return 'center'
  return indent > 0 ? 'indent' : 'noindent'
}
