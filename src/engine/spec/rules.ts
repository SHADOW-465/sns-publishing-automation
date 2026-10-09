// =============================================================================================
// The rule registry: every house rule the e-book follows, in one list. Each rule has a stable ID
// (used in every conversation with the client: "TBL-01", never "the table thing"), a kind, the
// setting it controls, its choices, and the words people use for it in requirement documents.
// The Spec step, the Settings screen, the Excel spec workbook and the requirement import are all
// generated from this list, so they can never disagree.
//
// Kinds:
//   locked   — required for a valid EPUB (EPUBCheck) or by how the tool works; shown, never changed
//   advisory — accessibility (Ace, WCAG); may be changed only with a recorded waiver
//   free     — house taste; the client decides
// =============================================================================================
import { DEFAULT_SETTINGS, VARIANT_GROUPS, type HouseSettings, type VariantGroup } from '../settings.ts'

export type RuleKind = 'locked' | 'advisory' | 'free'
export type RuleType = 'choice' | 'bool' | 'number' | 'multi' | 'list' | 'css' | 'fixed'
export type RuleValue = string | number | boolean | string[]

export interface Rule {
  id: string
  group: string
  title: string
  /** one or two sentences in plain words: what the reader sees */
  help: string
  kind: RuleKind
  type: RuleType
  /** the setting the rule controls (absent for 'fixed' rules, which the tool always applies) */
  key?: keyof HouseSettings
  /** value → label, for choice / multi */
  choices?: [string, string][]
  unit?: string
  min?: number
  max?: number
  /** advisory rules: the accessible value; anything else needs a waiver */
  safe?: RuleValue
  /** the markup or CSS a value produces, shown next to the choice */
  example?: (v: RuleValue) => string
  /** words that point at this rule in a requirement document (lower case, Spanish and English) */
  keywords: string[]
  /** words that point at each choice ("th", "cabecera" → th) */
  choiceWords?: Record<string, string[]>
  /** where the rule came from (client feedback round, standard) */
  origin: string
}

export const WAIVER_TEXT = 'Yes, I know this reduces accessibility, do it anyway.'

export const GROUPS = ['Pages and language', 'Headings', 'Paragraphs and classes', 'Tables', 'Notes', 'Contents pages', 'Stylesheet', 'Copyright page', 'Standard EPUB', 'Quality check'] as const

const onOff: [string, string][] = [['true', 'Yes'], ['false', 'No']]

