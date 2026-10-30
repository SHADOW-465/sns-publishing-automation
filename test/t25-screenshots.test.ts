// T25: the client's 24 Oct correction screenshots, one row each in test/eval-screenshots.csv, loaded into the eval set.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { loadEvalSet, parseShots, TAGS } from './eval-set.ts'

const sacgeo = () => loadEvalSet().books.find((b) => b.id === 'sacgeo')!
const shots = () => sacgeo().pages.filter((p) => p.shot)

test('T25: all 30 screenshots are in the eval set, each with its page, what is wrong and the expected tag', () => {
  assert.deepEqual(shots().map((p) => p.shot), Array.from({ length: 30 }, (_, i) => `image${i + 1}`))
  for (const p of shots()) {
    assert.ok(p.wrong && p.expected && p.kind, p.shot!)
    assert.ok(TAGS.includes(p.tag!), `${p.shot} tag "${p.tag}"`)
    assert.ok(p.page === null ? p.shot === 'image21' : Number.isInteger(p.page), `${p.shot} page ${p.page}`)
  }
  const by = (s: string) => shots().find((p) => p.shot === s)!
  assert.equal(by('image20').tag, 'Caption') // "Figura 7.2" tagged P
  assert.equal(by('image20').page, 139)
  assert.equal(by('image3').expected, 'running head as Artifact, not Figure') // a comma and quotes survive the sheet
  assert.equal(by('image12').wrong!.includes('"Introducción de Barbara"'), true)
})

test('T25: the sheet is the only home of the screenshots, and the other eval pages are still loaded', () => {
  const raw = JSON.parse(readFileSync('test/eval-pages.json', 'utf8')) as { books: { pages: { shot?: string }[] }[] }
  assert.equal(raw.books.flatMap((b) => b.pages).filter((p) => p.shot).length, 0)
  assert.ok(sacgeo().pages.some((p) => p.page === 249 && !p.shot))
  assert.ok(loadEvalSet().books.some((b) => b.id === 'gladiators'))
})

test('T25: a sheet row with no tag, an unknown tag, a bad page or a repeated shot is refused', () => {
  const head = 'book,shot,page,kind,tag,wrong,expected\n'
  assert.equal(parseShots(head + 'sacgeo,image1,8,artifact,Artifact,w,e\n').length, 1)
  assert.throws(() => parseShots(head + 'sacgeo,image1,8,artifact,,w,e\n'), /image1.*tag/)
  assert.throws(() => parseShots(head + 'sacgeo,image1,8,artifact,Banana,w,e\n'), /image1.*tag/)
  assert.throws(() => parseShots(head + 'sacgeo,image1,x,artifact,Artifact,w,e\n'), /image1.*page/)
  assert.throws(() => parseShots(head + 'sacgeo,image1,8,artifact,Artifact,w,e\nsacgeo,image1,9,artifact,Artifact,w,e\n'), /image1.*twice/)
})
