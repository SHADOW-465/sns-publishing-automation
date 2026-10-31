// Regressions found on the Fire Mission Vietnam sample (REGR-1 to REGR-5).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { continuesIndexLine, linkIndexLocators } from '../src/engine/pdfua/indexlinks.ts'
import { isBoldFont, isItalicFont } from '../src/engine/pdf/layout.ts'

test('REGR-1: only a line of numbers, commas and dashes continues the previous index line', () => {
  assert.equal(continuesIndexLine('42, 44, 77'), true)
  assert.equal(continuesIndexLine('174–8'), true)
  assert.equal(continuesIndexLine('12 - 14'), true)
  assert.equal(continuesIndexLine('101st Field Battery 21, 24'), false, 'a new entry that starts with a digit')
  assert.equal(continuesIndexLine('1st Australian Task Force (1ATF) 42'), false)
  assert.equal(continuesIndexLine('12 passim'), false)
  assert.equal(continuesIndexLine(''), false)
})

test('REGR-2: an abbreviated index range is written out in full and only its first number is a link', () => {
  assert.equal(linkIndexLocators('Australia, return to 174–8, 180'), 'Australia, return to <a href="#pg:174">174</a>–178, <a href="#pg:180">180</a>')
  assert.equal(linkIndexLocators('Rome, 266-69'), 'Rome, <a href="#pg:266">266</a>-269')
  assert.equal(linkIndexLocators('Edge, 199-02'), 'Edge, <a href="#pg:199">199</a>-202')
  assert.equal(linkIndexLocators('Full, 192–195'), 'Full, <a href="#pg:192">192</a>–195', 'a range already in full is left as printed')
})

test('REGR-3: bold and italic font names are recognised whatever their case', () => {
  for (const f of ['ZUHANU+AGaramondPro-Italic', 'AGaramondPro-ITALIC', 'Minion-Oblique', 'MinionPro-It', 'Arial,Italic']) assert.equal(isItalicFont(f), true, f)
  for (const f of ['AGaramondPro-Regular', 'Italian-Text', 'Summit', 'FuturaPT-Book']) assert.equal(isItalicFont(f), false, f)
  for (const f of ['AGaramondPro-Bold', 'AGARAMONDPRO-BOLD', 'FuturaPT-Demi', 'Arial-BoldMT', 'Myriad-SEMIBOLD']) assert.equal(isBoldFont(f), true, f)
  for (const f of ['AGaramondPro-Regular', 'FuturaPT-Book', 'FuturaPT-Medium']) assert.equal(isBoldFont(f), false, f)
})

test('REGR-3: a page number set in italic or bold in the index is still a link', () => {
  assert.equal(linkIndexLocators('Australia, 174–8, <em>174</em>'), 'Australia, <a href="#pg:174">174</a>–178, <em><a href="#pg:174">174</a></em>')
  assert.equal(linkIndexLocators('Arbuthnot 45–7, <em>47–9</em>, <strong>94</strong>'), 'Arbuthnot <a href="#pg:45">45</a>–47, <em><a href="#pg:47">47</a>–49</em>, <strong><a href="#pg:94">94</a></strong>')
  assert.equal(linkIndexLocators('aircraft <em>see by name</em>'), 'aircraft <em>see by name</em>')
})
