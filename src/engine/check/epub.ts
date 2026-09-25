import { type Files, text, unzip } from '../zip.ts'
import { parseXml, resolvePath, epubType } from '../xml.ts'
import { extOf, imageSize } from '../epub/image.ts'
import { isbn13Valid } from '../epub/package.ts'
import { settings } from '../settings.ts'
import { compareLook } from './look.ts'
import type { PrintPage } from '../pdf/pages.ts'

// =============================================================================================
// Built-in quality check for any EPUB 3: what EPUBCheck (file validity), Ace by DAISY
// (accessibility) and a proof-reader (nothing lost, details right) would flag — run in the
// browser on every build, and on any EPUB dropped into the checker. EPUBCheck and Ace remain
// the final authority; this catches the common problems before a file leaves the tool.
// =============================================================================================

export type Level = 'error' | 'warn' | 'pass'
export interface Finding {
  level: Level
  msg: string
  where?: string
}
export interface CheckGroup {
  id: 'valid' | 'a11y' | 'content' | 'look' | 'details'
  title: string
  /** one sentence for people who don't know the jargon */
  explain: string
  findings: Finding[]
}
export interface CheckReport {
  groups: CheckGroup[]
  errors: number
  warnings: number
  stats: { documents: number; words: number; pages: number; images: number; notes: number }
}

export interface CheckSource {
  /** words of the source text (InDesign export / print PDF), for the completeness check */
  words?: string[]
  /** lines deliberately left out (print-only imprint lines…) */
  dropped?: string[]
  /** printed page numbers of the source book, for the page-marker check */
  printPages?: string[]
  /** the print PDF's pages with line positions, for the visual comparison */
  printLayout?: PrintPage[]
}

const KNOWN_TYPES = new Set([
  'cover', 'frontmatter', 'bodymatter', 'backmatter', 'halftitlepage', 'titlepage', 'copyright-page', 'dedication', 'epigraph',
  'toc', 'landmarks', 'page-list', 'loi', 'lot', 'introduction', 'preface', 'foreword', 'prologue', 'part', 'chapter', 'division',
  'conclusion', 'epilogue', 'afterword', 'glossary', 'appendix', 'bibliography', 'endnotes', 'endnote', 'footnotes', 'footnote',
  'index', 'contributors', 'acknowledgments', 'pagebreak', 'noteref', 'backlink', 'titlepage', 'subtitle', 'title', 'imprint',
  'colophon', 'credits', 'errata', 'other-credits', 'seriespage', 'afterword', 'notice', 'volume', 'abstract', 'aside', 'glossterm',
  'glossdef', 'biblioentry', 'index-headnotes', 'index-entry', 'index-term', 'index-group', 'keyword', 'toc-brief', 'preamble',
])
const A11Y_META = ['schema:accessMode', 'schema:accessibilityFeature', 'schema:accessibilityHazard', 'schema:accessibilitySummary', 'schema:accessModeSufficient']
export const wordsOf = (s: string) => s.replace(/[­​]/g, '').toLocaleLowerCase().normalize('NFC').split(/[^\p{L}\p{N}]+/u).filter((w) => /\p{L}/u.test(w))

export function checkEpubBytes(epub: Uint8Array, src: CheckSource = {}): CheckReport {
  const pre: Finding[] = []
  // OCF: the first zip entry must be "mimetype", stored (not compressed), with no extra field
  const dv = new DataView(epub.buffer, epub.byteOffset, epub.byteLength)
  const nameLen = dv.getUint16(26, true)
  const first = new TextDecoder().decode(epub.subarray(30, 30 + nameLen))
  if (dv.getUint32(0, true) !== 0x04034b50) pre.push({ level: 'error', msg: 'Not a zip file — this is not an EPUB.' })
  else if (first !== 'mimetype') pre.push({ level: 'error', msg: 'The first file in the EPUB must be "mimetype" (some readers refuse the book otherwise).' })
  else if (dv.getUint16(8, true) !== 0) pre.push({ level: 'error', msg: 'The "mimetype" file is compressed; it must be stored uncompressed.' })
  else if (dv.getUint16(28, true) !== 0) pre.push({ level: 'error', msg: 'The "mimetype" zip entry has an extra field (EPUBCheck PKG-005).' })
  else pre.push({ level: 'pass', msg: 'Zip container is laid out correctly (mimetype first, uncompressed).' })
  let files: Files
  try {
    files = unzip(epub)
  } catch (e) {
    return report([group('valid', [...pre, { level: 'error', msg: `The zip cannot be opened: ${(e as Error).message}` }])], emptyStats())
  }
  const r = checkEpub(files, src)
  r.groups[0].findings.unshift(...pre)
  return recount(r)
}

