// The client's "Standard vs Accessible tag differences" and "Language" sheets, row by row; plus the Cartografías del poder export.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { toStandard } from '../src/engine/epub/package.ts'
import { STD_DEFAULTS } from '../src/engine/settings.ts'
import { ruleById } from '../src/engine/spec/rules.ts'
import { reviewList, rulesForTopic } from '../src/engine/review/confidence.ts'
import { labelsFor } from '../src/engine/epub/locale.ts'
import { unzip, text } from '../src/engine/zip.ts'
import { analyze, build } from '../src/engine/indesign/build.ts'
import { checkEpub } from '../src/engine/check/epub.ts'
import { setSettings } from '../src/engine/settings.ts'
import { has, read } from './samples.ts'
import { epubcheck } from './epubcheck.ts'

const L = labelsFor('es-ES')

test('standard markup, row by row', () => {
  const acc = [
    '<section aria-labelledby="chap1" epub:type="chapter" role="doc-chapter">',
    '<span aria-label="página 1" epub:type="pagebreak" id="page-1" role="doc-pagebreak" title="página 1"/>',
    '<h1 class="chapter" id="chap1" role="heading"><span class="bold">Uno</span> <span class="italic">dos</span></h1>',
    '<figure class="fig_group"><p class="image_Container"><img alt="a real description" class="fig1-1" src="images/f.jpg"/></p>',
    '<figcaption class="caption">Pie</figcaption></figure>',
    '<ul class="bull">\n<li>First</li>\n<li>Second<ol class="num" start="3">\n<li>Deep</li>\n</ol>\n</li>\n</ul>',
    '<blockquote><p class="quote">Q</p></blockquote>',
    '<table><colgroup><col style="width:100%;"/></colgroup><thead><tr><th class="c1" scope="col">H</th></tr></thead><tbody><tr><td>x</td></tr></tbody></table>',
    '<sup><a epub:type="noteref" href="#fn-1" id="fn_1" role="doc-noteref">1</a></sup>',
    '<div epub:type="footnote" id="fn-1" role="doc-footnote">\n<p class="FN-1"><a epub:type="backlink" href="#fn_1" role="doc-backlink">1.</a> Nota</p>\n</div>',
    '</section>',
  ].join('\n')
  const std = toStandard(acc, L)
  assert.doesNotMatch(std, /<section|<h1|<figure|<figcaption|<blockquote|<thead|<tbody|<th[ >]|<ul|<ol|<li|epub:type|role=|aria-/)
  assert.match(std, /^<a id="Page_1"\/>\n<p class="chapter" id="chap1"><b>Uno<\/b> <i>dos<\/i><\/p>/)
  assert.match(std, /<div class="fig_group"><p class="image_Container"><img alt="imagen" class="fig1-1" src="images\/f.jpg"\/><\/p>/)
  assert.match(std, /<p class="bull">• First<\/p>/)
  assert.match(std, /<p class="bull">• Second<\/p>\n<p class="num2">3\. Deep<\/p>/)
  assert.match(std, /<div class="top"><p class="quote">Q<\/p><\/div>/)
  assert.match(std, /<table><colgroup>.*<\/colgroup><tr><td class="c1 tbl-h">H<\/td><\/tr><tr><td>x<\/td><\/tr><\/table>/)
  assert.match(std, /<sup><a href="#fn-1" id="fn_1">1<\/a><\/sup>/)
  assert.match(std, /<p id="fn-1" class="FN-1"><a href="#fn_1">1\.<\/a> Nota<\/p>/, 'the note keeps the id its reference points at')
})

test('language sheet: the words per language', () => {
  const row = (lang: string) => { const l = labelsFor(lang); return [l.page, l.chapter, l.navTitle, l.landmarks, l.cover, l.title, l.startReading, l.titleWord, l.authorWord, l.publisherWord, l.imageAlt, l.decorativeAlt] }
  assert.deepEqual(row('de-DE'), ['Seite', 'Kapitel', 'Inhaltsverzeichnis', 'Orientierungspunkte', 'Umschlag', 'Titelseite', 'Lesen beginnen', 'Titel', 'Autor', 'Verlag', 'Bild', 'dekorativ'])
  assert.deepEqual(row('fr-FR'), ['page', 'Chapitre', 'Table des matières', 'Repères', 'Couverture', 'Page de titre', 'Commencer la lecture', 'Titre', 'Auteur', 'Éditeur', 'image', 'décorative'])
  assert.deepEqual(row('es-ES'), ['página', 'Capítulo', 'Índice de contenido', 'Puntos de referencia', 'Cubierta', 'Portada', 'Empezar a leer', 'Título', 'Autor', 'Editorial', 'imagen', 'decorativa'])
  assert.deepEqual(row('it-IT'), ['pagina', 'Capitolo', 'Indice', 'Punti di riferimento', 'Copertina', 'Pagina del titolo', 'Inizia a leggere', 'Titolo', 'Autore', 'Editore', 'immagine', 'decorativa'])
  assert.deepEqual(row('pt-PT'), ['página', 'Capítulo', 'Índice', 'Pontos de referência', 'Capa', 'Página de título', 'Começar a ler', 'Título', 'Autor', 'Editora', 'imagem', 'decorativa'])
  assert.deepEqual(row('es-MX'), ['página', 'Capítulo', 'Índice de contenido', 'Puntos de referencia', 'Portada', 'Página de título', 'Empezar a leer', 'Título', 'Autor', 'Editorial', 'imagen', 'decorativa'])
})

