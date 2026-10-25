// Openers set over several lines (PDF flow): part subtitle, split titles, "ACT THREE" read as a chapter number, a lone EPILOGUE.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeOpeners } from '../src/engine/structure/labels.ts'

type S = { type: string; number?: string; numberAsTitle?: string; title: string[]; blocks: { kind: string; html: string }[] }
const pb = (n: number) => ({ kind: 'raw', html: `<span epub:type="pagebreak" id="page-${n}"/>` })
const h = (t: string) => ({ kind: 'raw', html: `<h2 class="subhead"><strong>${t}</strong></h2>` })
const body = (n = 400) => ({ kind: 'p', html: 'word '.repeat(n) })
const tt = (s: S) => s.title.join(' ')

test('part subtitle, label to the chapter, split title joined, part-numbered chapter is a part, lone epilogue joins its title', () => {
  const secs: S[] = [
    { type: 'part', title: ['ACT ONE'], blocks: [pb(28)] },
    { type: 'other', title: ['Your Writing World'], blocks: [h('CHAPTER 1')] },
    { type: 'other', title: ['A ROADMAP'], blocks: [body()] },
    { type: 'other', title: ['WHY WE DO IT'], blocks: [body()] },
    { type: 'other', title: ['THE BLESSING AND'], blocks: [pb(106), h('CHAPTER 4')] },
    { type: 'other', title: ['THE CURSE'], blocks: [body()] },
    { type: 'chapter', number: 'ACT THREE', title: ['Showing Up'], blocks: [pb(224)] },
    { type: 'chapter', number: 'CHAPTER 8', title: [], blocks: [pb(225)] },
    { type: 'chapter', number: 'THE POWER:', title: ['TOWARD MOVES'], blocks: [body()] },
    { type: 'epilogue', title: ['EPILOGUE'], blocks: [pb(297)] },
    { type: 'other', title: ['THE GENIE'], blocks: [body(100)] },
  ]
  const out = mergeOpeners(secs, tt)
  assert.deepEqual(out.map((s) => [s.type, s.number ?? '', tt(s)]), [
    ['part', '', 'ACT ONE Your Writing World'],
    ['chapter', 'CHAPTER 1', 'A ROADMAP'],
    ['chapter', '', 'WHY WE DO IT'],
    ['chapter', 'CHAPTER 4', 'THE BLESSING AND THE CURSE'],
    ['part', 'ACT THREE', 'Showing Up'],
    ['chapter', 'CHAPTER 8', 'TOWARD MOVES'],
    ['epilogue', '', 'EPILOGUE THE GENIE'],
  ])
  assert.equal(out[5].numberAsTitle, 'THE POWER:')
})
