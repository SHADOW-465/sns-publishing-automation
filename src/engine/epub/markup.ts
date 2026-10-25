// Roles written out through the client's templates (design §4.2). One function per role, shared by the InDesign and PDF builders,
// so a client's markup is data in one place. Roles with a template: chapter-title and part-title (the heading builders),
// noteref and figure (here).
import { esc } from '../xml.ts'
import { settings } from '../settings.ts'
import { labelsFor } from './locale.ts'

const attrsOf = (a?: Record<string, string>) => Object.entries(a ?? {}).map(([k, v]) => ` ${k}="${esc(v)}"`).join('')

/** The wrapper of a picture, as the client's figure template says (default: <figure> with the builder's own class).
 *  A <div> wrapper has no <figcaption>, so its caption is a paragraph. */
export function figureWrap(defaultClass: string): { open: string; close: string; caption: (cls: string, html: string) => string } {
  const t = settings().markup.figure
  const tag = t?.tag === 'div' ? 'div' : 'figure'
  const cls = t?.class ?? defaultClass
  const capTag = tag === 'figure' ? 'figcaption' : 'p'
  return { open: `<${tag}${cls ? ` class="${esc(cls)}"` : ''}${attrsOf(t?.attrs)}>`, close: `</${tag}>`, caption: (c, html) => `<${capTag} class="${c}">${html}</${capTag}>` }
}

/** The extended description of a complex figure (chart, map, diagram), linked from the picture by aria-describedby.
 *  FIG-02: a paragraph (default) or a collapsed <details> whose summary is the language's "Picture description". */
export function longDescHtml(id: string, desc: string, lang: string): string {
  const d = esc(desc.trim())
  if (settings().longDescAs !== 'details') return `<p id="${id}" class="longdesc">${d}</p>`
  return `<details id="${id}" class="longdesc"><summary>${esc(labelsFor(lang).longDesc)}</summary><p>${d}</p></details>`
}

/** A note reference, written as the client's noteref template says (default: a link in a <sup>). */
export function noteRef(href: string, id: string, label: string): string {
  const t = settings().markup.noteref
  const attrs = attrsOf(t?.attrs)
  const a = `<a epub:type="noteref" href="${href}"${id ? ` id="${id}"` : ''} role="doc-noteref"${attrs}>${label}</a>`
  const wrap = t?.wrap ?? 'sup'
  const cls = wrap && t?.class ? ` class="${esc(t.class)}"` : ''
  return wrap ? `<${wrap}${cls}>${a}</${wrap}>` : a
}

/** NOTE-05: the number a note shows: the source's own mark, its place in the book, or its place in its chapter. */
export function noteLabel(source: string, inBook: number, inSection: number): string {
  const m = settings().noteNumbers
  return m === 'continuous' ? String(inBook) : m === 'per-chapter' ? String(inSection) : source
}
