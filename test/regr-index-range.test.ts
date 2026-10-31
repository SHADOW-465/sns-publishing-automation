// "167–68" must not collapse onto 167 when a later page is marked. The printed "68" stays "68".
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { linkIndexLocators, resolvePageLinks } from '../src/engine/pdfua/indexlinks.ts'
import { indexRangeGuards } from '../src/engine/check/guards.ts'
import { bytes } from '../src/engine/zip.ts'

test('a range end whose page has no marker links to the nearest marker at or after it', () => {
  const review: { level: 'error'; msg: string }[] = []
  const pages = new Map([['167', 'c.xhtml'], ['170', 'c.xhtml']])
  const html = resolvePageLinks(linkIndexLocators('Writers, 167–68'), pages, review)
  assert.equal(html, 'Writers, <a href="c.xhtml#page-167">167</a>–<a href="c.xhtml#page-170">68</a>')
  assert.deepEqual(review, [])
  const exact = resolvePageLinks(linkIndexLocators('Writers, 167–68'), new Map([['167', 'c.xhtml'], ['168', 'c.xhtml']]), review)
  assert.equal(exact, 'Writers, <a href="c.xhtml#page-167">167</a>–<a href="c.xhtml#page-168">68</a>')
  const before = resolvePageLinks(linkIndexLocators('Writers, 167–68'), new Map([['160', 'a.xhtml'], ['167', 'c.xhtml']]), review)
  assert.equal(before, 'Writers, <a href="c.xhtml#page-167">167</a>–<a href="c.xhtml#page-167">68</a>')
  assert.deepEqual(review, [])
  assert.deepEqual(indexRangeGuards(new Map([['OEBPS/index.xhtml', bytes(`<p>${html}</p>`)]])), [])
  assert.deepEqual(indexRangeGuards(new Map([['OEBPS/index.xhtml', bytes(`<p>${before}</p>`)]])), [])
  const bad = new Map([['OEBPS/index.xhtml', bytes('<p><a href="c.xhtml#page-266">266</a>-<a href="c.xhtml#page-69">69</a></p>')]])
  assert.match(indexRangeGuards(bad)[0].msg, /^IDX-002: the index range 266-69/)
})
