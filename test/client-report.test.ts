// The client's review of the Tempelhofer Feld EPUB (EPUB-Automation-Report, 15-10-26): twelve points,
// each tested as a general rule on a small synthetic InDesign export, and once more on the real book when it is on disk.
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { text, unzip, type Files } from '../src/engine/zip.ts'
import { analyze, build, inPrintOrder } from '../src/engine/indesign/build.ts'
import { setSettings, settings, DEFAULT_SETTINGS, type HouseSettings } from '../src/engine/settings.ts'
import { openSpec, applySpec } from '../src/engine/spec/session.ts'
import { labelsFor } from '../src/engine/epub/locale.ts'
import { blockBoundary, insertAtMarker } from '../src/engine/epub/insert.ts'
import { bundledLayer } from '../src/engine/spec/clients.ts'
import { tocPageOf } from '../src/engine/indesign/inline.ts'
import { checkEpubBytes } from '../src/engine/check/epub.ts'
import { epubcheck, localValidator } from './epubcheck.ts'
import { refdiff } from '../src/engine/check/refdiff.ts'
import { synthExport } from './synth.ts'
import type { PrintPage } from '../src/engine/pdf/pages.ts'

afterEach(() => setSettings(DEFAULT_SETTINGS))

const cover = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))
const css = `
p.text { font-size: 1em; font-family: "Minion Pro", serif; text-align: justify; }
p.tt { font-size: 1em; font-family: "Minion Pro", serif; text-align: center; }
h1.h1 { font-size: 2.5em; font-family: "Veneer", sans-serif; }
p.h2 { font-size: 1.17em; font-family: "Hero", sans-serif; margin-top: 6px; }
p.ihv1 { font-size: 1.08em; font-family: "Veneer", sans-serif; }
p.ihv2 { font-size: 0.75em; font-family: "Hero", sans-serif; }
p.impressum { font-size: 0.7em; font-family: "Minion Pro", serif; }
p.Inhalt { font-size: 1.2em; text-align: center; }
p.BU { font-size: 0.63em; font-family: "Hero", sans-serif; text-align: left; }
p.FN-Text { font-size: 0.75em; font-family: "Minion Pro", serif; }
p.ParaOverride-2 { text-align: right; }
span.CharOverride-1 { font-family: "Veneer", sans-serif; font-size: 5.9em; }
span.CharOverride-4 { font-family: "New Hero Regular"; font-size: 1.1em; text-transform: uppercase; }
`
const para = (t: string) => `<p class="text">${t}</p>`
const long = (t: string) => para(`${t} `.repeat(40))
const pb = (n: number) => `<span epub:type="pagebreak" id="page${n}" role="doc-pagebreak" aria-label="${n}" title="${n}"/>`
const endRef = (n: number) => `<span class="ENzeichen"><a class="_idEndnoteLink" role="doc-noteref" epub:type="noteref" href="book.xhtml#endnote-00${n}"><span id="endnote-00${n}-backlink">${n}</span></a></span>`
const endNote = (n: number, t: string) =>
  `<li id="endnote-00${n}" class="FN-Text"><p class="FN-Text"><a class="_idEndnoteAnchor" role="doc-backlink" href="book.xhtml#endnote-00${n}-backlink"><span>${n}</span></a>&#9;${t}</p></li>`

function exportBody(): string {
  return [
    pb(1),
    '<p class="text ParaOverride-2"><span class="CharOverride-1">Sample Book</span></p>',
    pb(2),
    // the export writes the publisher and the author after the title; in print the author is on top
    '<p class="text ParaOverride-2"><span class="CharOverride-1">Sample Book</span></p>',
    '<p class="text ParaOverride-2"><span class="CharOverride-4">Example Press</span></p>',
    '<p class="text ParaOverride-2"><span class="CharOverride-4">Anna Writer</span></p>',
    pb(3),
    '<p class="Inhalt">Contents</p>',
    '<p class="ihv1">Alpha<span class="optisch"><span class="ihv-seitenzahl">5</span></span></p>',
    '<p class="ihv2">The fields</p>',
    '<p class="ihv1">Beta<span class="optisch">1</span><span class="optisch">21</span></p>',
    '<p class="ihv2">Years from <span class="optisch">1800</span> to now</p>',
    '<p class="ihv2">Notes<span class="optisch"><span class="ihv-seitenzahl">9</span></span></p>',
    pb(5),
    '<h1 class="h1">Alpha</h1>',
    '<p class="h2">The fields</p>',
    para(`Alpha tells how the field became a park.${endRef(1)} `.repeat(1) + 'More words follow. '.repeat(40)),
    long('Alpha continues for a while with ordinary sentences about the field and its use.'),
    pb(6),
    long('A second page of Alpha so the chapter is longer than a few lines.'),
    pb(7),
    '<h1 class="h1">Beta</h1>',
    '<p class="h2">Years from <span class="optisch">1800</span> to now</p>',
    para(`Beta begins here.${endRef(2)} ` + 'More words follow. '.repeat(40)),
    long('Beta goes on and on with sentences about the harbour and the people of the town.'),
    pb(9),
    '<p class="h2">Notes</p>',
    '<section class="Basic-Text-Frame" role="doc-endnotes" epub:type="endnotes"><ol>',
    endNote(1, 'First note text.'),
    endNote(2, 'Second note text.'),
    '</ol></section>',
    '<p class="impressum">© 2020 Example Press</p>',
    '<p class="impressum">ISBN 978-3-16-148410-0</p>',
  ].join('\n')
}

