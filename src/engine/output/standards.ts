// What each output type is allowed to do, and the defaults a missing setting falls back to.
// A missing value follows the standard for that output type. The client's finished files decide where
// that standard and their own practice meet (see docs/REFERENCE_INVENTORY.md).
import type { HouseSettings } from '../settings.ts'

export type OutputKind = 'standard-epub' | 'accessible-epub' | 'accessible-pdf'

export interface OutputDefault {
  kind: OutputKind
  id: string
  /** what the reader gets, in plain words */
  plain: string
  /** the document the default comes from */
  standard: string
}

export const OUTPUT_KINDS: { id: OutputKind; title: string; line: string }[] = [
  { id: 'standard-epub', title: 'Standard EPUB', line: 'A normal EPUB 3.3 e-book for the stores: the same text and pictures, without the extra accessibility layer.' },
  { id: 'accessible-epub', title: 'Accessible EPUB', line: 'An e-book a screen reader can follow: real headings, page numbers, text rather than pictures of text, and the accessibility details in the package (EPUB Accessibility 1.1 and WCAG 2.2 AA).' },
  { id: 'accessible-pdf', title: 'Accessible PDF', line: 'The print PDF retagged so a screen reader reads it in order, checked against PDF/UA-1 (the Matterhorn protocol).' },
]

/** Defaults that apply when a layer does not set the value. Explanations are for the operator. */
export const OUTPUT_DEFAULTS: OutputDefault[] = [
  { kind: 'standard-epub', id: 'headings', plain: 'Chapter titles may be ordinary paragraphs with a class, which is how the finished Crowood ceramics file is built. EPUB 3.3 allows that.', standard: 'EPUB 3.3; Crowood reference' },
  { kind: 'standard-epub', id: 'page-marks', plain: 'Printed page numbers are simple anchors, not a page list. The ceramics file uses anchors.', standard: 'EPUB 3.3; Crowood reference' },
  { kind: 'standard-epub', id: 'chapter-opener', plain: 'The chapter number and title sit inside one heading (class ch-head1, ch-num, ch2), as in the ceramics file.', standard: 'Crowood reference' },
  { kind: 'accessible-epub', id: 'headings', plain: 'Chapter titles are real headings (h1–h6), so a screen reader can list them.', standard: 'EPUB Accessibility 1.1; WCAG 2.2 AA (1.3.1, 2.4.6)' },
  { kind: 'accessible-epub', id: 'pages', plain: 'Printed page numbers are kept, with a page list, so a reader can say “page 42”.', standard: 'EPUB Accessibility 1.1 (page navigation)' },
  { kind: 'accessible-epub', id: 'text', plain: 'The title page is text, not a picture of text. Pictures that carry information have a description.', standard: 'WCAG 2.2 AA (1.4.5 Images of text, 1.1.1 Non-text content)' },
  { kind: 'accessible-epub', id: 'language', plain: 'Every page names its language, and the package says the book is accessible.', standard: 'WCAG 2.2 AA (3.1.1); EPUB Accessibility 1.1 metadata' },
  { kind: 'accessible-pdf', id: 'tags', plain: 'Every paragraph, heading, list, table, note and figure is tagged in reading order. Decoration is marked as an artifact.', standard: 'PDF/UA-1 (ISO 14289-1); Matterhorn protocol' },
  { kind: 'accessible-pdf', id: 'language', plain: 'The document language is set and the title is shown in the window bar.', standard: 'PDF/UA-1' },
  { kind: 'accessible-pdf', id: 'figures', plain: 'A logo drawn from many paths is one figure, not a pile of pieces. A plate section appended at the end gets its own bookmark.', standard: 'PDF/UA-1 (figures); client reference bookmark “Plate”' },
]

export interface OutputProblem {
  level: 'error' | 'warn'
  message: string
}

/** Combinations that break the chosen output type. Errors should stop the build; warnings need a person. */
export function outputViolations(kind: OutputKind, s: HouseSettings): OutputProblem[] {
  const out: OutputProblem[] = []
  if (kind === 'accessible-epub') {
    const tag = s.markup?.['chapter-title']?.tag
    if (tag && !/^h[1-6]$/.test(tag)) {
      out.push({ level: 'error', message: `This accessible EPUB would write chapter titles as <${tag}>, which is not a heading. Screen readers need real headings (EPUB Accessibility 1.1, WCAG 2.2). Change the chapter-title template to a heading, or switch to Standard EPUB.` })
    }
    if (s.chapterOpener === 'split') {
      out.push({ level: 'error', message: 'This accessible EPUB would turn each chapter opening into two ordinary paragraphs, with no heading. Screen readers need a real heading. Use “Number and title inside one heading”, or switch to Standard EPUB.' })
    }
    if (s.altRequired === 'warn') {
      out.push({ level: 'warn', message: 'Pictures without a description will only warn, not stop delivery. WCAG 2.2 asks for a description of every picture that carries information. A person should confirm the empty ones are decorative.' })
    }
  }
  if (kind === 'accessible-pdf' && s.markup?.['chapter-title']?.tag === 'img') {
    out.push({ level: 'error', message: 'An accessible PDF cannot use a picture of the chapter title in place of text. PDF/UA needs real text for that heading.' })
  }
  return out
}
