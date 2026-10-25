// What each OUTPUT TYPE is, which standard it follows, and what a setting falls back to when no layer
// (house → client → series → book) gives a value. Every default carries a plain-language reason and the standard it comes from,
// so the screen can say "this is the Accessible EPUB default, because WCAG 2.2 1.4.5 …" instead of showing a bare value.
//
//   Standard EPUB    EPUB 3.3: valid XHTML and package, no accessibility claim.
//   Accessible EPUB  EPUB Accessibility 1.1 + WCAG 2.2 AA: real headings, page list, text rather than pictures of text,
//                    descriptions for pictures, the language of every page, accessibility metadata.
//   Accessible PDF   PDF/UA-1 (ISO 14289-1) + the Matterhorn Protocol: tags in reading order, language, one figure per picture.
//
// Where the client's finished files (docs/REFERENCE_INVENTORY.md) show a practice the standard leaves open, the default follows the
// files; where a file and the standard disagree, the standard decides and the difference is a question for the client.
import { DEFAULT_SETTINGS, type HouseSettings } from '../settings.ts'
import { ruleById, type RuleValue } from '../spec/rules.ts'

export type OutputKind = 'standard-epub' | 'accessible-epub' | 'accessible-pdf'
export type SourceKind = 'indesign' | 'pdf' | 'word'

export interface OutputInfo {
  id: OutputKind
  title: string
  /** one line for the operator */
  line: string
  /** the standards it is checked against */
  standards: string
  /** the kinds of source it can be made from */
  sources: SourceKind[]
}

export const OUTPUT_KINDS: OutputInfo[] = [
  { id: 'standard-epub', title: 'Standard EPUB', line: 'A normal e-book for the stores (EPUB 3.3): the same text and pictures, without the extra accessibility layer.', standards: 'EPUB 3.3', sources: ['indesign', 'pdf', 'word'] },
  { id: 'accessible-epub', title: 'Accessible EPUB', line: 'An e-book a screen reader can follow: real headings, page numbers, text rather than pictures of text, picture descriptions and the accessibility details in the package.', standards: 'EPUB Accessibility 1.1, WCAG 2.2 AA', sources: ['indesign', 'pdf', 'word'] },
  { id: 'accessible-pdf', title: 'Accessible PDF', line: 'The print PDF tagged so a screen reader reads it in order, with picture descriptions, bookmarks and the language set (PDF/UA-1).', standards: 'PDF/UA-1 (ISO 14289-1), Matterhorn Protocol', sources: ['pdf'] },
]
export const outputInfo = (k: OutputKind) => OUTPUT_KINDS.find((o) => o.id === k)!

export interface StandardDefault {
  /** the value; absent = the factory value stands and only the reason is added */
  value?: RuleValue
  /** why, in plain words */
  plain: string
  /** the document it comes from */
  standard: string
}

const T = (plain: string, standard: string, value?: RuleValue): StandardDefault => ({ plain, standard, value })
const EPUB: OutputKind[] = ['standard-epub', 'accessible-epub']
const table: Record<OutputKind, Record<string, StandardDefault>> = { 'standard-epub': {}, 'accessible-epub': {}, 'accessible-pdf': {} }
const put = (kinds: OutputKind[], id: string, d: StandardDefault) => kinds.forEach((k) => (table[k][id] = d))

