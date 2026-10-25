// Links typed in the layout with spaces, accents or a bare "%" must come out as valid URLs (EPUBCheck RSC-020).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeHref } from '../src/engine/indesign/inline.ts'

test('hrefs with spaces, accents, trailing blanks or a bare % are encoded', () => {
  assert.equal(normalizeHref('http://www.facebook.com/standingbarhanoi ', ''), 'http://www.facebook.com/standingbarhanoi')
  assert.equal(normalizeHref('http://www.facebook.com/Mr Luyen homestay', ''), 'http://www.facebook.com/Mr%20Luyen%20homestay')
  assert.equal(normalizeHref('http://www.facebook.com/Bông Bang', ''), 'http://www.facebook.com/B%C3%B4ng%20Bang')
  assert.equal(normalizeHref('https://example.org/100%real', ''), 'https://example.org/100%25real')
  assert.equal(normalizeHref('https://example.org/a%20b', ''), 'https://example.org/a%20b')
  assert.equal(normalizeHref('', 'www.example.org/x y'), 'https://www.example.org/x%20y')
  assert.equal(normalizeHref('mailto: a@b.org', ''), 'mailto:a@b.org')
})
