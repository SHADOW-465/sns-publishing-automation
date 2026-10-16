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
