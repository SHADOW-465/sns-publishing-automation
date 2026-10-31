// Regressions found on the Fire Mission Vietnam sample (REGR-1 to REGR-5).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { continuesIndexLine } from '../src/engine/pdfua/indexlinks.ts'

test('REGR-1: only a line of numbers, commas and dashes continues the previous index line', () => {
  assert.equal(continuesIndexLine('42, 44, 77'), true)
  assert.equal(continuesIndexLine('174–8'), true)
  assert.equal(continuesIndexLine('12 - 14'), true)
  assert.equal(continuesIndexLine('101st Field Battery 21, 24'), false, 'a new entry that starts with a digit')
  assert.equal(continuesIndexLine('1st Australian Task Force (1ATF) 42'), false)
  assert.equal(continuesIndexLine('12 passim'), false)
  assert.equal(continuesIndexLine(''), false)
})
