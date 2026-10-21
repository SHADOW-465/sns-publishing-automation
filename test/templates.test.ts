// Phase 5: part titles and picture wrappers are templated roles, like chapter titles and note calls.
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { text, unzip, bytes } from '../src/engine/zip.ts'
import { analyze, build } from '../src/engine/indesign/build.ts'
import { setSettings, DEFAULT_SETTINGS, type HouseSettings } from '../src/engine/settings.ts'
import { conformance } from '../src/engine/check/conform.ts'
import { sampleRole, parseMarkupSample, sampleOf, markupSheets, layerDataFromWorkbook, layerDataFromReport, STYLES_HEAD } from '../src/engine/spec/markup.ts'
import { writeXlsx, readXlsx } from '../src/engine/spec/office.ts'
import { pdfImgHtml } from '../src/engine/pdfepub/build.ts'
import { longDescHtml } from '../src/engine/epub/markup.ts'
import { checkEpubBytes } from '../src/engine/check/epub.ts'
import { synthExport, SYNTH_CSS } from './synth.ts'
import { epubcheck } from './epubcheck.ts'

afterEach(() => setSettings(DEFAULT_SETTINGS))

/** PNG header only: enough for the size reader */
const png = (w: number, h: number) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, w >> 24, (w >> 16) & 255, (w >> 8) & 255, w & 255, h >> 24, (h >> 16) & 255, (h >> 8) & 255, h & 255])
const cover = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))
const css = `${SYNTH_CSS}\np.Teil { font-size:2.5em; text-align:center; font-family:"Sans", sans-serif; }
p.TeilT { font-size:2em; text-align:center; font-family:"Sans", sans-serif; }\n`
const long = (t: string) => `<p class="Cuerpo">${`${t} `.repeat(30)}</p>`

function book(s: Partial<HouseSettings>, pictures: { file: string; alt: string; decorative: boolean; longDesc: string }[] = []) {
  setSettings({ ...DEFAULT_SETTINGS, ...s, styleMap: { teil: { match: '^Teil$', role: 'part-label' }, teilt: { match: '^TeilT$', role: 'part-title' } } })
  const body = [
    long('Sample front line to keep the front matter alive.'),
    '<p class="Teil">Erster Teil</p>',
    '<p class="TeilT">Anfänge</p>',
    ...[1, 2].map((n) => `<p class="Etiqueta">Chapter ${n}</p>\n<p class="Titulo">Title of chapter ${n}</p>\n${long(`Chapter ${n} tells its story.`)}`),
    '<img src="images/photo.png" alt="A red plane on the runway"/>',
    long('After the picture the chapter goes on.'),
  ].join('\n')
  const files = synthExport(body, css)
  files.set('OEBPS/images/photo.png', png(800, 600))
  files.set('OEBPS/content.opf', bytes(text(files.get('OEBPS/content.opf')!).replace('</manifest>', '<item id="i1" href="images/photo.png" media-type="image/png"/></manifest>')))
  const a = analyze(files, {}, pictures)
  const r = build(a, { styles: a.styles, images: a.images, meta: { ...a.meta, title: 'Sample', authors: 'A. Writer', eisbn: '9780306406157' }, cover: { name: 'cover.png', data: cover } })
  const all = [...r.files].filter(([p]) => p.endsWith('.xhtml')).map(([, d]) => text(d)).join('\n')
  return { r, all }
}

