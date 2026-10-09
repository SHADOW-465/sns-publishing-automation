import { px, em, type Decls } from '../indesign/css.ts'
import { settings } from '../settings.ts'

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
p.img, p.image_Container { text-align: center; margin: 1em auto; text-indent: 0; }
figure.fig_group, div.fig_group { text-align: center; margin: 1em 0; }
h3.sec1, h4.sec1, h5.sec1 { font-size: 100%; text-align: left; margin: 1em 0; font-family: serif; }
ul.bull { text-align: justify; margin: 1em 0; font-family: serif; }
ol.num { text-align: justify; margin: 1em 0; font-family: serif; }
li ul, li ol { margin-top: 0; margin-bottom: 0; }
span.list { float: left; margin-left: -1.5em; }
span.space1 { margin-right: 0.4em; }

/* table of contents pages */
.nav { margin: 0; list-style-type: none; }
p.toc_1, p.toc_1t, p.toc_1a, p.toc_2, p.toc_3 { text-align: left; text-indent: 0; font-family: serif; }
p.toc_1 { margin: 0.8em 0 0 0; }
p.toc_1t { margin: 1.5em 0 0 0; }
p.toc_1a { margin: 0.4em 0 0 1.5em; text-indent: -1.5em; }
p.toc_2 { margin: 1.5em 0 0 0; text-align: center; }
p.toc_3 { margin: 1em 0 0 0; }
span.toc_2a { display: block; font-size: 110%; }
p.toc_1 a, p.toc_1t a, p.toc_1a a, p.toc_2 a, p.toc_3 a { text-decoration: none; }

/* footnotes: the separator line is hr.footline (see footnoteRule in Settings) */
div.footnotes { margin-top: 2em; }
p.Nota-al-pie { font-size: 85%; text-align: justify; margin: 0.2em 0 0 0; text-indent: 0; font-family: serif; }

