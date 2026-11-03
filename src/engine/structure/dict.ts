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

const CHAPTER_WORDS = [
  'chapter', 'chap', 'capitulo', 'chapitre', 'kapitel', 'capitolo',
  'hoofdstuk', 'rozdzial', 'glava', 'глава', 'kapitola', 'fejezet',
  'luku', 'kapittel', 'bolum', 'chuong',
]

const PART_WORDS = [
  'part', 'parte', 'partie', 'teil', 'deel', 'czesc', 'часть',
]

/** Words that name a subheading level (a "sub-" prefix also does). "Subtitle", "sous-titre", "Untertitel" and
 * "sottotitolo" are left out on purpose: they usually mean the book's or a chapter's subtitle, not a subheading. */
const SECTION_WORDS = [
  'section', 'seccao', 'secao', 'abschnitt', 'sezione', 'sekcja',
  'subheading', 'subhead', 'subtitulo', 'zwischentitel', 'zwischenuberschrift', 'zwischenueberschrift',
  'intertitre', 'intertitulo',
]
const SUBTITLE = /^(sub ?title|sous ?titre|unter ?titel|sotto ?titolo)s?$/
const SUB_PREFIXES = ['sub', 'sous', 'unter', 'sotto']

/** Words that may stand next to a chapter/part/section word without changing what the style is. */
const TITLE_WORDS = new Set(['title', 'titles', 'name', 'head', 'heading', 'titel', 'uberschrift', 'ueberschrift', 'titulo', 'titre', 'titolo', 'tytul', 'naam', 'nazev', 'cim', 'otsikko', 'baslik', 'de', 'del', 'do', 'da', 'di', 'du', 'of', 'the', 'van', 'des', 'h1', '第', '제'])
const LABEL_WORDS = new Set(['number', 'num', 'no', 'nr', 'nummer', 'label', 'zahl', 'numero', 'nro'])
const TITLE_SUFFIXES = /^(title|name|head(ing)?|titel|u?e?berschrift|titulo|titre|titolo)$/i
const LABEL_SUFFIXES = /^(zahl|nummer|number|num|no|nr|label|numero)$/i

type Kind = 'chap' | 'part' | 'sect' | 'sub' | 'title' | 'label' | 'digit' | 'ct' | 'cn' | 'pt' | 'pn' | 'ch' | 'other'

/** "kapitel", "kapitelzahl", "capitulos", "chapter1", "chaptertitle": the word, then nothing, an s, a number, a title or a label word. */
function compound(t: string, words: string[]): 'title' | 'label' | undefined {
  for (const w of words) {
    if (t === w) return 'title'
    if (!t.startsWith(w)) continue
    const rest = t.slice(w.length)
    if (rest === 's' || /^\d+$/.test(rest) || TITLE_SUFFIXES.test(rest)) return 'title'
    if (LABEL_SUFFIXES.test(rest)) return 'label'
  }
}

