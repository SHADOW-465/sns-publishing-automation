// House settings: the rules a production team adjusts per house without touching code. Defaults
// reproduce the hand-finished reference EPUBs and the client's corrections (V2 25-9-26, V3 28-9-26).
// The UI edits them on the Settings screen (saved in the browser, exportable as JSON); tests use
// the defaults. Every option is described in SETTING_HELP so the UI and the README say the same.
// ponytail: one module-level value, set before a build; pass it explicitly if builds ever run concurrently.

/** Groups of CSS properties whose one-off change on a paragraph is worth a class of its own. */
export const VARIANT_GROUPS = {
  align: ['text-align'],
  indent: ['text-indent', 'margin-left', 'margin-right'],
  face: ['font-style', 'font-weight'],
  size: ['font-size', 'font-family'],
  spacing: ['margin-top', 'margin-bottom'],
  colour: ['color'],
} as const
export type VariantGroup = keyof typeof VARIANT_GROUPS

/** The choices behind the Standard EPUB: one per row of the client's sheet (rules STD-01…STD-12). The first value is the sheet's;
 *  the default for a Standard EPUB follows the finished files and the HTML standard where they differ (output/standards.ts). */
export const STD_CHOICES = {
  stdHeadings: ['paragraph', 'headings'],
  stdEmphasis: ['bi', 'span', 'semantic'],
  stdFigures: ['div', 'figure'],
  stdLists: ['typed', 'lists'],
  stdQuotes: ['div-top', 'blockquote'],
  stdTables: ['bare', 'sections'],
  stdNotes: ['plain', 'roles'],
  stdPageMarks: ['anchor', 'none', 'keep'],
  stdAlt: ['generic', 'keep'],
  stdWrappers: ['none', 'keep'],
  stdPageLang: ['none', 'xml:lang'],
  stdTitle: ['book', 'section', 'main'],
} as const
export type StdOptions = { [K in keyof typeof STD_CHOICES]: (typeof STD_CHOICES)[K][number] }
export const STD_DEFAULTS = Object.fromEntries(Object.entries(STD_CHOICES).map(([k, v]) => [k, v[0]])) as StdOptions

/** How a role is written out. Data a client layer can carry; the engine fills in what the template leaves out. */
export interface MarkupTemplate {
  /** element: h2 for a chapter title, h1 for a part title, figure or div for a figure */
  tag?: string
  /** class; for a chapter title it is used when the chapter has no label above it ("{style}" = the InDesign style's own class).
   *  For a part title it is the heading's class; for a figure the wrapper's */
  class?: string
  /** wrapper element: "sup" around a note reference; "" for none */
  wrap?: string
  /** extra attributes */
  attrs?: Record<string, string>
}
export type MarkupRole = 'chapter-title' | 'part-title' | 'noteref' | 'figure'
/** A source style and what it means. `match` is a style name or a regular expression over it ("^ihv(\d)$"). */
export interface StyleRule {
  /** the style name; empty for a content rule */
  match: string
  role: string
  /** a content rule: a regular expression over the paragraph's text. It applies to paragraphs whose style is only a
   *  one-off override (no named style: "ParaOverride-21"), whatever number the export gave that override, and sets the class */
  text?: string
  /** content rules only: the paragraph's shape. block = set in from the margin (margin-left > 0, no hanging indent);
   *  hanging = a negative first-line indent; omitted = any */
  layout?: 'block' | 'hanging'
  /** content rules only: the margin-left in px must be at least this (a deeper inset than the plain block) */
  minInset?: number
  /** output class for this style only */
  class?: string
}

/** The settings that are data, not one plain value: templates, style meanings, lists, CSS. */
interface StructuredSettings {
  /** role → output template, from the client layers (resolved) */
  markup: Partial<Record<MarkupRole, MarkupTemplate>>
  /** source style → meaning, from the client layers (resolved); decides before any guess */
  styleMap: Record<string, StyleRule>
  /** extra phrases that mark print-only imprint lines (removed from the e-book copyright page) */
  printOnly: string[]
  /** reader-facing labels per language code ("es", "en"…), overriding the built-in ones */
  labels: Record<string, Record<string, string>>
  /** CSS appended to the generated stylesheet (wins over the house CSS) */
  extraCss: string
  /** replaces the built-in house stylesheet (fixed classes: indent, extract1, toc_1…); empty = built-in */
  houseCss: string
  /** which kinds of override are worth a class of their own (others are typesetting noise) */
  variantOn: VariantGroup[]
}

