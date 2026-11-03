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
export const ownName = (key: string) => key.replace(/^.*?[_:/]+(?=[^_:/]+$)/, '')

function foldStyleName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\u0142/gi, 'l')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/([\p{L}])(\d)/gu, '$1 $2')
    .replace(/(\d)([\p{L}])/gu, '$1 $2')
    .normalize('NFC')
    .toLowerCase()
}

const SHORT_TOKENS = new Set(['ch', 'cap', 'ct', 'cn', 'pt', 'pn', 'zt', 'zu', 'kt'])

const CHAPTER_WORDS = [
  'chapter', 'chap', 'capitulo', 'chapitre', 'kapitel', 'capitolo',
  'hoofdstuk', 'rozdzial', 'glava', 'глава', 'kapitola', 'fejezet',
  'luku', 'kapittel', 'bolum', 'chuong',
]

const PART_WORDS = [
  'part', 'parte', 'partie', 'teil', 'deel', 'czesc', 'часть',
]

const SECTION_WORDS = [
  'section', 'seccao', 'secao', 'abschnitt', 'sezione', 'sekcja',
  'subheading', 'subhead', 'subtitulo', 'subtitle', 'zwischentitel', 'zwischenueberschrift',
  'intertitre', 'intertitulo',
]

const NUMBER_WORDS = new Set(['number', 'num', 'no', 'nr', 'label', 'zahl', 'numero'])
const TITLE_SUFFIXES = /^(title|name|head(ing)?|titel|uberschrift|berschrift|titulo|titre|titolo)$/i
const LABEL_SUFFIXES = /^(zahl|nummer|number|num|no|nr|label|numero)$/i

