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

export interface HouseSettings {
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

export const DEFAULT_SETTINGS: HouseSettings = {
  printOnly: [],
  labels: {},
  extraCss: '',
  houseCss: '',
  roleHeading: true,
  langWrapper: true,
  seriesSmallCaps: true,
  verseLines: true,
  defaultProfile: 'accessible',
  htmlLang: 'xml:lang',
  styleVariants: 'own',
  variantOn: ['align', 'indent', 'face'],
  tableHeaders: 'th', // accessible; a client may choose 'reference' with a recorded waiver (Spec step)
  footnoteRule: 'short',
  footnoteRuleWidth: 25,
  cssFormat: 'vertical',
  maxSpaceEm: 2,
  blockSpaceEm: 1,
  headingSpaceAboveEm: 2,
  headingSpaceBelowEm: 3,
  headingScalePct: 100,
  footnoteIndentEm: 2,
  tocEntryIndentEm: 1.5,
  blockClass: 'extract1',
  altRequired: 'error',
  minCoverPx: 1400,
  lostWordsErrorPct: 1,
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
  const oneOf = <K extends keyof HouseSettings>(k: K, ok: readonly unknown[]) => (ok.includes(s[k]) ? s[k] : d[k])
  type NumKey = { [K in keyof HouseSettings]: HouseSettings[K] extends number ? K : never }[keyof HouseSettings]
  const num = (k: NumKey, lo: number, hi: number) =>
    typeof s[k] === 'number' && isFinite(s[k]) ? Math.min(hi, Math.max(lo, s[k])) : d[k]
  return {
    ...s,
    printOnly: Array.isArray(s.printOnly) ? s.printOnly.map(String) : d.printOnly,
    labels: s.labels && typeof s.labels === 'object' ? s.labels : d.labels,
    extraCss: typeof s.extraCss === 'string' ? s.extraCss : d.extraCss,
    houseCss: typeof s.houseCss === 'string' ? s.houseCss : d.houseCss,
    defaultProfile: oneOf('defaultProfile', ['accessible', 'standard']) as HouseSettings['defaultProfile'],
    htmlLang: oneOf('htmlLang', ['xml:lang', 'both', 'lang']) as HouseSettings['htmlLang'],
    styleVariants: oneOf('styleVariants', ['own', 'ignore']) as HouseSettings['styleVariants'],
    variantOn: Array.isArray(s.variantOn) ? s.variantOn.filter((g) => g in VARIANT_GROUPS) : d.variantOn,
    tableHeaders: oneOf('tableHeaders', ['reference', 'th']) as HouseSettings['tableHeaders'],
    footnoteRule: oneOf('footnoteRule', ['short', 'full', 'none']) as HouseSettings['footnoteRule'],
    cssFormat: oneOf('cssFormat', ['vertical', 'compact']) as HouseSettings['cssFormat'],
    footnoteRuleWidth: num('footnoteRuleWidth', 5, 100),
    maxSpaceEm: num('maxSpaceEm', 0, 10),
    blockSpaceEm: num('blockSpaceEm', 0, 5),
    headingSpaceAboveEm: num('headingSpaceAboveEm', 0, 10),
    headingSpaceBelowEm: num('headingSpaceBelowEm', 0, 10),
    headingScalePct: num('headingScalePct', 50, 200),
    footnoteIndentEm: num('footnoteIndentEm', 0, 5),
    tocEntryIndentEm: num('tocEntryIndentEm', 0, 5),
    blockClass: oneOf('blockClass', ['extract1', 'extract']) as HouseSettings['blockClass'],
    altRequired: oneOf('altRequired', ['error', 'warn']) as HouseSettings['altRequired'],
    minCoverPx: num('minCoverPx', 0, 10000),
    lostWordsErrorPct: num('lostWordsErrorPct', 0, 100),
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
