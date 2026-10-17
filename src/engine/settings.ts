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

/** The choices behind the Standard EPUB: one per row of the client's sheet (rules STD-01…STD-12). The first value is the sheet's. */
export const STD_CHOICES = {
  stdHeadings: ['paragraph', 'headings'],
  stdEmphasis: ['bi', 'span'],
  stdFigures: ['div', 'figure'],
  stdLists: ['typed', 'lists'],
  stdQuotes: ['div-top', 'blockquote'],
  stdTables: ['bare', 'sections'],
  stdNotes: ['plain', 'roles'],
  stdPageMarks: ['anchor', 'none', 'keep'],
  stdAlt: ['generic', 'keep'],
  stdWrappers: ['none', 'keep'],
  stdPageLang: ['none', 'xml:lang'],
  stdTitle: ['book', 'section'],
} as const
export type StdOptions = { [K in keyof typeof STD_CHOICES]: (typeof STD_CHOICES)[K][number] }
export const STD_DEFAULTS = Object.fromEntries(Object.entries(STD_CHOICES).map(([k, v]) => [k, v[0]])) as StdOptions

/** How a role is written out. Data a client layer can carry; the engine fills in what the template leaves out. */
export interface MarkupTemplate {
  /** element: h2 for a chapter title */
  tag?: string
  /** class; for a chapter title it is used when the chapter has no label above it ("{style}" = the InDesign style's own class) */
  class?: string
  /** wrapper element: "sup" around a note reference; "" for none */
  wrap?: string
  /** extra attributes */
  attrs?: Record<string, string>
}
export type MarkupRole = 'chapter-title' | 'noteref'
/** A source style and what it means. `match` is a style name or a regular expression over it ("^ihv(\d)$"). */
export interface StyleRule {
  match: string
  role: string
  /** output class for this style only */
  class?: string
}

export interface HouseSettings extends StdOptions {
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

  // ---- markup (house-style options from client feedback on the reference EPUBs) ----
  roleHeading: boolean // role="heading" + aria-level on the heading that names each part
  langWrapper: boolean // <div xml:lang="…"> around the content of every page
  seriesSmallCaps: boolean // numbered heading series ("Hábito 1…12") all in small caps when some are
  verseLines: boolean // a quotation broken into short lines is set as verse (extract1/extract2)
  /** the kind of e-book offered first for a new book (changeable per book in Book details) */
  defaultProfile: 'accessible' | 'standard'
  /** language attributes on <html>: the reference writes xml:lang only ("duplicated language should be removed") */
  htmlLang: 'xml:lang' | 'both' | 'lang'
  /** a paragraph whose own InDesign overrides change its look: 'own' = one class of its own
   *  ("Texto_1", never "Texto Texto_1"); 'ignore' = always the style's class */
  styleVariants: 'own' | 'ignore'
  /** which kinds of override are worth a class of their own (others are typesetting noise) */
  variantOn: VariantGroup[]
  /** tables: 'reference' = as the hand-finished EPUB (td with the cell style class, no thead);
   *  'th' = first row as <thead><th scope="col"> (screen readers announce column names) */
  tableHeaders: 'reference' | 'th'
  /** rule above the footnotes: a short line as in print, a full-width line, or none */
  footnoteRule: 'short' | 'full' | 'none'
  footnoteRuleWidth: number // % of the text width, for 'short'
  /** chapter title element: h2 for every chapter, or the tag the source used (h1 when the export typed it so) */
  chapterTag: 'h2' | 'source'
  /** class of a chapter title set without a label ("Natur"): the client's chapter-b, or the InDesign style's own name */
  chapterHeadingClass: 'chapter-b' | 'style'
  /** printed page numbers on the contents page: shown right-aligned as in print, or left out */
  tocPageNumbers: 'strip' | 'show'
  /** a chapter's subtitle ("Natur: Ackerland, Grünfläche…") in the navigation menu when the printed contents lists it under the chapter */
  navSubtitle: boolean
  /** where the accessible name of the navigation lists sits: on the wrapping section (valid for EPUBCheck 5.4) or on <nav> itself (rejected by EPUBCheck 5.4) */
  navLabelOn: 'section' | 'nav'
  /** text-and-data-mining reservation in the package (W3C TDM reservation protocol) */
  tdmReservation: 'off' | 'reserved'
  /** NOTE-04: where notes go. auto = InDesign end notes on the notes page when the book has one, footnotes under their chapter */
  noteSpot: 'auto' | 'chapter' | 'book-end'
  /** NAV-05: deepest level of the navigation menu (1 = parts and chapters only) */
  navDepth: number
  /** NAV-06: front and back matter in the menu: every section, only those the book titles, or none (chapters and parts only) */
  navFront: 'all' | 'named' | 'none'
  /** FM-02: the title page lines follow the printed page (needs the print PDF) or stay in the order of the export */
  titleOrder: 'print' | 'source'
  /** PKG-02: the cover page is part of the reading order (linear) or only reachable from the menu */
  coverLinear: boolean
  /** PKG-03: write the EPUB 2 <guide> (cover and contents) */
  writeGuide: boolean

