import { type Files, bytes, zipEpub } from '../zip.ts'
import { esc, xhtmlDoc } from '../xml.ts'
import { type Decls } from '../indesign/css.ts'
import { labelsFor, type Labels, type SectionType } from './locale.ts'
import { buildCss, formatCss } from './css.ts'
import { mediaType } from './image.ts'
import { validateEpub } from './validate.ts'
import { settings, htmlLangAttrs } from '../settings.ts'

export interface BookMeta {
  title: string
  subtitle: string
  authors: string // comma separated
  publisher: string
  language: string
  eisbn: string // as printed, hyphens allowed
  printIsbn: string
  rights: string
  certifiedBy: string
  conformsTo: string
  /** accessible = full EPUB accessibility (roles, page list, metadata); standard = clean EPUB 3 for the stores */
  profile?: 'accessible' | 'standard'
}

/** Right-to-left scripts: the book reads from the right. */
export const isRtl = (lang: string) => /^(ar|he|iw|fa|ur|yi|ps|sd|ug|dv)(-|_|$)/i.test(lang)

/**
 * Standard EPUB (the client's "Standard vs Accessible tag differences" sheet): the same book in plain markup.
 * Headings are classed paragraphs, bold and italic are <b> and <i>, a figure is a <div> with a caption paragraph,
 * lists are paragraphs with their bullet or number typed in, quotes are <div class="top">, tables have bare rows,
 * notes carry no roles, page numbers are <a id="Page_1"/>, and the section / language wrappers and all ARIA go.
 */
export function toStandard(body: string, L: Pick<Labels, 'imageAlt' | 'decorativeAlt'> = { imageAlt: 'image', decorativeAlt: 'decorative' }): string {
  let out = body
  // page markers
  out = out.replace(/<(span|div)\b([^>]*?)(?:\/>|>\s*<\/\1>)/g, (m, _t, attrs: string) => {
    if (!/epub:type="pagebreak"/.test(attrs)) return m
    const id = attrs.match(/\bid="page-([^"]+)"/)?.[1]
    return id ? `<a id="Page_${id}"/>` : ''
  })
  // wrappers: sections, the language div, footnote boxes (the first paragraph keeps the box's id so note links still land)
  out = out.replace(/<\/?section\b[^>]*>\n?/g, '')
  out = out.replace(/<div\b[^>]*\bxml:lang="[^"]*"[^>]*>\n?([\s\S]*?)\n?<\/div>/g, '$1')
  out = out.replace(/<div\b([^>]*epub:type="footnote"[^>]*)>\n?([\s\S]*?)\n?<\/div>/g, (_m, attrs: string, inner: string) => {
    const id = attrs.match(/\bid="([^"]+)"/)?.[1]
    return id ? inner.replace(/<p\b/, `<p id="${id}"`) : inner
  })
  // headings → paragraphs, quotes → div.top, figures → divs
  out = out.replace(/<h([1-6])\b([^>]*)>/g, '<p$2>').replace(/<\/h[1-6]>/g, '</p>')
  out = out.replace(/<blockquote\b[^>]*>/g, '<div class="top">').replace(/<\/blockquote>/g, '</div>')
  out = out.replace(/<figure\b([^>]*)>/g, '<div$1>').replace(/<\/figure>/g, '</div>')
  out = out.replace(/(<div class="fig_group">\s*)(<img\b[^>]*\/>)/g, '$1<p class="image_Container">$2</p>') // the picture sits in its own paragraph
  out = out.replace(/<figcaption\b([^>]*)>/g, '<p$1>').replace(/<\/figcaption>/g, '</p>')
  // tables: bare rows, header cells as plain cells (class tbl-h keeps them bold)
  out = out.replace(/<\/?(?:thead|tbody|tfoot)\b[^>]*>\n?/g, '')
  out = out.replace(/<th\b([^>]*)>/g, (_m, attrs: string) => {
    attrs = attrs.replace(/\s+scope="[^"]*"/, '')
    return /\bclass="/.test(attrs) ? `<td${attrs.replace(/class="([^"]*)"/, 'class="$1 tbl-h"')}>` : `<td class="tbl-h"${attrs}>`
  }).replace(/<\/th>/g, '</td>')
  // pictures: the default description, as the language sheet gives it
  out = out.replace(/<img\b([^>]*?)\/>/g, (m, attrs: string) => {
    if (/class="(?:cv|w1)"/.test(attrs)) return m
    const alt = /\balt="([^"]*)"/.exec(attrs)
    return `<img${alt ? attrs.replace(/\balt="[^"]*"/, `alt="${alt[1] ? L.imageAlt : L.decorativeAlt}"`) : ` alt="${L.imageAlt}"${attrs}`}/>`
  })
  out = listsAsParagraphs(out)
  out = bAndI(out)
  // the accessibility layer: ARIA, roles, epub:type
  const attr = /(<[a-z][^<>]*?)\s(?:role|aria-[a-z]+|epub:type)="[^"]*"/g
  for (let prev = ''; prev !== out; ) (prev = out), (out = out.replace(attr, '$1')) // one attribute per pass and tag
  return out
}