const pages: PrintPage[] = [
  { n: '1', text: 'Sample Book', blank: false, lines: [{ text: 'Sample Book', x0: 91, x1: 349 }], pdfPage: 1 },
  {
    // the export's page marker on the title page is page 2 (the break that opens it)
    n: '2', text: 'Anna Writer Sample Book Example Press', blank: false, pdfPage: 2,
    // top to bottom, as printed: the author first, the publisher last, all flush right
    lines: [{ text: 'ANNA WRITER', x0: 247, x1: 349 }, { text: 'Sample Book', x0: 91, x1: 349 }, { text: 'Example Press', x0: 273, x1: 349 }],
  },
]

// The twelve review rules, as a house would turn them on. Defaults stay compatible with earlier books;
// this file (and the BeBra client layer) is where the review's markup is requested.
const REVIEW: Partial<HouseSettings> = { chapterTag: 'h2', chapterHeadingClass: 'chapter-b', navSubtitle: true }

function book(s: Partial<HouseSettings> = {}, exp: () => Files = () => synthExport(exportBody(), css, 'de-DE'), printPages?: PrintPage[]) {
  setSettings({ ...REVIEW, ...s })
  const a = analyze(exp())
  const r = build(a, {
    styles: a.styles, images: a.images, printPages,
    meta: { ...a.meta, title: 'Sample Book', authors: 'Anna Writer', publisher: 'Example Press', eisbn: '9780306406157', language: 'de-DE' },
    cover: { name: 'cover.png', data: cover },
  })
  const f = (name: string) => text(r.files.get(`OEBPS/${name}`)!)
  return { r, f, css: f('css/style.css') }
}

const BEBRA = async () => {
  const spec = await openSpec({ client: 'BeBra Verlag GmbH', series: '', book: '9780306406157' }, DEFAULT_SETTINGS)
  applySpec(spec)
  return settings()
}

// ---- 7: the language is declared once ------------------------------------------------------------
test('7: every page declares its language once, on <html>, as xml:lang', () => {
  const { r } = book()
  for (const [p, d] of r.files) {
    if (!p.endsWith('.xhtml')) continue
    const html = text(d).match(/<html[^>]*>/)![0]
    assert.equal((html.match(/lang=/g) ?? []).length, 1, `${p}: ${html}`)
    assert.match(html, /xml:lang="de-DE"/, p)
  }
})

// ---- 8: names on every page ----------------------------------------------------------------------
test('8: every page has an accessible name; the nav lists are named by headings, or on <nav> when the rule says so', () => {
  const { r } = book()
  for (const [p, d] of r.files) {
    if (!p.endsWith('.xhtml')) continue
    const html = text(d)
    assert.match(html, /<section [^>]*aria-label(?:ledby)?="[^"]+"/, `${p} has a named section`)
  }
  const nav = text(r.files.get('OEBPS/nav.xhtml')!)
  assert.match(nav, /<section aria-labelledby="toc01" epub:type="frontmatter">/)
  assert.doesNotMatch(nav, /<nav [^>]*aria-label/, 'EPUBCheck 5.4 rejects a name on <nav>')
  assert.match(nav, /<h2 id="pagelist01">/)
  assert.match(nav, /<h2 id="landmarks01">/)
  const onNav = text(book({ navLabelOn: 'nav' }).r.files.get('OEBPS/nav.xhtml')!)
  assert.match(onNav, /<nav aria-labelledby="toc01" epub:type="toc" id="toc" role="doc-toc">/)
  assert.match(onNav, /<nav aria-labelledby="pagelist01" epub:type="page-list"/)
})

