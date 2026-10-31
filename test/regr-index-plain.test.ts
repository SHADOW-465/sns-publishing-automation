// A number in an index entry is a page locator only when that page was marked. "Main Force 275 Regiment" is not.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { linkIndexLocators, resolvePageLinks } from '../src/engine/pdfua/indexlinks.ts'

const pages = new Map([['12', 'chapter.xhtml'], ['201', 'index.xhtml'], ['40', 'c.xhtml']])

test('a number in an index heading with no page marker stays plain text, and a missing locator is not sent to an earlier page', () => {
  const review: { level: 'error'; msg: string }[] = []
  const html = resolvePageLinks(linkIndexLocators('Main Force 275 Regiment, 12'), pages, review)
  assert.equal(html, 'Main Force 275 Regiment, <a href="chapter.xhtml#page-12">12</a>')
  assert.equal(html.includes('275'), true)
  assert.equal(html.includes('#page-201'), false)
  assert.deepEqual(review, [])
  const missing = resolvePageLinks(linkIndexLocators('Entry, 180'), pages, review)
  assert.equal(missing, 'Entry, 180')
  assert.equal(missing.includes('#page-40'), false)
  assert.deepEqual(review, [])
  // a locator whose page exists still links, even when a word follows it
  const passim = resolvePageLinks(linkIndexLocators('Entry, 12 passim'), pages, review)
  assert.equal(passim, 'Entry, <a href="chapter.xhtml#page-12">12</a> passim')
  assert.deepEqual(review, [])
})
