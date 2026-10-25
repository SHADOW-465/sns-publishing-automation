// Step 4 (Structure) froze on every real book: each unplaced picture (score 0) and each unknown section (0.4) blocked
// "Next" and had to be accepted one by one (Vietnam sample: 83 pictures + 147 sections). acceptAllIds clears them in one go.
import test from 'node:test'
import assert from 'node:assert/strict'
import { blockingItems, acceptAllIds, acceptable } from '../src/engine/review/confidence.ts'

const items = [
  ...Array.from({ length: 83 }, (_, i) => ({ id: `picture:OEBPS/image/${i}.jpg`, area: 'picture' as const, score: 0 })),
  ...Array.from({ length: 147 }, (_, i) => ({ id: `section:${i}`, area: 'section' as const, score: 0.4 })),
  { id: 'notes:footnote', area: 'note' as const, score: 0.5 },
  { id: 'note:3', area: 'meta' as const, score: 0.4 }, // build message: never blocks
  { id: 'nav:2', area: 'section' as const, score: 0.4 }, // untitled part: never blocks
  { id: 'style:tital', area: 'style' as const, score: 0.55 },
  { id: 'meta:publisher', area: 'meta' as const, score: 0.3 },
  { id: 'style:ok', area: 'style' as const, score: 0.9 },
]

test('a real-size book blocks on hundreds of items before any decision', () => {
  assert.equal(blockingItems(items, new Set()).length, 83 + 147 + 1 + 2)
})

test('accept all clears pictures, notes and sections in one click; styles and book details still need a choice', () => {
  const all = acceptAllIds(items, new Set())
  assert.equal(all.length, 83 + 147 + 1)
  const left = blockingItems(items, new Set(all)).map((x) => x.id).sort()
  assert.deepEqual(left, ['meta:publisher', 'style:tital'])
  // once those are decided (their items leave the list), step 4 opens
  assert.equal(blockingItems(items.filter((x) => !left.includes(x.id)), new Set(all)).length, 0)
})

test('only pictures, note findings and unknown sections can be accepted as they are', () => {
  assert.ok(acceptable({ id: 'section:4', area: 'section' }))
  assert.ok(!acceptable({ id: 'nav:4', area: 'section' }))
  assert.ok(!acceptable({ id: 'note:1', area: 'note' }))
  assert.ok(!acceptable({ id: 'style:x', area: 'style' }))
  assert.ok(!acceptable({ id: 'meta:title', area: 'meta' }))
})