export function checkEpub(files: Files, src: CheckSource = {}): CheckReport {
  const valid: Finding[] = []
  const a11y: Finding[] = []
  const content: Finding[] = []
  const details: Finding[] = []
  const stats = emptyStats()

  // ---------------------------------------------------------------- package
  const mt = files.get('mimetype')
  if (mt && text(mt).trim() !== 'application/epub+zip') valid.push({ level: 'error', msg: 'The "mimetype" file must contain exactly "application/epub+zip".' })
  const container = files.get('META-INF/container.xml')
  const opfPath = container ? text(container).match(/full-path="([^"]+)"/)?.[1] : undefined
  if (!opfPath || !files.has(opfPath)) {
    valid.push({ level: 'error', msg: 'META-INF/container.xml does not point to a package document (OPF): the book cannot be opened.' })
    return report([group('valid', valid)], stats)
  }
  const docs = new Map<string, Document>()
  const parse = (path: string) => {
    if (docs.has(path)) return docs.get(path)!
    try {
      const d = parseXml(text(files.get(path)!), path)
      docs.set(path, d)
      return d
    } catch (e) {
      valid.push({ level: 'error', msg: `Not well-formed XML — reading systems will show an error page: ${(e as Error).message.slice(0, 160)}`, where: path })
      return undefined
    }
  }
  const opf = parse(opfPath)
  if (!opf) return report([group('valid', valid)], stats)
  const meta = (name: string) => Array.from(opf.getElementsByTagName(name))
  const metaText = (name: string) => meta(name).map((e) => (e.textContent ?? '').trim())
  const prop = (p: string) => Array.from(opf.getElementsByTagName('meta')).filter((m) => m.getAttribute('property') === p).map((m) => (m.textContent ?? '').trim())

  // required metadata, and no empty elements (EPUBCheck RSC-005)
  for (const el of Array.from(opf.getElementsByTagName('metadata')[0]?.children ?? [])) {
    if (el.prefix === 'dc' && !(el.textContent ?? '').trim()) valid.push({ level: 'error', msg: `Empty <${el.tagName}> in the package metadata (EPUBCheck RSC-005). Fill it in or leave it out.`, where: opfPath })
  }
  const uid = opf.documentElement.getAttribute('unique-identifier')
  const idEl = meta('dc:identifier').find((e) => e.getAttribute('id') === uid)
  if (!idEl || !(idEl.textContent ?? '').trim()) valid.push({ level: 'error', msg: 'The package has no unique identifier (dc:identifier referenced by unique-identifier).', where: opfPath })
  if (!metaText('dc:title').some(Boolean)) valid.push({ level: 'error', msg: 'The package has no title (dc:title).', where: opfPath })
  const lang = metaText('dc:language')[0] ?? ''
  if (!lang) valid.push({ level: 'error', msg: 'The package has no language (dc:language).', where: opfPath })
  else if (!/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(lang)) valid.push({ level: 'error', msg: `"${lang}" is not a valid language code (use e.g. es-ES, en-GB).`, where: opfPath })
  const modified = prop('dcterms:modified')[0]
  if (!modified || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(modified)) valid.push({ level: 'error', msg: 'dcterms:modified is missing or not in the form 2026-01-31T12:00:00Z.', where: opfPath })

  // manifest ↔ files, media types from the bytes
  const items = Array.from(opf.getElementsByTagName('item')).map((it) => ({
    id: it.getAttribute('id') ?? '', href: resolvePath(opfPath, it.getAttribute('href') ?? ''), type: it.getAttribute('media-type') ?? '', props: it.getAttribute('properties') ?? '',
  }))
  const byHref = new Map(items.map((i) => [i.href, i]))
  const ids = new Set<string>()
  for (const it of items) {
    if (ids.has(it.id)) valid.push({ level: 'error', msg: `Two manifest items share the id "${it.id}".`, where: opfPath })
    ids.add(it.id)
    const data = files.get(it.href)
    if (!data) {
      valid.push({ level: 'error', msg: `The package lists a file that is not in the EPUB: ${it.href}`, where: opfPath })
      continue
    }
    if (it.type.startsWith('image/')) {
      stats.images++
      const real = extOf(data)
      const want = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp', '': '' }[real]
      if (want && want !== it.type) valid.push({ level: 'error', msg: `${it.href} is really a ${real.toUpperCase()} image but is declared as ${it.type} (EPUBCheck OPF-029).`, where: opfPath })
      if (want && !new RegExp(`\\.${real === 'jpg' ? 'jpe?g' : real}$`, 'i').test(it.href)) valid.push({ level: 'warn', msg: `${it.href} is a ${real.toUpperCase()} image with the wrong file extension (EPUBCheck PKG-022).`, where: opfPath })
    }
  }
  for (const f of files.keys()) {
    if (f === 'mimetype' || f.startsWith('META-INF/') || f === opfPath) continue
    if (!byHref.has(f)) valid.push({ level: 'error', msg: `File in the EPUB but not in the package manifest: ${f}`, where: opfPath })
  }
  const navItems = items.filter((i) => i.props.split(/\s+/).includes('nav'))
  if (navItems.length !== 1) valid.push({ level: 'error', msg: navItems.length ? 'More than one navigation document.' : 'No navigation document (manifest item with properties="nav").', where: opfPath })
  const coverItem = items.find((i) => i.props.split(/\s+/).includes('cover-image'))
  if (!coverItem) details.push({ level: 'warn', msg: 'No cover image is declared (properties="cover-image"): stores and reading apps will show a blank cover.' })

  // spine
  const idToItem = new Map(items.map((i) => [i.id, i]))
  const spine = Array.from(opf.getElementsByTagName('itemref')).map((r) => idToItem.get(r.getAttribute('idref') ?? ''))
  if (spine.some((x) => !x)) valid.push({ level: 'error', msg: 'The reading order (spine) refers to a file that is not in the manifest.', where: opfPath })
  const spineSet = new Set(spine.filter(Boolean).map((x) => x!.href))
  if (!spineSet.size) valid.push({ level: 'error', msg: 'The reading order (spine) is empty.', where: opfPath })

  // ---------------------------------------------------------------- content documents
  const xhtml = items.filter((i) => i.type === 'application/xhtml+xml' && files.has(i.href))
  const idsOf = new Map<string, Set<string>>()
  for (const it of xhtml) {
    const d = parse(it.href)
    if (!d) continue
    const set = new Set<string>()
    for (const el of Array.from(d.querySelectorAll('[id]'))) {
      if (set.has(el.id)) valid.push({ level: 'error', msg: `The id "${el.id}" is used twice in the same file.`, where: it.href })
      set.add(el.id)
    }
    idsOf.set(it.href, set)
  }
  const navPath = navItems[0]?.href
  const pageNums: string[] = []
  const sourceWords: string[] = []
  const paraCount = new Map<string, number>()
  let headingDocs = 0
  for (const it of xhtml) {
    const d = docs.get(it.href)
    if (!d) continue
    const isNav = it.href === navPath
    if (!isNav && !spineSet.has(it.href)) valid.push({ level: 'warn', msg: 'Content file is not in the reading order (spine).', where: it.href })
    stats.documents += isNav ? 0 : 1
    // links and images
    for (const a of Array.from(d.querySelectorAll('[href], [src]'))) {
      if (a.localName === 'link') continue
      const ref = a.getAttribute('href') ?? a.getAttribute('src') ?? ''
      if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) {
        if (/^https?:\/\/$|^mailto:$/i.test(ref)) valid.push({ level: 'error', msg: `Empty web link "${ref}".`, where: it.href })
        continue
      }
      const [file, frag] = ref.split('#')
      const target = file ? resolvePath(it.href, file) : it.href
      if (!files.has(target)) valid.push({ level: 'error', msg: `Broken link or image: "${ref}" points to a missing file.`, where: it.href })
      else if (frag && idsOf.has(target) && !idsOf.get(target)!.has(frag)) valid.push({ level: 'error', msg: `Link "${ref}" points to an anchor that does not exist.`, where: it.href })
      else if (a.localName === 'a' && file && target.endsWith('.xhtml') && !spineSet.has(target))
        valid.push({ level: 'error', msg: `Link "${ref}" points to a file that is not in the reading order (EPUBCheck RSC-011).`, where: it.href })
    }
    for (const el of Array.from(d.querySelectorAll('*'))) {
      for (const t of epubType(el).split(/\s+/).filter(Boolean)) if (!KNOWN_TYPES.has(t)) valid.push({ level: 'warn', msg: `Unknown epub:type "${t}".`, where: it.href })
    }
    if (isNav) continue

    // ---- accessibility, per document ----
    const html = d.documentElement
    const dl = html.getAttribute('xml:lang') ?? html.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'lang') ?? html.getAttribute('lang')
    if (!dl) a11y.push({ level: 'error', msg: 'No language on the page (lang / xml:lang): screen readers may use the wrong voice.', where: it.href })
    else if (lang && dl.slice(0, 2).toLowerCase() !== lang.slice(0, 2).toLowerCase()) a11y.push({ level: 'warn', msg: `Page language "${dl}" differs from the book language "${lang}".`, where: it.href })
    if (!(d.querySelector('title')?.textContent ?? '').trim()) a11y.push({ level: 'warn', msg: 'Page has an empty <title>.', where: it.href })
    for (const img of Array.from(d.querySelectorAll('img'))) {
      const alt = img.getAttribute('alt')
      const decorative = img.getAttribute('role') === 'presentation' || img.getAttribute('aria-hidden') === 'true'
      if (alt === null) a11y.push({ level: 'error', msg: `Picture ${img.getAttribute('src')} has no alt attribute.`, where: it.href })
      else if (!alt.trim() && !decorative) a11y.push({ level: 'error', msg: `Picture ${img.getAttribute('src')} has no description. Describe it, or mark it as decorative.`, where: it.href })
      else if (/\.(jpe?g|png|gif|svg)$|^(image|imagen|picture|foto|photo|img)\s*\d*$/i.test(alt.trim())) a11y.push({ level: 'warn', msg: `Picture description "${alt}" is not a real description.`, where: it.href })
    }
    const hs = Array.from(d.querySelectorAll('h1,h2,h3,h4,h5,h6'))
    if (hs.length) headingDocs++
    let lastH = 0
    for (const h of hs) {
      const lv = Number(h.localName[1])
      if (!(h.textContent ?? '').trim()) a11y.push({ level: 'error', msg: `Empty heading <${h.localName}>: screen readers announce a blank heading.`, where: it.href })
      if (lastH && lv > lastH + 1) a11y.push({ level: 'warn', msg: `Heading level jumps from h${lastH} to h${lv} ("${(h.textContent ?? '').trim().slice(0, 40)}").`, where: it.href })
      lastH = lv
    }
    if (!hs.length && !d.querySelector('[aria-label], [aria-labelledby]') && it.href !== coverDoc(files, spine)) a11y.push({ level: 'warn', msg: 'Page has no heading and no label: it will be hard to find with a screen reader.', where: it.href })
    for (const a of Array.from(d.querySelectorAll('a'))) if (!(a.textContent ?? '').trim() && !a.querySelector('img[alt]')) a11y.push({ level: 'error', msg: 'A link has no text: screen readers announce just "link".', where: it.href })
    // a printed contents page whose entries lost their titles ("2.", "3." …)
    // (index page numbers are links too, but share their line with the entry's words)
    const bareLinks = Array.from(d.querySelectorAll('a[href]')).filter((a) => {
      const t = (a.textContent ?? '').trim()
      const line = (a.closest('p, li') ?? a).textContent ?? ''
      return /^[\divxlc]+\.?$/i.test(t) && line.replace(/\s+/g, ' ').trim() === t && !/noteref|backlink/.test(epubType(a) + (a.getAttribute('role') ?? ''))
    })
    if (bareLinks.length >= 3) content.push({ level: 'error', msg: `${bareLinks.length} contents entries show only a number (${bareLinks.slice(0, 4).map((a) => (a.textContent ?? '').trim()).join(', ')}…): the chapter titles are missing.`, where: it.href })
    for (const t of Array.from(d.querySelectorAll('table'))) if (!t.querySelector('th')) a11y.push({ level: 'warn', msg: 'A table has no header cells (th).', where: it.href })
    for (const pb of Array.from(d.querySelectorAll('*')).filter((e) => /\bpagebreak\b/.test(epubType(e)) || e.getAttribute('role') === 'doc-pagebreak')) {
      const n = pb.getAttribute('aria-label') ?? pb.getAttribute('title') ?? ''
      if (!n) a11y.push({ level: 'error', msg: 'A page marker has no page number (aria-label / title).', where: it.href })
      pageNums.push(pb.id.replace(/^page-?/, '') || n.replace(/^\D+\s/, ''))
    }
    stats.notes += Array.from(d.querySelectorAll('a')).filter((a) => /\bnoteref\b/.test(epubType(a)) || a.getAttribute('role') === 'doc-noteref').length
    // content
    const body = d.body ?? html
    let prevText = ''
    for (const p of Array.from(body.querySelectorAll('p'))) {
      const t = (p.textContent ?? '').replace(/\s+/g, ' ').trim()
      if (!t && !p.querySelector('img')) content.push({ level: 'warn', msg: 'Empty paragraph (shows as a blank gap).', where: it.href })
      // the same paragraph twice in a row is a conversion fault (books do repeat text, but not back to back)
      if (t.length > 40 && t === prevText) paraCount.set(t, (paraCount.get(t) ?? 1) + 1)
      prevText = t
    }
    const w = wordsOf(textWithSpaces(body))
    stats.words += w.length
    sourceWords.push(...w)
    const type = epubType(body.querySelector('section') ?? body)
    if (/\bchapter\b/.test(type) && w.length < 40) content.push({ level: 'warn', msg: `Chapter with only ${w.length} words — is text missing?`, where: it.href })
  }
  stats.pages = pageNums.length
  if (stats.documents && !headingDocs) a11y.push({ level: 'error', msg: 'The book has no headings at all.' })

  // ---- navigation ----
  const nav = navPath ? docs.get(navPath) : undefined
  if (nav) {
    const toc = Array.from(nav.querySelectorAll('nav')).find((n) => /\btoc\b/.test(epubType(n)))
    const pl = Array.from(nav.querySelectorAll('nav')).find((n) => /\bpage-list\b/.test(epubType(n)))
    const lm = Array.from(nav.querySelectorAll('nav')).find((n) => /\blandmarks\b/.test(epubType(n)))
    if (!toc || !toc.querySelector('a')) valid.push({ level: 'error', msg: 'The navigation document has no table of contents.', where: navPath })
    else {
      const labels = Array.from(toc.querySelectorAll('a')).map((a) => (a.textContent ?? '').trim())
      if (labels.some((l) => !l)) a11y.push({ level: 'error', msg: 'The navigation menu has an entry with no text.', where: navPath })
      const bare = labels.filter((l) => /^[\divxlc]+\.?$/i.test(l))
      if (bare.length) a11y.push({ level: 'warn', msg: `Navigation entries with only a number (${bare.slice(0, 4).join(', ')}): the chapter title is missing.`, where: navPath })
      const linked = new Set(Array.from(toc.querySelectorAll('a')).map((a) => resolvePath(navPath!, a.getAttribute('href') ?? '')))
      const unlisted = [...spineSet].filter((h) => {
        const b = docs.get(h)?.querySelector('h1,h2')
        return b && !linked.has(h)
      })
      if (unlisted.length) a11y.push({ level: 'warn', msg: `Sections with a heading that are missing from the navigation menu: ${unlisted.slice(0, 5).join(', ')}`, where: navPath })
    }
    if (pageNums.length && !pl) a11y.push({ level: 'error', msg: 'The book has page markers but no page list, so readers cannot "go to page".', where: navPath })
    if (!lm) a11y.push({ level: 'warn', msg: 'No landmarks (cover, start of the text…) in the navigation document.', where: navPath })
    else if (!Array.from(lm.querySelectorAll('a')).some((a) => /\bbodymatter\b/.test(epubType(a)))) a11y.push({ level: 'warn', msg: 'Landmarks do not mark where the text starts.', where: navPath })
  }

  // ---- page markers vs the printed book ----
  if (pageNums.length) {
    const dup = pageNums.filter((n, i) => pageNums.indexOf(n) !== i)
    if (dup.length) a11y.push({ level: 'error', msg: `Page number(s) marked twice: ${[...new Set(dup)].slice(0, 8).join(', ')}.` })
    const nums = pageNums.filter((n) => /^\d+$/.test(n)).map(Number)
    const back = nums.findIndex((n, i) => i > 0 && n < nums[i - 1])
    if (back > 0) a11y.push({ level: 'warn', msg: `Page markers go backwards (${nums[back - 1]} → ${nums[back]}): check the reading order.` })
    if (src.printPages?.length) {
      const have = new Set(pageNums)
      const missing = src.printPages.filter((p) => !have.has(p))
      if (missing.length) content.push({ level: missing.length > 3 ? 'error' : 'warn', msg: `Printed page(s) with no page marker: ${missing.slice(0, 15).join(', ')}${missing.length > 15 ? '…' : ''} (blank printed pages are fine to skip).` })
    }
  }

  // ---- accessibility metadata ----
  const missingMeta = A11Y_META.filter((p) => !prop(p).some(Boolean))
  if (missingMeta.length) a11y.push({ level: 'error', msg: `Accessibility metadata missing: ${missingMeta.join(', ')} (required by EPUB Accessibility 1.1).`, where: opfPath })
  if (!prop('dcterms:conformsTo').some(Boolean) && !Array.from(opf.getElementsByTagName('link')).some((l) => /conformsTo/.test(l.getAttribute('rel') ?? '')))
    a11y.push({ level: 'warn', msg: 'No accessibility conformance statement (dcterms:conformsTo).', where: opfPath })
  if (stats.pages && !prop('pageBreakSource').some(Boolean) && !meta('dc:source').length) a11y.push({ level: 'warn', msg: 'Page markers are present but the print edition they come from is not named (dc:source / pageBreakSource).', where: opfPath })

  // ---- completeness against the source ----
  const repeated = [...paraCount].filter(([, n]) => n > 1)
  if (repeated.length) content.push({ level: 'error', msg: `${repeated.length} paragraph(s) are repeated back to back — duplicated text, e.g. “${repeated[0][0].slice(0, 70)}…”.` })
  if (src.words?.length) {
    const dropped = new Map<string, number>()
    for (const w of (src.dropped ?? []).flatMap(wordsOf)) dropped.set(w, (dropped.get(w) ?? 0) + 1)
    const out = new Map<string, number>()
    for (const w of sourceWords) out.set(w, (out.get(w) ?? 0) + 1)
    const lost = new Map<string, number>()
    for (const w of src.words) {
      if ((out.get(w) ?? 0) > 0) out.set(w, out.get(w)! - 1)
      else if ((dropped.get(w) ?? 0) > 0) dropped.set(w, dropped.get(w)! - 1)
      else lost.set(w, (lost.get(w) ?? 0) + 1)
    }
    const nLost = [...lost.values()].reduce((a, b) => a + b, 0)
    const share = nLost / src.words.length
    const sample = [...lost].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([w, n]) => (n > 1 ? `${w} ×${n}` : w)).join(', ')
    if (share * 100 > settings().lostWordsErrorPct) content.push({ level: 'error', msg: `${nLost} of ${src.words.length} source words (${(share * 100).toFixed(1)}%) are not in the e-book: ${sample}` })
    else if (nLost > 0) content.push({ level: 'warn', msg: `${nLost} source word(s) not found in the e-book (${(share * 100).toFixed(2)}%): ${sample}` })
    else content.push({ level: 'pass', msg: `All ${src.words.length.toLocaleString()} words of the source are in the e-book.` })
  }

  // ---- book details ----
  const title = metaText('dc:title')[0] ?? ''
  const creators = metaText('dc:creator')
  if (/_|\.(indd|pdf|docx?)\b/i.test(title)) details.push({ level: 'error', msg: `Title “${title}” looks like a file name.` })
  if (title && title === title.toLocaleUpperCase() && /\p{L}{3}/u.test(title)) details.push({ level: 'warn', msg: `Title “${title}” is in capitals — use normal spelling.` })
  if (!creators.length) details.push({ level: 'warn', msg: 'No author (dc:creator).' })
  for (const c of creators) {
    if (c === c.toLocaleUpperCase() && /\p{L}{3}/u.test(c)) details.push({ level: 'warn', msg: `Author “${c}” is in capitals.` })
    if (title && c.toLocaleLowerCase().replace(/\W/g, '') === title.toLocaleLowerCase().replace(/\W/g, '').slice(0, c.replace(/\W/g, '').length) && c.length > 10)
      details.push({ level: 'error', msg: `Author “${c}” looks like the title, not a person.` })
  }
  if (!metaText('dc:publisher').some(Boolean)) details.push({ level: 'warn', msg: 'No publisher (dc:publisher).' })
  const isbn = (idEl?.textContent ?? '').replace(/^urn:isbn:/i, '')
  if (/^urn:isbn:/i.test(idEl?.textContent ?? '') && !isbn13Valid(isbn)) details.push({ level: 'error', msg: `E-book ISBN ${isbn} is not a valid ISBN-13 (check digit).` })
  if (coverItem && files.has(coverItem.href)) {
    const { width, height } = imageSize(files.get(coverItem.href)!)
    const min = settings().minCoverPx
    if (width && Math.max(width, height) < min) details.push({ level: 'warn', msg: `Cover is only ${width}×${height} px; the house minimum is ${min} px on the long side (stores recommend 1600×2560).` })
    else if (width) details.push({ level: 'pass', msg: `Cover image ${width}×${height} px.` })
  }

  // passes, so the reviewer sees what was checked
  const ok = (arr: Finding[], msg: string) => !arr.some((f) => f.level === 'error') && arr.push({ level: 'pass', msg })
  ok(valid, `Package, manifest, reading order, links and ${stats.documents} content files are valid.`)
  ok(a11y, `Language, headings, picture descriptions, navigation, ${stats.pages} page markers and accessibility metadata are in place.`)
  ok(content, `${stats.words.toLocaleString()} words in ${stats.documents} files; no empty chapters.`)
  if (title) details.unshift({ level: 'pass', msg: `Title: ${title}${creators.length ? ` — ${creators.join(', ')}` : ''}` })
  const groups = [group('valid', valid), group('a11y', a11y), group('content', content)]
  // ---- looks like the print book ----
  if (src.printLayout?.length) {
    const look: Finding[] = []
    const name: Record<string, string> = { left: 'flush left', justify: 'justified', center: 'centred', right: 'right-aligned' }
    const { checked, findings } = compareLook(files, src.printLayout)
    // a real fault repeats (a whole style set wrong); a lone difference may be a quirk of the print layout
    const level = findings.length >= 3 ? 'error' : 'warn'
    for (const f of findings) look.push({ level, msg: `Page ${f.page}: “${f.text}” is ${name[f.ebook]} in the e-book but ${name[f.print]} in print.`, where: f.file })
    if (!findings.length) look.push({ level: 'pass', msg: `${checked.toLocaleString()} paragraphs are aligned as in the print book.` })
    groups.push(group('look', look))
  }
  groups.push(group('details', details))
  return report(groups, stats)
}

