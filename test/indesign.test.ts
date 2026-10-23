// Regression test: rebuild the Cambia tu mente sample and compare with the hand-finished EPUB
// in Automation/Indesin-to-EPUB-Automation/Output. Skipped when the samples are not present.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { unzip, text } from '../src/engine/zip.ts'
import { analyze, build } from '../src/engine/indesign/build.ts'
import { readPrintPages } from '../src/engine/pdf/pages.ts'
import { INDD, has, read } from './samples.ts'
import { epubcheck } from './epubcheck.ts'
import { synthExport } from './synth.ts'
import { PNG } from './fixtures/indesign-export.ts'

const input = resolve(INDD, 'Input/88228-02 Cambia tu mente.zip')
const reference = resolve(INDD, 'Output/Cambia tu mente.epub')

const words = (html: string) =>
  html.replace(/^[\s\S]*?<body>|<\/body>[\s\S]*$/g, '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ')
    .toLocaleLowerCase().split(/\s+/).filter(Boolean)
/** multiset word overlap, 1 = same words */
function similarity(a: string[], b: string[]) {
  const count = new Map<string, number>()
  for (const w of a) count.set(w, (count.get(w) ?? 0) + 1)
  let common = 0
  for (const w of b) if ((count.get(w) ?? 0) > 0) (common++, count.set(w, count.get(w)! - 1))
  return a.length + b.length ? (2 * common) / (a.length + b.length) : 1
}
const pages = (files: Map<string, Uint8Array>) =>
  [...files].filter(([p]) => p.endsWith('.xhtml') && !p.endsWith('nav.xhtml'))
    .flatMap(([, d]) => [...text(d).matchAll(/id="page-(\d+)"/g)].map((m) => Number(m[1]))).sort((a, b) => a - b)

test('InDesign export → house EPUB matches the hand-finished reference', { skip: !has(input) && 'samples missing' }, async () => {
  const a = analyze(unzip(read(input)))
  assert.equal(a.meta.title, 'Cambia tu mente')
  assert.equal(a.meta.authors, 'RJ Spina')
  assert.equal(a.meta.printIsbn, '979-13-88228-02-5')
  const ref = unzip(read(reference))
  const printPages = await readPrintPages(pdfjs as never, read(resolve(INDD, 'Input/88228-02 Cambia tu mente.pdf')))
  const r = build(a, {
    styles: a.styles, images: a.images, printPages,
    meta: { ...a.meta, eisbn: '979-13-88228-26-1' },
    cover: { name: 'cover.jpg', data: ref.get('OEBPS/images/cover.jpg')! },
  })

  assert.deepEqual(r.review.filter((x) => x.level === 'error'), [], 'no validation errors')
  const refDocs = [...ref.keys()].filter((p) => /OEBPS\/\w+\.xhtml$/.test(p) && !p.endsWith('nav.xhtml')).sort()
  const genDocs = [...r.files.keys()].filter((p) => /OEBPS\/\w+\.xhtml$/.test(p) && !p.endsWith('nav.xhtml')).sort()
  assert.deepEqual(genDocs, refDocs, 'same content documents')
  for (const p of refDocs) {
    const sim = similarity(words(text(ref.get(p)!)), words(text(r.files.get(p)!)))
    assert.ok(sim >= 0.97, `${p}: text similarity ${sim.toFixed(3)}`)
  }
  assert.deepEqual(pages(r.files), pages(ref), 'same page markers')
  const notes = (f: Map<string, Uint8Array>) => [...f.values()].map(text).join('').match(/epub:type="footnote"/g)?.length
  assert.equal(notes(r.files), notes(ref), 'same number of footnotes')

  // client feedback 25-9-26 (chapter 2), as in the hand-finished reference:
  const ch2 = text(r.files.get('OEBPS/chapter02.xhtml')!)
  assert.match(ch2, /<section[^>]*>\n<div xml:lang="es-ES">/, 'content wrapped in <div xml:lang>')
  assert.match(ch2, /<h2 class="Antetitulo_SUPER" id="chap2" role="heading" aria-level="2">/, 'role="heading" (with aria-level, which EPUBCheck requires)')
  assert.match(ch2, /<h3 class="Ladillo-2">H<span class="small-caps">ÁBITO<\/span> 5: B<span class="small-caps">USCAR SEGURIDAD<\/span><\/h3>/, 'numbered heading series keeps small caps')
  assert.match(ch2, /<p class="extract1">«Mi poder y mi independencia se elevan,<\/p>\n<p class="extract2">Mi <span class="small-caps">YO SOY<\/span>/, 'verse set as extract1/extract2')
  for (const [p, d] of r.files) if (/\.xhtml$/.test(p)) assert.equal((text(d).match(/<div xml:lang=/g) ?? []).length, 1, `${p} has one language wrapper`)

  const ec = epubcheck(r.epub)
  if (ec) assert.deepEqual(ec.errors, [], 'EPUBCheck reports no errors')
  else console.log('EPUBCheck not installed in tools/: skipped')
})