const D = resolve(import.meta.dirname, '../../corrections')
const zip = resolve(D, 'Input_5d5f47c6-b94b-4ac3-b3aa-3a5c490a72b2.zip')

test('Cartografías del poder: chapters, details and both profiles', { skip: !has(zip) && 'sample missing', timeout: 300_000 }, () => {
  setSettings({})
  const all = unzip(read(zip))
  const exp = unzip(all.get('Input_Indesign_cartografia_288p.epub')!)
  const cover = all.get('cover.jpg')!
  const a = analyze(exp)
  assert.equal(a.meta.title, 'Cartografías del poder: Exploraciones en la sociología política contemporánea')
  assert.equal(a.meta.authors, 'Gustavo Urbina Cortés, Isaac Cisneros Yescas')
  assert.equal(a.meta.publisher, 'El Colegio de México')
  for (const profile of ['standard', 'accessible'] as const) {
    const r = build(a, { styles: a.styles, images: a.images, cover: { name: 'cover.jpg', data: cover }, meta: { ...a.meta, eisbn: '9786075648156', profile } })
    assert.equal(r.sections.filter((s) => s.type === 'chapter').length, 8, `${profile}: eight chapters`)
    assert.ok(r.sections.some((s) => s.type === 'preface') && r.sections.some((s) => s.type === 'foreword'), `${profile}: Presentación and Prefacio are front matter`)
    assert.match(r.sections.find((s) => s.type === 'chapter')!.nav, /^I\. Coordenadas de un campo en movimiento$/, 'contents label is not shouted')
    assert.deepEqual(r.review.filter((x) => x.level === 'error'), [], `${profile}: no build errors`)
    const rep = checkEpub(r.files, r.source)
    assert.deepEqual(rep.groups.flatMap((g) => g.findings).filter((f) => f.level === 'error'), [], `${profile}: no check errors`)
    const ec = epubcheck(r.epub)
    if (ec) assert.deepEqual(ec.errors, [], `${profile}: EPUBCheck`)
    const ch = text(r.files.get('OEBPS/chapter01.xhtml')!)
    if (profile === 'standard') assert.doesNotMatch(ch, /<html [^>]*lang=|<section|<h\d/)
    else assert.match(ch, /<html [^>]*xml:lang="es-ES"/)
  }
})

test('each Standard EPUB rule switches its own markup (STD-01…STD-12)', () => {
  const acc = [
    '<section epub:type="chapter" role="doc-chapter"><span aria-label="página 1" epub:type="pagebreak" id="page-1" role="doc-pagebreak" title="página 1"/>',
    '<h1 class="c">T</h1><ul class="bull"><li>One</li></ul><span class="italic">i</span><blockquote><p>q</p></blockquote>',
    '<figure class="fig_group"><img alt="real" src="a.jpg"/></figure><table><thead><tr><th>H</th></tr></thead></table>',
    '<sup><a epub:type="noteref" href="#n" role="doc-noteref">1</a></sup></section>',
  ].join('\n')
  const base = toStandard(acc, L)
  const keep = toStandard(acc, L, { ...STD_DEFAULTS, stdHeadings: 'headings', stdLists: 'lists', stdEmphasis: 'span', stdQuotes: 'blockquote', stdFigures: 'figure', stdTables: 'sections', stdAlt: 'keep', stdNotes: 'roles', stdPageMarks: 'none', stdWrappers: 'keep' })
  assert.match(base, /<p class="c">T<\/p>/)
  assert.match(keep, /<h1 class="c">T<\/h1>/)
  assert.match(keep, /<ul class="bull"><li>One<\/li><\/ul>/)
  assert.match(keep, /<span class="italic">i<\/span>/)
  assert.match(keep, /<blockquote>/)
  assert.match(keep, /<figure class="fig_group"><img alt="real"/)
  assert.match(keep, /<thead>.*<th>/s)
  assert.match(keep, /epub:type="noteref"[^>]*role="doc-noteref"/)
  assert.doesNotMatch(keep, /pagebreak|Page_/)
  assert.match(keep, /<section/)
  assert.match(base, /<a id="Page_1"\/>/)
})

test('rules in the registry: the twelve STD rules exist and are settings', () => {
  for (let i = 1; i <= 12; i++) assert.ok(ruleById.get(`STD-${String(i).padStart(2, '0')}`)?.key, `STD-${i}`)
})

test('check-these-first: unsure styles and unknown sections come first, clear ones are only counted', () => {
  const styles = [
    { key: 'a', count: 5, samples: ['x'], role: 'p', outClass: 'a', unsure: false, reason: 'body' },
    { key: 'b', count: 2, samples: ['Dedicatoria'], role: 'imprint', outClass: 'b', unsure: true, reason: 'ISBN / © / legal lines' },
  ] as never
  const r = reviewList({ styles, sources: { title: 'title page' }, meta: { title: 'T', authors: '', publisher: 'P', eisbn: '' }, sections: [{ type: 'chapter', nav: 'One' }, { type: 'other', nav: '' }], notes: [{ level: 'warn', msg: 'Picture needs a description' }] })
  assert.deepEqual(r.items.map((i) => i.id), ['style:b', 'meta:authors', 'section:1', 'note:3'])
  assert.equal(r.items[0].confidence, 'low')
  assert.equal(r.sure, 4)
  assert.ok(rulesForTopic('table', true).some((x) => x.id === 'TBL-01'))
})
