// analyse() used to throw "Cannot read properties of undefined (reading 'length')" when a picture
// listed in the package had no bytes, and the same read threw for a Links file or a nested .epub entry.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyze, inPrintOrder } from '../src/engine/indesign/build.ts'
import { linkFiles } from '../src/engine/indesign/links.ts'
import { rootExport } from '../src/engine/indesign/package.ts'
import { synthExport, SYNTH_CSS } from './synth.ts'
import type { PrintPage } from '../src/engine/pdf/pages.ts'

const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))

test('analyse skips a picture whose bytes are missing instead of reading length of undefined', () => {
  const files = synthExport('<p class="Cuerpo">Words of the opening chapter carry on across the page so the body style is known.</p><img src="image/missing.png" alt=""/>', SYNTH_CSS, 'en-GB', { 'image/missing.png': PNG })
  files.set('OEBPS/image/missing.png', undefined as unknown as Uint8Array)
  const a = analyze(files)
  assert.equal(a.images.some((im) => im.src.endsWith('missing.png')), false)
  assert.ok(a.styles.length > 0)
})

test('a Links file or a nested epub with no bytes is ignored', () => {
  const links = new Map([['Links/photo.jpg', undefined as unknown as Uint8Array]])
  assert.equal(linkFiles(links).size, 0)
  const nested = new Map([['book.epub', undefined as unknown as Uint8Array], ['note.txt', PNG]])
  assert.equal(rootExport(nested).has('note.txt'), true)
})

test('title-page lines stay in export order when the print page has no line list', () => {
  const items = [{ t: 'p' as const, text: 'The Road', el: {} as Element, key: 't', classes: [], page: '1' }]
  const page = { n: '1', text: 'The Road' } as PrintPage
  assert.equal(inPrintOrder(items, page), items)
})