function kindOf(t: string, first: boolean): { kind: Kind; label?: boolean } {
  if (/^\d+$/.test(t)) return { kind: 'digit' }
  if (TITLE_WORDS.has(t)) return { kind: 'title' }
  if (LABEL_WORDS.has(t)) return { kind: 'label' }
  // the short forms count only as the style's first word ("CT", "CT_01", "ch-title", "cap 1"), never inside
  // "Body 10pt", "Drop Cap" or "Text CN"
  if (first && (t === 'ct' || t === 'cn' || t === 'pt' || t === 'pn')) return { kind: t }
  if (first && (t === 'ch' || t === 'cap')) return { kind: 'ch' }
  if (SUB_PREFIXES.includes(t)) return { kind: 'sub' }
  for (const p of SUB_PREFIXES) {
    if (!t.startsWith(p) || t.length <= p.length) continue
    const rest = t.slice(p.length)
    if (compound(rest, CHAPTER_WORDS) || compound(rest, SECTION_WORDS) || rest === 'ch' || rest === 'cap' || /^\d+$/.test(rest) || TITLE_SUFFIXES.test(rest)) return { kind: 'sub' }
  }
  if (compound(t, SECTION_WORDS) || t.startsWith('zwischen')) return { kind: 'sect' }
  const ch = compound(t, CHAPTER_WORDS)
  if (ch) return { kind: 'chap', label: ch === 'label' }
  if (t.includes('章') || t.includes('장')) return { kind: 'chap' }
  const pa = compound(t, PART_WORDS)
  if (pa) return { kind: 'part', label: pa === 'label' }
  return { kind: 'other' }
}

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

  // a subtitle style ("Subtitle", "Chapter Subtitle", "Sous-titre") is not a heading level: left to the other evidence
  if (tokens.some((t, i) => SUBTITLE.test(t) || (i + 1 < tokens.length && SUBTITLE.test(`${t} ${tokens[i + 1]}`)))) return undefined

  // 2. Every word must be structural. "Chapter Epigraph", "Chapter_Body", "Kapitel Text", "Drop Cap" and "Body 10pt"
  // name something else than the heading itself, so they are left to the other evidence (style table, layout).
  const kinds = tokens.map((t, i) => kindOf(t, i === 0))
  if (kinds.some((k) => k.kind === 'other')) return undefined
  // a bare "Sub" or "Sous 2" says sub-what? Too little to name a heading: left to the size and position evidence
  if (tokens.every((t, i) => SUB_PREFIXES.includes(t) || kinds[i].kind === 'digit')) return undefined
  const has = (k: Kind) => kinds.some((x) => x.kind === k)
  const isLabel = has('label') || kinds.some((x) => x.label)

  // 3. Any sub-/sous-/unter-/sotto- prefix or section/seccao/secao/abschnitt form = subheading, never chapter.
  if (has('sub') || has('sect')) {
    // the level a subheading style names: "Subtitulo2", "SUB-CAPITULO 2" one below the first, "Subtitulo3" two below.
    // Each number is its own level, so the client's Subtitulo2 and Subtitulo3 never collapse into one.
    let role: Role = 'h2'
    const tagTok = tokens.find((t) => /^h[2-6]$/.test(t))
    const n = Number(tokens.map((t) => t.match(/^(\d)$/)?.[1] ?? t.match(/^\p{L}{3,}(\d)$/u)?.[1]).find(Boolean) ?? 0)
    if (tagTok) role = tagTok === 'h2' || tagTok === 'h3' ? 'h3' : tagTok === 'h4' ? 'h4' : 'h5'
    else if (n >= 2) role = (['h3', 'h4', 'h5'] as const)[Math.min(2, n - 2)]
    else if (tokens.some((t) => t.startsWith('zwischen'))) role = 'h3'
    return { role, reason: `style name “${key}” is a subheading` }
  }

  // 4. Short forms (first word only)
  if (kinds[0].kind === 'cn') return { role: 'chapter-label', reason: `style name “${key}” is a chapter number` }
  if (kinds[0].kind === 'ct') return { role: 'chapter-title', reason: `style name “${key}” is a chapter title` }
  if (kinds[0].kind === 'pn') return { role: 'part-label', reason: `style name “${key}” is a part number` }
  if (kinds[0].kind === 'pt') return { role: 'part-title', reason: `style name “${key}” is a part title` }
  // a bare "Cap" or "Ch" is too often a drop cap or a character style: only with a number or a title word
  if (kinds[0].kind === 'ch' && tokens.length === 1) return undefined

  // 5. Chapter words (accent/case/hyphen/space-insensitive)
  if (has('chap') || has('ch')) {
    return {
      role: isLabel ? 'chapter-label' : 'chapter-title',
      reason: isLabel ? `style name “${key}” is a chapter number` : `style name “${key}” is a chapter title`,
    }
  }

  // 6. Part words
  if (has('part')) {
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
