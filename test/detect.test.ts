// Phase 3: one scorer decides every style role; notes and pictures carry evidence; the review is one list by confidence.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyze, build } from '../src/engine/indesign/build.ts'
import { decide, evidence, crossChecks, actionOf } from '../src/engine/structure/score.ts'
import { matchNotes } from '../src/engine/structure/notes.ts'
import { pdfNotes } from '../src/engine/pdfepub/notes.ts'
import { decidePlacement, placeEvidence, candidatePages } from '../src/engine/indesign/placement.ts'
import { reviewList } from '../src/engine/review/confidence.ts'
import { synthExport, SYNTH_CSS, synthBook } from './synth.ts'

const cover = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))
const body = (n: number) => `<p class="Cuerpo">${'Una frase corta del capítulo. '.repeat(30)}${n}</p>`

test('thresholds: 0.85 is silent, 0.6 to 0.85 is listed, under 0.6 is blocked', () => {
  assert.equal(actionOf(0.85), 'silent')
  assert.equal(actionOf(0.84), 'listed')
  assert.equal(actionOf(0.6), 'listed')
  assert.equal(actionOf(0.59), 'blocked')
  // the old first-match answer alone is a weak vote
  assert.equal(decide([evidence('fallback', 'h3', 'first match')]).action, 'blocked')
  // several independent signals agree
  assert.equal(decide([evidence('tag', 'h2', 'a'), evidence('name', 'h2', 'b'), evidence('contents', 'h2', 'c')]).action, 'silent')
  // a rival lowers the confidence
  assert.ok(decide([evidence('tag', 'h2', 'a'), evidence('name', 'h3', 'b')]).confidence < decide([evidence('tag', 'h2', 'a')]).confidence)
})

test('every style keeps the signals that voted, and the readers fill the same feature record', () => {
  const a = analyze(synthExport(synthBook(3, body), SYNTH_CSS))
  assert.ok(a.styles.length > 0)
  for (const s of a.styles.filter((x) => x.count)) {
    assert.ok(s.evidence?.length, s.key)
    assert.ok(s.action, s.key)
    assert.equal(s.unsure, s.action === 'blocked', s.key)
  }
  assert.ok(a.styles.find((s) => s.role === 'p' && s.action === 'silent'))
})

test('notes: a reference without a note and a note without a reference are flagged low', () => {
  const a = analyze(synthExport([
    '<p class="Cuerpo">Text <a class="_idFootnoteLink" href="book.xhtml#footnote-001" id="b1">1</a> and <a class="_idFootnoteLink" href="book.xhtml#footnote-009" id="b9">2</a>.</p>',
    '<div class="_idFootnotes"><aside class="_idFootnote" epub:type="footnote" id="footnote-001"><p class="Cuerpo"><a class="_idFootnoteAnchor" href="book.xhtml#b1">1</a> One.</p></aside>',
    '<aside class="_idFootnote" epub:type="footnote" id="footnote-002"><p class="Cuerpo">2 Orphan.</p></aside></div>',
  ].join('\n'), SYNTH_CSS))
  const f = a.notes.find((n) => n.kind === 'indesign-footnote')!
  assert.ok(f, 'footnote kind found')
  assert.equal(f.unmatchedRefs.length, 1)
  assert.equal(f.unmatchedNotes.length, 1)
  assert.equal(f.action, 'blocked')
  const r = reviewList({ styles: a.styles, sources: {}, meta: { title: 'T', authors: 'A', publisher: 'P', eisbn: '' }, sections: [], notes: [], noteFindings: a.notes })
  assert.equal(r.items.filter((i) => i.area === 'note').length, 2)
  assert.ok(r.items.every((i) => i.score < 0.6))
})

test('notes: a typed endnote section matches numbers per chapter, and a PDF footnote needs both marks on the page', () => {
  const m = matchNotes('typed-endnote', 0.7, [], [{ label: '1', scope: 'a', where: '' }, { label: '1', scope: 'b', where: '' }], [{ label: '1', scope: 'a', where: '' }])
  assert.equal(m.unmatchedRefs.length, 1, 'the same number in another chapter is a different note')
  assert.ok(m.confidence < 0.7)
  const run = (text: string, size: number) => ({ text, x0: 0, x1: 5, font: 'F', size, bold: false, italic: false })
  const line = (text: string, size: number, y: number, runs = [run(text, size)]) => ({ text, size, y, runs, x0: 0, x1: 100, base: y, font: 'F', marker: false })
  const page = { height: 800, label: '7', lines: [line('Body text 1 here', 10, 100, [run('Body text', 10), run('1', 6), run(' here', 10)]), line('1 The note text', 8, 700)] }
  const found = pdfNotes([page as never], 10)
  assert.equal(found.length, 1)
  assert.equal(found[0].unmatchedRefs.length + found[0].unmatchedNotes.length, 0)
  assert.deepEqual(pdfNotes([{ ...page, lines: [page.lines[1]] } as never], 10), [], 'a numbered foot line with no superscript is not a footnote')
})

