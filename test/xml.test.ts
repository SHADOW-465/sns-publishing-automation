// The shared path helper and the in-app package check: links the source or a reviewer typed must not crash the build.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolvePath } from '../src/engine/xml.ts'
import { validateEpub } from '../src/engine/epub/validate.ts'
import { bytes } from '../src/engine/zip.ts'

const page = (body: string) => bytes(`<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body><h1>t</h1>${body}</body></html>`)
const opf = bytes(`<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf"><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/></manifest></package>`)

test('resolvePath: a stray "%" is not an escape and does not throw', () => {
  assert.equal(resolvePath('OEBPS/a.xhtml', '100%25.xhtml'), 'OEBPS/100%.xhtml')
  assert.equal(resolvePath('OEBPS/a.xhtml', '50%off.xhtml'), 'OEBPS/50%off.xhtml')
  const out = validateEpub(new Map([['OEBPS/content.opf', opf], ['OEBPS/a.xhtml', page('<p><a href="www.example.org/100%">x</a></p>')]]))
  assert.ok(out.some((x) => /Broken link "www\.example\.org\/100%"/.test(x.msg)), JSON.stringify(out))
})