const coverDoc = (files: Files, spine: ({ href: string } | undefined)[]) => {
  const first = spine[0]?.href
  return first && files.has(first) && /cover/i.test(first) ? first : ''
}

function textWithSpaces(el: Element): string {
  let s = ''
  const walk = (n: Node) => {
    for (const c of Array.from(n.childNodes)) {
      if (c.nodeType === 3) s += c.textContent ?? ''
      else if (c.nodeType === 1) {
        const e = c as Element
        if (/\bpagebreak\b/.test(epubType(e))) continue
        // pages set as pictures (title pages rendered from the PDF) carry their text in the description
        if (e.localName === 'img') s += ' ' + (e.getAttribute('alt') ?? '') + ' '
        const block = /^(p|h\d|li|div|section|td|th|br|tr|blockquote|figcaption)$/.test(e.localName)
        if (block) s += ' '
        walk(e)
        if (block) s += ' '
      }
    }
  }
  walk(el)
  return s
}

const GROUPS: Record<CheckGroup['id'], [string, string]> = {
  valid: ['Valid EPUB file', 'What EPUBCheck, the validator every store runs, looks at: the file structure, package, links and pictures.'],
  a11y: ['Accessibility', 'What Ace by DAISY looks at: people using screen readers need language, headings, picture descriptions, navigation and page numbers.'],
  content: ['Content complete', 'Nothing lost or duplicated compared with the source, every printed page has a marker, no empty chapters.'],
  look: ['Looks like the print book', 'Each paragraph compared with the print PDF: text centred, right-aligned or justified where print has it so.'],
  details: ['Book details', 'Title, author, publisher, ISBN and cover as the stores will show them.'],
}
const group = (id: CheckGroup['id'], findings: Finding[]): CheckGroup => ({ id, title: GROUPS[id][0], explain: GROUPS[id][1], findings: dedupe(findings) })
const emptyStats = (): CheckReport['stats'] => ({ documents: 0, words: 0, pages: 0, images: 0, notes: 0 })

/** Same message on many files → one line with a count. */
function dedupe(fs: Finding[]): Finding[] {
  const out = new Map<string, Finding & { n: number; files: string[] }>()
  for (const f of fs) {
    const k = `${f.level}|${f.msg}`
    const e = out.get(k)
    if (e) (e.n++, f.where && e.files.push(f.where))
    else out.set(k, { ...f, n: 1, files: f.where ? [f.where] : [] })
  }
  return [...out.values()].map(({ n, files, ...f }) => (n > 1 ? { ...f, msg: `${f.msg} (${n}×)`, where: files.slice(0, 3).join(', ') + (files.length > 3 ? '…' : '') } : f))
}

function report(groups: CheckGroup[], stats: CheckReport['stats']): CheckReport {
  return recount({ groups, stats, errors: 0, warnings: 0 })
}
function recount(r: CheckReport): CheckReport {
  const all = r.groups.flatMap((g) => g.findings)
  r.errors = all.filter((f) => f.level === 'error').length
  r.warnings = all.filter((f) => f.level === 'warn').length
  return r
}