/** a CSS class name: letters, digits, - and _, not starting with a digit */
/** a short label: letters, digits, spaces, dots, dashes */
const LABEL_TEXT = /^[\p{L}\p{N} ._-]{1,40}$/u
const CLASS_NAME = /^[A-Za-z_][\w-]{0,40}$/
/** an anchor id pattern: the page number goes where {n} is */
const ANCHOR_ID = /^[A-Za-z_][\w-]{0,30}\{n\}[\w-]{0,10}$/

type Field =
  | { def: boolean; bool: true }
  | { def: string; choices: readonly string[] }
  | { def: number; min: number; max: number }
  /** free text that must be a plain name (a CSS class or a pattern with {n}); anything else falls back to the default */
  | { def: string; text: RegExp }
/** One row per plain setting: its default and what a valid value is. The type, DEFAULT_SETTINGS and sanitize are all made
 *  from this table, so a new plain setting is one row here (plus its rule in the registry), not four edits. */
const SCHEMA = {
  // ---- markup (house-style options from client feedback on the reference EPUBs) ----
  /** role="heading" + aria-level on the heading that names each part */
  roleHeading: { def: true, bool: true },
  /** <div xml:lang="…"> around the content of every page */
  langWrapper: { def: true, bool: true },
  /** numbered heading series ("Hábito 1…12") all in small caps when some are */
  seriesSmallCaps: { def: true, bool: true },
  /** a quotation broken into short lines is set as verse (extract1/extract2) */
  verseLines: { def: true, bool: true },
  /** the kind of e-book offered first for a new book (changeable per book in Book details) */
  defaultProfile: { def: 'accessible', choices: ['accessible', 'standard'] },
  /** language attributes on <html>: the reference writes xml:lang only ("duplicated language should be removed") */
  htmlLang: { def: 'xml:lang', choices: ['xml:lang', 'both', 'lang'] },
  /** a paragraph whose own InDesign overrides change its look: 'own' = one class of its own
   *  ("Texto_1", never "Texto Texto_1"); 'ignore' = always the style's class */
  styleVariants: { def: 'own', choices: ['own', 'ignore'] },
  /** tables: 'reference' = as the hand-finished EPUB (td with the cell style class, no thead);
   *  'th' = first row as <thead><th scope="col"> (screen readers announce column names).
   *  Accessible by default; a client may choose 'reference' with a recorded waiver (Spec step) */
  tableHeaders: { def: 'th', choices: ['reference', 'th'] },
  /** rule above the footnotes: a short line as in print, a full-width line, or none */
  footnoteRule: { def: 'short', choices: ['short', 'full', 'none'] },
  /** % of the text width, for 'short' */
  footnoteRuleWidth: { def: 25, min: 5, max: 100 },
  // source / style / no subtitle: an InDesign <h1 class="h1"> stays that way, and the menu shows the chapter title.
  // A client layer (BeBra: h2.chapter-b, subtitles in the menu) turns the review rules on for that publisher.
  /** chapter title element: h2 for every chapter, or the tag the source used (h1 when the export typed it so) */
  chapterTag: { def: 'source', choices: ['h2', 'source'] },
  /** class of a chapter title set without a label ("Natur"): the client's chapter-b, or the InDesign style's own name */
  chapterHeadingClass: { def: 'style', choices: ['chapter-b', 'style'] },
  /** printed page numbers on the contents page: shown right-aligned as in print, or left out */
  tocPageNumbers: { def: 'strip', choices: ['strip', 'show'] },
  /** a chapter's subtitle ("Natur: Ackerland, Grünfläche…") in the navigation menu when the printed contents lists it under the chapter */
  navSubtitle: { def: false, bool: true },
  /** where the accessible name of the navigation lists sits: on the wrapping section (valid for EPUBCheck 5.4) or on <nav> itself (rejected by EPUBCheck 5.4) */
  navLabelOn: { def: 'section', choices: ['section', 'nav'] },
  /** text-and-data-mining reservation in the package (W3C TDM reservation protocol) */
  tdmReservation: { def: 'off', choices: ['off', 'reserved'] },
  /** NOTE-04: where notes go. auto = InDesign end notes on the notes page when the book has one, footnotes under their chapter */
  noteSpot: { def: 'auto', choices: ['auto', 'chapter', 'book-end'] },
  /** NOTE-05: the number a note shows: the source's own mark, counted through the whole book, or starting again in each chapter */
  noteNumbers: { def: 'source', choices: ['source', 'continuous', 'per-chapter'] },
  /** HD-09: subheads the book styles only by their look: all h3, or a level by size (the biggest h3, the next h4, then h5) */
  headingLevels: { def: 'one', choices: ['one', 'size'] },
  /** NAV-05: deepest level of the navigation menu (1 = parts and chapters only) */
  navDepth: { def: 3, min: 1, max: 3 },
  /** NAV-06: front and back matter in the menu: every section, only those the book titles, or none (chapters and parts only) */
  navFront: { def: 'all', choices: ['all', 'named', 'none'] },
  /** FM-02: the title page lines follow the printed page (needs the print PDF), stay in the order of the export,
   *  or are rebuilt in the house order (author, title, subtitle, publisher) from the page and Book details */
  titleOrder: { def: 'print', choices: ['print', 'source', 'rebuilt'] },
  /** PKG-02: the cover page is part of the reading order (linear) or only reachable from the menu */
  coverLinear: { def: true, bool: true },
  /** FIG-02: the extended description of a complex figure: a visible paragraph under the picture, or a collapsed <details> (both are linked with aria-describedby) */
  longDescAs: { def: 'paragraph', choices: ['paragraph', 'details'] },
  /** PKG-03: write the EPUB 2 <guide> (cover and contents) */
  writeGuide: { def: true, bool: true },
  /** PDF→EPUB chapter opener. spans = number and title inside one heading, as in the Crowood ceramics reference.
   *  split = two plain paragraphs (chnum, then chtit) with no id, as one correction sheet asked. */
  chapterOpener: { def: 'spans', choices: ['spans', 'split'] },
  /** class of that heading when the chapter-title template does not name one. ch-head1 is the ceramics reference. */
  pdfChapterClass: { def: 'ch-head1', text: CLASS_NAME },
  /** class of the chapter number */
  pdfChapterNumClass: { def: 'ch-num', text: CLASS_NAME },
  /** class of the chapter title words beside the number */
  pdfChapterTitleClass: { def: 'ch2', text: CLASS_NAME },
  /** how the title and half-title pages of a print PDF are written: as a picture of the printed page (with its text as the description),
   *  or rebuilt as text. Real text is the accessible form (WCAG 1.4.5), so an accessible EPUB defaults to text (see output/standards.ts) */
  titlePageAs: { def: 'text', choices: ['text', 'image'] },
  /** what a decorative picture gets as its description: nothing (alt="", the HTML and WCAG way) or the language's word for it ("decorative") */
  altDecorative: { def: 'empty', choices: ['empty', 'word'] },
  /** the id of a printed-page anchor in a standard EPUB; {n} is the page number ("Page_{n}" is the client's sheet, "pg_{n}" the Crowood file) */
  pageAnchorId: { def: 'Page_{n}', text: ANCHOR_ID },
  /** where that anchor sits: on a line of its own in front of the block, or as the first thing inside the block that starts the page */
  pageAnchorPlace: { def: 'before', choices: ['before', 'inside'] },

  // ---- typography of the stylesheet built for a print PDF (an InDesign export carries its own, which "print" keeps) ----
  /** body text alignment. print = what the printed page does (justified lines end flush right) */
  bodyAlign: { def: 'print', choices: ['print', 'left', 'justify'] },
  /** alignment of chapter titles */
  chapterTitleAlign: { def: 'print', choices: ['print', 'left', 'center'] },
  /** typeface family of chapter titles */
  chapterTitleFont: { def: 'serif', choices: ['serif', 'sans-serif'] },
  /** alignment of the heading of the contents page */
  contentsHeadingAlign: { def: 'print', choices: ['print', 'left', 'center'] },
  /** typeface family of the heading of the contents page */
  contentsHeadingFont: { def: 'sans-serif', choices: ['serif', 'sans-serif'] },
  /** alignment of the copyright page */
  copyrightAlign: { def: 'print', choices: ['print', 'left', 'center'] },
  /** the size of quoted extracts and verse, as a share of the body text */
  extractSizePct: { def: 100, min: 60, max: 100 },

  // ---- accessible PDF ----
  /** the heading level of a chapter: 2 keeps one H1 for the title of the book (default), 1 makes every chapter an H1 */
  uaChapterLevel: { def: 2, min: 1, max: 2 },
  /** a logo or mark drawn from many small shapes: one figure with a description, or decoration a screen reader skips */
  uaLogos: { def: 'figure', choices: ['figure', 'artifact'] },
  /** how many heading levels get a bookmark (1 = chapters only when chapters are H1) */
  uaBookmarkLevels: { def: 6, min: 1, max: 6 },
  /** bookmark the section appended at the end (plates), and the name it carries */
  uaPlateBookmark: { def: true, bool: true },
  uaPlateLabel: { def: 'Plate', text: LABEL_TEXT },
  /** make the page numbers of an index links to those pages */
  uaIndexLinks: { def: false, bool: true },
  /** link each note number to its note and back */
  uaNoteLinks: { def: true, bool: true },
  /** a small picture with no caption (a chapter ornament, a divider): decoration a screen reader skips, or a figure with a description */
  uaOrnaments: { def: 'artifact', choices: ['artifact', 'figure'] },
  /** a picture caption sits after its figure as its own element, or inside the figure element */
  uaCaptionIn: { def: 'after', choices: ['after', 'inside'] },
  /** running heads and folios are artifacts (default) or stay in the reading order */
  uaRunningHeads: { def: 'artifact', choices: ['artifact', 'keep'] },
  /** a heading level is never skipped (a section under a chapter with no subtitle moves up), or each heading style keeps its own level everywhere */
  uaHeadingLevels: { def: 'contiguous', choices: ['contiguous', 'consistent'] },
  /** link rectangles stacked on one picture (hidden layouts of a button): only the topmost is a link, or every one is kept */
  uaStackedLinks: { def: 'topmost', choices: ['topmost', 'all'] },

  // ---- stylesheet ----
  /** 'vertical' = one declaration per line, margins written out (margin-top…) as the reference; 'compact' = one rule per line */
  cssFormat: { def: 'vertical', choices: ['vertical', 'compact'] },
  /** largest space above/below a paragraph taken over from print (em) */
  maxSpaceEm: { def: 2, min: 0, max: 10 },
  /** space around indented blocks (<div class="top">); collapses with the paragraphs' own */
  blockSpaceEm: { def: 1, min: 0, max: 5 },
  /** least space above a part/chapter/section title (h1/h2) — print opens them low on the page */
  headingSpaceAboveEm: { def: 2, min: 0, max: 10 },
  /** least space between that title and the text */
  headingSpaceBelowEm: { def: 3, min: 0, max: 10 },
  /** scales every heading size taken from InDesign (100 = as in print) */
  headingScalePct: { def: 100, min: 50, max: 200 },
  /** first-line indent of footnotes */
  footnoteIndentEm: { def: 2, min: 0, max: 5 },
  /** left indent of chapter entries on the printed contents and list pages (0 = flush, as print) */
  tocEntryIndentEm: { def: 1.5, min: 0, max: 5 },
  /** class of indented blocks without an InDesign style of their own */
  blockClass: { def: 'extract1', choices: ['extract1', 'extract'] },
  /** a picture with no description stops delivery (accessible) or only warns */
  altRequired: { def: 'error', choices: ['error', 'warn'] },

  // ---- quality check ----
  /** shortest acceptable long side of the cover */
  minCoverPx: { def: 1400, min: 0, max: 10000 },
  /** % of source words missing that counts as an error (below: a warning) */
  lostWordsErrorPct: { def: 1, min: 0, max: 100 },
} as const satisfies Record<string, Field>