/** `<span class="italic">` / `bold` (alone or together) → <i> / <b>; other spans stay. */
function bAndI(html: string): string {
  const stack: string[] = []
  return html.replace(/<span\b([^>]*)>|<\/span>/g, (m, attrs?: string) => {
    if (attrs === undefined) return stack.pop() ?? m
    const cls = attrs.match(/^\s*class="([^"]*)"\s*$/)?.[1]?.split(/\s+/).filter(Boolean)
    if (cls?.length && cls.every((c) => c === 'bold' || c === 'italic')) {
      const open = [cls.includes('bold') ? 'b' : '', cls.includes('italic') ? 'i' : ''].filter(Boolean)
      stack.push(open.reverse().map((t) => `</${t}>`).join(''))
      return open.reverse().map((t) => `<${t}>`).join('')
    }
    stack.push('</span>')
    return m
  })
}

/** `<ul><li>` / `<ol><li>` → `<p class="bull">• …</p>` / `<p class="num">1. …</p>` (nested lists get "bull2", "bull3"…). */
function listsAsParagraphs(html: string): string {
  const stack: { ordered: boolean; n: number }[] = []
  let open = false // a <p> of the current item is open
  const closeP = () => (open ? ((open = false), '</p>\n') : '')
  return html.replace(/<(ul|ol)\b([^>]*)>\n?|<\/(?:ul|ol)>\n?|<li\b[^>]*>|<\/li>\n?/g, (m, kind?: string, attrs?: string) => {
    if (kind) {
      const start = Number(attrs?.match(/\bstart="(\d+)"/)?.[1] ?? 1)
      const pre = closeP() // text before a nested list ends its item's paragraph
      stack.push({ ordered: kind === 'ol', n: start - 1 })
      return pre
    }
    if (m.startsWith('</ul') || m.startsWith('</ol')) {
      stack.pop()
      return closeP()
    }
    if (m.startsWith('</li')) return closeP()
    const top = stack[stack.length - 1]
    if (!top) return m
    top.n++
    open = true
    const depth = stack.length
    return `<p class="${top.ordered ? 'num' : 'bull'}${depth > 1 ? depth : ''}">${top.ordered ? `${top.n}. ` : '• '}`
  })
}

/** Standard EPUB stylesheet: headings are paragraphs now, so their rules select `p`; lists and header cells keep their look. */
export function standardCss(css: string): string {
  return (
    css.replace(/(^|[,\s])h[1-6](?=\.)/gm, '$1p') +
    `\n/* standard e-book: lists and header cells are plain paragraphs and cells */\np.bull, p.num { margin: 0 0 0 1.5em; text-indent: -1em; }\np.bull2, p.num2 { margin: 0 0 0 3em; text-indent: -1em; }\np.bull3, p.num3 { margin: 0 0 0 4.5em; text-indent: -1em; }\ntd.tbl-h { font-weight: bold; }\n`
  )
}

export interface Section {
  file: string
  id: string
  type: SectionType
  nav: string
  title: string
  parent?: string
  body: string
}

export interface ReviewItem {
  level: 'error' | 'warn' | 'info'
  msg: string
  where?: string
}

export interface ImageOut {
  path: string
  data: Uint8Array
}

const FRONT: SectionType[] = ['halftitle', 'title', 'copyright', 'dedication', 'epigraph', 'toc', 'list']
export const isbnDigits = (s: string) => s.replace(/[^\dXx]/g, '').toUpperCase()

export function isbn13Valid(s: string): boolean {
  const d = isbnDigits(s)
  if (!/^\d{13}$/.test(d)) return false
  const sum = [...d.slice(0, 12)].reduce((a, c, i) => a + Number(c) * (i % 2 ? 3 : 1), 0)
  return (10 - (sum % 10)) % 10 === Number(d[12])
}

