// Thumbnails must follow the bytes. A PNG stored under a .jpg name, or passed with a JPEG hint, still decodes as PNG.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { imageMime } from '../src/engine/epub/image.ts'

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])

test('imageMime trusts the bytes over a caller hint', () => {
  assert.equal(imageMime(png, 'image/jpeg'), 'image/png')
  assert.equal(imageMime(jpg, 'image/png'), 'image/jpeg')
  assert.equal(imageMime(new Uint8Array([1, 2, 3, 4]), 'image/jpeg'), 'image/jpeg')
  assert.equal(imageMime(new Uint8Array([1, 2, 3, 4])), '')
  // a zip entry is often a view into a larger buffer
  const buf = new Uint8Array(16)
  buf.set(png, 4)
  assert.equal(imageMime(buf.subarray(4, 12), 'image/jpeg'), 'image/png')
})