/** A schema row's value type: yes/no, one of its choices, or a number. */
type ValueOf<F> = F extends { bool: true } ? boolean : F extends { choices: readonly (infer C)[] } ? C : F extends { text: RegExp } ? string : number
type PlainSettings = { -readonly [K in keyof typeof SCHEMA]: ValueOf<(typeof SCHEMA)[K]> }

export interface HouseSettings extends StdOptions, PlainSettings, StructuredSettings {}

export const DEFAULT_SETTINGS: HouseSettings = {
  markup: {},
  styleMap: {},
  printOnly: [],
  labels: {},
  extraCss: '',
  houseCss: '',
  variantOn: ['align', 'indent', 'face'],
  ...STD_DEFAULTS,
  ...(Object.fromEntries(Object.entries(SCHEMA).map(([k, f]) => [k, f.def])) as unknown as PlainSettings),
}

let current: HouseSettings = DEFAULT_SETTINGS
let house: HouseSettings = DEFAULT_SETTINGS

/** the settings the engine builds with right now (house settings + the client's spec for this book) */
export const settings = () => current
export function setSettings(s: Partial<HouseSettings>) {
  current = sanitize({ ...DEFAULT_SETTINGS, ...s })
}
/** the house settings of the Settings screen, before any client or book layer */
export const houseSettings = () => house
export function setHouseSettings(s: Partial<HouseSettings>) {
  house = sanitize({ ...DEFAULT_SETTINGS, ...s })
  current = house
}

