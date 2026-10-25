// Post-build checks for the classes of mistake in the 23 Oct corrections. Each message says what
// a person would see. They warn; they do not pretend to be EPUBCheck.
import type { Files } from '../zip.ts'
import { text } from '../zip.ts'
import { resolvePath } from '../xml.ts'
import { expandPageEnd } from '../pdfua/indexlinks.ts'
import type { ReviewItem } from '../epub/package.ts'
import { settings } from '../settings.ts'
import { imageFacts } from '../epub/image-spec.ts'

const textOf = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

/** Plain-language problems found in a finished EPUB. */
export function postBuildGuards(files: Files): string[] {
  const msgs: string[] = []
  const pages = [...files].filter(([p]) => p.endsWith('.xhtml')).map(([p, d]) => [p.split('/').pop()!, text(d)] as const)
  const names = new Set(pages.map(([n]) => n))

  const firsts = new Map<string, string[]>()
  for (const [name, html] of pages) {
    if (/^(nav|toc|cover|titlepage)\.xhtml$/.test(name)) continue
    const m = html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/)
    if (!m) continue
    const t = textOf(m[1])
    if (!t || t.length > 80 || /[.!?]$/.test(t)) continue
    const k = t.toLocaleLowerCase()
    firsts.set(k, [...(firsts.get(k) ?? []), name])
  }
  for (const [t, where] of firsts) {
    if (where.length >= 3) msgs.push(`The line “${t}” opens ${where.length} chapters (${where.slice(0, 3).join(', ')}). That is usually a running head or a page number that leaked into the text.`)
  }

  const index = pages.find(([n]) => n === 'index.xhtml')
  if (index) {
    const bare = index[1].replace(/<a\b[^>]*>[\s\S]*?<\/a>/g, ' ')
    const nums = bare.match(/\b\d{1,4}\b/g) ?? []
    if (nums.length >= 5) msgs.push(`The index still has ${nums.length} page numbers that are not links, for example ${nums.slice(0, 3).join(', ')}. Each page number in an index should jump to that page.`)
  }

  const toc = pages.find(([n]) => n === 'toc.xhtml')
  if (toc) {
    const hrefs = [...toc[1].matchAll(/href="([^"]+)"/g)].map((m) => m[1]).filter((h) => h && !/^[a-z][a-z0-9+.-]*:/i.test(h))
    const missing = hrefs.filter((h) => {
      const file = decodeURIComponent(h.split('#')[0])
      return file && !names.has(file.split('/').pop()!)
    })
    if (missing.length) msgs.push(`${missing.length} contents link${missing.length === 1 ? '' : 's'} point at a file that is not in the book, for example “${missing[0]}”.`)
  }

  // a picture of text used as the only title page, on an accessible book (the package says it is accessible)
  const opf = [...files].find(([p]) => p.endsWith('.opf'))
  const accessible = opf ? /schema:accessMode/.test(text(opf[1])) : false
  if (accessible) {
    const title = pages.find(([n]) => n === 'title.xhtml' || n === 'titlepage.xhtml')
    if (title && /<img\b/i.test(title[1]) && textOf(title[1].replace(/<img\b[^>]*>/g, '')).length < 8) {
      msgs.push('The title page is a picture with almost no text. An accessible EPUB needs the title as real text, not a picture of text (WCAG 2.2).')
    }
  }
  return msgs
}

/**
 * Pictures: every <img> must have bytes in the package (IMG-011) and the e-book must hold as many pictures as the print
 * PDF (IMG-011). These are errors, not hints: a missing picture is a missing part of the book.
 */
export function pictureGuards(files: Files, printPictures?: number): ReviewItem[] {
  const out: ReviewItem[] = []
  const used = new Set<string>()
  const lost: string[] = []
  for (const [path, data] of files) {
    if (!path.endsWith('.xhtml')) continue
    for (const m of text(data).matchAll(/<img\b[^>]*?\bsrc="([^"]+)"/g)) {
      const target = resolvePath(path, m[1])
      used.add(target)
      if (!files.get(target)?.length) lost.push(m[1])
    }
  }
  if (lost.length) out.push({ level: 'error', msg: `IMG-011: ${lost.length} picture${lost.length === 1 ? ' has' : 's have'} no image file in the package, for example “${lost[0]}”. The reader would show a broken picture.` })
  // the cover is its own thing; pictures that stand in the pages are counted
  const placed = [...used].filter((u) => !/(^|\/)cover\.(jpe?g|png)$/i.test(u)).length
  if (printPictures !== undefined && placed < printPictures)
    out.push({ level: 'error', msg: `IMG-011: the print PDF has ${printPictures} pictures and the e-book has ${placed}. ${printPictures - placed} picture${printPictures - placed === 1 ? ' is' : 's are'} missing.` })
  return out
}

