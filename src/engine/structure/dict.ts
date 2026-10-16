// Style names typesetters use, as data (design §2.3). Only roles the tool has today are listed;
// a name with no role yet (BU caption, Zitat quotation, Kasten box) belongs to a later phase.
import type { Role } from '../indesign/read.ts'

export const STYLE_NAMES: [Role, RegExp, string][] = [
  ['chapter-label', /^(kapitelzahl|kapnr|kapitelnummer|kapitel[-_ ]?nr)$/i, 'chapter number (German)'],
  ['chapter-title', /^(kapitel[uü]berschrift|k[uü]|kapitel[-_ ]?[uü]berschrift)$/i, 'chapter title (German)'],
  ['h3', /^(zt|z[uü]|zwischentitel|zwischen[uü]berschrift|zwischentitel[-_ ]?[12])$/i, 'subheading (German)'],
  ['drop', /^(kt|kolumnentitel|pagina|lebender[-_ ]?kolumnentitel)$/i, 'running head (German)'],
  ['imprint', /^impressum/i, 'imprint (German)'],
]
export const nameRole = (key: string) => STYLE_NAMES.find(([, re]) => re.test(key))

/** Named paragraph styles that mean a heading level. h1 opens a chapter; h2–h6 stay inside it. */
export const NAMED_HEAD: [Role, RegExp][] = [
  ['chapter-title', /^(h1|heading[-_ ]?1|chapter([-_ ]?(title|name|head(ing)?))?|kapitel([-_ ]?titel)?|titulo[-_ ]?capitulo)$/i],
  ['h2', /^(h2|heading[-_ ]?2)$/i],
  ['h3', /^(h3|heading[-_ ]?3)$/i],
  ['h4', /^(h4|heading[-_ ]?4)$/i],
  ['h5', /^(h5|h6|heading[-_ ]?[56])$/i],
]
/** Style names InDesign and other exporters use for structure, in any language. Not a book list. */
export const TOC_NAME = /^(toc|ihv|inhalt|contents|indice|sumario|sommario|table[-_ ]?of[-_ ]?contents)([-_ ]?[0-9ivx]+|[a-z])?$/i
export const IMPRINT_NAME = /impressum|imprint|colophon|copyright|copy-?right|legal/i

/** The role a style's name alone points to, with the reason. */
export function nameVote(key: string, avgLen: number): [Role, string] | undefined {
  const named = NAMED_HEAD.find(([, re]) => re.test(key))
  if (named && avgLen < 180) return [named[0], `style name “${key}” is a heading`]
  const dn = nameRole(key)
  if (dn) return [dn[0], `style name “${key}” is a ${dn[2]}`]
  if (TOC_NAME.test(key)) return ['toc', `style name “${key}” is a contents entry`]
  if (IMPRINT_NAME.test(key)) return ['imprint', `style name “${key}” is the imprint`]
}