/** A settings file from an older version or edited by hand: unknown values fall back to the default. */
function sanitize(s: HouseSettings): HouseSettings {
  const d = DEFAULT_SETTINGS
  const raw = s as unknown as Record<string, unknown>
  const plain = Object.fromEntries(
    Object.entries(SCHEMA).map(([k, f]) => {
      const v = raw[k]
      const ok = 'bool' in f ? typeof v === 'boolean' : 'choices' in f ? (f.choices as readonly unknown[]).includes(v) : 'text' in f ? typeof v === 'string' && f.text.test(v) : typeof v === 'number' && isFinite(v)
      return [k, !ok ? f.def : 'min' in f ? Math.min(f.max, Math.max(f.min, v as number)) : v]
    }),
  )
  return {
    ...s,
    ...plain,
    printOnly: Array.isArray(s.printOnly) ? s.printOnly.map(String) : d.printOnly,
    labels: s.labels && typeof s.labels === 'object' ? s.labels : d.labels,
    markup: s.markup && typeof s.markup === 'object' ? s.markup : d.markup,
    styleMap: s.styleMap && typeof s.styleMap === 'object' ? s.styleMap : d.styleMap,
    extraCss: typeof s.extraCss === 'string' ? s.extraCss : d.extraCss,
    houseCss: typeof s.houseCss === 'string' ? s.houseCss : d.houseCss,
    ...(Object.fromEntries(Object.entries(STD_CHOICES).map(([k, v]) => [k, (v as readonly unknown[]).includes(raw[k]) ? raw[k] : (d as unknown as Record<string, unknown>)[k]])) as StdOptions),
    variantOn: Array.isArray(s.variantOn) ? s.variantOn.filter((g) => g in VARIANT_GROUPS) : d.variantOn,
  }
}

/** CSS properties that justify a class of its own for a paragraph, from the chosen groups. */
export const variantProps = (): Set<string> => new Set(current.variantOn.flatMap((g) => [...VARIANT_GROUPS[g]]))

/** Language attributes for the root <html> element of every content document. */
export function htmlLangAttrs(lang: string): string {
  const mode = current.htmlLang
  return [mode !== 'xml:lang' ? `lang="${lang}"` : '', mode !== 'lang' ? `xml:lang="${lang}"` : ''].filter(Boolean).join(' ')
}

/** Built-in print-only patterns plus the house's own phrases (plain text, any case). */
export const isHousePrintOnly = (text: string) => current.printOnly.some((p) => p.trim() && text.toLocaleLowerCase().includes(p.trim().toLocaleLowerCase()))
