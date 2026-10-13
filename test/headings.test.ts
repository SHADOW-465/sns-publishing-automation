// Heading and contents detection from the book's own tags, style names and contents page.
// No title list: a synthetic export plus the Tempelhofer Feld sample when it is on disk.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { text, unzip } from '../src/engine/zip.ts'
import { analyze, build } from '../src/engine/indesign/build.ts'
import { synthExport } from './synth.ts'

const cover = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))
const css = `
p.text { font-size: 1em; font-family: "Minion Pro", serif; text-align: justify; }
h1.h1 { font-size: 2.5em; font-family: "Veneer", sans-serif; }
p.h2 { font-size: 1.17em; font-family: "Hero", sans-serif; margin-top: 6px; }
p.ihv1 { font-size: 1.08em; font-family: "Veneer", sans-serif; }
p.ihv2 { font-size: 0.75em; font-family: "Hero", sans-serif; }
p.impressum { font-size: 0.7em; font-family: "Minion Pro", serif; }
p.Inhalt { font-size: 1.2em; text-align: center; }
`
const para = (t: string) => `<p class="text">${t}</p>`
const long = (t: string) => para(`${t} `.repeat(40))

function book() {
  const body = [
    para('Sample Book'),
    '<p class="Inhalt">Contents</p>',
    '<p class="ihv1">Alpha<span class="optisch"><span class="ihv-seitenzahl">3</span></span></p>',
    '<p class="ihv2">The fields</p>',
    '<p class="ihv1">Beta<span class="ihv-seitenzahl">4</span></p>',
    '<p class="ihv2">The harbour</p>',
    '<p class="ihv1">Gamma<span class="ihv-seitenzahl">5</span></p>',
    '<p class="ihv2">Notes</p>',
    '<span epub:type="pagebreak" id="page3" role="doc-pagebreak" aria-label="3" title="3"/>',
    '<h1 class="h1">Alpha</h1>',
    '<p class="h2">The fields</p>',
    long('Alpha tells how the field became a park, and mentions www.example.test and a local GmbH twice so a careless imprint test must not swallow it.'),
    '<span epub:type="pagebreak" id="page4" role="doc-pagebreak" aria-label="4" title="4"/>',
    '<h1 class="h1">Beta</h1>',
    '<p class="h2">The harbour</p>',
    long('Beta is the long middle of the book, with another www.example.test and GmbH mention that still belongs to the chapter.'),
    '<span epub:type="pagebreak" id="page5" role="doc-pagebreak" aria-label="5" title="5"/>',
    '<h1 class="h1">Gamma</h1>',
    long('Gamma closes the story.'),
    '<p class="h2">Notes</p>',
    para('A note that stays with the notes section.'),
    '<p class="impressum">© 2020 Example Press</p>',
    '<p class="impressum">ISBN 978-3-16-148410-0</p>',
  ].join('\n')
  const a = analyze(synthExport(body, css, 'en-GB'))
  return build(a, {
    styles: a.styles, images: a.images,
    meta: { ...a.meta, title: 'Sample Book', authors: 'A. Writer', publisher: 'Example Press', eisbn: '9780306406157', language: 'en-GB' },
    cover: { name: 'cover.png', data: cover },
  })
}

test('styles named h1/h2 and a contents page become chapters, not the copyright page', () => {
  const r = book()
  const chapters = r.sections.filter((s) => s.type === 'chapter')
  assert.deepEqual(chapters.map((s) => s.nav), ['Alpha', 'Beta', 'Gamma'])
  assert.match(text(r.files.get('OEBPS/chapter01.xhtml')!), /<h1 [^>]*class="h1"/)
  assert.match(text(r.files.get('OEBPS/chapter01.xhtml')!), /<h2 [^>]*class="h2"/)
  assert.match(text(r.files.get('OEBPS/chapter01.xhtml')!), /epub:type="chapter"/)
  const copy = r.sections.find((s) => s.type === 'copyright')
  assert.ok(copy, 'imprint style becomes the copyright page')
  assert.doesNotMatch(text(r.files.get(`OEBPS/${copy!.file}`)!), /Alpha tells how/)
  const beta = r.sections.find((s) => s.nav === 'Beta')!
  assert.equal(beta.type, 'chapter')
  assert.match(text(r.files.get(`OEBPS/${beta.file}`)!), /epub:type="chapter"/)
  const nav = text(r.files.get('OEBPS/nav.xhtml')!)
  for (const name of ['Alpha', 'Beta', 'Gamma']) assert.match(nav, new RegExp(`<a href="chapter\\d+\\.xhtml">${name}</a>`))
  assert.match(nav, /epub:type="bodymatter"/)
  const spine = text(r.files.get('OEBPS/content.opf')!).match(/<itemref idref="[^"]+"/g)!.map((s) => s.replace(/.*idref="([^"]+)".*/, '$1'))
  const ch = spine.filter((id) => /^chapter/.test(id))
  assert.deepEqual(ch, ['chapter01', 'chapter02', 'chapter03'])
  const ordered = spine.flatMap((id) => {
    const file = [...r.files.keys()].find((p) => p.endsWith(`/${id}.xhtml`))
    return file ? [...text(r.files.get(file)!).matchAll(/id="page-(\d+)"/g)].map((m) => Number(m[1])) : []
  })
  const sorted = [...ordered].sort((a, b) => a - b)
  assert.deepEqual(ordered, sorted, `page-list order ${ordered.join(',')}`)
})

