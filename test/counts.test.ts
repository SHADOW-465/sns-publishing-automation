import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deliveryCounts, extraReview } from '../src/engine/check/counts.ts'
import type { CheckReport } from '../src/engine/check/epub.ts'
import type { ReviewItem } from '../src/engine/epub/package.ts'

const report = (msgs: string[]): CheckReport => ({
  errors: msgs.length,
  warnings: 0,
  stats: { documents: 1, words: 1, pages: 1, images: 1, notes: 0 },
  groups: [{ id: 'a11y', title: 'Accessibility', explain: '', findings: msgs.map((msg) => ({ level: 'error' as const, msg })) }],
})

test('the headline counts a picture description or an ISBN once, and keeps a separate conversion error', () => {
  const review: ReviewItem[] = [
    ...Array.from({ length: 11 }, (_, i) => ({ level: 'error' as const, msg: `Picture img${i}.jpg needs a description (alt text), or mark it as decorative.` })),
    { level: 'error', msg: 'E-book ISBN is missing.' },
    { level: 'error', msg: 'Style p.Texto is set to “left” alignment, but 4 of 5 of its paragraphs are “justify” in the source.' },
    { level: 'info', msg: 'Moved 63 picture(s) to the printed page that contains their caption.' },
  ]
  const findings = report(['Picture description "Bild" is not a real description.', 'E-book ISBN is not a valid ISBN-13.'])
  const c = deliveryCounts(findings, review)
  assert.equal(c.errors, 3)
  assert.equal(extraReview(findings, review).filter((r) => r.level === 'error').length, 1)
  // The old screen added both lists, so the eleven picture notes and the ISBN were counted twice.
  assert.equal(findings.errors + review.filter((r) => r.level === 'error').length, 15)
  assert.equal(deliveryCounts(report(['Picture x has no description.'])).errors, 1)
})

test('a cover that was only measured does not hide a missing upload', () => {
  const measured = report(['Cover image 1594×2480 px.'])
  measured.groups[0].findings[0].level = 'pass'
  measured.errors = 0
  const missing = [{ level: 'error' as const, msg: 'No cover uploaded — used the cover image from the InDesign export. InDesign often exports a blank placeholder: check it.' }]
  assert.equal(deliveryCounts(measured, missing).errors, 1)
  const declared = report(['No cover image is declared: stores will show a blank cover.'])
  assert.equal(deliveryCounts(declared, missing).errors, 1)
})
