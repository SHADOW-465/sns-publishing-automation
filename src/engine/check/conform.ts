// Spec conformance (gate stage 2): does the OUTPUT obey the rules that were in effect? A mismatch is our bug, never the client's.
import { type Files, text } from '../zip.ts'
import type { HouseSettings } from '../settings.ts'
import { labelsFor } from '../epub/locale.ts'

const read = (f: Files, name: string) => {
  const e = [...f].find(([p]) => p === name || p.endsWith(`/${name}`))
  return e ? text(e[1]) : ''
}

/** One message per rule the output breaks. `s` is the resolved settings of the build (labels included). */
export function conformance(files: Files, s: HouseSettings): string[] {
  const out: string[] = []
  const opf = read(files, 'content.opf')
  if (!opf) return ['The package document is missing.']
  const accessible = /schema:accessMode/.test(opf)
  const lang = opf.match(/<dc:language>([^<]+)</)?.[1] ?? 'en'
  const pages = [...files].filter(([p]) => p.endsWith('.xhtml')).map(([p, d]) => [p.split('/').pop()!, text(d)] as const)
  // HD-07: chapter title element
  const want = s.markup?.['chapter-title']?.tag ?? (s.chapterTag === 'h2' ? 'h2' : '')
  if (/^h[1-6]$/.test(want))
    for (const [n, h] of pages) if (/^chapter\d+\.xhtml$/.test(n) && !new RegExp(`<${want}[\\s>]`).test(h)) out.push(`HD-07: ${n} has no ${want} chapter title`)
  // DOC-01: language attributes on <html>
  if (accessible)
    for (const [n, h] of pages) {
      const root = h.match(/<html[^>]*>/)?.[0] ?? ''
      if (/\slang=/.test(root) !== (s.htmlLang !== 'xml:lang') || /\sxml:lang=/.test(root) !== (s.htmlLang !== 'lang')) {
        out.push(`DOC-01: ${n} declares its language differently from the rule`)
        break
      }
    }
  // the cover title is the label in effect
  const cover = read(files, 'cover.xhtml').match(/<title>([^<]*)<\/title>/)?.[1]
  if (cover !== undefined && cover !== labelsFor(lang).coverTitle) out.push(`Label: the cover title is "${cover}", the labels in effect say "${labelsFor(lang).coverTitle}"`)
  // PKG-01: the TDM reservation
  if ((s.tdmReservation === 'reserved') !== /tdm:reservation/.test(opf)) out.push('PKG-01: the text-and-data-mining reservation does not match the rule')
  // the guide points at the contents
  if (!/<reference type="toc"/.test(opf)) out.push('The guide has no contents reference')
  // NAV-02: page numbers on the printed contents page
  if (s.tocPageNumbers === 'strip' && /class="toc_pg"/.test(read(files, 'toc.xhtml'))) out.push('NAV-02: the contents page shows page numbers although the rule strips them')
  // every note reference is a sup link
  const bare = /<a [^>]*epub:type="noteref"/
  for (const [n, h] of pages)
    if (bare.test(h) && bare.test(h.replace(/<sup>\s*<a [^>]*epub:type="noteref"[^>]*>[^<]*<\/a>\s*<\/sup>/g, ''))) {
      out.push(`${n}: a note reference is not wrapped in <sup>`)
      break
    }
  return out
}