// ---- 9, 11: the package -------------------------------------------------------------------------
test('9, 11: the package declares the opf namespace and a toc reference; the TDM reservation only when the rule is on', () => {
  const { f } = book()
  const opf = f('content.opf')
  assert.match(opf, /<metadata xmlns:dc="http:\/\/purl\.org\/dc\/elements\/1\.1\/" xmlns:opf="http:\/\/www\.idpf\.org\/2007\/opf">/)
  assert.match(opf, /<meta property="dcterms:dateCopyrighted">2020<\/meta>|<dc:rights>/)
  assert.match(opf, /<reference type="toc" title="[^"]+" href="toc\.xhtml"\/>/, 'the guide points at the printed contents page')
  assert.doesNotMatch(opf, /tdm/)
  const reserved = book({ tdmReservation: 'reserved' }).f('content.opf')
  assert.match(reserved, /<package [^>]*prefix="tdm: http:\/\/www\.w3\.org\/ns\/tdmrep#"/)
  assert.match(reserved, /<meta property="tdm:reservation">1<\/meta>/)
})

test('11: a book without a printed contents page points the guide at the navigation document', () => {
  const body = exportBody().replace(/<p class="Inhalt">[\s\S]*?(?=<span epub:type="pagebreak" id="page5")/, '')
  const { f } = book({}, () => synthExport(body, css, 'de-DE'))
  assert.match(f('content.opf'), /<reference type="toc" title="[^"]+" href="(nav|toc)\.xhtml"\/>/)
})

// ---- 10: the cover title is a client rule -------------------------------------------------------
test('10: the cover page title is a configurable client label, not a hardcoded word', async () => {
  assert.equal(labelsFor('de-DE').coverTitle, 'Umschlag', 'default: the cover word')
  const plain = book()
  assert.match(plain.f('cover.xhtml'), /<title>Umschlag<\/title>/)
  assert.match(plain.f('content.opf'), /<reference type="cover" title="Umschlag"/)
  assert.match(plain.f('nav.xhtml'), /<a href="cover\.xhtml#cimg">Umschlag<\/a>/, 'default: the menu uses the cover word')
  assert.match(plain.f('nav.xhtml'), /<a epub:type="cover" href="cover\.xhtml">Umschlag<\/a>/)
  assert.match(plain.f('toc.ncx'), /<navLabel><text>Umschlag<\/text><\/navLabel><content src="cover\.xhtml#cimg"\/>/)
  const layer = bundledLayer('client', 'BeBra Verlag GmbH')!
  assert.equal(layer.labels?.de?.coverTitle, 'Abdeckung')
  assert.equal(bundledLayer('client', 'BeBra'), undefined, 'matches the client, not any name that starts alike')
  assert.equal(bundledLayer('client', 'Editorial Sirio'), undefined)
  await BEBRA()
  const { f } = book(settings())
  assert.match(f('cover.xhtml'), /<title>Abdeckung<\/title>/)
  assert.match(f('cover.xhtml'), /<section aria-label="Abdeckung" epub:type="cover">/)
  assert.match(f('nav.xhtml'), /<a href="cover\.xhtml#cimg">Abdeckung<\/a>/)
  assert.match(f('nav.xhtml'), /<a epub:type="cover" href="cover\.xhtml">Abdeckung<\/a>/)
  assert.doesNotMatch(f('nav.xhtml'), /Umschlag/)
  assert.match(f('toc.ncx'), /<navLabel><text>Abdeckung<\/text><\/navLabel><content src="cover\.xhtml#cimg"\/>/)
  assert.doesNotMatch(f('toc.ncx'), /Umschlag/)
  assert.match(f('content.opf'), /<reference type="cover" title="Abdeckung"/)
})