/* tables */
table { border-collapse: collapse; width: 100%; margin: 1em 0; }
th, td { border: 1px solid #000; padding: 0.25em 0.4em; vertical-align: top; text-align: left; font-family: sans-serif; font-size: 85%; }
th { background-color: #e2e3e4; font-weight: bold; }
`

const r = (n: number) => Math.round(n * 2) / 2 // to the nearest 0.5em
const emStr = (n: number) => `${n}em`

/** The book's body size in px, the unit print spacing is measured in (InDesign writes 1em = 12px). */
const bodyPx = (body: Decls) => em(body['font-size'] || '1em') * 12 || 12

/** House declarations for a book-specific class, derived from InDesign's: fonts reduced to serif /
 *  sans-serif, lengths converted to em of the body text, first-line indents normalised to the house
 *  1.5em, print spacing capped for small screens. Margins are written out (margin-top, -bottom,
 *  -right, -left) in the order the reference stylesheet uses. */
export function houseDecls(tag: string, d: Decls, body: Decls): Decls {
  const out: Decls = {}
  const base = bodyPx(body)
  const heading = /^h\d$/.test(tag)
  const size = (em(d['font-size']) / em(body['font-size'] || '1em')) * (heading ? settings().headingScalePct / 100 : 1) // a title span is sized relative to its heading, already scaled
  // a heading always states its size: left out, readers fall back to their own h1 = 2em, h2 = 1.5em
  // (client feedback V3 row 17: part titles far larger than in print)
  if (heading || Math.abs(size - 1) > 0.05) out['font-size'] = `${Math.round(size * 20) * 5}%` // in steps of 5%, as the reference (110%, 150%)
  if (d['text-align']) out['text-align'] = d['text-align']
  const v = (x: string | undefined) => Math.min(settings().maxSpaceEm, r(px(x) / base))
  const indent = px(d['text-indent'])
  const left = r(px(d['margin-left']) / base)
  // a hanging indent keeps its geometry: the first line starts where it starts in print
  const ti = indent > 0 ? 1.5 : indent < 0 ? -Math.max(0.5, r(-indent / base)) : 0
  // part, chapter and section titles open low on the printed page (V3 row 16: "top space missing")
  const opener = tag === 'h1' || tag === 'h2'
  out['margin-top'] = emStr(Math.max(v(d['margin-top']), opener ? settings().headingSpaceAboveEm : 0))
  out['margin-bottom'] = emStr(Math.max(v(d['margin-bottom']), opener ? settings().headingSpaceBelowEm : 0))
  out['margin-right'] = emStr(r(px(d['margin-right']) / base))
  out['margin-left'] = emStr(ti < 0 ? Math.max(-ti, left) : left)
  out['text-indent'] = ti ? emStr(ti) : '0'
  const w = d['font-weight'] === 'bold' ? 700 : parseInt(d['font-weight'] ?? '400')
  if (w >= 600 || (heading && w >= 500)) out['font-weight'] = 'bold'
  else if (heading) out['font-weight'] = 'normal'
  if (d['font-style'] === 'italic' || d['font-style'] === 'oblique') out['font-style'] = 'italic'
  if (d['text-transform'] === 'uppercase') out['text-transform'] = 'uppercase'
  out['font-family'] = /sans|avenir|helvetica|arial|futura|gill|myriad|frutiger|univers|verdana/i.test(d['font-family'] ?? '') ? 'sans-serif' : 'serif'
  if (d['color'] && !/^#0{3}(0{3})?$|^black$/i.test(d['color'])) out['color'] = d['color']
  if (d['page-break-after'] === 'avoid' || heading) out['page-break-after'] = 'avoid'
  if (tag === 'span') out['display'] = 'block'
  return out
}

/** House declarations for a table cell class: InDesign's cell fill and vertical alignment, plus the
 *  alignment and face of the paragraphs inside (a bold header row is bold through its cell class). */
export function cellDecls(cell: Decls, para: Decls): Decls {
  const out: Decls = {}
  if (para['text-align'] && para['text-align'] !== 'justify') out['text-align'] = para['text-align']
  if (cell['vertical-align']) out['vertical-align'] = cell['vertical-align']
  const bg = cell['background-color']
  if (bg && !/^(transparent|#fff(fff)?|white)$/i.test(bg)) out['background-color'] = bg
  const w = para['font-weight'] === 'bold' ? 700 : parseInt(para['font-weight'] ?? '400')
  if (w >= 600) out['font-weight'] = 'bold'
  if (para['font-style'] === 'italic') out['font-style'] = 'italic'
  return out
}

/** One compact rule, e.g. `p.Texto { text-align: justify; … }` (formatCss lays it out). */
export const ruleOf = (selector: string, d: Decls): string =>
  Object.keys(d).length ? `${selector} { ${Object.entries(d).map(([k, v]) => `${k}: ${v}`).join('; ')}; }` : `${selector} {}`

/** One rule for a book-specific class, derived from InDesign's declarations. */
export function ruleFor(tag: string, cls: string, d: Decls, body: Decls): string {
  return ruleOf(`${tag}.${cls}`, houseDecls(tag, d, body))
}

/** CSS for the house options: footnote separator line and the space around indented blocks. */
function optionCss(): string {
  const s = settings()
  const width = s.footnoteRule === 'full' ? 100 : s.footnoteRuleWidth
  return [
    `hr.footline { width: ${width}%; margin: 0 auto 0.5em 0; border: 0; border-top: 1px solid; height: 0; }`,
    `div.top { margin: ${s.blockSpaceEm}em 0; }`,
    `blockquote { margin: ${s.blockSpaceEm}em 0; }`,
    // footnotes indented as in print (V3 row 20); contents entries flush as in print (V3 rows 18–19)
    `p.Nota-al-pie { text-indent: ${s.footnoteIndentEm}em; }`,
    // a chapter entry starts flush and its wrapped lines hang in by this much, as the printed contents page
    `p.toc_1a { margin-left: ${s.tocEntryIndentEm}em; text-indent: ${s.tocEntryIndentEm ? -s.tocEntryIndentEm : 0}em; }`,
  ].join('\n')
}

/** classes whose look the house stylesheet fixes (whatever the source says) */
export const FIXED_CLASSES = new Set(['p.indent', 'p.noindent', 'p.extract', 'p.extract1', 'p.extract2', 'p.hang', 'p.center', 'h3.sec1', 'h4.sec1', 'h5.sec1', 'li.bull'])

export function buildCss(used: Map<string, { tag: string; decls: Decls }>, body: Decls): string {
  const gen = [...used]
    .filter(([key]) => !FIXED_CLASSES.has(key))
    .map(([key, u]) =>
      // table cell classes are shared by <td> and <th> (header row, Settings → tableHeaders)
      u.tag === 'td' ? ruleOf(`${key}, th.${key.slice(3)}`, { ...u.decls }) : ruleOf(key, houseDecls(u.tag, u.decls, body)))
  const house = settings().houseCss.trim() || HOUSE_CSS
  return house + '\n/* house options (Settings) */\n' + optionCss() + '\n\n/* book styles (generated from the InDesign paragraph styles) */\n' + gen.join('\n') + '\n'
}

// ---------------------------------------------------------------------------------------------
// Layout of the stylesheet: "vertical" as in the reference EPUB (selector, brace, one declaration
// per line, margins written out), or "compact" (one rule per line, margins as one shorthand).
// ---------------------------------------------------------------------------------------------

const SIDES = ['top', 'bottom', 'right', 'left'] as const
/** "1em 0" → top 1em, bottom 1em, right 0, left 0 (CSS shorthand rules) */
function sides(v: string): Record<(typeof SIDES)[number], string> | undefined {
  const p = v.trim().split(/\s+/)
  if (p.length < 1 || p.length > 4 || /!important|\(/.test(v)) return undefined
  const [t, rr = t, b = t, l = rr] = p
  return { top: t, bottom: b, right: rr, left: l }
}

function layoutDecls(decls: [string, string][], vertical: boolean): [string, string][] {
  const out: [string, string][] = []
  for (const [k, v] of decls) {
    const s = (k === 'margin' || k === 'padding') && vertical ? sides(v) : undefined
    if (s) for (const side of SIDES) out.push([`${k}-${side}`, s[side]])
    else out.push([k, v])
  }
  if (vertical) return out
  // compact: four written-out sides become one shorthand, in place of the first
  for (const k of ['margin', 'padding']) {
    const got = SIDES.map((side) => out.find(([n]) => n === `${k}-${side}`))
    if (got.some((x) => !x)) continue
    const [t, b, rr, l] = got.map((x) => x![1])
    const at = out.indexOf(got[0]!)
    const short = rr === l ? (t === b ? (t === rr ? t : `${t} ${rr}`) : `${t} ${rr} ${b}`) : `${t} ${rr} ${b} ${l}`
    const rest = out.filter((x) => !got.includes(x))
    rest.splice(Math.min(at, rest.length), 0, [k, short])
    out.splice(0, out.length, ...rest)
  }
  return out
}

/** Lays out a flat stylesheet (comments, rules, @page). Nested blocks (@media) are left untouched. */
export function formatCss(css: string, mode: 'vertical' | 'compact' = settings().cssFormat): string {
  const out: string[] = []
  let i = 0
  const vertical = mode === 'vertical'
  while (i < css.length) {
    const ws = css.slice(i).match(/^\s+/)
    if (ws) {
      i += ws[0].length
      continue
    }
    if (css.startsWith('/*', i)) {
      const end = css.indexOf('*/', i + 2)
      if (end < 0) return css
      out.push(css.slice(i, end + 2))
      i = end + 2
      continue
    }
    const open = css.indexOf('{', i)
    const close = css.indexOf('}', open)
    if (open < 0 || close < 0) return css
    const body = css.slice(open + 1, close)
    if (body.includes('{')) return css // nested block: not a flat stylesheet
    const selector = css.slice(i, open).trim().replace(/\s+/g, ' ')
    const decls = body.split(';').map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()] as [string, string]).filter(([k, v]) => k && v)
    const laid = layoutDecls(decls, vertical)
    const lines = laid.map(([k, v]) => (vertical ? `${k}:${v};` : `${k}: ${v};`))
    out.push(vertical ? `${selector}\n{\n${lines.map((l) => l + '\n').join('')}}` : `${selector} {${lines.length ? ` ${lines.join(' ')} ` : ''}}`)
    i = close + 1
  }
  return out.join(vertical ? '\n\n' : '\n') + '\n'
}
