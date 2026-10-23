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
  assert.ok(/f\s+EMC/.test(stream), 'the same artifact continues across Q, and closes after the last paint')
  assert.ok(!/\blS\b|\bref\b/.test(stream), 'glued operators are separated')
})

test('one figure stays one marked-content sequence across q and Q', () => {
  const src = '0 0 m\n10 10 l\nS\nq\n0 0 m\n5 5 l\nS\nQ\n'
  const ops = tokenize(src)
  const owner = { el: 7, tag: 'Figure' }
  const { stream, mcids } = rewrite(src, ops, ops.map((o) => (o.op === 'S' ? owner : undefined)))
  assert.equal(mcids.length, 1, stream)
  assert.equal((stream.match(/\/Figure/g) ?? []).length, 1)
})

test('q does not glue two different elements into one sequence', () => {
  const src = '0 0 m\n10 10 l\nS\nq\n0 0 m\n5 5 l\nS\nQ\n'
  const ops = tokenize(src)
  let n = 0
  const owners = ops.map((o) => (o.op === 'S' ? { el: ++n, tag: 'P' } : undefined))
  const { stream, mcids } = rewrite(src, ops, owners)
  assert.equal(mcids.length, 2, stream)
  assert.match(stream, /S\s+EMC\s+q/)
})

test('XMP packet is valid UTF-8 with its dashes', () => {
  const bytes = new TextEncoder().encode(xmpPacket({ title: 'A — B', author: '', subject: '', keywords: '', lang: 'en', isbn: '' } as never))
  assert.doesNotThrow(() => new TextDecoder('utf-8', { fatal: true }).decode(bytes))
})