// ---- Accessible EPUB: EPUB Accessibility 1.1 and WCAG 2.2 AA ----
const A: OutputKind[] = ['accessible-epub']
put(A, 'DOC-00', T('The package is marked as an accessible publication and the pages carry the reading roles.', 'EPUB Accessibility 1.1 §3', 'accessible'))
put(A, 'DOC-01', T('Every page names its language, so a screen reader pronounces the text correctly.', 'WCAG 2.2 3.1.1; EPUB 3.3 §4.2'))
put(A, 'HD-01', T('Part and chapter titles are marked as headings for assistive software.', 'WCAG 2.2 1.3.1, 2.4.6; DPUB-ARIA'))
put(A, 'HD-07', T('A chapter title is a real heading (h1–h6), never a classed paragraph.', 'WCAG 2.2 1.3.1, 2.4.6'))
put(A, 'HD-10', T('The chapter number and title sit inside one real heading.', 'WCAG 2.2 1.3.1', 'spans'))
put(A, 'FM-03', T('The title page is rebuilt as text. A picture of text cannot be resized or read aloud, and the title page carries the title.', 'WCAG 2.2 1.4.5 Images of text', 'text'))
put(A, 'PG-01', T('Printed page numbers are marked where each page starts, with a page list, so a reader can go to “page 42”.', 'EPUB Accessibility 1.1 (page navigation); EPUB 3.3 page-list'))
put(EPUB, 'PG-02', T('A Word manuscript with no page breaks takes its page markers from the companion print PDF.', 'EPUB Accessibility 1.1 (page navigation)', true))
put(EPUB, 'PG-03', T('Small caps a Word file dropped are recovered from the print PDF, where the letters are drawn at capital width.', 'The client’s finished files set small caps; a PDF-to-Word file often loses the property', true))
put(A, 'NAV-02', T('The contents page links to the chapters without printed page numbers; the numbers belong in the page list.', 'EPUB Accessibility 1.1 (page navigation)', 'strip'))
put(A, 'TBL-01', T('A table has header cells, so a screen reader can say which column a cell is in.', 'WCAG 2.2 1.3.1 (H43)', 'th'))
put(A, 'A11Y-01', T('A picture that carries information must have a description, or be marked as decoration, before delivery.', 'WCAG 2.2 1.1.1', 'error'))
put(A, 'STD-13', T('A decorative picture gets an empty description, which a screen reader skips.', 'WCAG 2.2 1.1.1; HTML 4.7.5.1', 'empty'))
put(A, 'TYP-01', T('Body text follows the printed page. Justified text is allowed but harder for some readers.', 'WCAG 2.2 1.4.8 (advanced level)'))
put(A, 'TYP-07', T('Extracts and verse are sized as a percentage of the body text, so readers can still enlarge them.', 'WCAG 2.2 1.4.4 Resize text'))
put(A, 'NOTE-04', T('Notes are linked to their reference and back.', 'EPUB Accessibility 1.1; DPUB-ARIA doc-noteref'))
put(A, 'FIG-02', T('A complex figure has a long description besides its short one.', 'EPUB Accessibility 1.1 (complex images); WCAG 2.2 1.1.1'))

// ---- Standard EPUB: EPUB 3.3, and the finished Crowood file where the standard is open ----
const S: OutputKind[] = ['standard-epub']
put(S, 'DOC-00', T('A clean EPUB 3.3 for the stores, with no accessibility claim in the package.', 'EPUB 3.3', 'standard'))
put(S, 'HD-10', T('The chapter number and title sit inside one heading, as in the finished Crowood file.', 'EPUB 3.3 allows either; Crowood reference', 'spans'))
put(S, 'FM-03', T('The title and half-title pages are the printed pages as pictures, with their words as the description, as in the finished Crowood file.', 'EPUB 3.3 allows it; Crowood reference', 'image'))
put(S, 'A11Y-01', T('A Standard EPUB makes no accessibility claim, so a missing picture description is a warning, not a stop. HTML still wants the alt attribute to be there.', 'EPUB 3.3; HTML 4.7.5.1', 'warn'))
put(S, 'STD-02', T('Italic and bold use <em> and <strong>, which say what the text means. The Crowood file does; the client’s sheet says <i> and <b>, so ask before changing it back.', 'HTML 4.5; Crowood reference', 'semantic'))
put(S, 'STD-12', T('Each page’s title is the book’s main title, as in the finished Crowood file. EPUBCheck only asks that a title exists.', 'EPUB 3.3 §4.2.4; Crowood reference', 'main'))
put(S, 'STD-13', T('A decorative picture gets an empty description (alt=""), as HTML says.', 'HTML 4.7.5.1; WCAG 1.1.1', 'empty'))
put(S, 'STD-08', T('Printed pages are marked with plain anchors.', 'EPUB 3.3; client sheet'))
put(S, 'STD-14', T('Anchors are named Page_{n}, as in the client’s sheet. The Crowood file names them pg_{n}.', 'Client sheet', 'Page_{n}'))
put(S, 'TYP-01', T('Body text follows the printed page.', 'No standard decides alignment'))