// ---- phase 3: evidence and confidence ------------------------------------------------------------------
test('detection: every style keeps its evidence; agreeing signals raise the confidence, a lone weak one stays under 0.6', async () => {
  const { decide, evidence, crossChecks } = await import('../src/engine/structure/score.ts')
  const { nameRole } = await import('../src/engine/structure/dict.ts')
  const strong = decide([evidence('tag', 'chapter-title', 'h1'), evidence('name', 'chapter-title', 'Kapitelüberschrift'), evidence('contents', 'chapter-title', 'listed')])
  assert.equal(strong.action, 'silent')
  const weak = decide([evidence('typography', 'h3', 'bold sans')])
  assert.equal(weak.action, 'blocked')
  const split = decide([evidence('tag', 'chapter-title', 'h1'), evidence('name', 'h3', 'ZT')], 'chapter-title')
  assert.ok(split.confidence < strong.confidence)
  assert.equal(nameRole('KT')?.[0], 'drop')
  assert.equal(nameRole('Kapitelzahl')?.[0], 'chapter-label')
  // the German abbreviation table: body text, captions, quotations, notes, boxes stay text with their own class
  for (const k of ['Grundtext', 'GT', 'Fliesstext', 'BU', 'BU-2', 'Bildnachweis', 'Zitat', 'Motto', 'FN-Text', 'Anmerkung', 'Kasten', 'Marginalie', 'Initial', 'Vorspann']) assert.equal(nameRole(k)?.[0], 'p', k)
  assert.match(nameRole('BU')![2], /caption/)
  assert.equal(nameRole('ZT2')?.[0], 'h3')
  assert.equal(nameRole('Zwischentitel-1')?.[0], 'h3')
  assert.equal(nameRole('Buch'), undefined, 'a name only starts like one is not matched')
  assert.equal(nameRole('Text'), undefined)
  assert.equal(crossChecks([{ type: 'chapter', nav: 'A', words: 20 }, { type: 'chapter', nav: 'B', words: 900 }, { type: 'chapter', nav: 'C', words: 900 }, { type: 'chapter', nav: 'D', words: 900 }]).length, 1)
})

test('Cambia with the Arkano client layer: the reference’s own class names and the bare note call', { skip: !has(input) && 'samples missing' }, async () => {
  const { openSpec, applySpec } = await import('../src/engine/spec/session.ts')
  const { DEFAULT_SETTINGS } = await import('../src/engine/settings.ts')
  const a = analyze(unzip(read(input)))
  applySpec(await openSpec({ client: a.meta.publisher, series: '', book: 'Cambia tu mente' }, DEFAULT_SETTINGS))
  const ref = unzip(read(reference))
  const r = build(a, { styles: a.styles, images: a.images, meta: { ...a.meta, eisbn: '979-13-88228-26-1' }, cover: { name: 'cover.jpg', data: ref.get('OEBPS/images/cover.jpg')! } })
  const classOf = (files: Map<string, Uint8Array>, snippet: string) => [...files].filter(([p]) => p.endsWith('.xhtml')).map(([, d]) => text(d).match(new RegExp(`<p class="([^"]+)"[^>]*>(?:<[^>]+>)*${snippet}`))?.[1]).find(Boolean)
  for (const s of ['Sí = 1 punto', 'Suma tus puntuaciones:']) assert.equal(classOf(r.files, s), classOf(ref, s), s)
  const intro = text(r.files.get('OEBPS/intro.xhtml')!)
  assert.doesNotMatch(intro, /<sup>\s*<a epub:type="noteref"/)
  assert.match(intro, /<a epub:type="noteref" href="#fn-01"/)
  assert.match(text(r.files.get('OEBPS/app.xhtml')!), /class="num1"/)
  const ec = epubcheck(r.epub)
  if (ec) assert.deepEqual(ec.errors, [], ec.output)
})

