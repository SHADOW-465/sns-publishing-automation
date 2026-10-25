// Batch 3B: every picture that enters an EPUB is RGB, tagged, and within the long-side cap.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as jpeg from 'jpeg-js'
import { createCanvas, ImageData } from '@napi-rs/canvas'
import { imageFacts, normaliseEpubImage, prepareEpubImages, rewriteImagePaths, stampDpi } from '../src/engine/epub/image-spec.ts'
import { imageSpecGuards } from '../src/engine/check/guards.ts'
import { setSettings, DEFAULT_SETTINGS } from '../src/engine/settings.ts'

/** 4×3 CMYK JPEG written by Pillow. Not a client file. */
const CMYK = Uint8Array.from(
  'ffd8ffe000104a46494600010101004800480000ffee000e41646f626500640000000000ffdb0043000302020302020303030304030304050805050404050a070706080c0a0c0c0b0a0b0b0d0e12100d0e110e0b0b1016101113141515150c0f171816141812141514ffc000140800030004044311004d11005911004b1100ffc4001f0000010501010101010100000000000000000102030405060708090a0bffc400b5100002010303020403050504040000017d01020300041105122131410613516107227114328191a1082342b1c11552d1f02433627282090a161718191a25262728292a3435363738393a434445464748494a535455565758595a636465666768696a737475767778797a838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7f8f9faffda000e0443004d0059004b00003f00fd38afd1dafd03afba2bffd9'.match(/../g)!,
  (h) => parseInt(h, 16),
)

function solidPng(w: number, h: number, alpha: number): Uint8Array {
  const rgba = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = 20
    rgba[i + 1] = 40
    rgba[i + 2] = 200
    rgba[i + 3] = alpha
  }
  const canvas = createCanvas(w, h)
  canvas.getContext('2d').putImageData(new ImageData(rgba, w, h), 0, 0)
  return new Uint8Array(canvas.toBuffer('image/png'))
}

function rgbJpeg(w: number, h: number): Uint8Array {
  const rgba = new Uint8Array(w * h * 4)
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = 180
    rgba[i + 1] = 40
    rgba[i + 2] = 40
    rgba[i + 3] = 255
  }
  const out = jpeg.encode({ data: rgba, width: w, height: h }, 80) as { data?: Uint8Array } | Uint8Array
  const data = out instanceof Uint8Array ? out : out.data
  if (!data) throw new Error('jpeg encode returned no bytes')
  return new Uint8Array(data)
}

test('an RGB JPEG inside the cap is only tagged, and a second pass does not change it', () => {
  const raw = rgbJpeg(12, 8)
  assert.equal(imageFacts(raw).mode, 'rgb')
  assert.equal(imageFacts(raw).dpi, 0)
  const once = normaliseEpubImage(raw)
  const facts = imageFacts(once)
  assert.equal(facts.width, 12)
  assert.equal(facts.height, 8)
  assert.equal(facts.mode, 'rgb')
  assert.equal(facts.dpi, DEFAULT_SETTINGS.imageDpi)
  assert.equal(once.length < raw.length + 64, true)
  const twice = normaliseEpubImage(once)
  assert.deepEqual(twice, once)
})

test('CMYK becomes RGB, a long side over the cap is scaled down, and a transparent PNG stays a PNG', () => {
  const prev = DEFAULT_SETTINGS.imageMaxPx
  setSettings({ imageMaxPx: 200 })
  try {
    const cmyk = normaliseEpubImage(CMYK)
    const cf = imageFacts(cmyk)
    assert.equal(cf.mode, 'rgb')
    assert.equal(cf.dpi, 300)
    assert.equal(cf.ext, 'jpg')

    const big = normaliseEpubImage(rgbJpeg(210, 40))
    const bf = imageFacts(big)
    assert.ok(bf.width <= 200 && bf.height <= 200)
    assert.equal(Math.max(bf.width, bf.height), 200)
    assert.equal(bf.dpi, 300)
    assert.equal(bf.mode, 'rgb')

    const clear = solidPng(6, 4, 0)
    assert.equal(imageFacts(clear).transparent, true)
    const kept = normaliseEpubImage(clear)
    const kf = imageFacts(kept)
    assert.equal(kf.ext, 'png')
    assert.equal(kf.transparent, true)
    assert.equal(kf.dpi, 300)
    assert.deepEqual(normaliseEpubImage(kept), kept)

    const opaque = solidPng(6, 4, 255)
    const jpg = normaliseEpubImage(opaque)
    assert.equal(imageFacts(jpg).ext, 'jpg')
    assert.equal(imageFacts(jpg).mode, 'rgb')
    const prepared = prepareEpubImages(
      { path: 'images/cover.png', data: opaque },
      [{ path: 'images/plate.png', data: clear }],
    )
    assert.equal(prepared.cover.path, 'images/cover.jpg')
    assert.equal(prepared.images[0].path, 'images/plate.png')
    assert.equal(
      rewriteImagePaths('<img src="images/cover.png"/> <img src="images/plate.png"/>', prepared.renames),
      '<img src="images/cover.jpg"/> <img src="images/plate.png"/>',
    )
  } finally {
    setSettings({ imageMaxPx: prev })
  }
})

test('a header stub is left alone, and the guards name IMG-006, IMG-007 and IMG-008', () => {
  const stub = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0x08, 0, 0, 0, 0, 0x0a])
  assert.equal(normaliseEpubImage(stub), stub)
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>')
  assert.equal(normaliseEpubImage(svg), svg)

  // SOF only: wide enough to trip the cap, four components so the mode is CMYK, no density tag.
  const sof = new Uint8Array([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x14, 0x08,
    0x00, 0x10, 0x08, 0x00, // 16 × 2048
    0x04, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00, 0x04, 0x11, 0x00,
  ])
  assert.equal(imageFacts(sof).real, true)
  assert.equal(imageFacts(sof).mode, 'cmyk')
  const tagged = stampDpi(rgbJpeg(8, 8), 72)
  const files = new Map<string, Uint8Array>([
    ['OEBPS/images/wide.jpg', sof],
    ['OEBPS/images/plate.jpg', tagged],
    ['OEBPS/images/stub.png', stub],
  ])
  const msgs = imageSpecGuards(files).map((r) => r.msg)
  assert.ok(msgs.some((m) => m.startsWith('IMG-007:') && m.includes('wide.jpg')))
  assert.ok(msgs.some((m) => m.startsWith('IMG-008:') && m.includes('CMYK') && m.includes('wide.jpg')))
  assert.ok(msgs.some((m) => m.startsWith('IMG-006:') && m.includes('plate.jpg') && m.includes('72')))
  assert.equal(msgs.some((m) => m.includes('stub.png')), false)
  const fixed = normaliseEpubImage(tagged)
  const after = imageSpecGuards(new Map([['OEBPS/images/plate.jpg', fixed]])).map((r) => r.msg)
  assert.deepEqual(after, [])
})
