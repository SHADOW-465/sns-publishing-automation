// Style names typesetters use, as data (design §2.3, the German abbreviation table). Each row: the role the tool gives the
// style, the names (whole style name, any case, an optional number or "-1" after it), and what the name means. Names whose
// meaning has no role of its own yet (caption, quotation, box, note text, drop cap) are kept as text, "p" with their own
// class, so they are never taken for headings; the meaning shows on the review screen.
import type { Role } from '../indesign/read.ts'

const N = '([-_ ]?\\d+)?'
const names = (...alts: string[]) => new RegExp(`^(${alts.join('|')})${N}$`, 'i')

export const STYLE_NAMES: [Role, RegExp, string][] = [
  ['chapter-label', names('cn', 'chapter[-_ ]?(number|num|no|nr|label)', 'chapternumber', 'chap[-_ ]?(num|no|nr)', 'numero[-_ ]?capitolo', 'n[uú]mero[-_ ]?cap[ií]tulo', 'num[eé]ro[-_ ]?chapitre'), 'chapter number'],
  ['chapter-title', names('ct', 'chapter[-_ ]?title', 'chaptertitle', 'chap[-_ ]?title', 'titolo[-_ ]?capitolo', 't[ií]tulo[-_ ]?cap[ií]tulo', 'titre[-_ ]?chapitre'), 'chapter title'],
  ['part-label', names('pn', 'part[-_ ]?(number|num|no|label)', 'partnumber'), 'part number'],
  ['part-title', names('part[-_ ]?title', 'parttitle', 'titolo[-_ ]?parte'), 'part title'],
  ['chapter-label', names('kapitelzahl', 'kapnr', 'kapitelnummer', 'kapitel[-_ ]?nr'), 'chapter number (German: Kapitelzahl)'],
  ['chapter-title', names('kapitel[uü]berschrift', 'k[uü]', 'kapitel[-_ ]?[uü]berschrift'), 'chapter title (German: Kapitelüberschrift)'],
  ['h3', names('zt', 'z[uü]', 'zwischentitel', 'zwischen[uü]berschrift'), 'subheading (German: Zwischentitel)'],
  ['drop', names('kt', 'kolumnentitel', 'pagina', 'lebender[-_ ]?kolumnentitel'), 'running head or folio (German: Kolumnentitel)'],
  ['imprint', /^impressum/i, 'imprint (German: Impressum)'],
  ['p', names('grundtext', 'lauftext', 'flie(ß|ss)text', 'gt'), 'body text (German: Grundtext)'],
  ['p', names('vorspann', 'lead'), 'lead paragraph (German: Vorspann)'],
  ['p', names('bu', 'bildunterschrift', 'bildlegende'), 'picture caption (German: Bildunterschrift)'],
  ['p', names('bn', 'bildnachweis', 'bildquelle'), 'picture credit (German: Bildnachweis)'],
  ['p', names('zitat', 'blockzitat'), 'quotation (German: Zitat)'],
  ['p', names('motto'), 'epigraph (German: Motto)'],
  ['p', names('widmung'), 'dedication (German: Widmung)'],
  ['p', names('fn', 'fu(ß|ss)note', 'fn[-_ ]?text'), 'footnote text (German: Fußnote)'],
  ['p', names('anm', 'anmerkung', 'anmerkungen', 'endnote'), 'endnote text (German: Anmerkung)'],
  ['p', names('kasten', 'info', 'infokasten'), 'box (German: Kasten)'],
  ['p', names('marginalie', 'randnotiz'), 'margin note (German: Marginalie)'],
  ['p', names('initial'), 'drop cap paragraph (German: Initial)'],
]
/** InDesign exports a style inside a group as "Group_Style" (e.g. "Titoli_Titolo-capitolo"): the style's own name counts too. */
const ownName = (key: string) => key.replace(/^.*?[_:/]+(?=[^_:/]+$)/, '')
export const nameRole = (key: string) => STYLE_NAMES.find(([, re]) => re.test(key)) ?? (ownName(key) !== key ? STYLE_NAMES.find(([, re]) => re.test(ownName(key))) : undefined)

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
