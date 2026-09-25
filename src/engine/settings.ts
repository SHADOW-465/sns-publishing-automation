// House settings: the rules a production team adjusts per house without touching code. Defaults
// reproduce the reference EPUBs. The UI edits them on the Settings screen; tests use the defaults.
// ponytail: one module-level value, set before a build; pass it explicitly if builds ever run concurrently.

export interface HouseSettings {
  /** extra phrases that mark print-only imprint lines (removed from the e-book copyright page) */
  printOnly: string[]
  /** reader-facing labels per language code ("es", "en"…), overriding the built-in ones */
  labels: Record<string, Record<string, string>>
  /** CSS appended to the generated stylesheet (wins over the house CSS) */
  extraCss: string
  /** house-style options (from client feedback on the reference EPUBs) */
  roleHeading: boolean // role="heading" + aria-level on the heading that names each part
  langWrapper: boolean // <div xml:lang="…"> around the content of every page
  seriesSmallCaps: boolean // numbered heading series ("Hábito 1…12") all in small caps when some are
  verseLines: boolean // a quotation broken into short lines is set as verse (extract1/extract2)
  /** quality check */
  minCoverPx: number // shortest acceptable long side of the cover
  lostWordsErrorPct: number // % of source words missing that counts as an error (below: a warning)
}

export const DEFAULT_SETTINGS: HouseSettings = {
  printOnly: [],
  labels: {},
  extraCss: '',
  roleHeading: true,
  langWrapper: true,
  seriesSmallCaps: true,
  verseLines: true,
  minCoverPx: 1400,
  lostWordsErrorPct: 1,
}

let current: HouseSettings = DEFAULT_SETTINGS

export const settings = () => current
export function setSettings(s: Partial<HouseSettings>) {
  current = { ...DEFAULT_SETTINGS, ...s }
}

/** Built-in print-only patterns plus the house's own phrases (plain text, any case). */
export const isHousePrintOnly = (text: string) => current.printOnly.some((p) => p.trim() && text.toLocaleLowerCase().includes(p.trim().toLocaleLowerCase()))