test('HD-09: styles that only look like headings take h3 by default, or a level by size rank', { skip: !has(input) && 'samples missing' }, async () => {
  const { setSettings, DEFAULT_SETTINGS } = await import('../src/engine/settings.ts')
  const levels = (m: 'one' | 'size') => {
    setSettings({ ...DEFAULT_SETTINGS, headingLevels: m })
    return Object.fromEntries(analyze(unzip(read(input))).styles.filter((s) => /^h\d/.test(s.role)).map((s) => [s.key, s.role]))
  }
  assert.deepEqual(Object.values(levels('one')), ['h3', 'h3', 'h3'])
  const by = levels('size')
  assert.equal(by['Ladillo-1'], 'h3', 'the biggest')
  assert.ok(by['Ladillo-2'] > by['Ladillo-1'], 'the smallest sits deeper')
  setSettings(DEFAULT_SETTINGS)
})

test('note numbers under an in-chapter Notes heading: a bold "1." stays well-formed and a page marker before "2" is kept', () => {
  const css = `
p.text { font-size: 1em; font-family: "Minion Pro", serif; text-align: justify; }
h1.h1 { font-size: 2.5em; font-family: "Veneer", sans-serif; }
p.h2 { font-size: 1.17em; font-family: "Hero", sans-serif; margin-top: 12px; font-weight:bold; }
p.impressum { font-size: 0.7em; }
p.tt { font-size: 2em; text-align:center; }
span.sup { vertical-align: super; }
span.b { font-weight: bold; }
`
  const pb = (n: number) => `<span epub:type="pagebreak" id="page${n}" role="doc-pagebreak" aria-label="${n}" title="${n}"/>`
  const long = (t: string) => `<p class="text">${`${t} `.repeat(40)}</p>`
  const body = [
    pb(1), '<p class="tt">Sample Book</p>', '<p class="tt">Anna Writer</p>',
    pb(2), '<p class="impressum">© 2020 Example Press</p>', '<p class="impressum">ISBN 978-3-16-148410-0</p>',
    pb(3), '<h1 class="h1">Alpha</h1>',
    `<p class="text">Alpha one<span class="sup">1</span> and two<span class="sup">2</span>. ${'More words follow. '.repeat(40)}</p>`,
    long('Alpha continues for a while with ordinary sentences.'),
    '<p class="h2">Notes</p>',
    '<p class="text"><span class="b">1.</span> First note text.</p>',
    `<p class="text">${pb(4)}2 Second note text.</p>`,
    pb(5), '<h1 class="h1">Beta</h1>', long('Beta goes on and on.'), long('Beta more.'),
  ].join('\n')
  const a = analyze(synthExport(body, css, 'en-GB'))
  const r = build(a, { styles: a.styles, images: a.images, meta: { ...a.meta, title: 'Sample Book', authors: 'Anna Writer', publisher: 'Example Press', eisbn: '9780306406157', language: 'en-GB' }, cover: { name: 'c.png', data: PNG } })
  const [, ch] = [...r.files].find(([p]) => /chapter01\.xhtml$/.test(p))!
  const t = text(ch)
  assert.equal(new DOMParser().parseFromString(t, 'application/xhtml+xml').getElementsByTagName('parsererror').length, 0, t.slice(t.indexOf('<body')))
  assert.match(t, /id="[^"]*-n1"/)
  assert.match(t, /id="page-4"/, 'the page marker at the start of note 2 is kept')
})