/** A class token that names a caption (BU, pie, caption, Bildunterschrift, …). ^ inside a class="…" value is not the start of the attribute, so match tokens. */
const CAPTION_TOKEN = /^(?:caption\d*|bildunterschrift|bildlegende|figcaption|leyenda|bu|pie)$/i

function captionOpenTag(tag: string): boolean {
  const cls = tag.match(/\bclass="([^"]*)"/i)?.[1]
  if (!cls) return false
  return cls.split(/\s+/).some((tok) => tok.split(/[_-]/).some((part) => CAPTION_TOKEN.test(part)))
}

/** FIG-003: a caption-class paragraph must not sit directly after a closed figure. FIG-004: a caption keeps space below it. */
export function figureGuards(files: Files): ReviewItem[] {
  const out: ReviewItem[] = []
  let html = ''
  for (const [path, data] of files) if (path.endsWith('.xhtml')) html += text(data)
  const stray = html.match(/<\/figure>\s*(<p\b[^>]*>)/i)
  if (stray && captionOpenTag(stray[1])) out.push({ level: 'error', msg: `FIG-003: a caption paragraph sits after </figure> (${stray[0].replace(/\s+/g, ' ').slice(0, 80)}). The caption belongs inside the figure, in a figcaption.` })
  const hasCaption = /<figcaption\b/i.test(html) || [...html.matchAll(/<p\b[^>]*>/gi)].some((m) => captionOpenTag(m[0]))
  const css = [...files].find(([p]) => p.endsWith('.css'))
  if (css && hasCaption && !/figcaption[^{]*\{[^}]*margin-bottom\s*:/i.test(text(css[1])))
    out.push({ level: 'warn', msg: 'FIG-004: a caption has no margin-bottom, so the next paragraph can touch it.' })
  return out
}

/**
 * NOT-001: when this client's note reference is a superscript, every noteref link sits inside that <sup>.
 * A client whose template sets wrap to "" (a bare link) is not flagged.
 */
export function noteRefGuards(files: Files, wrap: string | undefined): ReviewItem[] {
  if ((wrap ?? 'sup') !== 'sup') return []
  const out: ReviewItem[] = []
  for (const [path, data] of files) {
    if (!path.endsWith('.xhtml')) continue
    const html = text(data)
    const bare = html.replace(/<sup\b[^>]*>\s*<a\b[^>]*(?:epub:type="noteref"|role="doc-noteref")[^>]*>[\s\S]*?<\/a>\s*<\/sup>/g, '')
    if (/<a\b[^>]*(?:epub:type="noteref"|role="doc-noteref")/.test(bare)) {
      out.push({ level: 'error', msg: `NOT-001: a note call in ${path.split('/').pop()} is not inside <sup>, and this client's note reference is a superscript.` })
      break
    }
  }
  return out
}

/** TBL-001: a table the print PDF drew has to be a <table> in the e-book. */
export function tableGuards(files: Files, printTables: number | undefined): ReviewItem[] {
  if (printTables === undefined) return []
  let n = 0
  for (const [path, data] of files) if (path.endsWith('.xhtml')) n += text(data).match(/<table\b/gi)?.length ?? 0
  if (n >= printTables) return []
  const miss = printTables - n
  return [{ level: 'error', msg: `TBL-001: the print PDF has ${printTables} table${printTables === 1 ? '' : 's'} and the e-book has ${n}. ${miss} table${miss === 1 ? ' is' : 's are'} missing.` }]
}

/** TXT-008: a raised ordinal that pdf.js read as its own line must not survive as its own paragraph. */
export function scriptGuards(files: Files): ReviewItem[] {
  const out: ReviewItem[] = []
  for (const [path, data] of files) {
    if (!path.endsWith('.xhtml')) continue
    const hit = text(data).match(/<p\b[^>]*>\s*(?:st|nd|rd|th)\s*<\/p>/i)
    if (hit) {
      out.push({ level: 'error', msg: `TXT-008: a raised ordinal is its own paragraph in ${path.split('/').pop()} (${hit[0].replace(/\s+/g, ' ')}). It belongs in <sup> on the line it sits on.` })
      break
    }
  }
  return out
}

/** IDX-002: the second link of an abbreviated range must not point at an earlier page than the start. */
export function indexRangeGuards(files: Files): ReviewItem[] {
  const out: ReviewItem[] = []
  const re = /<a\b[^>]*href="[^"]*#page-(\d+)"[^>]*>(\d{1,4})<\/a>(\s*[–—-]\s*)<a\b[^>]*href="[^"]*#page-(\d+)"[^>]*>(\d{1,4})<\/a>/g
  for (const [path, data] of files) {
    if (!path.endsWith('.xhtml')) continue
    for (const m of text(data).matchAll(re)) {
      const start = Number(m[2])
      const hrefEnd = Number(m[4])
      const endText = m[5]
      // a shorter end, or a same-width end with a leading zero, is the abbreviation. A full page that happens to be lower is not.
      const abbreviated = endText.length < String(start).length || (endText.length === String(start).length && endText.startsWith('0'))
      if (!abbreviated) continue
      const expanded = expandPageEnd(start, endText)
      if (hrefEnd !== expanded || hrefEnd < start) out.push({ level: 'error', msg: `IDX-002: the index range ${start}-${endText} in ${path.split('/').pop()} links the end to page ${hrefEnd}, an earlier page. The end expands to ${expanded}.` })
    }
  }
  return out
}

