import { StyleSheet, isOverride, px, em, type Decls } from './css.ts'
import { type Files, text } from '../zip.ts'
import { parseXml, resolvePath, tag, classesOf, textOf, pageBreakOf, epubType } from '../xml.ts'
import { pickLanguage } from '../lang.ts'

// ---------------------------------------------------------------------------------------------
// Reading an InDesign "Export > EPUB (reflowable)" package and flattening it to a block stream.
// ---------------------------------------------------------------------------------------------

export type Block =
  | { t: 'pb'; n: string }
  | { t: 'p'; el: Element; key: string; classes: string[]; text: string; page: string }
  | { t: 'table'; el: Element; page: string }
  | { t: 'img'; src: string; page: string; alt: string }

export interface Export {
  opfPath: string
  lang: string
  opfTitle: string
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
    const walk = (el: Element) => {
      for (const c of Array.from(el.children)) {
        const n = pageBreakOf(c)
        if (n !== null) {
          blocks.push({ t: 'pb', n })
          page = n
          continue
        }
        const tg = tag(c)
        const et = epubType(c)
        if (/footnotes|endnotes/.test(et) || classesOf(c).includes('_idFootnotes') || et === 'footnote') {
          for (const li of Array.from(c.querySelectorAll('li, aside'))) if (li.id) footnotes.set(li.id, li)
          if (et === 'footnote' && c.id) footnotes.set(c.id, c)
          continue
        }
        if (/^(p|h[1-6])$/.test(tg)) {
          // inline page markers inside the paragraph still count for "page of this block"
          blocks.push({ t: 'p', el: c, key: styleKey(c), classes: classesOf(c), text: textOf(c), page })
          const inner = Array.from(c.querySelectorAll('*')).map(pageBreakOf).filter((x) => x !== null)
          if (inner.length) page = inner[inner.length - 1]!
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
    }
    walk(doc.body ?? doc.documentElement)
  }

  const lang = pickLanguage(declared, blocks.slice(0, 3000).map((b) => (b.t === 'p' ? b.text : '')).join(' '))
  return { opfPath, lang, opfTitle: opf.getElementsByTagName('dc:title')[0]?.textContent ?? '', css, blocks, footnotes, images, coverImage }
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
  'p', 'h3', 'h4', 'h5', 'chapter-label', 'chapter-title', 'part-label', 'part-title',
  'section-title', 'bullet', 'toc', 'imprint', 'drop',
] as const
export type Role = (typeof ROLES)[number]

export const ROLE_HELP: Record<Role, string> = {
  p: 'Paragraph (kept, with its own CSS class)',
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
const IMPRINT = /i\.?s\.?b\.?n|©|copyright|dep[óo]sito legal|all rights reserved|todos los derechos|primera edici[óo]n|first published/i

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
    return ex.css.decls('p', b.classes)
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
  for (const k of keys) {
    if (roles.has(k)) continue
    const bl = byKey.get(k)!.blocks
    const d = decl(k)
    const indent = px(d['text-indent'])
    const left = px(d['margin-left'])
    let r: [Role, string, boolean]
    if (!bl.length) r = ['drop', 'only ever empty', false]
    else if (share(k, TOC_LINE, 'raw') >= 0.6) r = ['toc', 'lines end with a tab and a page number', false]
    else if (share(k, BULLET, 'raw') >= 0.6) r = ['bullet', 'lines start with a bullet character', false]
    else if (k !== bodyKey && (/imprint|copyright|legal|credit/i.test(k) || share(k, IMPRINT) >= 0.5)) r = ['imprint', 'ISBN / © / legal lines', !/imprint|copyright|legal|credit/i.test(k)]
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
  if (role === 'h3' || role === 'h4' || role === 'h5') return 'sec1'
  const indent = px(d['text-indent'])
  if (indent < 0) return 'hang'
  if (px(d['margin-left']) > 0) return 'extract'
  if (d['text-align'] === 'center') return 'center'
  return indent > 0 ? 'indent' : 'noindent'
}
