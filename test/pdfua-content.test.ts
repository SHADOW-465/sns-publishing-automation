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

/** q/Q and marked content must nest as one stack: an EMC closes the BDC opened at the same q depth, a Q never cuts a sequence open inside it. */
function nestingProblems(stream: string): string[] {
  const stack: ('q' | 'mc')[] = []
  const bad: string[] = []
  for (const o of tokenize(stream)) {
    if (o.op === 'q') stack.push('q')
    else if (o.op === 'BDC' || o.op === 'BMC') stack.push('mc')
    else if (o.op === 'Q') stack.pop() === 'q' || bad.push('Q closes a marked-content sequence opened inside it')
    else if (o.op === 'EMC') stack.pop() === 'mc' || bad.push('EMC ends in a different q group than it began')
  }
  if (stack.length) bad.push('unbalanced')
  return bad
}
const painted = (src: string, owner: (n: number) => { el: number; tag: string } | null) => {
  const ops = tokenize(src)
  let n = 0
  return { ops, owners: ops.map((o) => (['S', 'f', 'Do', 'Tj'].includes(o.op) ? owner(++n) : undefined)) }
}
const GROUP = (paint: string) => `q\n0 0 m\n10 10 l\n${paint}\nQ\n`

test('a logo drawn as several q…Q groups of one figure is one marked-content sequence, correctly nested', () => {
  const src = GROUP('S') + GROUP('S') + GROUP('f')
  const { ops, owners } = painted(src, () => ({ el: 7, tag: 'Figure' }))
  const { stream, mcids } = rewrite(src, ops, owners)
  assert.equal(mcids.length, 1, stream)
  assert.deepEqual(nestingProblems(stream), [], stream)
})

test('groups of different elements stay separate sequences and still nest', () => {
  const src = GROUP('S') + GROUP('S')
  const { ops, owners } = painted(src, (n) => ({ el: n, tag: 'P' }))
  const { stream, mcids } = rewrite(src, ops, owners)
  assert.equal(mcids.length, 2, stream)
  assert.deepEqual(nestingProblems(stream), [], stream)
})

test('a group that mixes elements, or holds a text object, is not merged into a figure sequence', () => {
  const src = GROUP('S') + `q\n0 0 m\n5 5 l\nS\nBT\n(a) Tj\nET\n0 0 m\n3 3 l\nS\nQ\n`
  const { ops, owners } = painted(src, (n) => (n === 3 ? { el: 9, tag: 'P' } : { el: 7, tag: 'Figure' }))
  const { stream } = rewrite(src, ops, owners)
  assert.deepEqual(nestingProblems(stream), [], stream)
})
