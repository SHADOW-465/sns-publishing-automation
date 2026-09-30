// House stylesheet for books rebuilt from a print PDF — the classes of the Contemporary Ceramics
// reference EPUB, coloured with the book's own brand colour (detected from the PDF's panels).

export function pdfBookCss(brand: string, box: { panel: string }): string {
  return `@page { margin: 14pt 0pt 16pt 0pt; }
body { margin: 0 auto; padding: 0.75em 5%; }
img { max-width: 100%; max-height: 100%; }
a { text-decoration: underline; }
em { font-style: italic; }
strong { font-weight: bold; }

/* front matter */
.cover { margin: 0; padding: 0; text-align: center; }
img.cv { max-height: 96vh; max-width: 100%; height: auto; }
p.copyr-top { font-family: sans-serif; font-size: 90%; margin: 2em 0 0 0; text-indent: 0; text-align: left; }
p.copyr1 { font-family: sans-serif; font-size: 90%; margin: 0; text-indent: 0; text-align: left; }
p.copyr2 { font-family: sans-serif; font-size: 90%; margin: 1em 0 0 0; text-indent: 0; text-align: left; }
h1.TOC-1, h1.ch-head { font-family: sans-serif; font-size: 200%; font-weight: normal; margin: 1em 0 1.5em 0; text-align: left; color: ${brand}; }
p.TOC-2 { font-family: sans-serif; font-size: 110%; margin: 0.5em 0 0 1.5em; text-align: left; }
p.TOC-2 a { text-decoration: none; }
span.space-toc-10 { margin-left: -1.5em; float: left; }
span.space-toc-11 { margin-left: -2em; float: left; }

/* chapter openers and headings */
h1.ch-head1 { font-family: serif; font-size: 300%; font-weight: bold; margin: 1em 0 2em 0.8em; text-indent: -0.8em; text-align: left; color: ${brand}; }
span.ch-num { font-weight: bold; }
span.ch2 { font-family: sans-serif; font-size: 60%; vertical-align: middle; border-bottom: 5px solid ${brand}; }
h1.subhead, h2.subhead { font-family: sans-serif; font-size: 110%; font-weight: bold; margin: 2em 0 1em 0; text-align: left; color: ${brand}; page-break-after: avoid; }
h2.subhead1, h3.subhead1 { font-family: sans-serif; font-size: 100%; font-weight: bold; margin: 1.5em 0 0.2em 0; text-align: left; color: ${brand}; page-break-after: avoid; }
h1.ded-h, h1.ack-h { font-family: sans-serif; font-size: 100%; font-weight: bold; margin: 2em 0 0.2em 0; text-align: left; }
p.ded-1, p.ack1 { font-family: sans-serif; font-size: 90%; margin: 0.2em 0 0 0; text-indent: 0; text-align: left; }

/* text */
p.noindent { font-family: serif; text-align: left; margin: 0; text-indent: 0; }
p.indent { font-family: serif; text-align: left; margin: 0; text-indent: 1.5em; }
p.hang { font-family: serif; text-align: left; margin: 0 0 0 1.5em; text-indent: -1.5em; }
span.dropcap { font-family: sans-serif; font-size: 400%; float: left; margin: -0.15em 0.05em -0.31em 0; font-weight: normal; line-height: 1; color: #999693; }
p.extract1 { margin: 1em 0 1em 1.5em; text-indent: 0; text-align: left; }
p.extractt { margin: 1em 0 0 1.5em; text-indent: 0; text-align: left; }
p.extractint { margin: 0 0 1em 1.5em; text-indent: 1.5em; text-align: left; }
p.extractint0 { margin: 0 0 0 1.5em; text-indent: 1.5em; text-align: left; }

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

/* index */
p.Index1 { font-family: serif; margin: 0 0 0 1.5em; text-indent: -1.5em; text-align: left; }
p.Index1-t { font-family: serif; margin: 1em 0 0 1.5em; text-indent: -1.5em; text-align: left; }
p.Index2 { font-family: serif; margin: 0 0 0 2.5em; text-indent: -1.5em; text-align: left; }
.nav { margin: 0; list-style-type: none; }
`
}