test('pictures: the signal that places a picture and its confidence; a picture nothing places is blocked with candidates', () => {
  const anchor = decidePlacement('a.jpg', 'images/a.jpg', [placeEvidence('anchor', 'anchored', '5')], false, [])
  assert.equal(anchor.signal, 'anchor')
  assert.equal(anchor.action, 'silent')
  const layout = decidePlacement('b.jpg', 'images/b.jpg', [placeEvidence('layout-page', 'frame', '5')], false, [])
  assert.equal(layout.action, 'listed')
  // the caption names another page than the layout frame: the caption wins
  const moved = decidePlacement('c.jpg', 'images/c.jpg', [placeEvidence('layout-page', 'frame', '5'), placeEvidence('caption-pdf', 'caption', '40')], true, [])
  assert.equal(moved.signal, 'caption-pdf')
  assert.equal(moved.page, '40')
  // the caption confirms the layout page: both add up
  const both = decidePlacement('d.jpg', 'images/d.jpg', [placeEvidence('layout-page', 'frame', '5'), placeEvidence('caption-pdf', 'caption', '5')], false, [])
  assert.ok(both.confidence > layout.confidence)
  const none = decidePlacement('e.jpg', 'images/e.jpg', [], false, ['12', '40'])
  assert.equal(none.signal, 'none')
  assert.equal(none.action, 'blocked')
  assert.deepEqual(none.candidates, ['12', '40'])
  const pages = [{ n: '12', text: 'the airfield was used by the army and the factory', blank: false }, { n: '13', text: 'something else entirely', blank: false }] as never
  assert.deepEqual(candidatePages('Army airfield and factory in 1938', pages), ['12'])
})

test('build: every placed picture says which signal placed it', () => {
  const html = (src: string) => `<div class="_idGenObjectLayout-1"><div class="Bild"><img src="${src}" alt=""/></div></div>`
  const files = synthExport([synthBook(2, body), '<span epub:type="pagebreak" id="page9" role="doc-pagebreak" aria-label="9" title="9"/>', html('img/a.png'), '<p class="Cuerpo">Zu Bild A. Caption words here to follow.</p>', body(3)].join('\n'), SYNTH_CSS)
  files.set('OEBPS/img/a.png', cover)
  files.set('OEBPS/content.opf', new TextEncoder().encode(new TextDecoder().decode(files.get('OEBPS/content.opf')!).replace('</manifest>', '<item id="i" href="img/a.png" media-type="image/png"/></manifest>')))
  const a = analyze(files)
  const r = build(a, { styles: a.styles, images: a.images, meta: { ...a.meta, eisbn: '9780306406157' }, cover: { name: 'cover.png', data: cover } })
  assert.equal(r.pictures.length, a.images.filter((i) => i.placement !== 'logo').length)
  for (const p of r.pictures) assert.ok(['anchor', 'layout-page', 'caption-pdf', 'pdf-position', 'none'].includes(p.signal))
})

test('review: one list sorted by confidence; cross-check failures are the banner, not list entries', () => {
  const r = reviewList({
    styles: [{ key: 'x', count: 3, samples: ['s'], role: 'h3', outClass: 'x', unsure: false, reason: 'r', confidence: 0.7, action: 'listed' }, { key: 'y', count: 3, samples: ['s'], role: 'h3', outClass: 'y', unsure: true, reason: 'r', confidence: 0.4, action: 'blocked' }] as never,
    sources: {}, meta: { title: 'T', authors: 'A', publisher: 'P', eisbn: '' }, sections: [],
    notes: [{ level: 'warn', msg: 'The contents lists 10 chapters, but 9 were found.', kind: 'cross-check' }],
    pictures: [{ src: 'p.jpg', name: 'images/p.jpg', signal: 'layout-page', confidence: 0.6, action: 'listed', evidence: [], candidates: [], note: 'x' }],
  })
  assert.deepEqual(r.items.map((i) => i.score), [0.4, 0.6, 0.7])
  assert.deepEqual(r.banner, ['The contents lists 10 chapters, but 9 were found.'])
  assert.ok(crossChecks([{ type: 'chapter', nav: 'A', words: 900 }, { type: 'chapter', nav: 'B', words: 900 }, { type: 'chapter', nav: 'C', words: 900 }, { type: 'chapter', nav: 'D', words: 900 }], [{ title: 'A' }, { title: 'B' }, { title: 'C' }]).some((m) => /lists 3 chapters, but 4/.test(m)))
  assert.ok(crossChecks([{ type: 'chapter', nav: 'A', words: 900 }, { type: 'chapter', nav: 'B', words: 900 }, { type: 'chapter', nav: 'C', words: 900 }], [{ title: 'A', printed: '10', first: '12' }, { title: 'B', printed: '20', first: '20' }, { title: 'C', printed: '9', first: '9' }]).some((m) => /puts "A" on page 10, but it starts on page 12/.test(m)))
})

