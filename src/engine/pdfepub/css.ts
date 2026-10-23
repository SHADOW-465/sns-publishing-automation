// House stylesheet for books rebuilt from a print PDF — the classes of the Contemporary Ceramics
// reference EPUB, coloured with the book's own brand colour (detected from the PDF's panels).

import type { Align } from './align.ts'

/** The look the settings decide (TYP-01…TYP-07, HD-11…HD-13): alignment, typeface, size, and the class names of a chapter opener. */
export interface PdfTypography {
  body: Align
  chapterTitle: Align
  chapterTitleFont: string
  contentsHeading: Align
  contentsHeadingFont: string
  copyright: Align
  extractSizePct: number
  chapterClass: string
  numClass: string
  titleClass: string
}
export const DEFAULT_TYPOGRAPHY: PdfTypography = {
  body: 'left', chapterTitle: 'left', chapterTitleFont: 'serif', contentsHeading: 'left', contentsHeadingFont: 'sans-serif', copyright: 'left',
  extractSizePct: 100, chapterClass: 'ch-head1', numClass: 'ch-num', titleClass: 'ch2',
}

export function pdfBookCss(brand: string, box: { panel: string }, t: PdfTypography = DEFAULT_TYPOGRAPHY): string {
  const bodyAlign = t.body === 'justify' ? 'justify' : 'left'
  return `@page { margin: 14pt 0pt 16pt 0pt; }
body { margin: 0 auto; padding: 0.75em 5%; }
img { max-width: 100%; max-height: 100%; }
a { text-decoration: underline; }
em { font-style: italic; }
strong { font-weight: bold; }

/* front matter */
.cover { margin: 0; padding: 0; text-align: center; }
img.cv { max-height: 96vh; max-width: 100%; height: auto; }
p.copyr-top { font-family: sans-serif; font-size: 90%; margin: 2em 0 0 0; text-indent: 0; text-align: ${t.copyright}; }
p.copyr1 { font-family: sans-serif; font-size: 90%; margin: 0; text-indent: 0; text-align: ${t.copyright}; }
p.copyr2 { font-family: sans-serif; font-size: 90%; margin: 1em 0 0 0; text-indent: 0; text-align: ${t.copyright}; }
h1.TOC-1, h1.ch-head { font-family: ${t.contentsHeadingFont}; font-size: 200%; font-weight: normal; margin: 1em 0 1.5em 0; text-align: ${t.contentsHeading}; color: ${brand}; }
p.TOC-2 { font-family: sans-serif; font-size: 110%; margin: 0.5em 0 0 1.5em; text-align: left; }
p.TOC-2 a { text-decoration: none; }
span.space-toc-10 { margin-left: -1.5em; float: left; }
span.space-toc-11 { margin-left: -2em; float: left; }

/* title and half-title pages rebuilt as text */
h1.title_1 { font-family: serif; font-size: 200%; font-weight: bold; margin: 3em 0 0.5em 0; text-align: center; }
p.title-2 { font-family: serif; font-size: 110%; margin: 1.5em 0 0 0; text-indent: 0; text-align: center; }
p.title-3 { font-family: serif; font-size: 150%; margin: 1em 0 0 0; text-indent: 0; text-align: center; }

/* chapter openers and headings */
h1.${t.chapterClass} { font-family: ${t.chapterTitleFont}; font-size: 300%; font-weight: bold; margin: 1em 0 2em ${t.chapterTitle === 'center' ? '0' : '0.8em'}; text-indent: ${t.chapterTitle === 'center' ? '0' : '-0.8em'}; text-align: ${t.chapterTitle}; color: ${brand}; }
span.${t.numClass} { font-weight: bold; }
span.${t.titleClass} { font-family: sans-serif; font-size: 60%; vertical-align: middle; border-bottom: 5px solid ${brand}; }
h1.subhead, h2.subhead { font-family: sans-serif; font-size: 110%; font-weight: bold; margin: 2em 0 1em 0; text-align: left; color: ${brand}; page-break-after: avoid; }
h2.subhead1, h3.subhead1 { font-family: sans-serif; font-size: 100%; font-weight: bold; margin: 1.5em 0 0.2em 0; text-align: left; color: ${brand}; page-break-after: avoid; }
h1.ded-h, h1.ack-h { font-family: sans-serif; font-size: 100%; font-weight: bold; margin: 2em 0 0.2em 0; text-align: left; }
p.ded-1, p.ack1 { font-family: sans-serif; font-size: 90%; margin: 0.2em 0 0 0; text-indent: 0; text-align: left; }

/* text */
p.noindent { font-family: serif; text-align: ${bodyAlign}; margin: 0; text-indent: 0; }
p.indent { font-family: serif; text-align: ${bodyAlign}; margin: 0; text-indent: 1.5em; }
p.hang { font-family: serif; text-align: left; margin: 0 0 0 1.5em; text-indent: -1.5em; }
span.dropcap { font-family: sans-serif; font-size: 400%; float: left; margin: -0.15em 0.05em -0.31em 0; font-weight: normal; line-height: 1; color: #999693; }
p.extract1 { margin: 1em 0 1em 1.5em; text-indent: 0; text-align: left;${t.extractSizePct < 100 ? ` font-size: ${t.extractSizePct}%;` : ''} }
p.extractt { margin: 1em 0 0 1.5em; text-indent: 0; text-align: left;${t.extractSizePct < 100 ? ` font-size: ${t.extractSizePct}%;` : ''} }
p.extractint { margin: 0 0 1em 1.5em; text-indent: 1.5em; text-align: left;${t.extractSizePct < 100 ? ` font-size: ${t.extractSizePct}%;` : ''} }
p.extractint0 { margin: 0 0 0 1.5em; text-indent: 1.5em; text-align: left;${t.extractSizePct < 100 ? ` font-size: ${t.extractSizePct}%;` : ''} }

/* pictures */
figure.img_cont { margin: 1em 0; text-align: center; page-break-inside: avoid; }
p.image_Container { text-align: center; margin: 0.5em 0; text-indent: 0; }
figcaption.caption1, p.caption1 { font-family: sans-serif; font-size: 80%; margin: 0.5em 0 0 0; text-indent: 0; text-align: left; }

/* tip boxes */
aside.box { margin: 2em 0 1em 0; page-break-inside: avoid; }
div.brownbox { background-color: ${brand}; color: #ffffff; padding: 0.5em; }
h2.box-head { font-family: sans-serif; font-size: 90%; margin: 0; text-align: left; }
div.brownbox_1 { background-color: ${box.panel}; padding: 1em; }
h3.box-subhead { font-family: sans-serif; font-size: 85%; font-weight: bold; margin: 0 0 1em 0; }
h3.box-subhead1 { font-family: sans-serif; font-size: 85%; font-weight: bold; margin: 1.5em 0 1em 0; }
p.box-noindent { font-family: sans-serif; font-size: 85%; margin: 1em 0 0 0; text-indent: 0; text-align: left; }

/* contents of a book with parts and chapters, lists */
p.toc_1, p.toc_1t, p.toc_1a, p.toc_2, p.toc_3 { font-family: serif; text-align: left; text-indent: 0; }
p.toc_1 { margin: 0.8em 0 0 0; }
p.toc_1t { margin: 1.5em 0 0 0; }
p.toc_1a { margin: 0.4em 0 0 1.5em; text-indent: -1.5em; }
p.toc_2 { font-family: sans-serif; font-size: 85%; text-align: center; margin: 1.5em 0 0.5em 0; }
p.toc_3 { margin: 1em 0 0.5em 0; }
span.toc_2a { display: block; font-size: 110%; margin: 0.5em 0 1.5em 0; }
p.toc_1 a, p.toc_1t a, p.toc_1a a, p.toc_2 a, p.toc_3 a { text-decoration: none; }
ul.bull { font-family: serif; text-align: left; margin: 1em 0; }

/* tables */
table.tbl { border-collapse: collapse; width: 100%; margin: 1em 0; font-family: sans-serif; font-size: 90%; }
table.tbl th, table.tbl td { border: 1px solid #000000; padding: 4px; vertical-align: top; text-align: left; }
table.tbl th, table.tbl td.tbl-h { background-color: #e2e3e4; font-weight: bold; }

/* footnotes */
div.footnotes { margin-top: 2em; border-top: 1px solid #000000; }
p.Nota-al-pie { font-family: serif; font-size: 85%; margin: 0.3em 0 0 0; text-indent: 0; text-align: left; }

/* index */
p.Index1 { font-family: serif; margin: 0 0 0 1.5em; text-indent: -1.5em; text-align: left; }
p.Index1-t { font-family: serif; margin: 1em 0 0 1.5em; text-indent: -1.5em; text-align: left; }
p.Index2 { font-family: serif; margin: 0 0 0 2.5em; text-indent: -1.5em; text-align: left; }
.nav { margin: 0; list-style-type: none; }
`
}
