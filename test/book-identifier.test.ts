import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bookUid, epubFileName } from '../src/engine/epub/package.ts'

test('a valid e-book ISBN is the identifier and the file name', () => {
  assert.equal(bookUid({ eisbn: '978-0-306-40615-7', title: 'X' }), 'urn:isbn:9780306406157')
  assert.equal(epubFileName({ eisbn: '978-0-306-40615-7', title: 'X' }), '9780306406157.epub')
})

test('no or invalid ISBN: a title-derived uuid and a marked NO-ISBN file name, never an ISBN', () => {
  const a = bookUid({ title: 'Dinámicas contemporáneas' })
  assert.match(a, /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.equal(a, bookUid({ title: 'Dinámicas contemporáneas' }))
  assert.notEqual(a, bookUid({ title: '1066 Churches' }))
  assert.match(bookUid({ eisbn: '979-13-88228-26-0', title: 'Y' }), /^urn:uuid:/)
  assert.equal(epubFileName({ title: 'Dinámicas contemporáneas / vol. 1' }), 'NO-ISBN_Dinamicas-contemporaneas-vol-1.epub')
  assert.equal(epubFileName({}), 'NO-ISBN_book.epub')
})
