// DOM helpers shared by all pipelines. Uses the platform DOMParser (browser / desktop shell);
// Node tests install jsdom's DOMParser on globalThis (see test/setup.ts).

export const XHTML_NS = 'http://www.w3.org/1999/xhtml'
export const OPS_NS = 'http://www.idpf.org/2007/ops'

export class XmlError extends Error {}

export function parseXml(src: string, what = 'document'): Document {
  const doc = new DOMParser().parseFromString(src, 'application/xhtml+xml')
  const err = doc.getElementsByTagName('parsererror')[0]
  if (err) throw new XmlError(`${what} is not well-formed XML: ${err.textContent?.trim().slice(0, 300)}`)
  return doc
}

export const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export const tag = (el: Element) => el.localName.toLowerCase()

export const elementChildren = (el: Element) => Array.from(el.children)

export const classesOf = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)

/** Whitespace-collapsed text content: a line break counts as a space ("OCULTA<br/>DE" → "OCULTA DE"),
 *  soft hyphens vanish ("go&shy;bierno" → "gobierno"). */
export function textOf(el: Element | null | undefined): string {
  if (!el) return ''
  let s = ''
  const walk = (n: Node) => {
    for (const c of Array.from(n.childNodes)) {
      if (c.nodeType === 3) s += c.textContent ?? ''
      else if (c.nodeType === 1) (c as Element).localName === 'br' ? (s += ' ') : walk(c)
    }
  }
  walk(el)
  return s.replace(/­/g, '').replace(/\s+/g, ' ').trim()
}

export const epubType = (el: Element) =>
  el.getAttributeNS(OPS_NS, 'type') ?? el.getAttribute('epub:type') ?? ''

/** Page-break marker (InDesign writes these as empty div/span with epub:type="pagebreak"). */
export const pageBreakOf = (el: Element): string | null =>
  epubType(el) === 'pagebreak' || el.getAttribute('role') === 'doc-pagebreak'
    ? (el.getAttribute('aria-label') ?? el.getAttribute('title') ?? el.id.replace(/^page-?/, ''))
    : null

/** Resolve a relative href against the directory of `base` (zip paths, no leading slash). */
export function resolvePath(base: string, href: string): string {
  const parts = base.split('/').slice(0, -1)
  for (const seg of decodeURIComponent(href.split('#')[0]).split('/')) {
    if (seg === '..') parts.pop()
    else if (seg && seg !== '.') parts.push(seg)
  }
  return parts.join('/')
}

export const xhtmlDoc = (lang: string, title: string, css: string, body: string) =>
  `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${lang}" xml:lang="${lang}">
<head>
<title>${esc(title)}</title>
<link href="${css}" rel="stylesheet" type="text/css"/>
</head>
<body>
${body}
</body>
</html>
`
