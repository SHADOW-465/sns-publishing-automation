// Batch 8: pictures come from the print PDF, and InDesign's grey "missing link" placeholder is never used silently.
// Synthetic only: no client file is read.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyze } from '../src/engine/indesign/build.ts'
import { isInDesignPlaceholder, missingPictures, pairPictures, exportPictures } from '../src/engine/indesign/pdfpictures.ts'
import { synthExport, synthBook, SYNTH_CSS } from './synth.ts'

/** A JPEG header (SOI + SOF0) for w x h, padded to `bytes`: enough for the size check, no decoding needed. */
function jpeg(w: number, h: number, bytes: number): Uint8Array {
  const b = new Uint8Array(bytes)
  b.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03])
  return b
}

const book = (n: number) =>
  synthExport(synthBook(n, (k) => `<p class="Cuerpo">${'Words go on. '.repeat(20)}</p>\n<img src="images/pic${k}.jpg" alt=""/>\n<p class="Cuerpo">${'More. '.repeat(20)}</p>`), SYNTH_CSS, 'en-GB')

test('an InDesign grey placeholder is told apart from a real picture by its size alone', () => {
  assert.equal(isInDesignPlaceholder(jpeg(1457, 951, 18_943)), true, 'the Vietnam Lago Ba Be placeholder: 0.014 byte/px')
  assert.equal(isInDesignPlaceholder(jpeg(449, 322, 4_673)), true, 'a Tempelhofer placeholder')
  assert.equal(isInDesignPlaceholder(jpeg(1441, 1000, 250_000)), false, 'a real photo (0.17 byte/px)')
  assert.equal(isInDesignPlaceholder(jpeg(36, 44, 1_700)), false, 'a small icon is not a placeholder')
  assert.equal(isInDesignPlaceholder(undefined), false)
})

test('a placeholder in the package counts as missing, so it is taken from the print PDF', () => {
  const a = analyze(book(2))
  const [p1, p2] = exportPictures(a.ex)
  a.ex.images.set(p1, jpeg(1000, 700, 15_000)) // grey placeholder
  a.ex.images.set(p2, jpeg(1000, 700, 200_000)) // real
  assert.deepEqual(missingPictures(a.ex), [p1])
  const pdfPic = jpeg(1900, 1330, 600_000)
  const r = pairPictures(a.ex, [{ page: '', data: pdfPic }])
  assert.equal(r.paired.get(p1), pdfPic)
  assert.deepEqual(r.unmatched, [])
})

test('with one PDF picture for every export picture, every picture comes from the PDF (client spec), in order', () => {
  const a = analyze(book(3))
  const srcs = exportPictures(a.ex)
  for (const s of srcs) a.ex.images.set(s, jpeg(450, 300, 40_000)) // low-res but real
  const pics = srcs.map((_, k) => ({ page: '', data: jpeg(1900, 1200 + k, 500_000) }))
  const r = pairPictures(a.ex, pics)
  assert.equal(r.all, true)
  srcs.forEach((s, k) => assert.equal(r.paired.get(s), pics[k].data))
})

test('a placeholder that cannot be matched to the PDF stays listed, never silently used', () => {
  const a = analyze(book(2))
  for (const s of exportPictures(a.ex)) a.ex.images.set(s, jpeg(1000, 700, 15_000))
  const r = pairPictures(a.ex, [{ page: '', data: jpeg(1900, 1330, 600_000) }, { page: '', data: jpeg(10, 10, 900) }, { page: '', data: jpeg(10, 10, 900) }])
  assert.equal(r.all, false)
  assert.equal(r.paired.size, 1, 'only the PDF picture of the same shape pairs; the tiny marks do not')
  assert.equal(r.unmatched.length, 1)
})
