import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildQc, stateOf, QC_HEADINGS } from '../src/engine/review/qc.ts'
import { detectQc } from '../src/engine/review/qc-detect.ts'
import type { CheckReport } from '../src/engine/check/epub.ts'
import type { Files } from '../src/engine/zip.ts'

const enc = new TextEncoder()
const page = (n: string) => `<span id="page-${n}" epub:type="pagebreak" role="doc-pagebreak" aria-label="${n}"/>`
const doc = (body: string) => `<html xmlns:epub="x"><body>${body}</body></html>`
const files = (o: Record<string, string>): Files => new Map(Object.entries(o).map(([k, v]) => ['OEBPS/' + k, enc.encode(v)]))
const report = (groups: CheckReport['groups'] = []): CheckReport => ({ groups, errors: 0, warnings: 0, stats: { documents: 1, words: 1, pages: 1, images: 0, notes: 0 } })
const kinds = (f: Files) => detectQc(f).map((i) => i.kind)

test('the seven headings come in the QC order', () => {
  assert.deepEqual(QC_HEADINGS.map((h) => h.title), ['Text & characters', 'Formatting', 'Structure', 'Reading order', 'Navigation', 'Images', 'Metadata & validation'])
  const s = buildQc({ files: files({}), report: report() })
  assert.ok(s.every((x) => stateOf(x).label === 'Passed'))
})

test('italic and bold runs: stray, split and mid-word styles are listed with their page', () => {
  const f = files({ 'ch1.xhtml': doc(`${page('7')}<p>An <em>Birm</em>ingham tale, <strong> </strong> and <em>one</em> <em>two</em> but <em>fine</em>.</p>`) })
  const items = detectQc(f)
  assert.deepEqual(items.map((i) => i.kind).sort(), ['Split runs', 'Styled runs with no letters', 'Styles that stop inside a word'].sort())
  assert.ok(items.every((i) => i.file === 'ch1.xhtml' && i.anchor === 'page-7' && i.page === '7' && i.heading === 'formatting'))
  assert.match(items.find((i) => i.kind === 'Styled runs with no letters')!.msg, /bold run/)
})

test('a bold-italic run is named as such', () => {
  const f = files({ 'a.xhtml': doc('<p><strong><em> </em></strong></p>') })
  assert.match(detectQc(f)[0].msg, /bold-italic/)
})

test('index: 174-8 links 174 and 178; a plain end, a missing link text and a wrong target are found', () => {
  const idx = (p: string) => files({ 'ch1.xhtml': doc(`${page('174')}${page('178')}`), 'index.xhtml': doc(`<nav epub:type="index"></nav><p>${p}</p>`) })
  const link = (n: string, t: string) => `<a href="ch1.xhtml#page-${n}">${t}</a>`
  assert.deepEqual(kinds(idx(`Smith, ${link('174', '174')}-${link('178', '8')}`)), [])
  assert.deepEqual(kinds(idx(`Smith, ${link('174', '174')}-8`)), ['Range ends not linked'])
  assert.deepEqual(kinds(idx(`Smith, ${link('174', '174')}-${link('174', '8')}`)), ['Index links to the wrong page'])
  assert.deepEqual(kinds(idx(`Smith, <a href="ch1.xhtml#page-174"></a>`)), ['Index links with no text'])
  assert.deepEqual(kinds(idx(`Smith, ${link('174', '174')}, 305`)), ['Page numbers not linked'])
  assert.deepEqual(kinds(idx(`Smith, ${link('178', '999')}`)), ['Index links that fall back'])
})

test('page markers need an ID', () => {
  const f = files({ 'a.xhtml': doc('<p>x<span epub:type="pagebreak" role="doc-pagebreak" aria-label="9"/></p>') })
  assert.deepEqual(detectQc(f).map((i) => [i.rule, i.heading]), [['PGM-001', 'navigation']])
})

test('hyphens: only a word written both ways is unsure; soft hyphens and line-end hyphens are listed', () => {
  const f = files({ 'a.xhtml': doc(`${page('1')}<p>A sun-light and sunlight day, a well-known fact, re\u00ADal, recon- figura.</p>`) })
  assert.deepEqual(kinds(f).sort(), ['Hyphens: kept in one place, joined in another', 'Line-end hyphens left in the text', 'Soft hyphens'].sort())
})

test('note calls: a call with no note, and a note nothing calls', () => {
  const f = files({ 'a.xhtml': doc(`<p>x<a epub:type="noteref" href="n.xhtml#fn1">1</a><a epub:type="noteref" href="n.xhtml#fn9">9</a></p>`), 'n.xhtml': doc('<aside epub:type="footnote" id="fn1"/><aside epub:type="footnote" id="fn2"/>') })
  assert.deepEqual(kinds(f).sort(), ['Note calls with no note', 'Notes nothing calls'])
})

test('the menu against the reading order', () => {
  const opf = '<package><manifest><item id="a" href="a.xhtml"/><item id="b" href="b.xhtml"/></manifest><spine><itemref idref="a"/><itemref idref="b"/></spine></package>'
  const f = files({ 'a.xhtml': doc(''), 'b.xhtml': doc(''), 'nav.xhtml': doc('<nav epub:type="toc"><a href="b.xhtml">Two</a><a href="a.xhtml">One</a></nav>'), 'c.opf': opf })
  f.set('META-INF/container.xml', enc.encode('<container><rootfile full-path="OEBPS/c.opf"/></container>'))
  assert.deepEqual(detectQc(f).map((i) => i.heading), ['order'])
})

test('existing findings are sorted under the headings, with file and page; unlinked contents entries are counted', () => {
  const f = files({ 'ch1.xhtml': doc(`${page('12')}<p><img src="images/a.jpg" alt=""/></p>`) })
  const r = report([
    { id: 'a11y', title: 'Accessibility', explain: '', findings: [{ level: 'error', msg: 'Picture images/a.jpg has no alt attribute.' }, { level: 'pass', msg: 'fine' }] },
    { id: 'content', title: 'Content', explain: '', findings: [{ level: 'warn', msg: 'Page marker 12 is repeated.' }] },
  ])
  const review = [
    ...Array.from({ length: 3 }, (_, i) => ({ level: 'error' as const, msg: `TOC entry "Chapter ${i}" could not be linked to any section.`, where: 'ch1' })),
    { level: 'error' as const, msg: 'IMG-011: 2 pictures have no image file in the package.' },
  ]
  const s = Object.fromEntries(buildQc({ files: f, report: r, review, ec: null, a11y: null }).map((x) => [x.key, x]))
  assert.equal(s.navigation.items.filter((i) => i.kind === 'Contents and menu').length, 3)
  const alt = s.images.items.find((i) => /no alt/.test(i.msg))!
  assert.deepEqual([alt.file, alt.page, alt.anchor], ['ch1.xhtml', '12', 'page-12'])
  assert.ok(s.images.items.some((i) => i.rule === 'IMG-011'))
  assert.equal(stateOf(s.images).label, '2 to fix')
  assert.equal(stateOf(s.text).label, 'Passed')
  assert.equal(s.metadata.notRun.length, 2)
  assert.equal(stateOf(s.metadata).tone, 'meh')
})