// ---- 4: chapter titles are headings --------------------------------------------------------------
test('4: a chapter title is an h2 with class chapter-b, never a classed paragraph', () => {
  const { f, css } = book()
  const ch = f('chapter01.xhtml')
  assert.match(ch, /<h2 class="chapter-b" id="chap1" role="heading" aria-level="2">Alpha<\/h2>/)
  assert.doesNotMatch(ch, /<p class="h1"|<h1/)
  assert.match(css, /h2\.chapter-b\n\{/)
  assert.match(book({ chapterTag: 'source', chapterHeadingClass: 'style' }).f('chapter01.xhtml'), /<h1 class="h1" id="chap1"/)
})

// ---- 1, 3: navigation and contents page ----------------------------------------------------------
test('1: nav.xhtml and toc.ncx list every chapter, with the subtitle the printed contents gives it', () => {
  const { f, r } = book()
  assert.deepEqual(r.sections.filter((s) => s.type === 'chapter').map((s) => s.nav), ['Alpha: The fields', 'Beta: Years from 1800 to now'])
  const nav = f('nav.xhtml')
  assert.match(nav, /<li><a href="chapter01\.xhtml">Alpha: The fields<\/a><\/li>/)
  assert.match(nav, /<li><a href="chapter02\.xhtml">Beta: Years from 1800 to now<\/a><\/li>/)
  assert.match(f('toc.ncx'), /<navLabel><text>Alpha: The fields<\/text><\/navLabel><content src="chapter01\.xhtml"\/>/)
  assert.match(f('chapter01.xhtml'), /<title>Alpha: The fields<\/title>/)
  assert.deepEqual(book({ navSubtitle: false }).r.sections.filter((s) => s.type === 'chapter').map((s) => s.nav), ['Alpha', 'Beta'])
})

test('3: the contents page keeps its page numbers beside the entries, right-aligned, and a number inside a title stays text', async () => {
  await BEBRA()
  const { f, css } = book(settings())
  const toc = f('toc.xhtml')
  assert.match(toc, /<p class="toc_1a"><a href="chapter01\.xhtml">Alpha<\/a><span class="toc_pg">5<\/span><\/p>/)
  assert.match(toc, /<p class="toc_1s"><a href="chapter01\.xhtml#sec1">The fields<\/a><\/p>/)
  assert.match(toc, /<a href="chapter02\.xhtml">Beta<\/a><span class="toc_pg">121<\/span>/, 'a number split over two spans is joined')
  assert.match(toc, /Years from 1800 to now/, 'the year in the title is not taken for a page number')
  assert.match(toc, /<a href="notes\.xhtml">Notes<\/a><span class="toc_pg">9<\/span>/)
  assert.match(css, /p\.toc_1, p\.toc_1t, p\.toc_1a, p\.toc_1s\n\{\ndisplay:flex;\njustify-content:space-between;/)
  assert.match(css, /span\.toc_pg\n\{/)
  // the default (no client style) leaves the numbers out, as before, but still keeps the year
  const bare = book().f('toc.xhtml')
  assert.doesNotMatch(bare, /toc_pg/)
  assert.match(bare, /Years from 1800 to now/)
})

test('3: tocPageOf reads the number at the end of an entry only', () => {
  const el = (h: string) => new DOMParser().parseFromString(`<p>${h}</p>`, 'text/html').body.firstElementChild!
  assert.equal(tocPageOf(el('Natur<span class="optisch"><span class="ihv-seitenzahl">11</span></span>')), '11')
  assert.equal(tocPageOf(el('Architektur<span class="optisch">1</span><span class="optisch">21</span>')), '121')
  assert.equal(tocPageOf(el('Von <span class="optisch">1800</span> bis heute')), undefined)
  assert.equal(tocPageOf(el('Literatur\t203')), '203')
})

// ---- 5, 12: notes -------------------------------------------------------------------------------
test('5, 12: end notes are collected on the notes page; each reference is a sup link there and each note links back', () => {
  const { f, r } = book()
  const ch1 = f('chapter01.xhtml')
  assert.match(ch1, /<sup><a epub:type="noteref" href="notes\.xhtml#fn-1" id="fn_1" role="doc-noteref">1<\/a><\/sup>/)
  assert.match(f('chapter02.xhtml'), /<sup><a epub:type="noteref" href="notes\.xhtml#fn-2" id="fn_2" role="doc-noteref">2<\/a><\/sup>/)
  assert.doesNotMatch(ch1, /doc-footnote|class="footnotes"/, 'nothing at the end of the chapter')
  const notes = f('notes.xhtml')
  assert.match(notes, /<div epub:type="footnote" id="fn-1" role="doc-footnote">\n<p class="Nota-final"><a epub:type="backlink" href="chapter01\.xhtml#fn_1" role="doc-backlink">1<\/a> First note text\.<\/p>\n<\/div>/)
  assert.match(notes, /id="fn-2"[^>]*>\n<p class="Nota-final"><a epub:type="backlink" href="chapter02\.xhtml#fn_2"/)
  assert.ok(r.sections.find((s) => s.type === 'notes')!.nav, 'the notes page stays in the menu')
  // every link target exists
  const ids = (t: string) => new Set([...t.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))
  assert.ok(ids(notes).has('fn-1') && ids(ch1).has('fn_1'))
})

test('5: a footnote (not an end note) stays under its chapter, and its reference is a sup too', () => {
  const body = exportBody()
    .replace(/<section class="Basic-Text-Frame"[\s\S]*?<\/section>/, '<div class="_idFootnotes"><aside class="_idFootnote" epub:type="footnote" id="footnote-001"><p class="FN-Text"><a class="_idFootnoteAnchor" href="book.xhtml#footnote-001-backlink">1</a> A footnote.</p></aside></div>')
    .replace(endRef(1), '<a class="_idFootnoteLink" href="book.xhtml#footnote-001" id="footnote-001-backlink">1</a>')
  const { f } = book({}, () => synthExport(body, css, 'de-DE'))
  const ch1 = f('chapter01.xhtml')
  assert.match(ch1, /<sup><a epub:type="noteref" href="#fn-01" id="fn_01" role="doc-noteref">1<\/a><\/sup>/)
  assert.match(ch1, /<div class="footnotes">[\s\S]*<div epub:type="footnote" id="fn-01" role="doc-footnote">/)
})

// ---- 2: title page -------------------------------------------------------------------------------
test('2: the title page follows the printed page: author on top, lines flush right as exported, sans where the font is sans', () => {
  const { f, css } = book({}, undefined, pages)
  const t = f('title.xhtml')
  const order = [...t.matchAll(/<(?:h1|p) [^>]*>([^<]+)</g)].map((m) => m[1])
  // CharOverride-4 is text-transform: uppercase, so the publisher is set in capitals too
  assert.deepEqual(order, ['ANNA WRITER', 'Sample Book', 'EXAMPLE PRESS'])
  assert.match(t, /<p aria-label="Autor" class="title-3-rs">/)
  assert.match(t, /<h1 aria-label="Titel" class="title_1-rs">/)
  assert.match(css, /p\.title-3-rs\n\{\nfont-size:150%;\ntext-align:right;[\s\S]*?font-family:sans-serif;/)
  // without the print PDF the export's order stays
  const unordered = [...book().f('title.xhtml').matchAll(/<(?:h1|p) [^>]*>([^<]+)</g)].map((m) => m[1])
  assert.deepEqual(unordered, ['Sample Book', 'EXAMPLE PRESS', 'ANNA WRITER'])
})

test('2: inPrintOrder only reorders when every line is found on the printed page', () => {
  const p = (t: string) => ({ t: 'p', text: t }) as never
  const items = [p('B line'), p('A line'), p('Nowhere')]
  const page = { n: '1', text: '', blank: false, pdfPage: 1, lines: [{ text: 'A line', x0: 0, x1: 1 }, { text: 'B line', x0: 0, x1: 1 }] } as PrintPage
  assert.deepEqual(inPrintOrder(items, page), items)
  assert.deepEqual((inPrintOrder(items.slice(0, 2), page) as { text: string }[]).map((x) => x.text), ['A line', 'B line'])
})

// ---- 6: pictures ---------------------------------------------------------------------------------
test('6: a picture is never put inside a paragraph; it goes to the edge of the paragraph the page marker sits in', () => {
  const m = '<span id="page-7"/>'
  const html = `<section>\n<p class="a">Before ${m}after the marker.</p>\n<p class="b">Next.</p>\n</section>`
  const re = /<span id="page-7"\/>/
  const after = insertAtMarker(html, re, '<figure>F</figure>', 'after')!
  assert.match(after, /after the marker\.<\/p>\n<figure>F<\/figure>\n<p class="b">/)
  const before = insertAtMarker(html, re, '<figure>F</figure>', 'before')!
  assert.match(before, /<section>\n<figure>F<\/figure>\n<p class="a">/)
  // a marker that opens its paragraph: the picture goes in front of that paragraph
  const lead = `<p>Old.</p>\n<p class="a">${m}Starts here.</p>`
  assert.match(insertAtMarker(lead, re, '<figure>F</figure>', 'after')!, /<p>Old\.<\/p>\n<figure>F<\/figure>\n<p class="a"><span/)
  // between blocks, the marker position itself is fine; list items and table cells are not split either
  assert.equal(blockBoundary('<div>x</div><span id="page-7"/>', 14, 'after'), 14)
  const li = '<ul>\n<li>one <span id="page-7"/>two</li>\n<li>three</li>\n</ul>'
  assert.match(insertAtMarker(li, re, '<figure>F</figure>', 'after')!, /<\/ul>\n<figure>F<\/figure>\n$/)
  assert.equal(insertAtMarker('<p>none</p>', re, 'x', 'after'), undefined)
})

// ---- the real book, when it is on disk ------------------------------------------------------------
const sample = resolve('..', 'corrections', 'Indesign-Tempelhofer_Feld_Inhalt_de9fa898-27c3-45dc-838c-2e847d2fa889.epub')
const printPdf = resolve('..', 'corrections', 'Weigel_Tempelhofer_Feld_Inhalt_print_83fe21e0-beb6-458a-a56b-d5f74054d93d.pdf')

test('Tempelhofer Feld: the twelve points of the client review hold on the real book', { skip: !existsSync(sample) && 'sample missing', timeout: 300_000 }, async () => {
  const { readPrintPages } = await import('../src/engine/pdf/pages.ts')
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const printPages = existsSync(printPdf) ? await readPrintPages(pdfjs as never, new Uint8Array(readFileSync(printPdf))) : undefined
  const a = analyze(unzip(readFileSync(sample)))
  const spec = await openSpec({ client: a.meta.publisher, series: '', book: '9783814803562' }, DEFAULT_SETTINGS)
  applySpec(spec)
  const r = build(a, { styles: a.styles, images: a.images, printPages, meta: { ...a.meta, eisbn: '9783814803562' }, cover: { name: 'cover.png', data: cover } })
  const f = (n: string) => text(r.files.get(`OEBPS/${n}`)!)
  const CHAPTERS = ['Vom Ackerland zum Freizeitpark', 'Natur', 'Sport', 'Militär', 'Luftfahrt', 'Migration', 'Architektur', 'Freizeit', 'Politik', 'Zukunft']
  // 1: nav and ncx
  const chapters = r.sections.filter((s) => s.type === 'chapter')
  assert.equal(chapters.length, 10)
  assert.match(f('nav.xhtml'), /<a href="chapter02\.xhtml">Natur: Ackerland, Grünfläche, Urban Gardening<\/a>/)
  assert.match(f('toc.ncx'), /<text>Natur: Ackerland, Grünfläche, Urban Gardening<\/text>/)
  for (const [i, c] of CHAPTERS.entries()) {
    assert.ok(chapters[i].nav.startsWith(c), chapters[i].nav)
    // 4: h2 chapter-b
    assert.match(f(`chapter${String(i + 1).padStart(2, '0')}.xhtml`), new RegExp(`<h2 class="chapter-b" id="chap${i + 1}"[^>]*>${c}</h2>`))
  }
  // 3: contents page, numbers outside the link, and the year kept
  assert.match(f('toc.xhtml'), /<a href="chapter10\.xhtml">Zukunft<\/a><span class="toc_pg">188<\/span>/)
  assert.match(f('toc.xhtml'), /Wünsche und Visionen von 1800 bis heute/)
  assert.match(f('toc.xhtml'), /<a href="chapter07\.xhtml">Architektur<\/a><span class="toc_pg">121<\/span>/)
  // 2: title page
  const title = [...f('title.xhtml').matchAll(/<(?:h1|p) [^>]*>([^<]+)</g)].map((m) => m[1].toUpperCase())
  if (printPages) assert.deepEqual(title.map((t) => t.replace(/\s|­/g, '')), ['BJOERNWEIGEL', 'DASTEMPELHOFERFELD', '350HEKTARDEUTSCHEGESCHICHTE', 'BEBRAVERLAG'])
  assert.match(f('title.xhtml'), /class="title-3-rs"/)
  // 5, 12: notes
  assert.match(f('chapter02.xhtml'), /<sup><a epub:type="noteref" href="notes\.xhtml#fn-1" id="fn_1" role="doc-noteref">1<\/a><\/sup>/)
  assert.equal((f('notes.xhtml').match(/role="doc-footnote"/g) ?? []).length, 19)
  assert.match(f('notes.xhtml'), /<a epub:type="backlink" href="chapter02\.xhtml#fn_1" role="doc-backlink">1<\/a>/)
  for (const c of CHAPTERS.keys()) assert.doesNotMatch(f(`chapter${String(c + 1).padStart(2, '0')}.xhtml`), /class="footnotes"/)
  // 6: no picture inside a paragraph
  for (const [p, d] of r.files) if (p.endsWith('.xhtml')) assert.doesNotMatch(text(d), /<p[^>]*>(?:(?!<\/p>)[\s\S])*<figure/, `${p}: a figure inside a paragraph`)
  // 7, 8, 9, 10, 11
  for (const [p, d] of r.files) {
    if (!p.endsWith('.xhtml')) continue
    assert.equal((text(d).match(/<html[^>]*>/)![0].match(/lang=/g) ?? []).length, 1, p)
    assert.match(text(d), /<section [^>]*aria-label(?:ledby)?="/, p)
  }
  assert.match(f('content.opf'), /xmlns:opf="http:\/\/www\.idpf\.org\/2007\/opf"/)
  assert.match(f('cover.xhtml'), /<title>Abdeckung<\/title>/)
  assert.match(f('nav.xhtml'), /<a href="cover\.xhtml#cimg">Abdeckung<\/a>/)
  assert.match(f('toc.ncx'), /<navLabel><text>Abdeckung<\/text><\/navLabel><content src="cover\.xhtml#cimg"\/>/)
  assert.doesNotMatch(f('nav.xhtml'), /Umschlag/)
  assert.doesNotMatch(f('toc.ncx'), /Umschlag/)
  assert.match(f('content.opf'), /<reference type="toc" title="Inhalt" href="toc\.xhtml"\/>/)
  // the package is valid, and the honest check agrees
  const ec = epubcheck(r.epub)
  if (ec) assert.deepEqual(ec.errors, [])
  assert.deepEqual(checkEpubBytes(r.epub, r.source).groups.flatMap((g) => g.findings.filter((i) => i.level === 'error' && /language|noteref|guide|chapter heading/i.test(i.msg))), [])
})

// ---- phase 0: reference diff ------------------------------------------------------------------------
test('refdiff: a build matches itself, and names what differs from a reference with other markup', () => {
  const a = book()
  assert.deepEqual(refdiff(a.r.files, a.r.files), [])
  const plain = book({ chapterTag: 'source', chapterHeadingClass: 'style' })
  const d = refdiff(plain.r.files, a.r.files)
  assert.ok(d.some((x) => x.startsWith('chapter headings')), d.join('\n'))
  const ec = epubcheck(a.r.epub)
  if (ec) assert.deepEqual(ec.errors, [])
})

// ---- phase 1: the gate -------------------------------------------------------------------------------
test('gate: green only when EPUBCheck ran and passed; conformance catches a broken heading; claims must match the content', async () => {
  const { gate, claimsCheck } = await import('../src/engine/check/gate.ts')
  const { zipEpub } = await import('../src/engine/zip.ts')
  const b = book()
  const s = settings()
  const none = await gate(b.r.epub, s)
  assert.notEqual(none.verdict, 'green', 'without EPUBCheck the verdict cannot be green')
  assert.ok(none.notes.length)
  if (epubcheck(b.r.epub)) {
    const g = await gate(b.r.epub, s, { validator: localValidator })
    assert.deepEqual(g.stages.filter((x) => x.errors.length).map((x) => `${x.id}: ${x.errors}`), [])
    assert.notEqual(g.verdict, 'red')
  }
  // a deliberately broken template: the chapter title written as a paragraph
  const broken = new Map(b.r.files)
  const ch = [...broken.keys()].find((k) => /chapter01\.xhtml$/.test(k))!
  broken.set(ch, new TextEncoder().encode(text(broken.get(ch)!).replace(/<h2\b/g, '<p').replace(/<\/h2>/g, '</p>')))
  const bad = await gate(zipEpub(broken), s)
  assert.equal(bad.verdict, 'red')
  assert.ok(bad.stages.find((x) => x.id === 'conformance')!.errors.some((m) => m.startsWith('HD-07')))
  // a claim the content does not back up
  const lie = new Map(b.r.files)
  const page = [...lie.keys()].find((k) => /chapter01\.xhtml$/.test(k))!
  lie.set(page, new TextEncoder().encode(text(lie.get(page)!).replace('</body>', '<img src="x.png" alt=""/></body>')))
  assert.ok(claimsCheck(lie).some((m) => /no description/.test(m)))
})

// ---- phase 2: a client is a data file ----------------------------------------------------------------
test('rules as data: BeBra is JSON; a second client with other classes builds with no code change', async () => {
  const { resolveSpec } = await import('../src/engine/spec/session.ts')
  const layer = bundledLayer('client', 'BeBra Verlag GmbH')!
  assert.deepEqual(layer.markup?.['chapter-title'], { tag: 'h2', class: 'chapter-b' })
  assert.equal(layer.values['HD-07'], undefined, 'the chapter heading comes from the markup template, not a rule')
  assert.equal(labelsFor('de-DE').coverTitle, 'Umschlag', 'the house word stays Umschlag')
  await BEBRA()
  assert.match(book(settings()).f('chapter01.xhtml'), /<h2 class="chapter-b" id="chap1"/)
  // another publisher: its own heading class, note references without a wrapper, a style meaning, extra CSS
  const other = bundledLayer('client', 'Zweiter Verlag AG', [{
    match: 'zweiterverlag', name: 'Zweiter Verlag', file: 'test',
    markup: { 'chapter-title': { tag: 'h2', class: 'kapitel' }, noteref: { wrap: '' } },
    styleMap: { sub: { match: '^h2$', role: 'h3' } },
    css: 'p.kapitel-x { color: #333; }',
  }])!
  const s = resolveSpec(DEFAULT_SETTINGS, [other]).settings
  const { f } = book(s)
  assert.match(f('chapter01.xhtml'), /<h2 class="kapitel" id="chap1"/)
  assert.doesNotMatch(f('chapter01.xhtml'), /chapter-b/)
  assert.doesNotMatch(f('notes.xhtml') + f('chapter01.xhtml'), /<sup><a epub:type="noteref"/)
  assert.match(f('chapter01.xhtml'), /<a epub:type="noteref"/)
  assert.match(f('chapter01.xhtml'), /<h3[^>]*>The fields<\/h3>/)
  assert.match(f('css/style.css'), /p\.kapitel-x/)
})

// ---- phase 4: a decision made once for the client applies to the next book -----------------------------
test('review: a style decided "for this client" is applied on the next book with no check item', async () => {
  const { MemoryStore, setStore } = await import('../src/engine/spec/store.ts')
  const { saveStyleRule } = await import('../src/engine/spec/session.ts')
  setStore(new MemoryStore())
  const exp = () => synthExport(exportBody(), css, 'de-DE')
  const roleOf = (key: string) => analyze(exp()).styles.find((s) => s.key === key)!
  const before = roleOf('Inhalt')
  const spec = await openSpec({ client: 'Fresh Verlag', series: '', book: 'one' }, DEFAULT_SETTINGS)
  const next = await saveStyleRule(spec, 'client', 'Inhalt', before.role === 'drop' ? 'p' : 'drop', '', 'tester')
  applySpec(await openSpec({ client: 'Fresh Verlag', series: '', book: 'two' }, DEFAULT_SETTINGS))
  const after = roleOf('Inhalt')
  setSettings(DEFAULT_SETTINGS)
  assert.equal(after.role, before.role === 'drop' ? 'p' : 'drop')
  assert.equal(after.unsure, false)
  assert.ok(after.evidence?.[0].signal === 'saved' || after.evidence?.some((e) => e.signal === 'saved'))
  assert.ok(next.layers.find((l) => l.level === 'client')!.styleMap?.['style:Inhalt'])
  setStore(new MemoryStore())
})

// ---- phase 5: the report's expected markup imports as the client layer -----------------------------------
test('import: the Markup and Styles sheets round-trip, and the report\'s expected samples reproduce bebra.json', async () => {
  const { parseMarkupSample, layerDataFromWorkbook } = await import('../src/engine/spec/markup.ts')
  const { specWorkbook, readRequirements } = await import('../src/engine/spec/requirements.ts')
  const { resolveSpec } = await import('../src/engine/spec/session.ts')
  const { emptyLayer } = await import('../src/engine/spec/layers.ts')
  // the "Expected" column of the client's report
  assert.deepEqual(parseMarkupSample('chapter-title', '<h2 class="chapter-b" id="chap1">Natur</h2>'), { tag: 'h2', class: 'chapter-b' })
  assert.deepEqual(parseMarkupSample('noteref', '<sup><a epub:type="noteref" href="#fn-01" id="fn_01">1</a></sup>'), { wrap: 'sup' })
  assert.deepEqual(parseMarkupSample('noteref', '<a epub:type="noteref" href="#fn-01">1</a>'), { wrap: '' })
  const bebra = bundledLayer('client', 'BeBra Verlag')!
  const layer = emptyLayer('client', 'X')
  layer.markup = bebra.markup
  layer.styleMap = { 'style:BU': { match: 'BU', role: 'p', class: 'caption' } }
  const resolved = resolveSpec(DEFAULT_SETTINGS, [layer])
  const xlsx = specWorkbook({ client: 'X', book: 'Y', resolved })
  const back = readRequirements('spec.xlsx', xlsx)
  assert.deepEqual(back.layerData?.markup, bebra.markup)
  assert.deepEqual(back.layerData?.styleMap, layer.styleMap)
  assert.equal(layerDataFromWorkbook([]), undefined)
})
