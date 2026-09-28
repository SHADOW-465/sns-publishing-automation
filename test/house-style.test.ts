// Regression tests for the client's corrections on Cambia tu mente (EPUB Automation Update V3,
// 28-9-26), on a hand-written InDesign export that reproduces each case (test/fixtures), so they run
// without the confidential sample books. Each assertion names its row in the V3 document.
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { text, bytes, type Files } from '../src/engine/zip.ts'
import { analyze, build, columnWidths } from '../src/engine/indesign/build.ts'
import { formatCss } from '../src/engine/epub/css.ts'
import { checkEpub } from '../src/engine/check/epub.ts'
import { compareLook, printIndent } from '../src/engine/check/look.ts'
import { setSettings, settings, DEFAULT_SETTINGS, type HouseSettings } from '../src/engine/settings.ts'
import type { PrintPage } from '../src/engine/pdf/pages.ts'
import { indesignExport, PNG, EISBN } from './fixtures/indesign-export.ts'

afterEach(() => setSettings(DEFAULT_SETTINGS))

function book(s: Partial<HouseSettings> = {}) {
  setSettings(s)
  const a = analyze(indesignExport())
  const r = build(a, { styles: a.styles, images: a.images, meta: { ...a.meta, eisbn: EISBN, publisher: 'Editorial Sirio' }, cover: { name: 'cover.png', data: PNG } })
  const f = (name: string) => text(r.files.get(`OEBPS/${name}`)!)
  return { r, f, css: f('css/style.css') }
}