export const RULES: Rule[] = [
  // ---- pages and language ----
  {
    id: 'DOC-00', group: 'Pages and language', title: 'Kind of e-book', kind: 'free', type: 'choice', key: 'defaultProfile',
    help: 'Accessible EPUB: reading roles, printed page numbers with a page list, and accessibility details in the package (libraries, schools, the European Accessibility Act). Standard EPUB: the same text, styles, contents and notes as a clean EPUB 3 for the stores, without that layer. Each book can still choose in Book details.',
    choices: [['accessible', 'Accessible EPUB'], ['standard', 'Standard EPUB']],
    example: (v) => (v === 'standard' ? '<h2 class="…" id="chap2">   (no role, aria-* or page markers)' : '<h2 class="…" id="chap2" role="heading" aria-level="2">'),
    keywords: ['standard epub', 'accessible epub', 'epub estándar', 'epub accesible', 'kind of epub', 'tipo de epub', 'epub type'],
    choiceWords: { standard: ['standard', 'estándar', 'estandar', 'plain epub', 'trade epub'], accessible: ['accessible', 'accesible'] },
    origin: 'Client scope (InDesign to accessible / standard EPUB)',
  },
  {
    id: 'DOC-01', group: 'Pages and language', title: 'Language attribute on each page', kind: 'free', type: 'choice', key: 'htmlLang',
    help: 'Which attribute names the book language on every page. Both work in every reader.',
    choices: [['xml:lang', 'xml:lang only'], ['both', 'lang and xml:lang'], ['lang', 'lang only']],
    example: (v) => `<html … ${v === 'lang' ? 'lang="es-ES"' : v === 'both' ? 'lang="es-ES" xml:lang="es-ES"' : 'xml:lang="es-ES"'}>`,
    keywords: ['xml:lang', 'lang=', 'language attribute', 'atributo de idioma', 'idioma duplicado', 'duplicated language', 'lang attribute'],
    choiceWords: { 'xml:lang': ['xml:lang only', 'solo xml:lang', 'duplicated', 'duplicado', 'remove lang'], both: ['both', 'ambos'], lang: ['lang only', 'solo lang'] },
    origin: 'V3 row 5',
  },
  {
    id: 'DOC-02', group: 'Pages and language', title: 'Language wrapper inside each section', kind: 'free', type: 'bool', key: 'langWrapper',
    help: 'Repeats the book language on a <div xml:lang> around the content of every page.',
    choices: onOff, example: (v) => (v ? '<section …>\n<div xml:lang="es-ES">' : '<section …>'),
    keywords: ['div xml:lang', 'language wrapper', 'xml:lang missing', 'falta xml:lang', 'div de idioma'],
    origin: 'V2 row 4',
  },
  {
    id: 'PG-01', group: 'Pages and language', title: 'Where page markers go', kind: 'locked', type: 'fixed',
    help: 'Each printed page number is marked exactly where that page starts in the text, also on contents pages.',
    keywords: ['page number placement', 'pagebreak', 'page marker', 'número de página', 'salto de página'],
    origin: 'EPUB page navigation; V3 rows 9–10',
  },

  // ---- headings ----
  {
    id: 'HD-01', group: 'Headings', title: 'role="heading" on part and chapter titles', kind: 'free', type: 'bool', key: 'roleHeading',
    help: 'Adds role="heading" to the title that names each part of the book.',
    choices: onOff, example: (v) => (v ? '<h2 class="…" id="chap2" role="heading" aria-level="2">' : '<h2 class="…" id="chap2">'),
    keywords: ['role="heading"', 'role heading', 'role=heading'],
    origin: 'V2 row 1',
  },
  {
    id: 'HD-02', group: 'Headings', title: 'aria-level with every role="heading"', kind: 'locked', type: 'fixed',
    help: 'EPUBCheck rejects role="heading" without aria-level, so the level is always written with it.',
    keywords: ['aria-level'],
    origin: 'EPUBCheck',
  },
  {
    id: 'HD-03', group: 'Headings', title: 'Numbered heading series look alike', kind: 'free', type: 'bool', key: 'seriesSmallCaps',
    help: 'When some headings of a series ("Hábito 1…12") are in small caps and others are not, all of them get small caps.',
    choices: onOff, example: (v) => (v ? 'H<span class="small-caps">ÁBITO</span> 5' : 'Hábito 5'),
    keywords: ['smallcaps', 'small caps', 'small-caps', 'versalitas', 'versales'],
    origin: 'V2 row 2',
  },
  {
    id: 'HD-04', group: 'Headings', title: 'Space above part, chapter and section titles', kind: 'free', type: 'number', key: 'headingSpaceAboveEm', unit: 'em', min: 0, max: 10,
    help: 'Print opens these titles low on the page. At least this much space is left above them.',
    example: (v) => `h2.… { margin-top: ${v}em; }`,
    keywords: ['top space', 'space above', 'espacio superior', 'espacio arriba', 'margen superior', 'space before title'],
    origin: 'V3 row 16',
  },
  {
    id: 'HD-05', group: 'Headings', title: 'Space below part, chapter and section titles', kind: 'free', type: 'number', key: 'headingSpaceBelowEm', unit: 'em', min: 0, max: 10,
    help: 'At least this much space between the title and the first paragraph.',
    example: (v) => `h2.… { margin-bottom: ${v}em; }`,
    keywords: ['space below title', 'space after title', 'espacio debajo del título', 'espacio después del título'],
    origin: 'V3 row 16',
  },
  {
    id: 'HD-06', group: 'Headings', title: 'Heading size', kind: 'free', type: 'number', key: 'headingScalePct', unit: '%', min: 50, max: 200,
    help: 'Heading sizes come from the InDesign styles, relative to the body text. 100 keeps them as in print; lower makes all headings smaller.',
    example: (v) => `h1.… { font-size: ${Math.round(1.1 * Number(v) / 5) * 5}%; }  (a label 10% larger than the text)`,
    keywords: ['font size', 'tamaño de fuente', 'tamaño de letra', 'heading size', 'tamaño del título', 'too big', 'muy grande'],
    origin: 'V3 row 17',
  },

  // ---- paragraphs and classes ----
  {
    id: 'TXT-01', group: 'Paragraphs and classes', title: 'Paragraphs changed by hand in InDesign', kind: 'free', type: 'choice', key: 'styleVariants',
    help: 'Every element has one class. A paragraph changed by hand gets a class of its own (Texto1) only for the kinds of change ticked in TXT-02.',
    choices: [['own', 'A class of its own when the change matters'], ['ignore', 'Always the style’s class']],
    example: (v) => (v === 'own' ? '<p class="Texto1">…  (never "Texto Texto1")' : '<p class="Texto">…'),
    keywords: ['dummy', 'first style is dummy', 'two classes', 'dos clases', 'estilo duplicado', 'override', 'variant'],
    choiceWords: { ignore: ['always the style', 'siempre el estilo', 'ignore overrides', 'no variants'] },
    origin: 'V3 row 6',
  },
  {
    id: 'TXT-02', group: 'Paragraphs and classes', title: 'Which hand changes get their own class', kind: 'free', type: 'multi', key: 'variantOn',
    help: 'Typesetters often change one paragraph without meaning anything by it. Only the ticked kinds of change are kept.',
    choices: (Object.keys(VARIANT_GROUPS) as VariantGroup[]).map((g) => [g, ({ align: 'Alignment', indent: 'Indents', face: 'Italic or bold on the whole paragraph', size: 'Font size and family', spacing: 'Space above and below', colour: 'Text colour' })[g]]),
    keywords: ['alignment of paragraph', 'override alignment'],
    origin: 'V3 row 6',
  },
  {
    id: 'TXT-03', group: 'Paragraphs and classes', title: 'Quoted verse', kind: 'free', type: 'bool', key: 'verseLines',
    help: 'A quotation broken into short lines (a mantra, a poem) is set as a block: extract1 lines and a final extract2 line.',
    choices: onOff, example: (v) => (v ? '<p class="extract1">«Mi poder…</p>\n<p class="extract2">…disfraces!»</p>' : '<p class="indent">«Mi poder…</p>'),
    keywords: ['verse', 'verso', 'poem', 'poema', 'extract style', 'estilo extract', 'extract – style missing'],
    origin: 'V2 row 3',
  },
  {
    id: 'TXT-04', group: 'Paragraphs and classes', title: 'Class of indented blocks', kind: 'free', type: 'choice', key: 'blockClass',
    help: 'Class of an indented paragraph that has no InDesign style of its own (questions and answers, exercises).',
    choices: [['extract1', 'extract1'], ['extract', 'extract']],
    example: (v) => `<p class="${v}"><span class="italic">Pregunta</span>: …</p>`,
    keywords: ['style missing', 'estilo faltante', 'falta estilo', 'extract1', 'indented block', 'bloque sangrado', 'pregunta', 'respuesta'],
    origin: 'V3 row 12',
  },
  {
    id: 'TXT-05', group: 'Paragraphs and classes', title: 'Space around indented blocks', kind: 'free', type: 'number', key: 'blockSpaceEm', unit: 'em', min: 0, max: 5,
    help: 'Space around quote blocks (<blockquote>; <div class="top"> in a standard EPUB). It overlaps the paragraphs’ own space instead of adding to it.',
    example: (v) => `blockquote { margin: ${v}em 0; }`,
    keywords: ['spacing', 'espaciado', 'wrong spacing', 'space around', 'espacio entre'],
    origin: 'V3 rows 13–14',
  },
  {
    id: 'TXT-06', group: 'Paragraphs and classes', title: 'Largest paragraph spacing', kind: 'free', type: 'number', key: 'maxSpaceEm', unit: 'em', min: 0, max: 10,
    help: 'Space above and below paragraphs is taken from print up to this much, so gaps stay small on phones.',
    example: (v) => `p.… { margin-top: ≤${v}em; }`,
    keywords: ['too much space', 'demasiado espacio', 'space between paragraphs', 'espacio entre párrafos', 'bottom space'],
    origin: 'V3 rows 13–14',
  },

  // ---- tables ----
  {
    id: 'TBL-01', group: 'Tables', title: 'Table header row', kind: 'advisory', type: 'choice', key: 'tableHeaders', safe: 'th',
    help: 'With header cells, screen readers announce the column name with each cell. Without them, blind readers hear bare values.',
    choices: [['th', 'Header cells: <thead>, <th scope="col">'], ['reference', 'Plain <td> cells with the InDesign cell style']],
    example: (v) => (v === 'th' ? '<thead>\n<tr>\n<th class="No-Table-Style1" scope="col">Sí</th>' : '<tbody>\n<tr>\n<td class="No-Table-Style1">Sí</td>'),
    keywords: ['table', 'tabla', 'thead', '<th', 'th scope', 'table structure', 'estructura de tabla', 'cabecera de tabla', 'header row', 'extra tags'],
    choiceWords: { th: ['th scope', 'thead', 'header cells', 'celdas de cabecera', 'accessible'], reference: ['td', 'no thead', 'sin thead', 'extra tags', 'manual epub', 'like the manual', 'como el manual', 'remove th'] },
    origin: 'V3 row 11',
  },
  {
    id: 'TBL-02', group: 'Tables', title: 'Column widths', kind: 'locked', type: 'fixed',
    help: 'Widths come from InDesign and always add up to 100%; narrow columns get at least 10%.',
    keywords: ['column width', 'ancho de columna', 'colgroup'],
    origin: 'V3 row 11',
  },

  // ---- notes ----
  {
    id: 'NOTE-01', group: 'Notes', title: 'Line above the footnotes', kind: 'free', type: 'choice', key: 'footnoteRule',
    help: 'The separator line between the text and its footnotes.',
    choices: [['short', 'Short line, as in print'], ['full', 'Full width'], ['none', 'No line']],
    example: (v) => (v === 'none' ? '<div class="footnotes">' : '<div class="footnotes">\n<hr class="footline"/>'),
    keywords: ['foot-line', 'footline', 'foot line', 'línea de nota', 'filete', 'separator line', 'línea separadora'],
    choiceWords: { short: ['short', 'reduce', 'reduced', 'corta', 'reducir', 'as in print'], full: ['full width', 'ancho completo'], none: ['no line', 'sin línea', 'remove line'] },
    origin: 'V3 row 15',
  },
  {
    id: 'NOTE-02', group: 'Notes', title: 'Length of the short footnote line', kind: 'free', type: 'number', key: 'footnoteRuleWidth', unit: '%', min: 5, max: 100,
    help: 'Share of the text width, for the short line.',
    example: (v) => `hr.footline { width: ${v}%; }`,
    keywords: ['line length', 'longitud de la línea', 'line width'],
    origin: 'V3 row 15',
  },
  {
    id: 'NOTE-03', group: 'Notes', title: 'Footnote indent', kind: 'free', type: 'number', key: 'footnoteIndentEm', unit: 'em', min: 0, max: 5,
    help: 'First-line indent of each footnote.',
    example: (v) => `p.Nota-al-pie { text-indent: ${v}em; }`,
    keywords: ['footnote indent', 'sangría de nota', 'sangría de las notas', 'indent missing'],
    origin: 'V3 row 20',
  },

  // ---- contents pages ----
  {
    id: 'NAV-01', group: 'Contents pages', title: 'Hanging indent of chapter entries', kind: 'free', type: 'number', key: 'tocEntryIndentEm', unit: 'em', min: 0, max: 5,
    help: 'A chapter entry on the contents and exercise-list pages starts flush left and its wrapped lines hang in by this much, as in print. 0 sets every line flush.',
    example: (v) => `p.toc_1a { margin-left: ${v}em; text-indent: -${v}em; }`,
    keywords: ['toc alignment', 'toc', 'índice', 'alineación del índice', 'contents', 'lista de ejercicios'],
    origin: 'V3 rows 18–19',
  },

  // ---- stylesheet ----
  {
    id: 'CSS-01', group: 'Stylesheet', title: 'Stylesheet layout', kind: 'free', type: 'choice', key: 'cssFormat',
    help: 'How the CSS file is written. It looks the same in the reader either way.',
    choices: [['vertical', 'One declaration per line, margins written out'], ['compact', 'One rule per line']],
    example: (v) => (v === 'vertical' ? 'h3.Ladillo-2\n{\nfont-size:110%;\nmargin-top:1.5em;\n…\n}' : 'h3.Ladillo-2 { font-size: 110%; margin: 1.5em 0 1em 0; … }'),
    keywords: ['css order', 'order by vertical', 'vertical', 'orden css', 'formato css', 'css format'],
    choiceWords: { vertical: ['vertical'], compact: ['compact', 'one line', 'una línea'] },
    origin: 'V3 row 7',
  },
  {
    id: 'CSS-02', group: 'Stylesheet', title: 'House stylesheet', kind: 'free', type: 'css', key: 'houseCss',
    help: 'The fixed classes every e-book uses (indent, extract1, toc_1…). Empty uses the built-in one.',
    keywords: ['house css', 'base css', 'hoja de estilos'],
    origin: 'Settings',
  },
  {
    id: 'CSS-03', group: 'Stylesheet', title: 'Extra CSS', kind: 'free', type: 'css', key: 'extraCss',
    help: 'Added at the end of the stylesheet, so it wins over everything else.',
    keywords: ['extra css', 'css adicional', 'add css', 'añadir css'],
    origin: 'Settings',
  },

  // ---- copyright page ----
  {
    id: 'FM-01', group: 'Copyright page', title: 'Print-only lines to remove', kind: 'free', type: 'list', key: 'printOnly',
    help: 'Any copyright-page line containing one of these phrases is left out of the e-book (printer, legal deposit, paper notices are removed already).',
    keywords: ['remove line', 'eliminar línea', 'print only', 'solo impreso', 'depósito legal', 'impreso en'],
    origin: 'V1',
  },

  // ---- quality check ----
  {
    id: 'A11Y-01', group: 'Quality check', title: 'Pictures without a description', kind: 'advisory', type: 'choice', key: 'altRequired', safe: 'error',
    help: 'A picture with no description is invisible to blind readers. Accessible books stop delivery until each picture is described or marked decorative.',
    choices: [['error', 'Must be fixed before download'], ['warn', 'Only a warning']],
    keywords: ['alt text', 'texto alternativo', 'image description', 'descripción de imagen'],
    origin: 'EPUB Accessibility 1.1',
  },
  {
    id: 'QA-01', group: 'Quality check', title: 'Smallest cover', kind: 'free', type: 'number', key: 'minCoverPx', unit: 'px', min: 0, max: 10000,
    help: 'Shortest acceptable long side of the cover image.',
    keywords: ['cover size', 'tamaño de cubierta', 'portada'],
    origin: 'Settings',
  },
  {
    id: 'QA-02', group: 'Quality check', title: 'Missing words that stop delivery', kind: 'free', type: 'number', key: 'lostWordsErrorPct', unit: '%', min: 0, max: 100,
    help: 'Share of source words missing from the e-book that counts as an error (below it, a warning).',
    keywords: ['missing words', 'palabras faltantes', 'missing text'],
    origin: 'Settings',
  },
  // ---- Standard EPUB: one rule per row of the client's "Standard vs Accessible tag differences" sheet ----
  ...(
    [
      ['STD-01', 'stdHeadings', 'Headings', 'Standard EPUB: how a heading is written.', [['paragraph', 'Classed paragraph'], ['headings', 'Heading element (h1–h6)']], (v: RuleValue) => (v === 'paragraph' ? '<p class="chapter" id="chap1">' : '<h1 class="chapter" id="chap1">'), ['standard heading', 'heading as paragraph', 'encabezado estándar']],
      ['STD-02', 'stdEmphasis', 'Bold and italic', 'Standard EPUB: how bold and italic text is marked.', [['bi', '<b> and <i>'], ['span', 'Spans with a class']], (v: RuleValue) => (v === 'bi' ? '<b>…</b> <i>…</i>' : '<span class="bold">…</span> <span class="italic">…</span>'), ['standard bold', 'standard italic', 'negrita estándar']],
      ['STD-03', 'stdFigures', 'Pictures and captions', 'Standard EPUB: a picture with its caption.', [['div', 'Div with the picture and a caption paragraph'], ['figure', 'figure and figcaption']], (v: RuleValue) => (v === 'div' ? '<div class="fig_group"><p class="image_Container"><img …/></p><p class="caption">…</p></div>' : '<figure class="fig_group"><img …/><figcaption>…</figcaption></figure>'), ['standard figure', 'standard image', 'figura estándar']],
      ['STD-04', 'stdLists', 'Lists', 'Standard EPUB: how list items are written.', [['typed', 'Paragraphs with the bullet or number typed in'], ['lists', 'Real lists (ul, ol)']], (v: RuleValue) => (v === 'typed' ? '<p class="bull">• First item</p>\n<p class="num">1. First item</p>' : '<ul><li>First item</li></ul>'), ['standard list', 'lista estándar']],
      ['STD-05', 'stdQuotes', 'Quotations', 'Standard EPUB: how a block quotation is wrapped.', [['div-top', '<div class="top">'], ['blockquote', '<blockquote>']], (v: RuleValue) => (v === 'div-top' ? '<div class="top"><p class="quote">…</p></div>' : '<blockquote><p class="quote">…</p></blockquote>'), ['standard quote', 'cita estándar']],
      ['STD-06', 'stdTables', 'Tables', 'Standard EPUB: table structure.', [['bare', 'Rows only (header cells are plain cells)'], ['sections', 'thead / tbody / tfoot and th']], (v: RuleValue) => (v === 'bare' ? '<table>\n<tr>…</tr>\n</table>' : '<table>\n<thead><tr>…</tr></thead>\n<tbody>…</tbody>\n</table>'), ['standard table', 'tabla estándar']],
      ['STD-07', 'stdNotes', 'Notes', 'Standard EPUB: footnote links. Keep the roles when readers should show notes as pop-ups.', [['plain', 'Plain links'], ['roles', 'Note roles (noteref, footnote, backlink)']], (v: RuleValue) => (v === 'plain' ? '<a href="#fn-1" id="fn_1">1</a>' : '<a epub:type="noteref" href="#fn-1" id="fn_1" role="doc-noteref">1</a>'), ['standard note', 'standard footnote', 'nota estándar']],
      ['STD-08', 'stdPageMarks', 'Printed page numbers', 'Standard EPUB: where the print page changes.', [['anchor', 'Anchor: <a id="Page_1"/>'], ['none', 'No page markers'], ['keep', 'Accessible page marker']], (v: RuleValue) => (v === 'anchor' ? '<a id="Page_1"/>' : v === 'none' ? '(nothing)' : '<span epub:type="pagebreak" role="doc-pagebreak" aria-label="página 1" id="page-1"/>'), ['standard page break', 'salto de página estándar']],
      ['STD-09', 'stdAlt', 'Picture descriptions', 'Standard EPUB: generic word ("imagen") or the description from the book. Keeping the real description is better for readers.', [['generic', 'The generic word for the language'], ['keep', 'Keep the real description']], (v: RuleValue) => (v === 'generic' ? '<img alt="imagen" …/>' : '<img alt="A woman reading under a tree" …/>'), ['standard alt', 'standard image description']],
      ['STD-10', 'stdWrappers', 'Section and language wrappers', 'Standard EPUB: wrap each page in <section> and <div xml:lang>, or write the content directly.', [['none', 'No wrappers'], ['keep', 'Keep section and language div']], (v: RuleValue) => (v === 'none' ? '<body>\n<p class="…">' : '<body>\n<section epub:type="chapter">\n<div xml:lang="es-ES">'), ['standard wrapper', 'standard section']],
      ['STD-11', 'stdPageLang', 'Language on each page', 'Standard EPUB: put the language on <html> or leave it to the package file.', [['none', 'None on the page'], ['xml:lang', 'xml:lang on <html>']], (v: RuleValue) => (v === 'none' ? '<html xmlns="…" xmlns:epub="…">' : '<html xml:lang="es-ES" xmlns="…">'), ['standard language', 'standard xml:lang']],
      ['STD-12', 'stdTitle', 'Page title', 'Standard EPUB: the <title> of each page.', [['book', 'The book title on every page'], ['section', 'The name of the section']], (v: RuleValue) => (v === 'book' ? '<title>Cartografías del poder</title>' : '<title>Capítulo 1</title>'), ['standard title']],
    ] as const
  ).map(
    ([id, key, title, help, choices, example, keywords]): Rule => ({
      id, group: 'Standard EPUB', title, help, kind: 'free', type: 'choice', key, choices: choices as unknown as [string, string][], example: example as (v: RuleValue) => string,
      keywords: [...keywords] as string[], origin: 'Client sheet: Standard vs Accessible tag differences (Oct 2026)',
    }),
  ),
]

