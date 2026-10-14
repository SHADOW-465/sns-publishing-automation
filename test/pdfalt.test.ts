import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pdfImgHtml, pdfPictureAlt } from '../src/engine/pdfepub/build.ts'

const xmp = (alt: string, long = '') => new TextEncoder().encode(
  `<x:xmpmeta><rdf:RDF><rdf:Description><photoshop:AltTextAccessibility>${alt}</photoshop:AltTextAccessibility>${long ? `<photoshop:ExtDescrAccessibility>${long}</photoshop:ExtDescrAccessibility>` : ''}</rdf:Description></rdf:RDF></x:xmpmeta>`,
)

test('PDF picture alt uses the layered order and never copies the caption', () => {
  const caption = 'The airfield at Tempelhofer Feld in 1938'
  const file = pdfPictureAlt({ name: 'images/pg-12.jpg', jpeg: xmp('A crowd on the tarmac'), width: 180, height: 120, caption })
  assert.equal(file.source, 'file')
  assert.equal(file.alt, 'A crowd on the tarmac')
  assert.equal(file.approved, true)

  const same = pdfPictureAlt({ name: 'images/pg-12.jpg', jpeg: xmp(caption), width: 180, height: 120, caption })
  assert.equal(same.alt, '', 'a description that only repeats the caption is not used')

  const spec = pdfPictureAlt({
    name: 'images/pg-12.jpg',
    jpeg: xmp('From the file'),
    pictures: [{ file: 'pg-12.jpg', alt: 'From the spec sheet', decorative: false, longDesc: 'The long description of the map.' }],
    width: 180,
    height: 120,
    caption,
  })
  assert.equal(spec.source, 'spec')
  assert.equal(spec.alt, 'From the spec sheet')
  assert.equal(spec.longDesc, 'The long description of the map.')

  const typed = pdfPictureAlt({
    name: 'images/pg-12.jpg',
    typed: 'What the reviewer wrote',
    pictures: [{ file: 'pg-12.jpg', alt: 'From the spec sheet', decorative: false, longDesc: '' }],
    jpeg: xmp('From the file'),
    width: 180,
    height: 120,
  })
  assert.equal(typed.source, 'typed')
  assert.equal(typed.alt, 'What the reviewer wrote')

  const cleared = pdfPictureAlt({
    name: 'images/pg-12.jpg',
    typed: '   ',
    pictures: [{ file: 'pg-12.jpg', alt: 'From the spec sheet', decorative: false, longDesc: '' }],
    width: 180,
    height: 120,
  })
  assert.equal(cleared.source, 'spec', 'a blank box is not a typed description')

  const rule = pdfPictureAlt({ name: 'images/pg-4-rule.jpg', width: 400, height: 2 })
  assert.equal(rule.decorative, true)
  assert.equal(rule.alt, '')
  assert.equal(rule.source, 'decorative')

  const ornament = pdfPictureAlt({ name: 'images/ornament.png', width: 80, height: 80 })
  assert.equal(ornament.decorative, true)

  const photo = pdfPictureAlt({ name: 'images/pg-20.jpg', width: 180, height: 120 })
  assert.equal(photo.decorative, false)
  assert.equal(photo.alt, '')

  const html = pdfImgHtml('images/pg-12.jpg', spec)
  assert.match(html.img, /alt="From the spec sheet"/)
  assert.match(html.img, /aria-describedby="ld-images-pg-12-jpg"/)
  assert.match(html.extra, /class="longdesc"/)
  const skip = pdfImgHtml('images/pg-4-rule.jpg', rule, 'cv')
  assert.equal(skip.img, '<img alt="" role="presentation" class="cv" src="images/pg-4-rule.jpg"/>')
  assert.equal(skip.extra, '')
})