test('V3 defaults: every correction of the client, as in the hand-finished EPUB', () => {
  const { r, f, css } = book()
  const ch1 = f('chapter01.xhtml')
  const ch2 = f('chapter02.xhtml')

  // rows 1–4 (V2, "Updated"): still in place
  assert.match(ch2, /<h2 class="Antetitulo_SUPER" id="chap2" role="heading" aria-level="2">Capítulo 2 <span class="Titulo_SUPER">Hábitos del falso Yo<\/span><\/h2>/)
  assert.match(ch2, /<h3 class="Ladillo-2">H<span class="small-caps">ÁBITO<\/span> 5: B<span class="small-caps">USCAR SEGURIDAD<\/span><\/h3>/)
  assert.match(ch2, /<p class="extract1">«Mi poder y mi independencia se elevan,<\/p>\n<p class="extract2">Mi <span class="small-caps">YO SOY<\/span> ruge/)
  assert.match(ch2, /<section aria-labelledby="chap2" epub:type="chapter" role="doc-chapter">\n<div xml:lang="es-ES">/)

  // row 5: language once on <html>, as xml:lang
  for (const [p, d] of r.files) {
    if (!p.endsWith('.xhtml')) continue
    const html = text(d).match(/<html[^>]*>/)![0]
    assert.match(html, /xml:lang="es-ES"/, p)
    assert.doesNotMatch(html, /\slang=/, `${p}: no duplicated lang`)
  }

  // row 6: one class per element — the heading with a stray InDesign override keeps its style's class
  for (const [p, d] of r.files) if (p.endsWith('.xhtml')) assert.doesNotMatch(text(d), /class="[^"]*\s[^"]*"/, `${p}: a single class on every element`)

  // row 7: stylesheet laid out vertically, margins written out, as the reference (same values as its h3.Ladillo-2)
  assert.match(css, /h3\.Ladillo-2\n\{\nfont-size:110%;\ntext-align:left;\nmargin-top:1\.5em;\nmargin-bottom:1em;\nmargin-right:0em;\nmargin-left:0em;\ntext-indent:0;\nfont-weight:bold;\nfont-family:sans-serif;\npage-break-after:avoid;\n\}/)
  assert.doesNotMatch(css, /\{ [^}]*; \}/, 'no one-line rules')

  // rows 9–10: page markers of the contents and list pages where their page starts, not piled up above the heading
  assert.match(f('toc.xhtml'), /id="page-9"[^\n]*\n<h2 class="Antetitulo_PP" id="toc"[^\n]*\n(<p class="toc_1a?">.*\n){3}<span [^\n]*id="page-10"[^\n]*\n<p class="toc_1a"><a href="chapter03.xhtml">/)
  assert.match(f('list.xhtml'), /id="page-11"[^\n]*\n<h2[^\n]*\n<p [^\n]*sec1[^\n]*\n<span [^\n]*id="page-12"[^\n]*\n<p [^\n]*sec2/)

  // row 11: table as the reference — td with cell styles, header row with its own class, one element per line, widths add up to 100%
  assert.match(ch1, /<table class="No-Table-Style" id="table009">\n<colgroup>\n<col style="width:10%;"\/>\n<col style="width:10%;"\/>\n<col style="width:80%;"\/>\n<\/colgroup>\n<tbody>\n<tr>\n<td class="No-Table-Style1">Sí<\/td>\n<td class="No-Table-Style1">No<\/td>\n<td class="No-Table-Style1">Pregunta<\/td>\n<\/tr>\n<tr>\n<td class="No-Table-Style"><\/td>/)
  assert.doesNotMatch(ch1, /<thead|<th /)
  assert.match(css, /td\.No-Table-Style1, th\.No-Table-Style1\n\{[^}]*background-color:#d9d9d9;\nfont-weight:bold;/)
  assert.doesNotMatch(f('content.opf'), /tableHeaders/, 'no tableHeaders claim without header cells')

  // row 12: question/answer lines are an indented block (extract1), not a hanging indent
  assert.match(ch1, /<div class="top">\n<p class="extract1"><span class="italic">Pregunta<\/span>: ¿Por qué me estoy cepillando el pelo\?<\/p>\n<p class="extract1"><span class="italic">Respuesta<\/span>/)
  assert.doesNotMatch(ch1, /class="hang"/)

  // rows 13–14: the space around indented blocks overlaps the paragraphs' own (margin, not padding)
  assert.match(css, /div\.top\n\{\nmargin-top:1em;\nmargin-bottom:1em;/)
  assert.doesNotMatch(css, /div\.top[^}]*padding/)
  assert.match(css, /p\.Texto_BLANCA-BLANCA\n\{\ntext-align:justify;\nmargin-top:1\.5em;\nmargin-bottom:1\.5em;/)
  // …and a style overridden everywhere in InDesign looks like its paragraphs, not like its bare definition
  assert.match(ch2, /<p class="Texto_BLANCA">Se volvió hacia mí/)
  assert.match(css, /p\.Texto_BLANCA\n\{[^}]*text-indent:1\.5em;/)

  // row 15: a short line above the footnotes, as in print
  assert.match(ch1, /<div class="footnotes">\n<hr class="footline"\/>\n<div epub:type="footnote" id="fn-01"/)
  assert.match(css, /hr\.footline\n\{\nwidth:30%;/)
  assert.doesNotMatch(css, /div\.footnotes[^}]*border-top/)

  // the built-in quality check agrees
  const rep = checkEpub(r.files, { ...r.source, printPages: ['1', '3', '4', '9', '10', '11', '12', '13', '14', '15', '17', '18', '19'] })
  const bad = rep.groups.flatMap((g) => g.findings).filter((x) => x.level === 'error')
  assert.deepEqual(bad, [])
})

test('V3 settings: each house option switches its rule', () => {
  let b = book({ htmlLang: 'both' })
  assert.match(b.f('chapter01.xhtml'), /<html [^>]*lang="es-ES" xml:lang="es-ES">/)

  b = book({ tableHeaders: 'th' })
  assert.match(b.f('chapter01.xhtml'), /<thead>\n<tr>\n<th class="No-Table-Style1" scope="col">Sí<\/th>/)
  assert.match(b.f('content.opf'), /tableHeaders/)

  b = book({ cssFormat: 'compact' })
  assert.match(b.css, /^h3\.Ladillo-2 \{ font-size: 110%; text-align: left; margin: 1\.5em 0em 1em; text-indent: 0;/m)

  b = book({ footnoteRule: 'none' })
  assert.doesNotMatch(b.f('chapter01.xhtml'), /footline/)
  b = book({ footnoteRule: 'full' })
  assert.match(b.css, /hr\.footline\n\{\nwidth:100%;/)

  // a hand override of the font size is noise by default; ticked, it gets a single class of its own
  b = book({ variantOn: [...DEFAULT_SETTINGS.variantOn, 'size'] })
  assert.match(b.f('chapter02.xhtml'), /<h3 class="Ladillo-2_1">H<span class="small-caps">ÁBITO<\/span> 5/)
  assert.match(b.css, /h3\.Ladillo-2_1\n\{\nfont-size:120%;/)

  b = book({ styleVariants: 'ignore' })
  assert.doesNotMatch(b.f('chapter02.xhtml'), /Texto_BLANCA1/)

  b = book({ blockSpaceEm: 0.5, maxSpaceEm: 1 })
  assert.match(b.css, /div\.top\n\{\nmargin-top:0\.5em;/)
  assert.match(b.css, /p\.Texto_BLANCA-BLANCA\n\{\ntext-align:justify;\nmargin-top:1em;/)

  b = book({ houseCss: 'p.indent { text-indent: 2em; }' })
  assert.match(b.css, /^p\.indent\n\{\ntext-indent:2em;\n\}/)
  assert.doesNotMatch(b.css, /toc_1a/)
})

test('settings from an older or hand-edited file fall back to the defaults', () => {
  setSettings({ htmlLang: 'nonsense', maxSpaceEm: 'x', variantOn: ['align', 'bogus'] } as unknown as Partial<HouseSettings>)
  assert.equal(settings().htmlLang, 'xml:lang')
  assert.equal(settings().maxSpaceEm, DEFAULT_SETTINGS.maxSpaceEm)
  assert.deepEqual(settings().variantOn, ['align'])
})

test('column widths add up to 100%, narrow columns get at least 10%', () => {
  assert.deepEqual(columnWidths([4, 4, 60]), [10, 10, 80])
  assert.deepEqual(columnWidths([40, 40, 320]), [10, 10, 80])
  assert.deepEqual(columnWidths([1, 1, 1]), [34, 33, 33])
  for (const raw of [[3, 7, 11, 13], [1, 1, 1, 1, 1, 1, 1], [50, 2]]) assert.equal(columnWidths(raw).reduce((a, b) => a + b, 0), 100)
})

test('stylesheet layout: vertical as the reference, compact on one line', () => {
  const css = '/* x */\nh3.Ladillo-2 { font-size: 110%; text-align: left; margin: 1.5em 0em 1em 0em; text-indent: 0em; font-family: sans-serif; }'
  assert.equal(formatCss(css, 'vertical'), '/* x */\n\nh3.Ladillo-2\n{\nfont-size:110%;\ntext-align:left;\nmargin-top:1.5em;\nmargin-bottom:1em;\nmargin-right:0em;\nmargin-left:0em;\ntext-indent:0em;\nfont-family:sans-serif;\n}\n')
  assert.equal(formatCss(formatCss(css, 'vertical'), 'compact'), '/* x */\nh3.Ladillo-2 { font-size: 110%; text-align: left; margin: 1.5em 0em 1em; text-indent: 0em; font-family: sans-serif; }\n')
  const nested = '@media (min-width: 1px) { p { color: red; } }'
  assert.equal(formatCss(nested, 'vertical'), nested, 'nested blocks are left alone')
})

// ---- quality check: the V3 faults are reported when they come back ----------------------------

function epubWith(body: string, css: string, extra: [string, string][] = []): Files {
  const x = (b: string) => `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="es"><head><title>t</title></head><body>${b}</body></html>`
  return new Map([
    ['mimetype', bytes('application/epub+zip')],
    ['META-INF/container.xml', bytes('<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')],
    ['OEBPS/content.opf', bytes(`<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:isbn:9791388228261</dc:identifier><dc:title>Cambia tu mente</dc:title><dc:language>es-ES</dc:language><meta property="dcterms:modified">2026-09-28T12:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="css" href="style.css" media-type="text/css"/><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>`)],
    ['OEBPS/nav.xhtml', bytes(x('<nav epub:type="toc"><ol><li><a href="c1.xhtml">Índice</a></li></ol></nav>'))],
    ['OEBPS/style.css', bytes(css)],
    ['OEBPS/c1.xhtml', bytes(x(body))],
    ...extra.map(([p, d]) => [p, bytes(d)] as [string, Uint8Array]),
  ])
}
const pbSpan = (n: number) => `<span aria-label="página ${n}" epub:type="pagebreak" id="page-${n}" role="doc-pagebreak" title="página ${n}"/>`

test('quality check: page markers piled up although their pages have text (V3 rows 9–10)', () => {
  const body = `<section epub:type="toc">${pbSpan(9)}${pbSpan(10)}<h2>Índice</h2><p class="toc_1">Uno</p><p class="toc_1">Dos</p></section>`
  const all = (r: ReturnType<typeof checkEpub>) => r.groups.flatMap((g) => g.findings.map((f) => `${f.level} ${f.msg}`)).join('\n')
  assert.match(all(checkEpub(epubWith(body, 'p.toc_1 {}'), { printPages: ['9', '10'] })), /error Page marker 10 \(right after 9\) sits next to the previous page's marker/)
  // page 9 blank in print: the two markers belong together
  assert.doesNotMatch(all(checkEpub(epubWith(body, 'p.toc_1 {}'), { printPages: ['10'] })), /right after 9/)
})

test('quality check: classes without a style and table widths that do not add up (V3 rows 11–12)', () => {
  const body = '<section epub:type="chapter"><h2>Uno</h2><p class="hang">Pregunta</p><table><colgroup><col style="width:10%;"/><col style="width:10%;"/><col style="width:88%;"/></colgroup><tr><td>a</td><td>b</td><td>c</td></tr></table></section>'
  const r = checkEpub(epubWith(body, 'p.indent { text-indent: 1.5em; }'))
  const all = r.groups.flatMap((g) => g.findings.map((f) => `${f.level} ${f.msg}`)).join('\n')
  assert.match(all, /warn Class used in the text but not defined in the stylesheet .*hang \(1×/)
  assert.match(all, /warn Table column widths add up to 108%/)
})

test('looks like print: indents compared with the printed lines (V3 rows 12–14)', () => {
  // a text column from x=50 to x=350; each page has enough full lines to find it
  const full = (t: string) => ({ text: t, x0: 50, x1: 350 })
  const filler = Array.from({ length: 12 }, (_, i) => full(`relleno de la columna número ${i} con palabras`))
  const page = (n: string, lines: PrintPage['lines'], pdfPage: number): PrintPage => ({ n, text: '', blank: false, lines: [...lines, ...filler], pdfPage })
  const pages = [
    page('13', [], 1),
    page('14', [
      { text: 'Pregunta: ¿Por qué me estoy cepillando el pelo?', x0: 68, x1: 300 },
      { text: 'Se volvió hacia mí y sonrió mientras los perros', x0: 68, x1: 350 },
      { text: 'ladraban y jugaban en el agua junto a la orilla.', x0: 50, x1: 280 },
    ], 2),
  ]
  const css = 'p.hang { margin: 0 0 0 1.5em; text-indent: -1.5em; }\np.Texto_BLANCA { text-align: justify; margin-left: 0em; text-indent: 0; }\np.Texto { text-indent: 1.5em; margin-left: 0em; }'
  const body = `<section epub:type="chapter"><h2>Uno</h2>${pbSpan(14)}<p class="hang">Pregunta: ¿Por qué me estoy cepillando el pelo?</p><p class="Texto_BLANCA">Se volvió hacia mí y sonrió mientras los perros ladraban y jugaban en el agua junto a la orilla.</p></section>`
  const { indents } = compareLook(epubWith(body, css), pages)
  assert.deepEqual(indents.map((f) => [f.cls, f.ebook, f.print]), [['hang', 'flush', 'in'], ['Texto_BLANCA', 'flush', 'indent']])
  // fixed classes: no finding
  const ok = body.replace('class="hang"', 'class="extract1"').replace('class="Texto_BLANCA"', 'class="Texto"')
  assert.deepEqual(compareLook(epubWith(ok, css + '\np.extract1 { margin: 0 0 0 1.5em; text-indent: 0; }'), pages).indents, [])
  assert.equal(printIndent([{ text: 'a', x0: 50, x1: 300 }, { text: 'b', x0: 68, x1: 300 }], { L: 50, R: 350 }), 'hang')
})