test('PDF footnotes become real notes: the raised number is marked, the foot line leaves the page, an unmatched number stays', async () => {
  const { extractFootnotes } = await import('../src/engine/pdfepub/notes.ts')
  const run = (text: string, size: number): { text: string; x0: number; x1: number; font: string; size: number; bold: boolean; italic: boolean; noteId?: number } => ({ text, x0: 0, x1: 5, font: 'F', size, bold: false, italic: false })
  const line = (text: string, size: number, y: number, runs = [run(text, size)]) => ({ text, size, y, runs, x0: 0, x1: 100, base: y, font: 'F', marker: false })
  const body = line('Body text 1 here 2', 10, 100, [run('Body text', 10), run('1', 6), run(' here', 10), run('2', 6)])
  const foot1 = line('1 The note text', 8, 700)
  const foot1b = line('goes on here.', 8, 712)
  const page = { height: 800, lines: [body, foot1, foot1b] }
  const notes = extractFootnotes([page as never], 10)
  assert.deepEqual(notes.map((n) => [n.label, n.text]), [['1', 'The note text goes on here.']])
  assert.equal(body.runs[1].noteId, 1)
  assert.equal(body.runs[3].noteId, undefined, 'number 2 has no note on its page')
  assert.deepEqual(page.lines, [body], 'the foot lines are gone from the page text')
})

test('NOTE-04: footnotes stay under the chapter, or all go to the notes page', async () => {
  const { setSettings, DEFAULT_SETTINGS } = await import('../src/engine/settings.ts')
  const mk = (noteSpot: 'auto' | 'book-end') => {
    setSettings({ ...DEFAULT_SETTINGS, noteSpot })
    const f = synthExport([
      '<p class="Etiqueta">Chapter 1</p><p class="Titulo">One</p>',
      `<p class="Cuerpo">${'Una frase. '.repeat(40)}<a class="_idFootnoteLink" href="book.xhtml#footnote-001" id="b1">1</a></p>`,
      '<div class="_idFootnotes"><aside class="_idFootnote" epub:type="footnote" id="footnote-001"><p class="Cuerpo"><a class="_idFootnoteAnchor" href="book.xhtml#b1">1</a> One note.</p></aside></div>',
    ].join('\n'), SYNTH_CSS)
    const a = analyze(f)
    const r = build(a, { styles: a.styles, images: a.images, meta: { ...a.meta, eisbn: '9780306406157' }, cover: { name: 'cover.png', data: cover } })
    setSettings(DEFAULT_SETTINGS)
    return r
  }
  const html = (r: ReturnType<typeof mk>) => [...r.files].filter(([p]) => p.endsWith('.xhtml')).map(([p, d]) => `${p}\n${new TextDecoder().decode(d)}`).join('\n')
  assert.match(html(mk('auto')), /class="footnotes"/)
  const end = html(mk('book-end'))
  assert.doesNotMatch(end, /class="footnotes"/)
  assert.match(end, /OEBPS\/notes\.xhtml[^]*One note\./)
})

test('PDF footnotes: a raised number that pdf.js read as a line of its own still counts, and joins its line', async () => {
  const { extractFootnotes, pdfNotes } = await import('../src/engine/pdfepub/notes.ts')
  const run = (text: string, size: number, x0 = 0, x1 = 5): { text: string; x0: number; x1: number; font: string; size: number; bold: boolean; italic: boolean; noteId?: number } => ({ text, x0, x1, font: 'F', size, bold: false, italic: false })
  const line = (text: string, size: number, y: number, x0 = 40, x1 = 140) => ({ text, size, y, runs: [run(text, size, x0, x1)], x0, x1, base: y, font: 'F', marker: false })
  const host = line('Text mit Fussnote', 10, 365)
  const lone = line('1', 6, 363, 141, 144)
  const foot = line('1 Eine Anmerkung.', 8, 700)
  const page = { height: 800, label: '3', lines: [host, lone, foot] }
  assert.equal(pdfNotes([page as never], 10)[0].unmatchedRefs.length, 0)
  const notes = extractFootnotes([page as never], 10)
  assert.equal(notes.length, 1)
  assert.deepEqual(page.lines, [host], 'the lone number and the foot line are gone')
  assert.equal(host.runs.at(-1)?.noteId, 1, 'the number is now part of its line')
})
