import { px, em, type Decls } from '../indesign/css.ts'

// House stylesheet. The fixed part mirrors the classes the production team uses in every
// reference EPUB; rules for the book's own paragraph styles are generated from InDesign's CSS
// (fonts dropped, px converted to em, indents normalised to the house 1.5em).

export const HOUSE_CSS = `@page { margin: 14pt 0pt 16pt 0pt; }
body { margin: 0 auto; padding: 0.75em 5%; }
img { max-height: 100%; max-width: 100%; }
a { text-decoration: underline; }
sup { font-size: 70%; vertical-align: super; line-height: 0; }
sub { font-size: 70%; vertical-align: sub; line-height: 0; }

/* inline formatting */
span.italic { font-style: italic; }
span.bold { font-weight: bold; }
span.bold-italic { font-weight: bold; font-style: italic; }
span.nori { font-style: normal; }
span.normal_1 { font-weight: normal; }
span.underline { text-decoration: underline; }
span.strike { text-decoration: line-through; }
span.small-caps { font-size: 75%; }
span.dropcap { font-size: 2.84em; float: left; margin: -0.15em 0.05em -0.3em 0; font-family: serif; font-weight: normal; line-height: 1; }

/* cover, title pages, copyright */
.cover { margin: 0; padding: 0; text-align: center; }
img.cv { max-width: 100%; height: auto; }
.tit_img { text-align: center; margin: 3em 0 0 0; text-indent: 0; }
img.w1 { width: 40%; max-width: 184px; }
h1.title { font-size: 180%; font-family: serif; text-align: center; margin: 3em 0 0 0; font-weight: normal; }
h1.title_1 { font-size: 290%; font-family: serif; text-align: center; font-weight: bold; margin: 1em 0 0 0; }
p.title-2 { font-size: 110%; text-align: center; margin: 2em 0 1.5em 0; text-indent: 0; font-family: serif; }
p.title-3 { font-size: 150%; text-align: center; margin: 3em 0 0 0; text-indent: 0; font-family: serif; }
p.title-4 { font-size: 150%; text-align: center; margin: 1em 0 0 0; text-indent: 0; font-family: serif; }
p.copy_top { font-size: 90%; text-align: left; margin: 3em 0 0 0; text-indent: 0; font-family: serif; }
p.copy1 { font-size: 90%; text-align: left; margin: 0.5em 0 0 0; text-indent: 0; font-family: serif; }
p.copy_t { font-size: 90%; text-align: left; margin: 0 0 0 1em; text-indent: 0; font-family: serif; }

/* generic paragraph roles */
p.indent { text-align: justify; margin: 0; text-indent: 1.5em; font-family: serif; }
p.noindent { text-align: justify; margin: 0; text-indent: 0; font-family: serif; }
p.extract { text-align: left; margin: 0 0 0 1.5em; text-indent: 0; font-family: serif; }
p.extract1 { text-align: left; margin: 0 0 0 1.5em; text-indent: 0; font-family: serif; }
p.extract2 { text-align: left; margin: 0 0 1em 1.5em; text-indent: 0; font-family: serif; }
p.hang { text-align: left; margin: 0 0 0.3em 1.5em; text-indent: -1.5em; font-family: serif; }
p.center { text-align: center; margin: 0; text-indent: 0; font-family: serif; }
p.img { text-align: center; margin: 1em auto; text-indent: 0; }
h3.sec1, h4.sec1, h5.sec1 { font-size: 100%; text-align: left; margin: 1em 0; font-family: serif; }
div.top { padding-top: 1em; padding-bottom: 1em; }
ul.bull { text-align: justify; margin: 1em 0; font-family: serif; }

/* table of contents pages */
.nav { margin: 0; list-style-type: none; }
p.toc_1, p.toc_1a, p.toc_2, p.toc_3 { text-align: left; text-indent: 0; font-family: serif; }
p.toc_1 { margin: 0.8em 0 0 0; }
p.toc_1a { margin: 0.4em 0 0 1.5em; }
p.toc_2 { margin: 1.5em 0 0 0; text-align: center; }
p.toc_3 { margin: 1em 0 0 0; }
span.toc_2a { display: block; font-size: 110%; }
p.toc_1 a, p.toc_1a a, p.toc_2 a, p.toc_3 a { text-decoration: none; }

/* footnotes */
div.footnotes { border-top: 1px solid; margin-top: 2em; padding-top: 0.5em; }
p.Nota-al-pie { font-size: 85%; text-align: justify; margin: 0.2em 0 0 0; text-indent: 0; font-family: serif; }

/* tables */
table { border-collapse: collapse; width: 100%; margin: 1em 0; }
th, td { border: 1px solid #000; padding: 0.25em 0.4em; vertical-align: top; text-align: left; font-family: sans-serif; font-size: 85%; }
th { background-color: #e2e3e4; font-weight: bold; }
`

const r = (n: number) => Math.round(n * 2) / 2 // to the nearest 0.5em

/** One rule for a book-specific class, derived from InDesign's declarations. */
export function ruleFor(tag: string, cls: string, d: Decls, body: Decls): string {
  const out: string[] = []
  const size = em(d['font-size']) / em(body['font-size'] || '1em')
  if (Math.abs(size - 1) > 0.1) out.push(`font-size: ${Math.round(size * 100)}%`)
  if (d['text-align']) out.push(`text-align: ${d['text-align']}`)
  const indent = px(d['text-indent'])
  const left = px(d['margin-left'])
  out.push(`text-indent: ${indent > 0 ? '1.5em' : indent < 0 ? '-1.5em' : '0'}`)
  const ml = indent < 0 ? Math.max(1.5, r(left / 12)) : r(left / 12)
  const v = (x: string | undefined) => Math.min(3, r(px(x) / 12)) // print spacing, capped for small screens
  out.push(`margin: ${v(d['margin-top'])}em ${r(px(d['margin-right']) / 12)}em ${v(d['margin-bottom'])}em ${ml}em`)
  const w = d['font-weight'] === 'bold' ? 700 : parseInt(d['font-weight'] ?? '400')
  if (w >= 600 || (/^h\d$/.test(tag) && w >= 500)) out.push('font-weight: bold')
  else if (/^h\d$/.test(tag)) out.push('font-weight: normal')
  if (d['font-style'] === 'italic' || d['font-style'] === 'oblique') out.push('font-style: italic')
  out.push(`font-family: ${/sans|avenir|helvetica|arial|futura|gill|myriad|frutiger|univers|verdana/i.test(d['font-family'] ?? '') ? 'sans-serif' : 'serif'}`)
  if (d['color'] && !/^#0{3}(0{3})?$|^black$/i.test(d['color'])) out.push(`color: ${d['color']}`)
  if (d['page-break-after'] === 'avoid' || /^h\d$/.test(tag)) out.push('page-break-after: avoid')
  if (tag === 'span') out.push('display: block')
  return `${tag}.${cls} { ${out.join('; ')}; }`
}

export function buildCss(used: Map<string, { tag: string; decls: Decls }>, body: Decls): string {
  const fixed = new Set(['p.indent', 'p.noindent', 'p.extract', 'p.extract1', 'p.extract2', 'p.hang', 'p.center', 'h3.sec1', 'h4.sec1', 'h5.sec1', 'li.bull'])
  const gen = [...used]
    .filter(([key]) => !fixed.has(key))
    .map(([key, u]) => ruleFor(u.tag, key.split('.').slice(1).join('.'), u.decls, body))
  return HOUSE_CSS + '\n/* book styles (generated from the InDesign paragraph styles) */\n' + gen.join('\n') + '\n'
}
