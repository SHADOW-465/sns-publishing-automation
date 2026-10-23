// Guards, output-type rules, the JSON settings store, index locators, and the accessible-PDF stage limit.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { indexNumberSpans } from '../src/engine/pdfua/indexlinks.ts'
import { planPages } from '../src/engine/pdfua/write.ts'
import { frontPages, type UaAnalysis } from '../src/engine/pdfua/index.ts'
import { outputViolations } from '../src/engine/output/standards.ts'
import { postBuildGuards } from '../src/engine/check/guards.ts'
import { DEFAULT_SETTINGS } from '../src/engine/settings.ts'
import { emptyLayer } from '../src/engine/spec/layers.ts'
import { JsonFileStore, openStoreFromEnv } from '../src/engine/spec/json-store.ts'
import { MemoryStore } from '../src/engine/spec/store.ts'
import { bytes, type Files } from '../src/engine/zip.ts'

test('index locators are the page numbers after the name, not numbers inside the name', () => {
  assert.deepEqual(indexNumberSpans('Abdera, 55').map((s) => s.pageNo), [55])
  const note = indexNumberSpans('Achaea (province), 60, 305n.129')
  assert.deepEqual(note.map((s) => s.pageNo), [60, 305])
  assert.equal(note[1].end - note[1].start, 3, '305 is the link; n.129 stays beside it')
  assert.deepEqual(indexNumberSpans('World War 2, 14').map((s) => s.pageNo), [14])
  assert.deepEqual(indexNumberSpans('Smith, John, 12, 14').map((s) => s.pageNo), [12, 14])
  const range = indexNumberSpans('Rome, 48–9')
  assert.deepEqual(range.map((s) => s.pageNo), [48])
  assert.equal(range[0].end - range[0].start, 2)
})

test('an accessible EPUB refuses a chapter opening that is not a heading', () => {
  assert.deepEqual(outputViolations('accessible-epub', DEFAULT_SETTINGS), [])
  const split = outputViolations('accessible-epub', { ...DEFAULT_SETTINGS, chapterOpener: 'split' })
  assert.equal(split.filter((p) => p.level === 'error').length, 1)
  assert.match(split[0].message, /heading/)
  const para = outputViolations('accessible-epub', { ...DEFAULT_SETTINGS, stdHeadings: 'paragraph' })
  assert.equal(para.filter((p) => p.level === 'error').length, 0, 'standard-EPUB heading style is not applied on an accessible build')
  const tag = outputViolations('accessible-epub', { ...DEFAULT_SETTINGS, markup: { 'chapter-title': { tag: 'p' } } })
  assert.equal(tag[0].level, 'error')
  const img = outputViolations('accessible-pdf', { ...DEFAULT_SETTINGS, markup: { 'chapter-title': { tag: 'img' } } })
  assert.equal(img[0].level, 'error')
  assert.match(outputViolations('accessible-epub', { ...DEFAULT_SETTINGS, altRequired: 'warn' })[0].message, /warn/i)
})

test('post-build guards name a leaked running head, a bare index number, a broken contents link, and a picture title', () => {
  const files: Files = new Map()
  const page = (name: string, body: string) => files.set(`OEBPS/${name}`, bytes(`<html><body>${body}</body></html>`))
  page('c1.xhtml', '<p>Cambia tu mente</p><p>Real text.</p>')
  page('c2.xhtml', '<p>Cambia tu mente</p><p>More.</p>')
  page('c3.xhtml', '<p>Cambia tu mente</p><p>More.</p>')
  page('index.xhtml', '<p>Abdera, 55, 60, 70, 80, 90</p>')
  page('toc.xhtml', '<a href="missing.xhtml">Gone</a>')
  page('titlepage.xhtml', '<img src="t.jpg" alt=""/>')
  files.set('OEBPS/content.opf', bytes('<package><meta property="schema:accessMode">textual</meta></package>'))
  const msgs = postBuildGuards(files)
  assert.equal(msgs.length, 4)
  assert.match(msgs[0], /running head/)
  assert.match(msgs[1], /index/)
  assert.match(msgs[2], /contents link/)
  assert.match(msgs[3], /title page/)
})

test('the JSON store round-trips a client layer and is the fallback when Supabase is not configured', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'sns-store-')), 'store.json')
  const store = new JsonFileStore(file)
  const layer = emptyLayer('client', 'Arkano')
  layer.values = { 'HD-10': 'spans' }
  await store.saveLayer(layer)
  const again = new JsonFileStore(file)
  const got = await again.getLayer('client', 'arkano')
  assert.equal(got?.values['HD-10'], 'spans')
  assert.ok(openStoreFromEnv({}) instanceof MemoryStore)
  assert.ok(openStoreFromEnv({ SNS_STORE: file }) instanceof JsonFileStore)
})

test('planning the tags stops at once when the stage limit is already used up', async () => {
  const doc = await PDFDocument.create()
  doc.addPage()
  await assert.rejects(planPages(await doc.save(), undefined, { stageLimitMs: 0 }), /Planning the tags stopped/)
})

test('an appended plates PDF is bookmarked Plate', () => {
  const a = {
    book: { pages: [{ lines: [], images: [] }], front: [], imprintPage: undefined },
    meta: { lang: 'en' },
    platePage: 10,
  } as unknown as UaAnalysis
  const plate = frontPages(a).find((p) => p.label === 'Plate')
  assert.deepEqual(plate, { page: 10, label: 'Plate' })
})