test('part-title and figure templates shape the build; the default output is unchanged', () => {
  const plain = book({}).all
  assert.match(plain, /<h1 class="Teil" id="[^"]+" role="heading" aria-level="1">Erster Teil <span class="TeilT">Anfänge<\/span><\/h1>/)
  assert.match(plain, /<figure class="fig_group"><img alt="A red plane on the runway" src="images\/photo\.png"\/><\/figure>/)
  const markup = { 'part-title': { tag: 'h1', class: 'part-t', attrs: { 'data-kind': 'part' } }, figure: { class: 'img-c', attrs: { 'data-x': '1' } } }
  const { r, all } = book({ markup })
  assert.match(all, /<h1 class="part-t" id="[^"]+" role="heading" aria-level="1" data-kind="part">Erster Teil <span class="TeilT">Anfänge<\/span><\/h1>/)
  assert.match(all, /<figure class="img-c" data-x="1"><img alt="A red plane on the runway" src="images\/photo\.png"\/><\/figure>/)
  assert.deepEqual(conformance(r.files, { ...DEFAULT_SETTINGS, markup }), [])
  const ec = epubcheck(r.epub)
  // the fixture's picture is a PNG header only, which EPUBCheck reports as a corrupted image (PKG-021); the markup must be clean
  if (ec) assert.deepEqual(ec.errors.filter((e) => !/PKG-021/.test(e)), [], ec.output)
  // a div wrapper (some clients' Standard EPUB) is written as a div
  assert.match(book({ markup: { figure: { tag: 'div', class: 'fig' } } }).all, /<div class="fig"><img alt="A red plane/)
})

test('conformance catches a picture whose wrapper lost the figure template class', () => {
  const markup = { figure: { class: 'img-c' } }
  const { r } = book({ markup })
  const files = unzip(r.epub)
  const k = [...files.keys()].find((p) => text(files.get(p)!).includes('class="img-c"'))!
  files.set(k, bytes(text(files.get(k)!).replace('class="img-c"', 'class="other"')))
  assert.match(conformance(files, { ...DEFAULT_SETTINGS, markup }).join('\n'), /figure template's class "img-c"/)
})

test('the spec sheet reads part-title and figure samples, from the Markup sheet and from a report', () => {
  assert.equal(sampleRole('<h1 class="part" id="p1">Erster Teil</h1>'), 'part-title')
  assert.equal(sampleRole('<h1 epub:type="part">Erster Teil</h1>'), 'part-title')
  assert.equal(sampleRole('<h2 class="chapter-b">Natur</h2>'), 'chapter-title')
  assert.equal(sampleRole('<figure class="bild"><img src="a.jpg" alt="x"/></figure>'), 'figure')
  assert.equal(sampleRole('<div class="fig_group"><p class="image_Container"><img src="a.jpg" alt=""/></p></div>'), 'figure')
  assert.deepEqual(parseMarkupSample('figure', '<figure class="bild" data-k="v"><img src="a.jpg" alt="x"/><figcaption>c</figcaption></figure>'), { tag: 'figure', class: 'bild', attrs: { 'data-k': 'v' } })
  assert.deepEqual(parseMarkupSample('part-title', sampleOf('part-title', { tag: 'h1', class: 'part' })), { tag: 'h1', class: 'part' })
  const markup = { 'part-title': { tag: 'h1', class: 'part' }, figure: { tag: 'div', class: 'fig_group' } }
  const back = layerDataFromWorkbook(markupSheets({ markup, styleMap: {} }))
  assert.deepEqual(back?.markup, markup)
  const rep = layerDataFromReport([{ text: '', where: 'table 1, row 3', cells: ['<figure class="bild"><img src="a.jpg" alt="x"/></figure>', 'tool', 'comment'] }])
  assert.deepEqual(rep?.markup.figure, { tag: 'figure', class: 'bild' })
})

test('FIG-02: a complex figure’s extended description is a paragraph or a collapsed <details>, linked by aria-describedby either way', () => {
  const pic = [{ file: 'photo.png', alt: 'Bar chart of visitors per year', decorative: false, longDesc: 'Visitors rose from 10 in 1990 to 90 in 2020.' }]
  const para = book({}, pic).all
  assert.match(para, /<img alt="Bar chart of visitors per year" aria-describedby="longdesc-0" src="images\/photo\.png"\/><p id="longdesc-0" class="longdesc">Visitors rose/)
  const { r, all } = book({ longDescAs: 'details' }, pic)
  assert.match(all, /<img [^>]*aria-describedby="longdesc-0"[^>]*\/><details id="longdesc-0" class="longdesc"><summary>Picture description<\/summary><p>Visitors rose from 10 in 1990 to 90 in 2020\.<\/p><\/details>/)
  assert.deepEqual(checkEpubBytes(r.epub, r.source).groups.flatMap((g) => g.findings).filter((f) => f.level === 'error' && /description|longdesc|describedby/i.test(f.msg)), [])
  const ec = epubcheck(r.epub)
  if (ec) assert.deepEqual(ec.errors.filter((e) => !/PKG-021/.test(e)), [], ec.output)
  // the PDF and Word builds share the helper, and the summary follows the book's language
  setSettings({ ...DEFAULT_SETTINGS, longDescAs: 'details' })
  const choice = { alt: 'Karte', longDesc: 'Wege und Hallen.', decorative: false, source: 'spec', approved: true } as never
  assert.match(pdfImgHtml('images/map.png', choice, '', 'de-DE').extra, /<summary>Bildbeschreibung<\/summary><p>Wege und Hallen\.<\/p>/)
  assert.match(longDescHtml('x', 'a < b', 'es'), /<summary>Descripción de la imagen<\/summary><p>a &lt; b<\/p>/)
})

test('a client’s content rules match unnamed one-off paragraphs by what they say and how they are set, whatever the export numbered them', async () => {
  const { CLIENT_FILES } = await import('../src/clients/index.ts')
  const ark = CLIENT_FILES.find((c) => c.match === 'arkanobooks')!
  assert.ok(!JSON.stringify(ark.styleMap).includes('ParaOverride'), 'no export numbers in the client file')
  const run = (n: (k: number) => string) => {
    const css = `${SYNTH_CSS}
p.${n(1)} { margin-left:17px; text-indent:0; text-align:justify; }
p.${n(2)} { margin-left:51px; text-indent:-17px; }
p.${n(3)} { margin-left:34px; text-indent:-17px; }
p.${n(4)} { text-align:center; }
p.${n(5)} { text-indent:17px; margin-top:9px; }
p.${n(6)} { margin-left:17px; text-indent:0; }`
    const body = [long('Front line to keep the front matter alive.'),
      `<p class="Etiqueta">Chapter 1</p>\n<p class="Titulo">Title</p>`, long('Body of the chapter.'),
      `<p class="${n(1)}">Pregunta: ¿Quién soy?</p>`, `<p class="${n(2)}">Respuesta: «Yo».</p>`,
      `<p class="${n(3)}">1: Pensar.</p>`, `<p class="${n(4)}">Instagram: www.example.com/x</p>`,
      `<p class="${n(5)}">Sí = 1 punto</p>`, `<p class="${n(5)}">Suma tus puntuaciones:</p>`,
      `<p class="${n(6)}">Un párrafo cualquiera con sangría que no es pregunta ni respuesta alguna.</p>`, long('The end of the chapter.')].join('\n')
    setSettings({ ...DEFAULT_SETTINGS, styleMap: ark.styleMap })
    const a = analyze(synthExport(body, css, 'es'))
    const r = build(a, { styles: a.styles, images: a.images, meta: { ...a.meta, title: 'Sample', authors: 'A. Writer', eisbn: '9780306406157' }, cover: { name: 'cover.png', data: cover } })
    const html = [...r.files].filter(([p]) => p.endsWith('.xhtml')).map(([, d]) => text(d)).join('\n')
    const cls = (t: string) => html.match(new RegExp(`<p class="([^"]+)">${t}`))?.[1]
    return ['Pregunta', 'Respuesta', '1: Pensar', 'Instagram', 'Sí = 1', 'Suma tus', 'Un párrafo'].map(cls)
  }
  const want = ['extract', 'extract1', 'num1', 'web', 'table-txt', 'table-txt1']
  assert.deepEqual(run((k) => `ParaOverride-${k}`).slice(0, 6), want)
  assert.deepEqual(run((k) => `ParaOverride-${k * 7 + 3}`).slice(0, 6), want, 'other numbers, same classes')
  assert.ok(!want.includes(run((k) => `ParaOverride-${k}`)[6]!), 'an inset paragraph that is no question or answer keeps its own class')
})

test('content rules round-trip through the Styles sheet of the spec workbook; rows that cannot be a content rule are left out', async () => {
  const { CLIENT_FILES } = await import('../src/clients/index.ts')
  const ark = CLIENT_FILES.find((c) => c.match === 'arkanobooks')!
  const styleMap = { ...ark.styleMap, kt: { match: '^KT$', role: 'chapter-title', class: 'kt' } }
  const sheets = readXlsx(writeXlsx(markupSheets({ markup: {}, styleMap })))
  const styles = sheets.find((s) => s.name === 'Styles')!
  assert.deepEqual(styles.rows[0], STYLES_HEAD)
  const back = layerDataFromWorkbook(sheets)!
  const sort = (m: Record<string, unknown>) => Object.values(m).map((v) => JSON.stringify(v)).sort()
  assert.deepEqual(sort(back.styleMap), sort(styleMap), 'every rule comes back as written, content rules with their pattern, layout and inset')
  const k = Object.keys(back.styleMap).find((x) => back.styleMap[x].class === 'extract1')!
  assert.match(back.sources![k].text, /hanging, inset ≥ 40px → extract1/)
  // a content rule needs a class, a pattern that compiles and a known layout; an old three-column sheet still reads
  const rows = [STYLES_HEAD, ['', 'p', '', '^Hola', '', ''], ['', 'p', 'x', '^(bad', '', ''], ['', 'p', 'y', '^Ok', 'sideways', ''], ['', 'p', 'z', '^Ok', '', 'deep'], ['', 'p', 'web', '^Web:', '', '']]
  assert.deepEqual(Object.values(layerDataFromWorkbook([{ name: 'Styles', rows }])!.styleMap), [{ match: '', role: 'p', text: '^Web:', class: 'web' }])
  assert.deepEqual(Object.values(layerDataFromWorkbook([{ name: 'Styles', rows: [['Source style', 'Means (role)', 'Output class'], ['KT', 'chapter-title', 'kt']] }])!.styleMap), [{ match: 'KT', role: 'chapter-title', class: 'kt' }])
})