export function packageEpub(p: {
  meta: BookMeta
  sections: Section[]
  cover: ImageOut
  images: ImageOut[]
  usedClasses: Map<string, { tag: string; decls: Decls }>
  bodyDecls: Decls
  review: ReviewItem[]
  /** ready-made stylesheet (PDF pipeline); otherwise generated from InDesign styles */
  css?: string
}): { epub: Uint8Array; files: Files } {
  const { meta, review } = p
  const standard = (meta.profile ?? settings().defaultProfile) === 'standard'
  const rtl = isRtl(meta.language)
  const L = labelsFor(meta.language)
  const sections = standard ? p.sections.map((x) => ({ ...x, body: toStandard(x.body, L) })) : p.sections
  const pageList = sections.flatMap((s) => [...s.body.matchAll(/id="(?:page-|Page_)([^"]+)"/g)].map((m) => ({ n: m[1], file: s.file })))
  const lang = meta.language
  const files: Files = new Map()
  const put = (path: string, s: string) => files.set(path, bytes(s))
  const title = meta.subtitle ? `${meta.title}. ${meta.subtitle}` : meta.title
  const authors = meta.authors.split(/\s*[,;]\s*/).filter(Boolean)

  if (!meta.title.trim()) review.push({ level: 'error', msg: 'The book has no title.' })
  if (!authors.length) review.push({ level: 'warn', msg: 'No author is set.' })
  if (!meta.publisher.trim()) review.push({ level: 'warn', msg: 'No publisher is set (it is left out of the package).' })
  if (!isbn13Valid(meta.eisbn)) review.push({ level: 'error', msg: `E-book ISBN "${meta.eisbn}" is missing or not a valid ISBN-13.` })
  if (meta.printIsbn && !isbn13Valid(meta.printIsbn)) review.push({ level: 'warn', msg: `Print ISBN "${meta.printIsbn}" is not a valid ISBN-13.` })

  // standard: no language on the page (it is in the package); the title of every page is the book's
  const langAttrs = (standard ? '' : htmlLangAttrs(lang)) + (rtl ? ' dir="rtl"' : '')
  const docTitle = (t: string) => (standard ? title : t)
  const doc = (t: string, body: string) => xhtmlDoc(langAttrs, docTitle(t), 'css/style.css', body, standard)
  // ---- content documents ----
  const coverAlt = L.coverAlt({ title, authors: authors.join(', '), publisher: meta.publisher })
  // house style: the content of every page sits in <div xml:lang="…"> inside its section
  const langDiv = (body: string) =>
    !settings().langWrapper || standard ? body :
    /^<section[^>]*>/.test(body) && body.trimEnd().endsWith('</section>')
      ? body.replace(/^(<section[^>]*>)/, `$1\n<div xml:lang="${lang}">`).replace(/<\/section>\s*$/, '</div>\n</section>')
      : `<div xml:lang="${lang}">\n${body}\n</div>`
  const coverP = `<p class="cover"><img alt="${esc(coverAlt)}" class="cv" id="cimg"${standard ? '' : ' role="doc-cover"'} src="${p.cover.path}"/></p>`
  put('OEBPS/cover.xhtml', doc(L.cover, standard ? coverP : `<section epub:type="cover">\n${langDiv(coverP)}\n</section>`))
  for (const s of sections) put(`OEBPS/${s.file}`, doc(s.title, langDiv(s.body)))
  const extra = settings().extraCss.trim()
  put('OEBPS/css/style.css', (standard ? standardCss : (c: string) => c)(formatCss(p.css ?? buildCss(p.usedClasses, p.bodyDecls))) + (extra ? `\n/* house additions (Settings) */\n${extra}\n` : ''))
  files.set(`OEBPS/${p.cover.path}`, p.cover.data)
  for (const im of p.images) files.set(`OEBPS/${im.path}`, im.data)

  // ---- navigation: nav.xhtml (EPUB 3) and toc.ncx (EPUB 2 readers) ----
  type Entry = { label: string; href: string; kids: Entry[] }
  const tree: Entry[] = [{ label: L.cover, href: 'cover.xhtml#cimg', kids: [] }]
  const byFile = new Map<string, Entry>()
  for (const s of sections) {
    if (!s.nav) continue // untitled pages (full-page pictures) are in the spine, not the TOC
    const e: Entry = { label: s.nav, href: s.file, kids: [] }
    byFile.set(s.file, e)
    ;(s.parent && byFile.get(s.parent) ? byFile.get(s.parent)!.kids : tree).push(e)
  }
  const ol = (es: Entry[]): string =>
    `<ol class="nav">\n${es.map((e) => `<li><a href="${e.href}">${esc(e.label)}</a>${e.kids.length ? '\n' + ol(e.kids) : ''}</li>`).join('\n')}\n</ol>`
  const tocSec = sections.find((s) => s.type === 'toc')
  const titleSec = sections.find((s) => s.type === 'title')
  const bodyStart = sections.find((s) => !FRONT.includes(s.type) && !(s.type === 'other' && s.file.startsWith('fm'))) ?? sections[0]
  put('OEBPS/nav.xhtml', doc(L.navTitle, standard ? `<nav epub:type="toc" id="toc">\n${ol(tree)}\n</nav>` : [
    // EPUBCheck's navigation schema rejects aria-label(ledby) on <nav>: the headings name them
    `<section epub:type="frontmatter">`,
    settings().langWrapper ? `<div xml:lang="${lang}">` : '',
    `<nav epub:type="toc" id="toc"${standard ? '' : ' role="doc-toc"'}>`,
    `<h1 id="toc01">${esc(L.navTitle)}</h1>`,
    ol(tree),
    `</nav>`,
    pageList.length && !standard
      ? `<nav epub:type="page-list" hidden="" role="doc-pagelist">\n<h2>${esc(L.pageList)}</h2>\n<ol class="nav">\n${pageList.map((pg) => `<li><a href="${pg.file}#page-${esc(pg.n)}">${esc(pg.n)}</a></li>`).join('\n')}\n</ol>\n</nav>`
      : '',
    `<nav epub:type="landmarks" hidden="" role="navigation">`,
    `<h2>${esc(L.landmarks)}</h2>`,
    `<ol class="nav">`,
    `<li><a epub:type="cover" href="cover.xhtml">${esc(L.cover)}</a></li>`,
    titleSec ? `<li><a epub:type="titlepage" href="${titleSec.file}">${esc(L.title)}</a></li>` : '',
    tocSec ? `<li><a epub:type="toc" href="${tocSec.file}">${esc(tocSec.nav || L.navTitle)}</a></li>` : '',
    bodyStart ? `<li><a epub:type="bodymatter" href="${bodyStart.file}">${esc(L.startReading)}</a></li>` : '',
    `</ol>`,
    `</nav>`,
    settings().langWrapper ? `</div>` : '',
    `</section>`,
  ].filter(Boolean).join('\n')))

  let play = 0
  const navPoints = (es: Entry[]): string =>
    es.map((e) => {
      const n = ++play
      return `<navPoint id="navPoint${n}" playOrder="${n}"><navLabel><text>${esc(e.label)}</text></navLabel><content src="${e.href}"/>${e.kids.length ? '\n' + navPoints(e.kids) + '\n' : ''}</navPoint>`
    }).join('\n')
  const navMap = navPoints(tree)
  const maxPage = Math.max(0, ...pageList.map((x) => Number(x.n)).filter((n) => !isNaN(n)))
  put('OEBPS/toc.ncx', `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="${lang}">
<head>
<meta name="dtb:uid" content="urn:isbn:${isbnDigits(meta.eisbn)}"/>
<meta name="dtb:depth" content="${tree.some((e) => e.kids.length) ? 2 : 1}"/>
<meta name="dtb:totalPageCount" content="${maxPage}"/>
<meta name="dtb:maxPageNumber" content="${maxPage}"/>
</head>
<docTitle><text>${esc(title)}</text></docTitle>
${authors.map((a) => `<docAuthor><text>${esc(a)}</text></docAuthor>`).join('\n')}
<navMap>
${navMap}
</navMap>
${pageList.length ? `<pageList>\n<navLabel><text>${esc(L.pageList)}</text></navLabel>\n${pageList.map((pg) => `<pageTarget id="pt-${esc(pg.n)}" type="${/^\d+$/.test(pg.n) ? 'normal' : 'front'}" value="${esc(pg.n)}" playOrder="${++play}"><navLabel><text>${esc(pg.n)}</text></navLabel><content src="${pg.file}#${standard ? "Page_" : "page-"}${esc(pg.n)}"/></pageTarget>`).join('\n')}\n</pageList>` : ''}
</ncx>
`)

  // ---- package document ----
  const now = new Date()
  const modified = now.toISOString().replace(/\.\d+Z$/, 'Z')
  const allImgs = [p.cover, ...p.images]
  const html = sections.map((s) => s.body).join('\n')
  const features = ['tableOfContents', 'readingOrder', 'structuralNavigation', 'displayTransformability', 'ARIA']
  if (pageList.length) features.push('pageNavigation')
  if (/<img alt="[^"]+"/.test(html) || coverAlt) features.push('alternativeText')
  if (/doc-noteref/.test(html)) features.push('annotations')
  if (/<th[\s>]/.test(html)) features.push('tableHeaders') // only when tables really have header cells
  if (/<math[\s>]/.test(html)) features.push('MathML')
  if (sections.some((s) => s.type === 'index')) features.push('index')
  const a11yMeta = [
    ...features.map((f) => `<meta property="schema:accessibilityFeature">${f}</meta>`),
    '<meta property="schema:accessibilityHazard">noFlashingHazard</meta>',
    '<meta property="schema:accessibilityHazard">noMotionSimulationHazard</meta>',
    '<meta property="schema:accessibilityHazard">noSoundHazard</meta>',
    `<meta property="schema:accessibilitySummary">${esc(L.a11ySummary)}</meta>`,
    '<meta property="schema:accessMode">textual</meta>',
    '<meta property="schema:accessMode">visual</meta>',
    '<meta property="schema:accessModeSufficient">textual</meta>',
    '<meta property="schema:accessModeSufficient">textual,visual</meta>',
    `<meta property="dcterms:conformsTo">${esc(meta.conformsTo)}</meta>`,
    meta.certifiedBy ? `<meta property="a11y:certifiedBy">${esc(meta.certifiedBy)}</meta>` : '',
  ].filter(Boolean).join('\n')
  const unique = new Map<string, ImageOut>()
  for (const im of allImgs) unique.set(im.path, im)
  const manifest = [
    `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    `<item id="style" href="css/style.css" media-type="text/css"/>`,
    `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`,
    `<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>`,
    ...sections.map((s) => {
      // content that needs a declaration in the package (EPUBCheck OPF-014)
      const props = [/<math[\s>]/.test(s.body) && 'mathml', /<svg[\s>]/.test(s.body) && 'svg', /<script[\s>]/.test(s.body) && 'scripted', /(src|href)="https?:\/\/[^"]*\.(jpe?g|png|gif|mp3|mp4|css)"/.test(s.body) && 'remote-resources'].filter(Boolean).join(' ')
      return `<item id="${s.id}" href="${s.file}" media-type="application/xhtml+xml"${props ? ` properties="${props}"` : ''}/>`
    }),
    ...[...unique.values()].map((im, i) =>
      im === p.cover
        ? `<item id="cover-image" href="${im.path}" media-type="${mediaType(im.path)}" properties="cover-image"/>`
        : `<item id="img${i}" href="${im.path}" media-type="${mediaType(im.path)}"/>`),
  ]
  put('OEBPS/content.opf', `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id" xml:lang="${lang}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="pub-id">urn:isbn:${isbnDigits(meta.eisbn)}</dc:identifier>
<dc:title id="pub-title">${esc(title)}</dc:title>
<dc:language>${esc(lang)}</dc:language>
${authors.map((a, i) => `<dc:creator id="author${i + 1}">${esc(a)}</dc:creator>\n<meta refines="#author${i + 1}" property="role" scheme="marc:relators">aut</meta>`).join('\n')}
${meta.publisher.trim() ? `<dc:publisher>${esc(meta.publisher.trim())}</dc:publisher>` : ''}
${meta.rights ? `<dc:rights>${esc(meta.rights)}</dc:rights>` : ''}
<dc:description>${esc(title)}${authors.length ? ` — ${esc(authors.join(', '))}` : ''}</dc:description>
<dc:date>${modified.slice(0, 10)}</dc:date>
${meta.printIsbn ? `<dc:source id="src-id">urn:isbn:${isbnDigits(meta.printIsbn)}</dc:source>${pageList.length ? `\n<meta property="pageBreakSource">urn:isbn:${isbnDigits(meta.printIsbn)}</meta>` : ''}` : ''}
<meta property="dcterms:modified">${modified}</meta>
${standard ? '' : a11yMeta}
<meta name="cover" content="cover-image"/>
</metadata>
<manifest>
${manifest.join('\n')}
</manifest>
<spine toc="ncx"${rtl ? ' page-progression-direction="rtl"' : ''}>
<itemref idref="cover"/>
${sections.map((s) => `<itemref idref="${s.id}"/>`).join('\n')}
</spine>
<guide>
<reference type="cover" title="${esc(L.cover)}" href="cover.xhtml"/>
</guide>
</package>
`.replace(/\n{2,}/g, '\n'))

  put('META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles>
<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
</rootfiles>
</container>
`)
  put('META-INF/com.apple.ibooks.display-options.xml', `<?xml version="1.0" encoding="UTF-8"?>
<display_options>
<platform name="*">
<option name="specified-fonts">true</option>
</platform>
</display_options>
`)

  review.push(...validateEpub(files))
  return { epub: zipEpub(files), files }
}
