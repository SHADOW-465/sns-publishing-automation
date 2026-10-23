// Post-build checks for the classes of mistake in the 23 Oct corrections. Each message says what
// a person would see. They warn; they do not pretend to be EPUBCheck.
import type { Files } from '../zip.ts'
import { text } from '../zip.ts'

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