  // ---- stylesheet ----
  /** 'vertical' = one declaration per line, margins written out (margin-top…) as the reference;
   *  'compact' = one rule per line */
  cssFormat: 'vertical' | 'compact'
  maxSpaceEm: number // largest space above/below a paragraph taken over from print (em)
  blockSpaceEm: number // space around indented blocks (<div class="top">); collapses with the paragraphs' own
  headingSpaceAboveEm: number // least space above a part/chapter/section title (h1/h2) — print opens them low on the page
  headingSpaceBelowEm: number // least space between that title and the text
  headingScalePct: number // scales every heading size taken from InDesign (100 = as in print)
  footnoteIndentEm: number // first-line indent of footnotes
  tocEntryIndentEm: number // left indent of chapter entries on the printed contents and list pages (0 = flush, as print)
  blockClass: 'extract1' | 'extract' // class of indented blocks without an InDesign style of their own
  altRequired: 'error' | 'warn' // a picture with no description stops delivery (accessible) or only warns

  /** quality check */
  minCoverPx: number // shortest acceptable long side of the cover
  lostWordsErrorPct: number // % of source words missing that counts as an error (below: a warning)
}

type Field =
  | { def: boolean; bool: true }
  | { def: string; choices: readonly string[] }
  | { def: number; min: number; max: number }
/** One row per plain setting: its default and what a valid value is. DEFAULT_SETTINGS and sanitize are made from this table,
 *  so a new plain setting is one row here (plus its rule in the registry), not four edits. */
const SCHEMA = {
  roleHeading: { def: true, bool: true },
  langWrapper: { def: true, bool: true },
  seriesSmallCaps: { def: true, bool: true },
  verseLines: { def: true, bool: true },
  defaultProfile: { def: 'accessible', choices: ['accessible', 'standard'] },
  htmlLang: { def: 'xml:lang', choices: ['xml:lang', 'both', 'lang'] },
  styleVariants: { def: 'own', choices: ['own', 'ignore'] },
  tableHeaders: { def: 'th', choices: ['reference', 'th'] }, // accessible; a client may choose 'reference' with a recorded waiver (Spec step)
  footnoteRule: { def: 'short', choices: ['short', 'full', 'none'] },
  footnoteRuleWidth: { def: 25, min: 5, max: 100 },
  // source / style / no subtitle: an InDesign <h1 class="h1"> stays that way, and the menu shows the chapter title.
  // A client layer (BeBra: h2.chapter-b, subtitles in the menu) turns the review rules on for that publisher.
  chapterTag: { def: 'source', choices: ['h2', 'source'] },
  chapterHeadingClass: { def: 'style', choices: ['chapter-b', 'style'] },
  tocPageNumbers: { def: 'strip', choices: ['strip', 'show'] },
  navSubtitle: { def: false, bool: true },
  navLabelOn: { def: 'section', choices: ['section', 'nav'] },
  tdmReservation: { def: 'off', choices: ['off', 'reserved'] },
  noteSpot: { def: 'auto', choices: ['auto', 'chapter', 'book-end'] },
  navDepth: { def: 3, min: 1, max: 3 },
  navFront: { def: 'all', choices: ['all', 'named', 'none'] },
  titleOrder: { def: 'print', choices: ['print', 'source'] },
  coverLinear: { def: true, bool: true },
  writeGuide: { def: true, bool: true },
  cssFormat: { def: 'vertical', choices: ['vertical', 'compact'] },
  maxSpaceEm: { def: 2, min: 0, max: 10 },
  blockSpaceEm: { def: 1, min: 0, max: 5 },
  headingSpaceAboveEm: { def: 2, min: 0, max: 10 },
  headingSpaceBelowEm: { def: 3, min: 0, max: 10 },
  headingScalePct: { def: 100, min: 50, max: 200 },
  footnoteIndentEm: { def: 2, min: 0, max: 5 },
  tocEntryIndentEm: { def: 1.5, min: 0, max: 5 },
  blockClass: { def: 'extract1', choices: ['extract1', 'extract'] },
  altRequired: { def: 'error', choices: ['error', 'warn'] },
  minCoverPx: { def: 1400, min: 0, max: 10000 },
  lostWordsErrorPct: { def: 1, min: 0, max: 100 },
} as const satisfies Record<string, Field>

export const DEFAULT_SETTINGS: HouseSettings = {
  markup: {},
  styleMap: {},
  printOnly: [],
  labels: {},
  extraCss: '',
  houseCss: '',
  variantOn: ['align', 'indent', 'face'],
  ...STD_DEFAULTS,
  ...(Object.fromEntries(Object.entries(SCHEMA).map(([k, f]) => [k, f.def])) as unknown as Pick<HouseSettings, keyof typeof SCHEMA>),
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
      const ok = 'bool' in f ? typeof v === 'boolean' : 'choices' in f ? (f.choices as readonly unknown[]).includes(v) : typeof v === 'number' && isFinite(v)
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
