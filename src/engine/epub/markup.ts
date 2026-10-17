// Roles written out through the client's templates (design §4.2). One function per role, shared by the InDesign and PDF builders,
// so a client's markup is data in one place. Roles with a template today: chapter-title (indesign/build.ts) and noteref.
import { esc } from '../xml.ts'
import { settings } from '../settings.ts'

/** A note reference, written as the client's noteref template says (default: a link in a <sup>). */
export function noteRef(href: string, id: string, label: string): string {
  const t = settings().markup.noteref
  const attrs = Object.entries(t?.attrs ?? {}).map(([k, v]) => ` ${k}="${esc(v)}"`).join('')
  const a = `<a epub:type="noteref" href="${href}"${id ? ` id="${id}"` : ''} role="doc-noteref"${attrs}>${label}</a>`
  const wrap = t?.wrap ?? 'sup'
  return wrap ? `<${wrap}>${a}</${wrap}>` : a
}
