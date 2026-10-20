// Phase 5: part titles and picture wrappers are templated roles, like chapter titles and note calls.
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { text, unzip, bytes } from '../src/engine/zip.ts'
import { analyze, build } from '../src/engine/indesign/build.ts'
import { setSettings, DEFAULT_SETTINGS, type HouseSettings } from '../src/engine/settings.ts'
import { conformance } from '../src/engine/check/conform.ts'
import { sampleRole, parseMarkupSample, sampleOf, markupSheets, layerDataFromWorkbook, layerDataFromReport } from '../src/engine/spec/markup.ts'
import { synthExport, SYNTH_CSS } from './synth.ts'
import { epubcheck } from './epubcheck.ts'

afterEach(() => setSettings(DEFAULT_SETTINGS))

/** PNG header only: enough for the size reader */
const png = (w: number, h: number) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, w >> 24, (w >> 16) & 255, (w >> 8) & 255, w & 255, h >> 24, (h >> 16) & 255, (h >> 8) & 255, h & 255])
const cover = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))
const css = `${SYNTH_CSS}\np.Teil { font-size:2.5em; text-align:center; font-family:"Sans", sans-serif; }
p.TeilT { font-size:2em; text-align:center; font-family:"Sans", sans-serif; }\n`
const long = (t: string) => `<p class="Cuerpo">${`${t} `.repeat(30)}</p>`

function book(s: Partial<HouseSettings>) {
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
  const a = analyze(files)
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
