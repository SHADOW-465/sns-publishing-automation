import { type Files, bytes, zipEpub } from '../zip.ts'
import { esc, xhtmlDoc } from '../xml.ts'
import { type Decls } from '../indesign/css.ts'
import { labelsFor, type SectionType } from './locale.ts'
import { buildCss } from './css.ts'
import { mediaType } from './image.ts'
import { validateEpub } from './validate.ts'

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

const FRONT: SectionType[] = ['halftitle', 'title', 'copyright', 'dedication', 'toc', 'list']
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
  const { meta, sections, review } = p
  const pageList = sections.flatMap((s) => [...s.body.matchAll(/id="page-([^"]+)"/g)].map((m) => ({ n: m[1], file: s.file })))
  const L = labelsFor(meta.language)
  const lang = meta.language
  const files: Files = new Map()
  const put = (path: string, s: string) => files.set(path, bytes(s))
  const title = meta.subtitle ? `${meta.title}. ${meta.subtitle}` : meta.title
  const authors = meta.authors.split(/\s*[,;]\s*/).filter(Boolean)

  if (!isbn13Valid(meta.eisbn)) review.push({ level: 'error', msg: `E-book ISBN "${meta.eisbn}" is missing or not a valid ISBN-13.` })
  if (meta.printIsbn && !isbn13Valid(meta.printIsbn)) review.push({ level: 'warn', msg: `Print ISBN "${meta.printIsbn}" is not a valid ISBN-13.` })

  // ---- content documents ----
  const coverAlt = L.coverAlt({ title, authors: authors.join(', '), publisher: meta.publisher })
  put('OEBPS/cover.xhtml', xhtmlDoc(lang, L.cover, 'css/style.css',
    `<section epub:type="cover">\n<p class="cover"><img alt="${esc(coverAlt)}" class="cv" id="cimg" role="doc-cover" src="${p.cover.path}"/></p>\n</section>`))
  for (const s of sections) put(`OEBPS/${s.file}`, xhtmlDoc(lang, s.title, 'css/style.css', s.body))
  put('OEBPS/css/style.css', p.css ?? buildCss(p.usedClasses, p.bodyDecls))
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
  const bodyStart = sections.find((s) => !FRONT.includes(s.type)) ?? sections[0]
  put('OEBPS/nav.xhtml', xhtmlDoc(lang, L.navTitle, 'css/style.css', [
    // EPUBCheck's navigation schema rejects aria-label(ledby) on <nav>: the headings name them
    `<nav epub:type="toc" id="toc" role="doc-toc">`,
    `<h1 id="toc01">${esc(L.navTitle)}</h1>`,
    ol(tree),
    `</nav>`,
    pageList.length
      ? `<nav epub:type="page-list" hidden="" role="doc-pagelist">\n<h2>${esc(L.pageList)}</h2>\n<ol class="nav">\n${pageList.map((pg) => `<li><a href="${pg.file}#page-${esc(pg.n)}">${esc(pg.n)}</a></li>`).join('\n')}\n</ol>\n</nav>`
      : '',
    `<nav epub:type="landmarks" hidden="">`,
    `<h2>${esc(L.landmarks)}</h2>`,
    `<ol class="nav">`,
    `<li><a epub:type="cover" href="cover.xhtml">${esc(L.cover)}</a></li>`,
    titleSec ? `<li><a epub:type="titlepage" href="${titleSec.file}">${esc(L.title)}</a></li>` : '',
    `<li><a epub:type="toc" href="${tocSec ? tocSec.file : 'nav.xhtml'}">${esc(tocSec?.nav ?? L.navTitle)}</a></li>`,
    bodyStart ? `<li><a epub:type="bodymatter" href="${bodyStart.file}">${esc(L.startReading)}</a></li>` : '',
    `</ol>`,
    `</nav>`,
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
${pageList.length ? `<pageList>\n<navLabel><text>${esc(L.pageList)}</text></navLabel>\n${pageList.map((pg) => `<pageTarget id="pt-${esc(pg.n)}" type="${/^\d+$/.test(pg.n) ? 'normal' : 'front'}" value="${esc(pg.n)}" playOrder="${++play}"><navLabel><text>${esc(pg.n)}</text></navLabel><content src="${pg.file}#page-${esc(pg.n)}"/></pageTarget>`).join('\n')}\n</pageList>` : ''}
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
  if (/<table/.test(html)) features.push('tableHeaders')
  if (sections.some((s) => s.type === 'index')) features.push('index')
  const unique = new Map<string, ImageOut>()
  for (const im of allImgs) unique.set(im.path, im)
  const manifest = [
    `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    `<item id="style" href="css/style.css" media-type="text/css"/>`,
    `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`,
    `<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>`,
    ...sections.map((s) => `<item id="${s.id}" href="${s.file}" media-type="application/xhtml+xml"/>`),
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
${authors.map((a, i) => `<dc:creator id="author${i + 1}">${esc(a)}</dc:creator>`).join('\n')}
<dc:publisher>${esc(meta.publisher)}</dc:publisher>
${meta.rights ? `<dc:rights>${esc(meta.rights)}</dc:rights>` : ''}
<dc:description>${esc(title)}</dc:description>
<dc:date>${modified.slice(0, 10)}</dc:date>
${meta.printIsbn ? `<dc:source id="src-id">urn:isbn:${isbnDigits(meta.printIsbn)}</dc:source>\n<meta property="pageBreakSource">urn:isbn:${isbnDigits(meta.printIsbn)}</meta>` : ''}
<meta property="dcterms:modified">${modified}</meta>
${features.map((f) => `<meta property="schema:accessibilityFeature">${f}</meta>`).join('\n')}
<meta property="schema:accessibilityHazard">noFlashingHazard</meta>
<meta property="schema:accessibilityHazard">noMotionSimulationHazard</meta>
<meta property="schema:accessibilityHazard">noSoundHazard</meta>
<meta property="schema:accessibilitySummary">${esc(L.a11ySummary)}</meta>
<meta property="schema:accessMode">textual</meta>
<meta property="schema:accessMode">visual</meta>
<meta property="schema:accessModeSufficient">textual</meta>
<meta property="schema:accessModeSufficient">textual,visual</meta>
<meta property="dcterms:conformsTo">${esc(meta.conformsTo)}</meta>
${meta.certifiedBy ? `<meta property="a11y:certifiedBy">${esc(meta.certifiedBy)}</meta>` : ''}
<meta name="cover" content="cover-image"/>
</metadata>
<manifest>
${manifest.join('\n')}
</manifest>
<spine toc="ncx">
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
