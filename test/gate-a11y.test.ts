import { test } from 'node:test'
import assert from 'node:assert/strict'
import { strToU8 } from 'fflate'
import { pageRules } from '../src/engine/check/gate.ts'

const page = (body: string) => strToU8(`<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>${body}</body></html>`)

test('gate stage 3 finds empty links, repeated ids, headerless tables and skipped heading levels', () => {
  const bad = pageRules(new Map([['OEBPS/a.xhtml', page('<h1 id="x">A</h1><h3>B</h3><p id="x"><a href="b.xhtml"></a></p><table><tr><td>1</td></tr></table>')]]))
  assert.deepEqual(bad.errors, ['a.xhtml: the id "x" is used twice', 'a.xhtml: a link to "b.xhtml" has no text'])
  assert.equal(bad.warnings.length, 2)
  assert.match(bad.warnings.join('|'), /jumps from h1 to h3/)
  const ok = pageRules(new Map([['OEBPS/a.xhtml', page('<h1>A</h1><h2>B</h2><p><a href="b.xhtml">go</a></p><table><thead><tr><th>1</th></tr></thead></table>')]]))
  assert.deepEqual(ok, { errors: [], warnings: [] })
})
