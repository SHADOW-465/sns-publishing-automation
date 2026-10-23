// The Standard EPUB conversion follows settings, not fixed regexes: anchor names and place, emphasis tags, decorative alt, page links.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toStandard, pageAnchorId } from '../src/engine/epub/package.ts'
import { STD_DEFAULTS } from '../src/engine/settings.ts'

const L = { imageAlt: 'image', decorativeAlt: 'decorative' }
const body = [
  '<span aria-label="page 13" epub:type="pagebreak" id="page-13" role="doc-pagebreak" title="page 13"/>',
  '<h1 class="ch-head1" id="chap1">1 Discovering</h1>',
  '<p class="noindent">A <span class="italic">book</span> and <span class="bold">bold</span> and <span class="bold italic">both</span>.</p>',
  '<p class="index">archive <a href="chapter01.xhtml#page-13">13</a>, <a href="chapter02.xhtml#page-40">40</a></p>',
  '<p class="image_Container"><img alt="" src="images/a.jpg"/></p>',
].join('\n')

test('an anchor is named by the pattern, and a link to the printed page follows it', () => {
  const out = toStandard(body, L, { ...STD_DEFAULTS, pageAnchorId: 'pg_{n}', pageAnchorPlace: 'before' })
  assert.match(out, /<a id="pg_13"\/>/)
  assert.doesNotMatch(out, /Page_13/)
  assert.match(out, /href="chapter01\.xhtml#pg_13"/)
  assert.match(out, /href="chapter02\.xhtml#pg_40"/)
  const defaults = toStandard(body, L, STD_DEFAULTS)
  assert.match(defaults, /<a id="Page_13"\/>/)
  assert.match(defaults, /href="chapter01\.xhtml#Page_13"/, 'an index link no longer points at an id that is gone')
})

test('the anchor can sit inside the block that starts the page, so a chapter title has nothing in front of it', () => {
  const inside = toStandard(body, L, { ...STD_DEFAULTS, pageAnchorId: 'pg_{n}', pageAnchorPlace: 'inside' })
  assert.match(inside, /<p class="ch-head1" id="chap1"><a id="pg_13"\/>1 Discovering<\/p>/)
  const before = toStandard(body, L, { ...STD_DEFAULTS, pageAnchorPlace: 'before' })
  assert.match(before, /<a id="Page_13"\/>\n<p class="ch-head1"/)
})

test('no page markers: links to a printed page keep the file and lose the dead fragment', () => {
  const none = toStandard(body, L, { ...STD_DEFAULTS, stdPageMarks: 'none' })
  assert.doesNotMatch(none, /#page-|#Page_/)
  assert.match(none, /href="chapter01\.xhtml"/)
})

test('emphasis: <b>/<i>, <em>/<strong>, or spans, one form throughout', () => {
  assert.match(toStandard(body, L, { ...STD_DEFAULTS, stdEmphasis: 'bi' }), /A <i>book<\/i> and <b>bold<\/b> and <b><i>both<\/i><\/b>/)
  assert.match(toStandard(body, L, { ...STD_DEFAULTS, stdEmphasis: 'semantic' }), /A <em>book<\/em> and <strong>bold<\/strong> and <strong><em>both<\/em><\/strong>/)
  assert.match(toStandard(body, L, { ...STD_DEFAULTS, stdEmphasis: 'span' }), /<span class="italic">book<\/span>/)
  const mixed = toStandard('<p>x <em>a</em> <strong>b</strong></p>', L, { ...STD_DEFAULTS, stdEmphasis: 'bi' })
  assert.equal(mixed, '<p>x <i>a</i> <b>b</b></p>')
})

test('a decorative picture is described with nothing, or with the word for it', () => {
  assert.match(toStandard(body, L, { ...STD_DEFAULTS, altDecorative: 'empty' }), /<img alt="" src="images\/a\.jpg"\/>/)
  assert.match(toStandard(body, L, { ...STD_DEFAULTS, altDecorative: 'word' }), /<img alt="decorative"/)
  assert.match(toStandard('<img alt="A woman" src="b.jpg"/>', L, { ...STD_DEFAULTS, altDecorative: 'empty' }), /alt="image"/, 'a described picture gets the generic word (STD-09)')
})

test('pageAnchorId fills in the page number', () => {
  assert.equal(pageAnchorId('7', 'pg_{n}'), 'pg_7')
  assert.equal(pageAnchorId('xii'), 'Page_xii')
})