const sample = resolve('..', 'corrections', 'Indesign-Tempelhofer_Feld_Inhalt_de9fa898-27c3-45dc-838c-2e847d2fa889.epub')
const CHAPTERS = ['Vom Ackerland zum Freizeitpark', 'Natur', 'Sport', 'Militär', 'Luftfahrt', 'Migration', 'Architektur', 'Freizeit', 'Politik', 'Zukunft']

test('Tempelhofer Feld: ten chapters, Luftfahrt is not the imprint, spine and page-list stay in order', { skip: !existsSync(sample) && 'sample missing' }, () => {
  const a = analyze(unzip(readFileSync(sample)))
  assert.equal(a.styles.find((s) => s.key === 'h1')?.role, 'chapter-title')
  assert.equal(a.styles.find((s) => s.key === 'h2')?.role, 'h2')
  assert.equal(a.styles.find((s) => s.key === 'ihv1')?.role, 'toc')
  assert.equal(a.styles.find((s) => s.key === 'impressum')?.role, 'imprint')
  const r = build(a, {
    styles: a.styles, images: a.images,
    meta: { ...a.meta, eisbn: '9783814803562' },
    cover: { name: 'cover.png', data: cover },
  })
  const chapters = r.sections.filter((s) => s.type === 'chapter')
  assert.deepEqual(chapters.map((s) => s.nav), CHAPTERS)
  const luft = chapters.find((s) => s.nav === 'Luftfahrt')!
  const html = text(r.files.get(`OEBPS/${luft.file}`)!)
  assert.match(html, /<h1 [^>]*>Luftfahrt<\/h1>/)
  assert.match(html, /epub:type="chapter"/)
  assert.doesNotMatch(html, /epub:type="copyright-page"/)
  const copy = r.sections.filter((s) => s.type === 'copyright')
  assert.equal(copy.length, 1)
  const copyHtml = text(r.files.get(`OEBPS/${copy[0].file}`)!)
  assert.match(copyHtml, /Impressum|978-3-8148-0356-2|9783814803562/)
  assert.doesNotMatch(copyHtml, /<h1[^>]*>Luftfahrt/)
  assert.ok(copyHtml.length < 20000, 'copyright page is the imprint, not a chapter range')
  const nav = text(r.files.get('OEBPS/nav.xhtml')!)
  for (const name of CHAPTERS) assert.match(nav, new RegExp(`<a href="chapter\\d+\\.xhtml">${name}</a>`))
  const bm = nav.match(/epub:type="bodymatter" href="([^"]+)"/)
  assert.ok(bm, 'landmarks mark where the text starts')
  assert.match(bm![1], /^chapter01\.xhtml/)
  const opf = text(r.files.get('OEBPS/content.opf')!)
  const spine = [...opf.matchAll(/<itemref idref="([^"]+)"/g)].map((m) => m[1])
  assert.deepEqual(spine.filter((id) => /^chapter\d+$/.test(id)), CHAPTERS.map((_, i) => `chapter${String(i + 1).padStart(2, '0')}`))
  const ordered: number[] = []
  for (const id of spine) {
    const file = [...r.files.keys()].find((p) => p.endsWith(`/${id}.xhtml`))
    if (!file) continue
    for (const m of text(r.files.get(file)!).matchAll(/id="page-(\d+)"/g)) ordered.push(Number(m[1]))
  }
  for (let i = 1; i < ordered.length; i++) assert.ok(ordered[i] >= ordered[i - 1], `page ${ordered[i]} follows ${ordered[i - 1]}`)
  assert.ok(r.sections.some((s) => s.type === 'notes'))
  assert.ok(r.sections.some((s) => s.type === 'bibliography'))
})