// ---- both EPUB types ----
put(EPUB, 'CSS-01', T('How the CSS file is laid out does not change how the book looks.', 'No standard decides this'))
put(EPUB, 'PKG-03', T('The EPUB 2 guide is written for older readers.', 'EPUB 3.3 §A (legacy)'))
put(EPUB, 'PKG-02', T('The cover is the first page of the reading order.', 'EPUB 3.3 §5 (spine)'))
put(EPUB, 'NAV-04', T('The navigation lists are named on the wrapping section, which EPUBCheck accepts.', 'EPUB 3.3 §5.4'))
put(EPUB, 'FIL-01', T('The client’s own file list is what the menu shows, when one is given. The sheet is the only statement of the menu titles we have; no finished file of that book exists to compare.', 'Client Book_Details sheet; rulebook NAV-001, NAV-002', 'plan'))
put(EPUB, 'NAV-05', T('The menu goes three levels deep.', 'EPUB 3.3 §5.4 (nav)'))

// ---- Accessible PDF: PDF/UA-1 and the Matterhorn Protocol ----
const P: OutputKind[] = ['accessible-pdf']
put(P, 'UA-01', T('One top heading (the title of the book), with chapters under it. PDF/UA asks that heading levels do not skip.', 'PDF/UA-1 7.4; Matterhorn 14-002', 2))
put(P, 'UA-02', T('A mark drawn from many shapes is one figure with a description.', 'PDF/UA-1 7.3; Matterhorn 13-004', 'figure'))
put(P, 'UA-03', T('Every heading level has a bookmark, so the outline shows the whole structure.', 'PDF/UA-1 7.1', 6))
put(P, 'UA-04', T('A section appended after the book (plates) has its own bookmark.', 'PDF/UA-1 7.1; Gladiators reference', true))
put(P, 'UA-05', T('The bookmark is called “Plate”, as in the finished Gladiators file.', 'Gladiators reference', 'Plate'))
put(P, 'UA-06', T('Index page numbers are not links, as in the finished Gladiators file. The 23 October note asked for links; switch this on when the client confirms.', 'Gladiators reference; correction U2', false))
put(P, 'UA-07', T('A note number links to its note and back.', 'PDF/UA-1 7.11 (Note, Reference); Matterhorn 28', true))
put(P, 'UA-08', T('A small picture with no caption is decoration, marked as an artifact so a screen reader skips it. A client that wants every ornament and mark as a figure sets this to “figure” (SacGeo and Pen & Sword do).', 'PDF/UA-1 7.3; Matterhorn 13-004; rulebook PAR-004', 'artifact'))
put(P, 'UA-09', T('The caption follows its figure as its own Caption element. Nesting it inside the figure is a switch, because the client has not said which they want.', 'PDF/UA-1; PDF Association Well-Tagged PDF; rulebook PFG-003', 'after'))
put(P, 'UA-11', T('Heading levels never skip. A client that wants the same print style to carry the same tag everywhere accepts a gap instead (SacGeo asked for this).', 'PDF/UA-1 7.4; Matterhorn 14-002; rulebook PHD-004, PHD-008', 'contiguous'))
put(P, 'UA-12', T('Only the topmost of several link rectangles stacked on one picture is a link: the rest belong to layouts nobody can see.', 'PDF/UA-1 7.18; Matterhorn 28; rulebook PNT-004', 'topmost'))
put(P, 'UA-10', T('Running heads and folios are page furniture: artifacts, so they do not break the reading order.', 'PDF/UA-1 7.8; Matterhorn 01-005; rulebook PAR-001', 'artifact'))

/** the default of one rule for an output type: the value, why, and the standard */
export function defaultFor(kind: OutputKind, ruleId: string): { value: RuleValue | undefined; plain: string; standard: string } {
  const r = ruleById.get(ruleId)
  const d = table[kind][ruleId]
  const factory = r?.key ? (DEFAULT_SETTINGS[r.key] as RuleValue) : undefined
  if (d) return { value: d.value !== undefined ? d.value : factory, plain: d.plain, standard: d.standard }
  return { value: factory, plain: r ? `${r.help.split('. ')[0]}.` : '', standard: 'No standard decides this; the house default applies' }
}