export const ruleById = new Map(RULES.map((r) => [r.id, r]))
export const ruleByKey = new Map(RULES.filter((r) => r.key).map((r) => [r.key!, r]))

/** The value a rule has in a full settings object. */
export const valueOf = (r: Rule, s: HouseSettings): RuleValue | undefined => (r.key ? (s[r.key] as RuleValue) : undefined)
export const houseDefault = (r: Rule) => (r.key ? (DEFAULT_SETTINGS[r.key] as RuleValue) : undefined)

/** Text (from Excel, a requirement document, AI) → a valid value for the rule, or undefined. */
export function coerce(r: Rule, raw: unknown): RuleValue | undefined {
  if (raw === undefined || raw === null) return undefined
  const t = String(raw).trim()
  switch (r.type) {
    case 'bool': {
      if (typeof raw === 'boolean') return raw
      if (/^(true|yes|sí|si|y|1|on|x)$/i.test(t)) return true
      if (/^(false|no|n|0|off)$/i.test(t)) return false
      return undefined
    }
    case 'number': {
      const n = typeof raw === 'number' ? raw : parseFloat(t.replace(',', '.'))
      if (!isFinite(n)) return undefined
      return Math.min(r.max ?? Infinity, Math.max(r.min ?? -Infinity, n))
    }
    case 'choice': {
      const hit = r.choices?.find(([v, label]) => v.toLowerCase() === t.toLowerCase() || label.toLowerCase() === t.toLowerCase())
      return hit?.[0]
    }
    case 'multi': {
      const parts = Array.isArray(raw) ? raw.map(String) : t.split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean)
      const ok = parts.map((p) => r.choices?.find(([v, label]) => v.toLowerCase() === p.toLowerCase() || label.toLowerCase() === p.toLowerCase())?.[0]).filter((x): x is string => !!x)
      return ok.length || !parts.length ? ok : undefined
    }
    case 'list':
      return Array.isArray(raw) ? raw.map(String) : t.split(/\n|;/).map((x) => x.trim()).filter(Boolean)
    case 'css':
      return String(raw)
    default:
      return undefined
  }
}

/** A value as text, for tables and Excel. */
export function show(r: Rule, v: RuleValue | undefined): string {
  if (v === undefined) return ''
  if (r.type === 'bool') return v ? 'Yes' : 'No'
  if (Array.isArray(v)) return r.type === 'list' ? v.join('; ') : v.join(', ')
  return String(v)
}

/** Does a value need a waiver? (advisory rule set away from its accessible value) */
export const needsWaiver = (r: Rule, v: RuleValue | undefined) => r.kind === 'advisory' && v !== undefined && JSON.stringify(v) !== JSON.stringify(r.safe)
