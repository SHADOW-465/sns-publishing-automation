import { test } from 'node:test'
import assert from 'node:assert/strict'
import { titleCase } from '../src/engine/pdfepub/analyze.ts'

test('Roman numerals in an all-caps heading stay capitals', () => {
  assert.equal(titleCase('PART II'), 'Part II')
  assert.equal(titleCase('CHAPTER XIV THE END'), 'Chapter XIV the End')
  assert.equal(titleCase('PART I'), 'Part I')
  assert.equal(titleCase('VIVID DREAMS'), 'Vivid Dreams')
})
