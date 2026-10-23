// Where the printed lines sit decides "as the printed page": flush right is justified, a title on the middle is centred.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bodyAlignment, lineAlignment } from '../src/engine/pdfepub/align.ts'
import type { PLine } from '../src/engine/pdfepub/analyze.ts'

const line = (x0: number, x1: number, col = 0): PLine => ({ x0, x1, col }) as PLine

test('body text is justified when most full lines end on the right edge', () => {
  const page = () => ({ lines: Array.from({ length: 8 }, (_, i) => line(50, i === 7 ? 180 : 400)) })
  assert.equal(bodyAlignment([page(), page(), page()], () => true), 'justify')
})

test('body text stays left when the right edge is ragged, or the sample is too short to trust', () => {
  const ragged = () => ({ lines: Array.from({ length: 8 }, (_, i) => line(50, 250 + (i % 5) * 30)) })
  assert.equal(bodyAlignment([ragged(), ragged(), ragged()], () => true), 'left')
  assert.equal(bodyAlignment([{ lines: Array.from({ length: 8 }, () => line(50, 400)) }], () => true), 'left')
})

test('a heading is centred when it sits on the middle of the text and does not share the left edge', () => {
  const page = () => ({ lines: [line(40, 400), line(40, 400), line(40, 400), line(160, 280)] })
  assert.equal(lineAlignment([page(), page()], (l) => l.x0 === 160), 'center')
  const left = () => ({ lines: [line(40, 400), line(40, 400), line(40, 400), line(40, 220)] })
  assert.equal(lineAlignment([left(), left()], (l) => l.x1 === 220), 'left')
})
