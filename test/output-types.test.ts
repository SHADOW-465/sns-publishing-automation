// Output types: each has its own defaults (with a reason and the standard it comes from), a client layer overrides them,
// and a combination that breaks the chosen type is refused in plain words.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_SETTINGS, setSettings, settings } from '../src/engine/settings.ts'
import { RULES, ruleById } from '../src/engine/spec/rules.ts'
import { baseSettings, defaultFor, outputViolations, OUTPUT_KINDS, type OutputKind } from '../src/engine/output/standards.ts'
import { openSpec } from '../src/engine/spec/session.ts'
import { MemoryStore, setStore } from '../src/engine/spec/store.ts'
import { uaOptionsFrom } from '../src/engine/pdfua/structure.ts'

const KINDS = OUTPUT_KINDS.map((o) => o.id)

test('the three output types are described in a line each, with the standard they follow', () => {
  assert.deepEqual(KINDS, ['standard-epub', 'accessible-epub', 'accessible-pdf'])
  for (const o of OUTPUT_KINDS) assert.ok(o.line.length > 40 && o.standards, o.id)
  assert.match(OUTPUT_KINDS[0].standards, /EPUB 3\.3/)
  assert.match(OUTPUT_KINDS[1].standards, /EPUB Accessibility 1\.1.*WCAG 2\.2 AA/)
  assert.match(OUTPUT_KINDS[2].standards, /PDF\/UA-1.*Matterhorn/)
})

test('every setting with a rule has a default for every output type, with a reason and a source', () => {
  for (const kind of KINDS) {
    for (const r of RULES.filter((x) => x.key)) {
      const d = defaultFor(kind, r.id)
      assert.notEqual(d.value, undefined, `${kind} ${r.id} has a value`)
      assert.ok(d.plain.length > 3, `${kind} ${r.id} says why`)
      assert.ok(d.standard.length > 3, `${kind} ${r.id} names its source`)
    }
  }
})

test('a missing setting falls back to the standard of the chosen type, not to one value for all', () => {
  const std = baseSettings('standard-epub')
  const acc = baseSettings('accessible-epub')
  const pdf = baseSettings('accessible-pdf')
  assert.equal(std.titlePageAs, 'image', 'Standard EPUB: the printed title page as a picture, as the Crowood file')
  assert.equal(acc.titlePageAs, 'text', 'Accessible EPUB: real text (WCAG 1.4.5)')
  assert.equal(std.stdEmphasis, 'semantic')
  assert.equal(std.altRequired, 'warn')
  assert.equal(acc.altRequired, 'error')
  assert.equal(std.defaultProfile, 'standard')
  assert.equal(acc.defaultProfile, 'accessible')
  assert.equal(pdf.uaChapterLevel, 2)
  assert.equal(pdf.uaIndexLinks, false)
  assert.equal(DEFAULT_SETTINGS.titlePageAs, 'text', 'the house default itself is unchanged')
  assert.match(defaultFor('accessible-epub', 'FM-03').standard, /WCAG 2\.2 1\.4\.5/)
  assert.match(defaultFor('accessible-pdf', 'UA-01').standard, /PDF\/UA-1/)
  assert.match(defaultFor('standard-epub', 'STD-12').standard, /Crowood/)
})

test('resolving with an output type says where each value came from: the standard, or the layer that set it', async () => {
  setStore(new MemoryStore())
  const none = await openSpec({ client: '', series: '', book: 'b', kind: 'standard-epub' })
  assert.equal(none.resolved.settings.pageAnchorId, 'Page_{n}')
  assert.equal(none.resolved.from['STD-14'].level, 'default')
  assert.match(none.resolved.from['STD-14'].basis!.standard, /Client sheet/)

  const crowood = await openSpec({ client: 'The Crowood Press Ltd', series: '', book: 'b', kind: 'standard-epub' })
  assert.equal(crowood.resolved.settings.pageAnchorId, 'pg_{n}', 'the client’s layer wins over the standard default')
  assert.equal(crowood.resolved.from['STD-14'].level, 'client')
  assert.equal(crowood.resolved.settings.stdEmphasis, 'semantic', 'what the client does not set stays the Standard EPUB default')
  assert.equal(crowood.resolved.from['STD-02'].level, 'default')

  const pen = await openSpec({ client: 'Pen & Sword Books', series: '', book: 'b', kind: 'accessible-pdf' })
  assert.deepEqual(uaOptionsFrom(pen.resolved.settings), { chapterLevel: 1, logos: 'figure', bookmarkLevels: 1, plateBookmark: true, plateLabel: 'Plate', indexLinks: false, noteLinks: true })
  const other = await openSpec({ client: 'Somebody Else', series: '', book: 'b', kind: 'accessible-pdf' })
  assert.equal(uaOptionsFrom(other.resolved.settings).chapterLevel, 2)
})

