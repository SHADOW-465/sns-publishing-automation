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
export type RuleType = 'choice' | 'bool' | 'number' | 'multi' | 'list' | 'css' | 'text' | 'fixed'
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

export const GROUPS = ['Pages and language', 'Headings', 'Paragraphs and classes', 'Tables', 'Notes', 'Contents pages', 'Package', 'Stylesheet', 'Copyright page', 'Typography', 'Accessible PDF', 'Standard EPUB', 'Quality check'] as const

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

  {
    id: 'HD-09', group: 'Headings', title: 'Levels of subheads', kind: 'free', type: 'choice', key: 'headingLevels',
    help: 'A style that only looks like a heading (bold, short, space around it) has no level in the export. One level puts them all at h3, as before. By size gives the biggest h3, the next h4, the next h5, so the outline follows the print hierarchy. A style the export already tagged h2 to h5 keeps its level.',
    choices: [['one', 'All at h3'], ['size', 'By size: h3, h4, h5']],
    example: (v) => (v === 'size' ? '<h3>Large subhead</h3> … <h4>Smaller subhead</h4>' : '<h3>Large subhead</h3> … <h3>Smaller subhead</h3>'),
    keywords: ['heading levels', 'subhead levels', 'h3 h4', 'outline', 'niveles de título', 'jerarquía de títulos', 'überschriftenebene'],
    origin: 'Design 3.2',
  },
  {
    id: 'HD-07', group: 'Headings', title: 'Chapter title element', kind: 'free', type: 'choice', key: 'chapterTag',
    help: 'Every chapter title is a heading (h2), never a classed paragraph. "As the source" keeps an h1 when the InDesign export already typed the title so.',
    choices: [['h2', 'h2 for every chapter title'], ['source', 'The element the export used']],
    example: (v) => (v === 'h2' ? '<h2 class="chapter-b" id="chap1">Natur</h2>' : '<h1 class="h1" id="chap1">Natur</h1>'),
    keywords: ['chapter heading', 'chapter title', 'h2 chapter', 'no header tag', 'no heading style', 'título de capítulo', 'kapitelüberschrift'],
    choiceWords: { source: ['as the source', 'keep h1'] },
    origin: 'EPUB Automation Report 15-10-26',
  },
  {
    id: 'HD-08', group: 'Headings', title: 'Class of a chapter title without a label', kind: 'free', type: 'choice', key: 'chapterHeadingClass',
    help: 'A chapter that has only a title ("Natur", no "Chapter 1" above it) gets the class chapter-b, as in the client’s hand-finished e-book. A chapter with a label keeps the class of its InDesign style.',
    choices: [['chapter-b', 'chapter-b'], ['style', 'The InDesign style name']],
    example: (v) => `<h2 class="${v === 'style' ? 'h1' : 'chapter-b'}" id="chap1">Natur</h2>`,
    keywords: ['chapter-b', 'chapter class'],
    origin: 'EPUB Automation Report 15-10-26',
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

  {
    id: 'NOTE-04', group: 'Notes', title: 'Where the notes go', kind: 'free', type: 'choice', key: 'noteSpot',
    help: 'Under each chapter, all together on one notes page at the end of the book, or decided by the source: InDesign end notes on the notes page when the book has one, footnotes under their chapter.',
    choices: [['auto', 'As the source has them'], ['chapter', 'Under each chapter'], ['book-end', 'All on the notes page']],
    example: (v) => (v === 'chapter' ? '<div class="footnotes"> … </div>  (end of every chapter)' : v === 'book-end' ? '<a epub:type="noteref" href="notes.xhtml#fn-1">1</a>  (notes.xhtml)' : '(end notes on notes.xhtml, footnotes under the chapter)'),
    keywords: ['note placement', 'notes at the end', 'endnotes', 'notas al final', 'notas al pie', 'footnotes under chapter'],
    choiceWords: { chapter: ['under each chapter', 'por capítulo'], 'book-end': ['end of the book', 'al final del libro'] },
    origin: 'EPUB Automation Report 15-10-26 (point 12); design 4.3',
  },
  {
    id: 'NOTE-05', group: 'Notes', title: 'Note numbers', kind: 'free', type: 'choice', key: 'noteNumbers',
    help: 'The number each note shows, in the text and in front of the note: as the source numbers them, counted 1, 2, 3… through the whole book, or starting again at 1 in each chapter.',
    choices: [['source', 'As the source numbers them'], ['continuous', 'Through the whole book'], ['per-chapter', 'From 1 in each chapter']],
    example: (v) => (v === 'source' ? '<sup><a …>*</a></sup>  (the mark the source has)' : v === 'continuous' ? 'chapter 1: 1, 2 · chapter 2: 3, 4' : 'chapter 1: 1, 2 · chapter 2: 1, 2'),
    keywords: ['note numbering', 'footnote numbering', 'numeración de notas', 'notes numbered', 'fußnotennummerierung', 'continuous numbering', 'restart numbering'],
    choiceWords: { continuous: ['continuous', 'whole book', 'durchgehend', 'correlativa'], 'per-chapter': ['per chapter', 'each chapter', 'restart', 'por capítulo', 'pro kapitel'] },
    origin: 'Design 4.3',
  },
  // ---- contents pages ----
  {
    id: 'NAV-01', group: 'Contents pages', title: 'Hanging indent of chapter entries', kind: 'free', type: 'number', key: 'tocEntryIndentEm', unit: 'em', min: 0, max: 5,
    help: 'A chapter entry on the contents and exercise-list pages starts flush left and its wrapped lines hang in by this much, as in print. 0 sets every line flush.',
    example: (v) => `p.toc_1a { margin-left: ${v}em; text-indent: -${v}em; }`,
    keywords: ['toc alignment', 'toc', 'índice', 'alineación del índice', 'contents', 'lista de ejercicios'],
    origin: 'V3 rows 18–19',
  },
  {
    id: 'NAV-02', group: 'Contents pages', title: 'Page numbers on the contents page', kind: 'free', type: 'choice', key: 'tocPageNumbers',
    help: 'Show the printed page number of each entry, right-aligned as in print (the number is not part of the link), or leave the numbers out.',
    choices: [['strip', 'Without page numbers'], ['show', 'With the printed page numbers, right-aligned']],
    example: (v) => (v === 'show' ? '<p class="toc_1a"><a href="chapter02.xhtml">Natur</a><span class="toc_pg">11</span></p>' : '<p class="toc_1a"><a href="chapter02.xhtml">Natur</a></p>'),
    keywords: ['toc page numbers', 'page numbers in toc', 'números de página en el índice', 'inhalt seitenzahlen', 'toc mistake'],
    choiceWords: { show: ['show', 'right-aligned', 'with page numbers'], strip: ['without', 'remove numbers', 'sin números'] },
    origin: 'EPUB Automation Report 15-10-26',
  },
  {
    id: 'NAV-03', group: 'Contents pages', title: 'Chapter subtitle in the navigation menu', kind: 'free', type: 'bool', key: 'navSubtitle',
    help: 'When the printed contents lists a line under a chapter ("Ackerland, Grünfläche…") and that line is the chapter’s first heading, the navigation menu shows "Natur: Ackerland, Grünfläche…".',
    choices: onOff, example: (v) => (v ? '<a href="chapter02.xhtml">Natur: Ackerland, Grünfläche, Urban Gardening</a>' : '<a href="chapter02.xhtml">Natur</a>'),
    keywords: ['nav subtitle', 'chapter subtitle', 'nav chapter splitting', 'ncx labels'],
    origin: 'EPUB Automation Report 15-10-26',
  },
  {
    id: 'NAV-04', group: 'Contents pages', title: 'Where the navigation lists are named', kind: 'free', type: 'choice', key: 'navLabelOn',
    help: 'Every page has an accessible name. On the navigation page it sits on the wrapping section, which EPUBCheck accepts. Putting aria-labelledby on <nav> itself is what the client’s e-book does, but EPUBCheck 5.4 reports it as an error.',
    choices: [['section', 'On the wrapping section (valid)'], ['nav', 'On <nav> (EPUBCheck 5.4 error)']],
    example: (v) => (v === 'nav' ? '<nav aria-labelledby="toc01" epub:type="toc" …>' : '<section aria-labelledby="toc01" epub:type="frontmatter">\n<nav epub:type="toc" …>'),
    keywords: ['aria-label', 'aria-labelledby', 'aria label missing', 'etiqueta aria'],
    origin: 'EPUB Automation Report 15-10-26',
  },

  {
    id: 'NAV-05', group: 'Contents pages', title: 'Depth of the navigation menu', kind: 'free', type: 'number', key: 'navDepth', min: 1, max: 3,
    help: '1 lists parts and chapters only; 2 adds the sections inside them; 3 adds the next level. The menu and the NCX follow it.',
    example: (v) => `<ol class="nav"> … ${v} level${v === 1 ? '' : 's'} … </ol>`,
    keywords: ['nav depth', 'toc depth', 'navigation levels', 'profundidad del índice', 'niveles del índice'],
    origin: 'Design 4.3',
  },
  {
    id: 'NAV-06', group: 'Contents pages', title: 'Front and back matter in the menu', kind: 'free', type: 'choice', key: 'navFront',
    help: 'Every section gets a menu entry; or all except the half-title, title, copyright and contents pages; or none, so the menu lists parts and chapters only.',
    choices: [['all', 'Every section'], ['named', 'Not the half-title, title, copyright and contents pages'], ['none', 'Parts and chapters only']],
    example: (v) => (v === 'none' ? '(Cover, chapters)' : v === 'named' ? '(Cover, dedication and other front and back matter, chapters)' : '(Cover, every front and back matter page, chapters)'),
    keywords: ['front matter in toc', 'back matter in nav', 'frontmatter nav', 'material preliminar en el índice'],
    origin: 'Design 4.3',
  },
  // ---- package ----
  {
    id: 'PKG-01', group: 'Package', title: 'Text and data mining reservation', kind: 'free', type: 'choice', key: 'tdmReservation',
    help: 'Declares in the package that the publisher reserves text-and-data-mining rights (TDM reservation protocol). Only the publisher can decide this, so it is off unless a client style turns it on.',
    choices: [['off', 'Not declared'], ['reserved', 'Rights reserved']],
    example: (v) => (v === 'reserved' ? '<package … prefix="tdm: http://www.w3.org/ns/tdmrep#">\n<meta property="tdm:reservation">1</meta>' : '(nothing)'),
    keywords: ['tdm', 'text and data mining', 'data mining', 'tdmrep'],
    origin: 'EPUB Automation Report 15-10-26',
  },

  {
    id: 'PKG-02', group: 'Package', title: 'Cover in the reading order', kind: 'free', type: 'bool', key: 'coverLinear',
    help: 'On: the cover page is the first page of the reading order. Off: it is marked linear="no", so readers open at the first chapter and the cover is reachable from the menu only.',
    choices: onOff, example: (v) => (v ? '<itemref idref="cover"/>' : '<itemref idref="cover" linear="no"/>'),
    keywords: ['cover linear', 'linear no', 'cover in spine', 'portada en el orden de lectura'],
    origin: 'Design 4.3',
  },
  {
    id: 'FIG-02', group: 'Paragraphs and classes', title: 'Extended description of complex figures', kind: 'free', type: 'choice', key: 'longDescAs',
    help: 'A chart, map or diagram can carry a long description besides its short one. Shown as a paragraph under the picture, or tucked into a collapsed "Picture description" that opens on tap. Screen readers get it either way.',
    choices: [['paragraph', 'A paragraph under the picture'], ['details', 'Collapsed, opens on tap']],
    example: (v) => (v === 'details' ? '<details class="longdesc"><summary>Picture description</summary><p>…</p></details>' : '<p class="longdesc">…</p>'),
    keywords: ['long description', 'extended description', 'complex figure', 'langbeschreibung', 'descripción larga', 'aria-describedby'],
    choiceWords: { details: ['collapsed', 'details', 'summary', 'aufklappbar'] },
    origin: 'Design 2.2 (complex figures)',
  },
  {
    id: 'PKG-03', group: 'Package', title: 'Write the EPUB 2 guide', kind: 'free', type: 'bool', key: 'writeGuide',
    help: 'The <guide> in the package names the cover and the contents for older readers. EPUB 3 readers use the landmarks instead.',
    choices: onOff, example: (v) => (v ? '<guide> <reference type="toc" … /> </guide>' : '(no guide)'),
    keywords: ['guide', 'opf guide', 'reference type toc', 'guía del paquete'],
    origin: 'EPUB Automation Report 15-10-26 (point 11); design 4.3',
  },
  {
    id: 'FM-02', group: 'Copyright page', title: 'Order of the title page lines', kind: 'free', type: 'choice', key: 'titleOrder',
    help: 'With the print PDF, the lines of the title page follow the printed page. Choose the source order to keep the export’s order, or rebuilt for the house layout: author, title, subtitle, publisher, in the house styles, with any missing line taken from Book details.',
    choices: [['print', 'As printed (needs the print PDF)'], ['source', 'As in the InDesign export'], ['rebuilt', 'Rebuilt in the house order']],
    example: (v) => (v === 'print' ? '(author, title, subtitle, publisher as on the printed page)' : v === 'rebuilt' ? '<p class="title-3">Author</p>\n<h1 class="title_1">Title</h1>\n<p class="title-4">Subtitle</p>\n<p class="title-2">Publisher</p>' : '(lines in the order of the export)'),
    keywords: ['title page order', 'orden de la portadilla', 'title page lines', 'rebuild title page', 'titelei neu'],
    choiceWords: { rebuilt: ['rebuilt', 'rebuild', 'house order', 'neu aufgebaut'], source: ['export order', 'source order'] },
    origin: 'EPUB Automation Report 15-10-26 (point 2); design 4.3',
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
    id: 'IMG-002', group: 'Quality check', title: 'Length of a short picture description', kind: 'free', type: 'number', key: 'altMaxChars', unit: 'characters', min: 40, max: 500,
    help: 'A short description stays under this many characters. A chart, map or diagram can add a long description under the picture. The model is asked for the same limit.',
    keywords: ['alt length', 'alt text length', 'zeichen', 'caracteres de la descripción'],
    origin: 'Börsenverein short description; rulebook IMG-002 (a description is not a caption or a filler sentence)',
  },
  {
    id: 'IMG-006', group: 'Quality check', title: 'Picture resolution', kind: 'free', type: 'number', key: 'imageDpi', unit: 'ppi', min: 72, max: 600,
    help: 'Every JPEG and PNG in the e-book is tagged at this resolution. A picture taken from a PDF is rendered at this many pixels per inch of its printed size, then capped by IMG-007.',
    keywords: ['300 dpi', '300 ppi', 'resolution', 'image spec', 'auflösung'],
    origin: '24102026 EPUB doc item 10 (Birmingham p.4); rulebook IMG-006',
  },
  {
    id: 'IMG-007', group: 'Quality check', title: 'Longest side of a picture', kind: 'free', type: 'number', key: 'imageMaxPx', unit: 'px', min: 200, max: 8000,
    help: 'No picture is wider or taller than this. A larger one is scaled down and keeps its shape. Nothing is scaled up. The client’s own Birmingham cover is 1949×2764, so 1900 follows the written spec and not that file.',
    keywords: ['1900', 'max-width', 'max-height', 'image size', 'pixel'],
    origin: '24102026 EPUB doc item 10; rulebook IMG-007. FLAGGED against the Birmingham cover.',
  },
  {
    id: 'IMG-008', group: 'Quality check', title: 'JPEG quality', kind: 'free', type: 'number', key: 'imageJpegQuality', min: 40, max: 95,
    help: 'Quality used when a picture is saved as JPEG (a CMYK or grayscale file, a scaled file, or a PNG with no transparency). A JPEG that is already RGB and within the cap is not saved again. The client named no quality; 85 matches the PDF picture raster.',
    keywords: ['jpeg quality', 'compression', 'image spec', 'rgb', 'cmyk'],
    origin: '24102026 EPUB doc item 10 (mode RGB); rulebook IMG-008, IMG-016. FLAGGED: quality number is not in the client note.',
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
  // ---- title pages, alt policy, anchors (standard EPUB) ----
  {
    id: 'FM-03', group: 'Copyright page', title: 'Title and half-title pages of a print PDF', kind: 'advisory', type: 'choice', key: 'titlePageAs', safe: 'text',
    help: 'Text: the title page is rebuilt as text, so a screen reader reads it. Picture: the printed page is shown as a picture, with its words as the description. A picture of text cannot be resized or read by software, so an accessible EPUB needs text; a standard EPUB may use the picture, as the finished Crowood file does.',
    choices: [['text', 'Text, rebuilt from the page'], ['image', 'A picture of the printed page']],
    example: (v) => (v === 'image' ? '<p class="cover"><img alt="CONTEMPORARY CERAMICS Jo Taylor" class="cv" src="images/title.jpg"/></p>' : '<h1 class="title_1">CONTEMPORARY CERAMICS</h1>\n<p class="title-3">Jo Taylor</p>'),
    keywords: ['title page as image', 'title page image', 'portadilla como imagen', 'half title image', 'titelseite als bild'],
    choiceWords: { image: ['as image', 'as a picture', 'image', 'como imagen'], text: ['as text', 'real text', 'como texto'] },
    origin: 'Crowood ceramics reference (picture); correction I1; WCAG 2.2 1.4.5',
  },
  {
    id: 'HD-10', group: 'Headings', title: 'Chapter opener shape (from a PDF)', kind: 'free', type: 'choice', key: 'chapterOpener',
    help: 'How a chapter number and title are written when the book is built from the print PDF. One heading matches the finished Crowood ceramics file. Two plain paragraphs is the shape one correction sheet asked for, and an accessible EPUB will not accept it.',
    choices: [['spans', 'Number and title inside one heading'], ['split', 'Two plain paragraphs, no heading id']],
    example: (v) => (v === 'split' ? '<p class="chnum">CHAPTER 1</p>\n<p class="chtit">Title</p>' : '<h1 class="ch-head1"><span class="ch-num">1</span> <span class="ch2">Title</span></h1>'),
    keywords: ['chapter opener', 'chnum', 'chtit', 'ch-num', 'chapter number'],
    choiceWords: { spans: ['one heading', 'ch-head'], split: ['chnum', 'chtit', 'two paragraphs', 'split'] },
    origin: 'Crowood ceramics reference (spans). Correction V1 asked for split.',
  },
  { id: 'HD-11', group: 'Headings', title: 'Chapter heading class (from a PDF)', kind: 'free', type: 'text', key: 'pdfChapterClass', help: 'The class on a chapter heading built from the print PDF, when the chapter-title template does not name one. ch-head1 is the class in the finished Crowood file.', example: (v) => `<h1 class="${v}">…</h1>`, keywords: ['ch-head1', 'chapter-title class', 'chtit'], origin: 'Crowood ceramics reference' },
  { id: 'HD-12', group: 'Headings', title: 'Chapter number class (from a PDF)', kind: 'free', type: 'text', key: 'pdfChapterNumClass', help: 'The class on the chapter number. ch-num is the finished Crowood file. chnum is the class one correction sheet asked for.', example: (v) => `<span class="${v}">1</span>`, keywords: ['ch-num', 'chnum'], origin: 'Crowood ceramics reference' },
  { id: 'HD-13', group: 'Headings', title: 'Chapter title-word class (from a PDF)', kind: 'free', type: 'text', key: 'pdfChapterTitleClass', help: 'The class on the title words beside the chapter number. ch2 is the finished Crowood file.', example: (v) => `<span class="${v}">Title</span>`, keywords: ['ch2', 'chtit'], origin: 'Crowood ceramics reference' },

  // ---- typography of books built from a print PDF ----
  {
    id: 'TYP-01', group: 'Typography', title: 'Alignment of body text', kind: 'free', type: 'choice', key: 'bodyAlign',
    help: 'As in print follows the printed page: justified when the lines end flush on the right, otherwise left. Left or justified forces it. Readers can always override it; justified text is harder for some readers (WCAG 1.4.8, advanced level).',
    choices: [['print', 'As the printed page'], ['left', 'Left'], ['justify', 'Justified']],
    example: (v) => `p.noindent { text-align: ${v === 'print' ? '(as printed)' : v}; }`,
    keywords: ['justify', 'justified', 'body alignment', 'bodymatter alignment', 'alineación del texto', 'blocksatz'], origin: 'Correction P5; Crowood and Cambia references differ',
  },
  {
    id: 'TYP-02', group: 'Typography', title: 'Alignment of chapter titles', kind: 'free', type: 'choice', key: 'chapterTitleAlign',
    help: 'As in print follows the printed page (centred titles stay centred). Left or centred forces it.',
    choices: [['print', 'As the printed page'], ['left', 'Left'], ['center', 'Centred']],
    example: (v) => `.ch-head1 { text-align: ${v === 'print' ? '(as printed)' : v}; }`,
    keywords: ['heading alignment', 'chapter heading alignment', 'centre heading', 'center heading'], origin: 'Correction P13; Crowood reference is left',
  },
  {
    id: 'TYP-03', group: 'Typography', title: 'Typeface of chapter titles', kind: 'free', type: 'choice', key: 'chapterTitleFont',
    help: 'Serif or sans-serif family for chapter titles. The reader’s own font choice still wins.',
    choices: [['serif', 'Serif'], ['sans-serif', 'Sans-serif']],
    example: (v) => `.ch-head1 { font-family: ${v}; }`, keywords: ['heading font', 'font-family', 'chapter font', 'schriftart'], origin: 'Correction P13; Crowood reference is serif',
  },
  {
    id: 'TYP-04', group: 'Typography', title: 'Alignment of the contents-page heading', kind: 'free', type: 'choice', key: 'contentsHeadingAlign',
    help: 'As in print, left or centred, for the heading of the printed contents page.',
    choices: [['print', 'As the printed page'], ['left', 'Left'], ['center', 'Centred']],
    example: (v) => `h1.TOC-1 { text-align: ${v === 'print' ? '(as printed)' : v}; }`, keywords: ['contents heading', 'toc heading alignment'], origin: 'Correction P2; Crowood reference is left',
  },
  {
    id: 'TYP-05', group: 'Typography', title: 'Typeface of the contents-page heading', kind: 'free', type: 'choice', key: 'contentsHeadingFont',
    help: 'Serif or sans-serif family for the heading of the printed contents page.',
    choices: [['serif', 'Serif'], ['sans-serif', 'Sans-serif']],
    example: (v) => `h1.TOC-1 { font-family: ${v}; }`, keywords: ['contents font', 'toc font'], origin: 'Correction P2; Crowood reference is sans-serif',
  },
  {
    id: 'TYP-06', group: 'Typography', title: 'Alignment of the copyright page', kind: 'free', type: 'choice', key: 'copyrightAlign',
    help: 'As in print, left or centred, for the lines of the copyright page.',
    choices: [['print', 'As the printed page'], ['left', 'Left'], ['center', 'Centred']],
    example: (v) => `p.copyr1 { text-align: ${v === 'print' ? '(as printed)' : v}; }`, keywords: ['copyright alignment', 'centre copyright', 'center alignment'], origin: 'Corrections I2, P1; Crowood reference is left',
  },
  {
    id: 'TYP-07', group: 'Typography', title: 'Size of quoted extracts and verse', kind: 'free', type: 'number', key: 'extractSizePct', unit: '%', min: 60, max: 100,
    help: 'Share of the body text size. Written as a percentage, so readers can still enlarge the text (WCAG 1.4.4).',
    example: (v) => `p.extract1 { font-size: ${v}%; }`, keywords: ['extract size', 'verse size', 'quote size', 'text size', 'poem size'], origin: 'Corrections I7, I8, P6, P7; Crowood reference is 100%',
  },

  // ---- accessible PDF ----
  {
    id: 'UA-01', group: 'Accessible PDF', title: 'Heading level of a chapter', kind: 'free', type: 'number', key: 'uaChapterLevel', min: 1, max: 2,
    help: 'Level 2 keeps a single top heading (the book’s title) with the chapters under it. Level 1 makes every chapter a top heading. PDF/UA only asks that levels do not skip.',
    example: (v) => (v === 1 ? '<H1>Chapter</H1>' : '<H1>Book title</H1> … <H2>Chapter</H2>'), keywords: ['chapter level', 'heading level pdf', 'h1 chapter'], origin: 'PDF/UA-1 7.4; Gladiators reference is 1, German report is 2',
  },
  {
    id: 'UA-02', group: 'Accessible PDF', title: 'Logos and marks', kind: 'free', type: 'choice', key: 'uaLogos',
    help: 'A mark drawn from many small shapes (FSC, a publisher’s device) becomes one figure with a description, or decoration that a screen reader skips.',
    choices: [['figure', 'One figure, with a description'], ['artifact', 'Decoration, skipped by screen readers']],
    example: (v) => (v === 'artifact' ? '/Artifact' : '<Figure Alt="FSC logo">'), keywords: ['logo', 'fsc', 'decorative logo', 'artifact logo'], origin: 'Correction U1; PDF/UA-1 7.3',
  },
  {
    id: 'UA-03', group: 'Accessible PDF', title: 'Bookmark depth', kind: 'free', type: 'number', key: 'uaBookmarkLevels', min: 1, max: 6,
    help: 'How many heading levels get a bookmark. 1 lists only top-level headings (chapters when chapters are H1); 6 lists every heading.',
    example: (v) => `${v} level${v === 1 ? '' : 's'} of bookmarks`, keywords: ['bookmarks', 'outline depth', 'lesezeichen'], origin: 'Gladiators reference has chapters only; the German report nests to four',
  },
  {
    id: 'UA-04', group: 'Accessible PDF', title: 'Bookmark for appended plates', kind: 'free', type: 'bool', key: 'uaPlateBookmark',
    help: 'A PDF appended after the book (plates) gets a bookmark of its own, so a reader can jump to it.',
    choices: onOff, example: (v) => (v ? 'Bookmarks: … Notes · Index · Plate' : 'Bookmarks: … Notes · Index'), keywords: ['plate bookmark', 'plates', 'bookmark add plate'], origin: 'Correction U6; Gladiators reference bookmarks “Plate”',
  },
  {
    id: 'UA-05', group: 'Accessible PDF', title: 'Name of the plates bookmark', kind: 'free', type: 'text', key: 'uaPlateLabel',
    help: 'The words on that bookmark. Gladiators’ finished file says “Plate”.', example: (v) => `Bookmark: ${v}`, keywords: ['plate label'], origin: 'Gladiators reference',
  },
  {
    id: 'UA-06', group: 'Accessible PDF', title: 'Page numbers in an index are links', kind: 'free', type: 'bool', key: 'uaIndexLinks',
    help: 'Each page number in the index jumps to that page. The client’s finished Gladiators file does not do this; the 23 October correction asked for it. Off until the client confirms.',
    choices: onOff, example: (v) => (v ? 'Abdera, <Link>55</Link>' : 'Abdera, 55'), keywords: ['index link', 'index page number link', 'index link to page number'], origin: 'Correction U2; Gladiators reference has no index links',
  },
  {
    id: 'UA-07', group: 'Accessible PDF', title: 'Note numbers link to the notes and back', kind: 'free', type: 'bool', key: 'uaNoteLinks',
    help: 'A note number in the text jumps to its note, and the note jumps back.',
    choices: onOff, example: (v) => (v ? '<Reference><Link>12</Link></Reference> → <Note>' : '12 (no link)'), keywords: ['note link', 'footnote link', 'endnote link'], origin: 'Client checklist 17 October; PDF/UA-1 7.11',
  },

  {
    id: 'UA-08', group: 'Accessible PDF', title: 'Ornaments and dividers', kind: 'free', type: 'choice', key: 'uaOrnaments',
    help: 'A small picture with no caption (a chapter ornament, a divider, a dingbat) is decoration that a screen reader skips, or a figure of its own with a short description. A description the reviewer types always wins, and a picture with a caption is always a figure.',
    choices: [['artifact', 'Decoration, skipped by screen readers'], ['figure', 'A figure with a description']],
    example: (v) => (v === 'figure' ? '<Figure Alt="decorativa">' : '/Artifact'), keywords: ['ornament', 'divider', 'dingbat', 'decorative picture', 'figure not tagged'],
    origin: 'SacGeo 24 October: ornaments circled as “Figure not tagged”; PDF/UA-1 7.3; rulebook PAR-004, PFG-001',
  },
  {
    id: 'UA-09', group: 'Accessible PDF', title: 'Where a figure caption sits', kind: 'free', type: 'choice', key: 'uaCaptionIn',
    help: 'The caption is a Caption element. It follows its figure as a sibling (PDF/UA-1, and the order in the client’s own files), or it sits inside the figure element, as Acrobat’s Figure/Caption button does.',
    choices: [['after', 'After the figure, as its own element'], ['inside', 'Inside the figure element']],
    example: (v) => (v === 'inside' ? '<Figure><Caption>…</Caption></Figure>' : '<Figure/><Caption>…</Caption>'), keywords: ['caption', 'figcaption', 'figure caption tag'],
    origin: 'SacGeo 24 October “Figcaption tag”; open question 1; rulebook PFG-003, PST-004',
  },
  {
    id: 'UA-10', group: 'Accessible PDF', title: 'Running heads and folios', kind: 'free', type: 'choice', key: 'uaRunningHeads',
    help: 'The lines printed at the top or foot of every page (book title, chapter title, page number) are page furniture. They are marked as artifacts so they do not interrupt the reading order.',
    choices: [['artifact', 'Artifacts, left out of the reading order'], ['keep', 'Keep them in the reading order']],
    example: (v) => (v === 'keep' ? '<P>2 Introducción de Barbara</P>' : '/Artifact <</Type /Pagination /Subtype /Header>>'), keywords: ['running head', 'folio', 'header', 'footer', 'page number'],
    origin: 'SacGeo 24 October “No need running head”; rulebook PAR-001, PRO-003',
  },

  {
    id: 'UA-11', group: 'Accessible PDF', title: 'Heading levels that look the same', kind: 'free', type: 'choice', key: 'uaHeadingLevels',
    help: 'PDF/UA wants heading levels without gaps. A section heading that follows a chapter with no subtitle then moves up one level, so the same print style can carry two tags. “Same everywhere” keeps one level per print style, as the client asked for SacGeo, and accepts a gap.',
    choices: [['contiguous', 'No gaps: a level may move up'], ['consistent', 'Same level everywhere for the same print style']],
    example: (v) => (v === 'consistent' ? '<H2>Chapter</H2> <H4>Section</H4> (always H4)' : '<H2>Chapter</H2> <H3>Section</H3> (H4 after a subtitle)'), keywords: ['heading level', 'same tag', 'h3 h4', 'consistent headings'],
    origin: 'SacGeo 24 October “Both headings should have the same tag (Global)”; rulebook PHD-002, PHD-004, PHD-008',
  },
  {
    id: 'UA-12', group: 'Accessible PDF', title: 'Links stacked on one picture', kind: 'free', type: 'choice', key: 'uaStackedLinks',
    help: 'A page built from hidden layouts (a row of book covers that changes) can carry several link rectangles on the same picture, though a reader sees only one. Only the topmost is tagged as a link and the others are removed, so the page has one Reference for each thing a reader can click.',
    choices: [['topmost', 'Only the topmost link of a stack'], ['all', 'Keep every link rectangle']],
    example: (v) => (v === 'all' ? '21 References on the page' : '3 covers + 3 text links, 6 References'), keywords: ['reference', 'hidden link', 'duplicate link', 'only three references'],
    origin: 'SacGeo 24 October “Only three references are required, but many unnecessary reference tags have been added”; rulebook PNT-004',
  },
  {
    id: 'STD-13', group: 'Standard EPUB', title: 'Description of a decorative picture', kind: 'free', type: 'choice', key: 'altDecorative',
    help: 'A picture that carries no information (an ornament, a rule) gets an empty description, which screen readers skip: that is what HTML and WCAG ask. The other option writes the word for it (“decorative”), which a screen reader reads out loud.',
    choices: [['empty', 'Empty (alt="")'], ['word', 'The word “decorative”']],
    example: (v) => (v === 'empty' ? '<img alt="" src="images/ornament.jpg"/>' : '<img alt="decorative" src="images/ornament.jpg"/>'),
    keywords: ['decorative alt', 'alt=""', 'empty alt', 'alt decorative', 'decorative image'], origin: 'HTML 4.7.5.1; WCAG 1.1.1; the T-C-E reference has alt=""; the language sheet says “decorative”',
  },
  {
    id: 'STD-14', group: 'Standard EPUB', title: 'Name of a printed-page anchor', kind: 'free', type: 'text', key: 'pageAnchorId',
    help: 'The id given to the point where a printed page starts. {n} is replaced by the page number. The client’s sheet says Page_{n}; the finished Crowood file uses pg_{n}.',
    example: (v) => `<a id="${String(v).replace('{n}', '13')}"/>`, keywords: ['page id', 'page anchor', 'pg_', 'page_'], origin: 'Client sheet (Page_1); Crowood ceramics reference (pg_13)',
  },
  {
    id: 'STD-15', group: 'Standard EPUB', title: 'Where the page anchor sits', kind: 'free', type: 'choice', key: 'pageAnchorPlace',
    help: 'On a line of its own in front of the paragraph that starts the page, or as the first thing inside that paragraph (a chapter title then has no stray anchor in front of it).',
    choices: [['before', 'In front of the paragraph'], ['inside', 'Inside the paragraph']],
    example: (v) => (v === 'inside' ? '<p class="ch-head1"><a id="pg_13"/>1 …</p>' : '<a id="Page_13"/>\n<p class="ch-head1">1 …</p>'),
    keywords: ['no need of page id', 'page id before chapter heading', 'anchor position'], origin: 'Correction P3; Crowood ceramics reference puts the anchor inside',
  },

  // ---- Standard EPUB: one rule per row of the client's "Standard vs Accessible tag differences" sheet ----
  ...(
    [
      ['STD-01', 'stdHeadings', 'Headings', 'Standard EPUB: how a heading is written.', [['paragraph', 'Classed paragraph'], ['headings', 'Heading element (h1–h6)']], (v: RuleValue) => (v === 'paragraph' ? '<p class="chapter" id="chap1">' : '<h1 class="chapter" id="chap1">'), ['standard heading', 'heading as paragraph', 'encabezado estándar']],
      ['STD-02', 'stdEmphasis', 'Bold and italic', 'Standard EPUB: how bold and italic text is marked.', [['bi', '<b> and <i>'], ['span', 'Spans with a class'], ['semantic', '<em> and <strong>']], (v: RuleValue) => (v === 'bi' ? '<b>…</b> <i>…</i>' : v === 'semantic' ? '<em>…</em> <strong>…</strong>' : '<span class="bold">…</span> <span class="italic">…</span>'), ['standard bold', 'standard italic', 'negrita estándar']],
      ['STD-03', 'stdFigures', 'Pictures and captions', 'Standard EPUB: a picture with its caption.', [['div', 'Div with the picture and a caption paragraph'], ['figure', 'figure and figcaption']], (v: RuleValue) => (v === 'div' ? '<div class="fig_group"><p class="image_Container"><img …/></p><p class="caption">…</p></div>' : '<figure class="fig_group"><img …/><figcaption>…</figcaption></figure>'), ['standard figure', 'standard image', 'figura estándar']],
      ['STD-04', 'stdLists', 'Lists', 'Standard EPUB: how list items are written.', [['typed', 'Paragraphs with the bullet or number typed in'], ['lists', 'Real lists (ul, ol)']], (v: RuleValue) => (v === 'typed' ? '<p class="bull">• First item</p>\n<p class="num">1. First item</p>' : '<ul><li>First item</li></ul>'), ['standard list', 'lista estándar']],
      ['STD-05', 'stdQuotes', 'Quotations', 'Standard EPUB: how a block quotation is wrapped.', [['div-top', '<div class="top">'], ['blockquote', '<blockquote>']], (v: RuleValue) => (v === 'div-top' ? '<div class="top"><p class="quote">…</p></div>' : '<blockquote><p class="quote">…</p></blockquote>'), ['standard quote', 'cita estándar']],
      ['STD-06', 'stdTables', 'Tables', 'Standard EPUB: table structure.', [['bare', 'Rows only (header cells are plain cells)'], ['sections', 'thead / tbody / tfoot and th']], (v: RuleValue) => (v === 'bare' ? '<table>\n<tr>…</tr>\n</table>' : '<table>\n<thead><tr>…</tr></thead>\n<tbody>…</tbody>\n</table>'), ['standard table', 'tabla estándar']],
      ['STD-07', 'stdNotes', 'Notes', 'Standard EPUB: footnote links. Keep the roles when readers should show notes as pop-ups.', [['plain', 'Plain links'], ['roles', 'Note roles (noteref, footnote, backlink)']], (v: RuleValue) => (v === 'plain' ? '<a href="#fn-1" id="fn_1">1</a>' : '<a epub:type="noteref" href="#fn-1" id="fn_1" role="doc-noteref">1</a>'), ['standard note', 'standard footnote', 'nota estándar']],
      ['STD-08', 'stdPageMarks', 'Printed page numbers', 'Standard EPUB: where the print page changes.', [['anchor', 'Anchor: <a id="Page_1"/>'], ['none', 'No page markers'], ['keep', 'Accessible page marker']], (v: RuleValue) => (v === 'anchor' ? '<a id="Page_1"/>' : v === 'none' ? '(nothing)' : '<span epub:type="pagebreak" role="doc-pagebreak" aria-label="página 1" id="page-1"/>'), ['standard page break', 'salto de página estándar']],
      ['STD-09', 'stdAlt', 'Picture descriptions', 'Standard EPUB: generic word ("imagen") or the description from the book. Keeping the real description is better for readers.', [['generic', 'The generic word for the language'], ['keep', 'Keep the real description']], (v: RuleValue) => (v === 'generic' ? '<img alt="imagen" …/>' : '<img alt="A woman reading under a tree" …/>'), ['standard alt', 'standard image description']],
      ['STD-10', 'stdWrappers', 'Section and language wrappers', 'Standard EPUB: wrap each page in <section> and <div xml:lang>, or write the content directly.', [['none', 'No wrappers'], ['keep', 'Keep section and language div']], (v: RuleValue) => (v === 'none' ? '<body>\n<p class="…">' : '<body>\n<section epub:type="chapter">\n<div xml:lang="es-ES">'), ['standard wrapper', 'standard section']],
      ['STD-11', 'stdPageLang', 'Language on each page', 'Standard EPUB: put the language on <html> or leave it to the package file.', [['none', 'None on the page'], ['xml:lang', 'xml:lang on <html>']], (v: RuleValue) => (v === 'none' ? '<html xmlns="…" xmlns:epub="…">' : '<html xml:lang="es-ES" xmlns="…">'), ['standard language', 'standard xml:lang']],
      ['STD-12', 'stdTitle', 'Page title', 'Standard EPUB: the <title> of each page.', [['book', 'The book title and subtitle on every page'], ['section', 'The name of the section'], ['main', 'The main book title only']], (v: RuleValue) => (v === 'book' ? '<title>Cartografías del poder. Exploraciones…</title>' : v === 'main' ? '<title>Cartografías del poder</title>' : '<title>Capítulo 1</title>'), ['standard title']],
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
    case 'text':
      return t || undefined
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
