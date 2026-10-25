// PDF flow chapter splitting: a chapter cut at its opener ("CHAPTER 1" | title + body, or title | "CHAPTER 1" + body) is one file.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeLabelSections, isLabelLine, type MergeSec } from '../src/engine/structure/labels.ts'

type S = MergeSec & { name: string }
const sec = (type: string, name: string, body: string[] = [], number?: string): S => ({ type, name, number, title: name ? [name] : [], blocks: body.map((html) => ({ kind: 'p', html })) })
const pb = (n: number) => ({ kind: 'raw', html: `<span epub:type="pagebreak" id="page-${n}"/>` })
const tt = (s: S) => s.name

test('label lines in several languages', () => {
  for (const t of ['CHAPTER 1', 'Chapter 12.', 'ACT ONE', 'Part II', 'Kapitel 3', 'Capitolo 4', '7', 'XIV']) assert.ok(isLabelLine(t), t)
  for (const t of ['Your Writing World', 'Chapter 1 begins here with text', 'Normandy']) assert.ok(!isLabelLine(t), t)
})

test('"Title" alone then "CHAPTER 1" + body (Your Writers Block) = one chapter', () => {
  const a = sec('other', 'Your Writing World'); a.blocks.push(pb(5))
  const b = sec('other', 'CHAPTER 1', ['Body one.', 'Body two.'])
  const out = mergeLabelSections([a, b], tt)
  assert.equal(out.length, 1)
  assert.equal(out[0].type, 'chapter')
  assert.equal(out[0].number, 'CHAPTER 1')
  assert.equal(out[0].blocks.filter((x) => x.kind === 'p').length, 2)
})

test('"CHAPTER 8." alone then title + body = one chapter; a part opener stays its own file', () => {
  const part = sec('other', 'ACT ONE')
  const lab = sec('chapter', '', [], 'CHAPTER 8.')
  const body = sec('other', 'The Blessing', ['Body.'])
  const out = mergeLabelSections([part, lab, body], tt)
  assert.deepEqual(out.map((s) => [s.type, s.name, s.number]), [['part', 'ACT ONE', undefined], ['chapter', 'The Blessing', 'CHAPTER 8.']])
  assert.ok(out.every((s, i) => i === 0 || s.blocks.length))
})

test('a section titled "Chapter 2 …" is a chapter, not back matter', () => {
  const out = mergeLabelSections([sec('other', 'Chapter 2 King William', ['Body.'])], tt)
  assert.equal(out[0].type, 'chapter')
})