const normAlt = (s: string) => s.toLocaleLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim()
const LEADING_ALT = /^(?:image of|picture of|bild von)\b/i

function captionNear(html: string, index: number): string {
  const window = html.slice(Math.max(0, index - 400), index + 800)
  const cap = window.match(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i) ?? window.match(/<p\b[^>]*\bclass="[^"]*\b(?:caption\d*|bildunterschrift|bildlegende|pie|bu)\b[^"]*"[^>]*>([\s\S]*?)<\/p>/i)
  return cap ? cap[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : ''
}

/**
 * IMG-001: a decorative picture has an empty description.
 * IMG-002: the description does not repeat the caption, does not start with "image of" / "picture of" / "Bild von",
 * and stays within the short-description limit. The rulebook has no separate length id; IMG-002 is the short-description rule.
 */
export function altGuards(files: Files): ReviewItem[] {
  const out: ReviewItem[] = []
  const max = settings().altMaxChars
  const seen = new Set<string>()
  for (const [path, data] of files) {
    if (!path.endsWith('.xhtml')) continue
    const html = text(data)
    for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
      const tag = m[0]
      const alt = tag.match(/\balt="([^"]*)"/)?.[1] ?? ''
      const src = tag.match(/\bsrc="([^"]+)"/)?.[1] ?? path
      const decorative = /role="presentation"|aria-hidden="true"/.test(tag)
      const key = `${src}|${alt}|${decorative}`
      if (seen.has(key)) continue
      seen.add(key)
      if (decorative && alt.trim()) {
        out.push({ level: 'error', msg: `IMG-001: ${src} is marked decorative but its description is not empty (“${alt.trim().slice(0, 60)}”). A decorative picture has alt="" and role="presentation".` })
        continue
      }
      if (!alt.trim() || decorative) continue
      const caption = captionNear(html, m.index ?? 0)
      const a = normAlt(alt)
      const c = normAlt(caption)
      if (a.length >= 8 && c.length >= 8 && (a === c || c.includes(a) || a.includes(c)))
        out.push({ level: 'error', msg: `IMG-002: the description of ${src} repeats its caption (“${alt.trim().slice(0, 60)}”).` })
      if (LEADING_ALT.test(alt.trim()))
        out.push({ level: 'error', msg: `IMG-002: the description of ${src} starts with “${alt.trim().split(/\s+/).slice(0, 2).join(' ')}”. Name what is in the picture.` })
      // A warning, not a blocked download. The aim is 140; the hand-finished Cambia cover description is 158.
      if (alt.trim().length > max)
        out.push({ level: 'warn', msg: `IMG-002: the description of ${src} is ${alt.trim().length} characters, over the limit of ${max}.` })
    }
  }
  return out
}

/** IMG-006 density, IMG-007 pixel cap, IMG-008 colour mode. SVG and an incomplete header are not pictures we can measure. */
export function imageSpecGuards(files: Files): ReviewItem[] {
  const out: ReviewItem[] = []
  const max = settings().imageMaxPx
  const dpi = settings().imageDpi
  for (const [path, data] of files) {
    if (!/\.(jpe?g|png)$/i.test(path)) continue
    const facts = imageFacts(data)
    if (!facts.real) continue
    const name = path.split('/').pop()!
    if (facts.width > max || facts.height > max)
      out.push({ level: 'error', msg: `IMG-007: ${name} is ${facts.width}×${facts.height} px, over the ${max} px limit.` })
    if (facts.mode === 'cmyk')
      out.push({ level: 'error', msg: `IMG-008: ${name} is CMYK. Pictures in the e-book are RGB.` })
    else if (facts.mode === 'gray')
      out.push({ level: 'error', msg: `IMG-008: ${name} is grayscale. Pictures in the e-book are RGB.` })
    if (facts.dpi !== dpi)
      out.push({ level: 'error', msg: `IMG-006: ${name} ${facts.dpi ? `is tagged at ${facts.dpi} ppi, not ${dpi}` : 'has no resolution tag'}. Pictures are tagged at ${dpi} ppi.` })
  }
  return out
}