test('the book layer wins over the series, the client and the standard', async () => {
  const store = new MemoryStore()
  setStore(store)
  const book = (await openSpec({ client: 'The Crowood Press Ltd', series: '', book: 'isbn-1', kind: 'standard-epub' })).layers.find((l) => l.level === 'book')!
  book.values['STD-14'] = 'seite_{n}'
  await store.saveLayer(book)
  const spec = await openSpec({ client: 'The Crowood Press Ltd', series: '', book: 'isbn-1', kind: 'standard-epub' })
  assert.equal(spec.resolved.settings.pageAnchorId, 'seite_{n}')
  assert.equal(spec.resolved.from['STD-14'].level, 'book')
})

test('settings that are free text must be plain names; anything else falls back to the default', () => {
  setSettings({ pdfChapterClass: 'chtit', pageAnchorId: 'pg_{n}', uaPlateLabel: 'Tafeln' })
  assert.equal(settings().pdfChapterClass, 'chtit')
  assert.equal(settings().pageAnchorId, 'pg_{n}')
  assert.equal(settings().uaPlateLabel, 'Tafeln')
  setSettings({ pdfChapterClass: 'two words', pageAnchorId: 'no number here', uaPlateLabel: '<script>' })
  assert.equal(settings().pdfChapterClass, 'ch-head1')
  assert.equal(settings().pageAnchorId, 'Page_{n}')
  assert.equal(settings().uaPlateLabel, 'Plate')
  setSettings(DEFAULT_SETTINGS)
})

test('guard: settings that break the type are refused, in plain words, and the same settings pass for another type', () => {
  const image = { ...baseSettings('standard-epub') }
  assert.deepEqual(outputViolations('standard-epub', image), [], 'a picture title page is fine in a Standard EPUB')
  const acc = outputViolations('accessible-epub', { ...image, titlePageAs: 'image' })
  assert.equal(acc.filter((p) => p.level === 'error').length, 1)
  assert.match(acc[0].message, /picture of text/)
  assert.match(acc[0].message, /WCAG 2\.2 1\.4\.5/)

  const split = outputViolations('accessible-epub', { ...baseSettings('accessible-epub'), chapterOpener: 'split' })
  assert.match(split.find((p) => p.level === 'error')!.message, /real heading/)
  const para = outputViolations('accessible-epub', { ...baseSettings('accessible-epub'), markup: { 'chapter-title': { tag: 'p' } } })
  assert.match(para.find((p) => p.level === 'error')!.message, /not a heading/)

  const claims = outputViolations('standard-epub', baseSettings('standard-epub'), { conformsTo: 'EPUB Accessibility 1.1 - WCAG 2.0 Level AA' })
  assert.equal(claims[0].level, 'error')
  assert.match(claims[0].message, /no accessibility claim/)

  const marks = outputViolations('accessible-pdf', { ...baseSettings('accessible-pdf'), uaBookmarkLevels: 1 })
  assert.equal(marks[0].level, 'warn', 'bookmarks that would list only the title are a warning')
  assert.deepEqual(outputViolations('accessible-pdf', baseSettings('accessible-pdf')), [])
  assert.deepEqual(outputViolations('accessible-epub', baseSettings('accessible-epub')), [])
})

test('every rule that names a setting names one that exists, and ids are unique', () => {
  const ids = RULES.map((r) => r.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const r of RULES) if (r.key) assert.ok(r.key in DEFAULT_SETTINGS, `${r.id} → ${String(r.key)}`)
  for (const id of ['TYP-01', 'FM-03', 'STD-13', 'STD-14', 'STD-15', 'UA-01', 'UA-07']) assert.ok(ruleById.has(id), id)
  const kinds: OutputKind[] = KINDS
  assert.equal(kinds.length, 3)
})