/** The settings a build starts from for an output type, before the house, client, series and book layers are applied. */
export function baseSettings(kind: OutputKind): HouseSettings {
  const out = { ...DEFAULT_SETTINGS } as Record<string, unknown>
  for (const [id, d] of Object.entries(table[kind])) {
    const key = ruleById.get(id)?.key
    if (key && d.value !== undefined) out[key] = d.value
  }
  return out as unknown as HouseSettings
}

export const hasStandardDefault = (kind: OutputKind, ruleId: string) => !!table[kind][ruleId]

export interface OutputProblem {
  level: 'error' | 'warn'
  /** the setting involved, when there is one */
  ruleId?: string
  message: string
}

export interface PackageClaims {
  conformsTo?: string
  certifiedBy?: string
}

/**
 * Combinations that break the chosen output type, in plain words. An error should stop the build; a warning needs a person.
 * The same settings pass for another type: a picture title page is fine in a Standard EPUB and not in an Accessible one.
 */
export function outputViolations(kind: OutputKind, s: HouseSettings, claims: PackageClaims = {}): OutputProblem[] {
  const out: OutputProblem[] = []
  const err = (ruleId: string | undefined, message: string) => out.push({ level: 'error', ruleId, message })
  const warn = (ruleId: string | undefined, message: string) => out.push({ level: 'warn', ruleId, message })
  if (kind === 'accessible-epub') {
    const tag = s.markup?.['chapter-title']?.tag
    if (tag && !/^h[1-6]$/.test(tag)) err('HD-07', `This Accessible EPUB would write chapter titles as <${tag}>, which is not a heading. Screen readers need real headings (EPUB Accessibility 1.1, WCAG 2.2 1.3.1). Change the chapter-title template to a heading, or choose Standard EPUB.`)
    if (s.chapterOpener === 'split') err('HD-10', 'This Accessible EPUB would turn each chapter opening into two ordinary paragraphs, with no heading. Screen readers need a real heading (WCAG 2.2 1.3.1). Use “Number and title inside one heading”, or choose Standard EPUB.')
    if (s.titlePageAs === 'image') err('FM-03', 'This Accessible EPUB would show the title page as a picture of text. A picture of text cannot be resized or read by software (WCAG 2.2 1.4.5). Rebuild the title page as text, or choose Standard EPUB.')
    if (s.altRequired === 'warn') warn('A11Y-01', 'Pictures without a description will only warn, not stop delivery. WCAG 2.2 1.1.1 asks for a description of every picture that carries information. A person should confirm the empty ones are decorative.')
    if (s.tocPageNumbers === 'show') warn('NAV-02', 'The contents page would show printed page numbers. In an Accessible EPUB the print page numbers belong in the page list (EPUB Accessibility 1.1); the numbers in the contents are not wrong, but they are not what the standard asks.')
    if (s.tableHeaders === 'reference') warn('TBL-01', 'Tables would have no header cells, so a screen reader cannot say which column a cell belongs to (WCAG 2.2 1.3.1). This needs the accessibility waiver.')
  }
  if (kind === 'standard-epub') {
    if (claims.conformsTo?.trim() || claims.certifiedBy?.trim()) err(undefined, 'This is a Standard EPUB, but the book details claim accessibility (“Conforms to” or “Certified by”). A Standard EPUB makes no accessibility claim. Clear those two fields, or choose Accessible EPUB.')
  }
  if (kind === 'accessible-pdf') {
    if (s.markup?.['chapter-title']?.tag === 'img') err('HD-07', 'An Accessible PDF cannot use a picture of the chapter title in place of text. PDF/UA needs real text for the heading.')
    if (s.uaBookmarkLevels < s.uaChapterLevel) warn('UA-03', 'Bookmarks would list only the title of the book, not the chapters, because chapters are one level deeper than the bookmarks go.')
    if (s.uaLogos === 'artifact') warn('UA-02', 'Logos will be marked as decoration and skipped by screen readers. Confirm the logos carry no information (a certification mark, for example, does).')
  }
  return out
}
