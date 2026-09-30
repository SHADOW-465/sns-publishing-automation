// Marked content must never start or end inside a path object (PAC "PDF Syntax"), and glued operators ("lS") are read as two.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tokenize, rewrite } from '../src/engine/pdfua/content.ts'
import { xmpPacket } from '../src/engine/pdfua/write.ts'

test('marked content wraps whole path objects', () => {
  const src = 'q 1 0 0 1 15 687 cm\n0 0 m\n-15 0 l\n9 9 m\n451.2 -687.3 lS\nQ\n5 5 10 10 ref\n'
  const ops = tokenize(src)
  assert.deepEqual(ops.map((o) => o.op), ['q', 'cm', 'm', 'l', 'm', 'l', 'S', 'Q', 're', 'f'])
  const { stream } = rewrite(src, ops, ops.map(() => null))
  assert.ok(/BMC\s+0 0 m/.test(stream), 'sequence opens before the first path operator')
  assert.ok(/l S\s+EMC/.test(stream), 'and closes after the paint operator')
  assert.ok(!/\blS\b|\bref\b/.test(stream), 'glued operators are separated')
})

test('XMP packet is valid UTF-8 with its dashes', () => {
  const bytes = new TextEncoder().encode(xmpPacket({ title: 'A — B', author: '', subject: '', keywords: '', lang: 'en', isbn: '' } as never))
  assert.doesNotThrow(() => new TextDecoder('utf-8', { fatal: true }).decode(bytes))
})