function matchClassifier(key: string): { role: Role; reason: string } | undefined {
  const f = foldStyleName(key)
  const tokens = f.split(/[\s\-_.:/]+/).filter(Boolean)
  if (!tokens.length) return undefined

  // 1. Heading levels: h1..h6, heading 1..heading 6
  if (/^h1$/i.test(f) || /^(heading|titre|titel|titulo)[-_ ]?1$/i.test(f)) return { role: 'chapter-title', reason: `style name “${key}” is a heading` }
  if (/^h2$/i.test(f) || /^(heading|titre|titel|titulo)[-_ ]?2$/i.test(f)) return { role: 'h2', reason: `style name “${key}” is a heading` }
  if (/^h3$/i.test(f) || /^(heading|titre|titel|titulo)[-_ ]?3$/i.test(f)) return { role: 'h3', reason: `style name “${key}” is a heading` }
  if (/^h4$/i.test(f) || /^(heading|titre|titel|titulo)[-_ ]?4$/i.test(f)) return { role: 'h4', reason: `style name “${key}” is a heading` }
  if (/^h[56]$/i.test(f) || /^(heading|titre|titel|titulo)[-_ ]?[56]$/i.test(f)) return { role: 'h5', reason: `style name “${key}” is a heading` }

  // 2. Subheading negative patterns:
  // Any sub-/sous-/unter-/sotto- prefix or section/seccao/secao/abschnitt form = subheading, never chapter.
  const hasSubPrefix = tokens.some((t) => {
    if ((t === 'sub' || t === 'sous' || t === 'unter' || t === 'sotto') && tokens.length > 1) return true
    for (const p of ['sub', 'sous', 'unter', 'sotto']) {
      if (t.startsWith(p) && t.length > p.length) {
        const rest = t.slice(p.length)
        if (
          CHAPTER_WORDS.some((w) => rest.startsWith(w)) ||
          SHORT_TOKENS.has(rest) ||
          SECTION_WORDS.some((w) => rest.startsWith(w)) ||
          /^\d+$/.test(rest) ||
          TITLE_SUFFIXES.test(rest) ||
          LABEL_SUFFIXES.test(rest)
        )
          return true
      }
    }
    return false
  })

  const hasSectionWord = tokens.some((t) => SECTION_WORDS.some((w) => t === w || t.startsWith(w)))
  const hasZt = tokens.includes('zt') || tokens.includes('zu') || tokens.some((t) => t.startsWith('zwischen'))

  if (hasSubPrefix || hasSectionWord || hasZt) {
    let role: Role = 'h2'
    if (tokens.some((t) => t === '3' || t === 'h3')) role = 'h3'
    else if (tokens.some((t) => t === '4' || t === 'h4')) role = 'h4'
    else if (tokens.some((t) => t === '5' || t === '6' || t === 'h5' || t === 'h6')) role = 'h5'
    else if (tokens.some((t) => t === '2' || t === 'h2')) role = 'h3'
    else if (hasZt) role = 'h3'
    return { role, reason: `style name “${key}” is a subheading` }
  }

  // 3. Short tokens (match whole tokens only)
  if (tokens.includes('cn')) return { role: 'chapter-label', reason: `style name “${key}” is a chapter number` }
  if (tokens.includes('ct')) return { role: 'chapter-title', reason: `style name “${key}” is a chapter title` }
  if (tokens.includes('pn')) return { role: 'part-label', reason: `style name “${key}” is a part number` }
  if (tokens.includes('pt')) return { role: 'part-title', reason: `style name “${key}” is a part title` }

  // 4. Chapter words (accent/case/hyphen/space-insensitive, short tokens whole only)
  const isChToken = (t: string) =>
    CHAPTER_WORDS.some((w) => {
      if (t === w) return true
      if (t.startsWith(w)) {
        const rest = t.slice(w.length)
        if (rest === 's' || /^\d+$/.test(rest) || TITLE_SUFFIXES.test(rest) || LABEL_SUFFIXES.test(rest)) return true
      }
      return false
    }) || t === 'ch' || t === 'cap' || t.includes('章') || t.includes('장')
  const hasChapter = tokens.some(isChToken)

  if (hasChapter) {
    const isLabel = tokens.some((t) => NUMBER_WORDS.has(t)) || /zahl|nummer|number/i.test(f)
    return {
      role: isLabel ? 'chapter-label' : 'chapter-title',
      reason: isLabel ? `style name “${key}” is a chapter number` : `style name “${key}” is a chapter title`,
    }
  }

  // 5. Part words
  const isPartToken = (t: string) =>
    PART_WORDS.some((w) => {
      if (t === w) return true
      if (t.startsWith(w)) {
        const rest = t.slice(w.length)
        if (rest === 's' || /^\d+$/.test(rest) || TITLE_SUFFIXES.test(rest) || LABEL_SUFFIXES.test(rest)) return true
      }
      return false
    })
  const hasPart = tokens.some(isPartToken)
  if (hasPart) {
    const isLabel = tokens.some((t) => NUMBER_WORDS.has(t)) || /zahl|nummer|number/i.test(f)
    return {
      role: isLabel ? 'part-label' : 'part-title',
      reason: isLabel ? `style name “${key}” is a part number` : `style name “${key}” is a part title`,
    }
  }

  return undefined
}

/** Classify style name across multilingual conventions (de, fr, es, pt, it, nl, pl, ru, tr, vi, zh, ko). */
export function classifyStyleName(key: string): { role: Role; reason: string } | undefined {
  const own = ownName(key)
  const m = matchClassifier(key) ?? (own !== key ? matchClassifier(own) : undefined)
  if (m) return m
  const dn = STYLE_NAMES.find(([, re]) => re.test(key)) ?? (own !== key ? STYLE_NAMES.find(([, re]) => re.test(own)) : undefined)
  if (dn) return { role: dn[0], reason: `style name “${key}” is a ${dn[2]}` }
}

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
  const cl = classifyStyleName(key)
  if (cl && (cl.role === 'drop' || cl.role === 'p' || avgLen < 180)) return [cl.role, cl.reason]
  if (TOC_NAME.test(key)) return ['toc', `style name “${key}” is a contents entry`]
  if (IMPRINT_NAME.test(key)) return ['imprint', `style name “${key}” is the imprint`]
}
