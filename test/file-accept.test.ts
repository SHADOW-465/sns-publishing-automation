import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileAllowed, rejectText } from '../src/ui/file-accept.ts'

test('each slot accepts its own kind of file, including when Windows leaves the type empty', () => {
  const pdf = 'application/pdf'
  const image = 'image/jpeg,image/png'
  assert.equal(fileAllowed(pdf, { name: 'book.pdf', type: '' }), true)
  assert.equal(fileAllowed(pdf, { name: 'cover.jpg', type: '' }), false)
  assert.equal(fileAllowed(pdf, { name: 'cover.jpg', type: 'image/jpeg' }), false)
  assert.equal(fileAllowed(image, { name: 'cover.JPEG', type: '' }), true)
  assert.equal(fileAllowed(image, { name: 'cover.png', type: 'application/octet-stream' }), true)
  assert.equal(fileAllowed(image, { name: 'book.pdf', type: 'application/pdf' }), false)
  assert.equal(fileAllowed('.zip,.epub', { name: 'export.epub', type: '' }), true)
  assert.equal(rejectText(pdf), 'Only a PDF can go here.')
  assert.equal(rejectText(image), 'Only a JPG or PNG image can go here.')
})
