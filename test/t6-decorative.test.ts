// R3: one decorative rule (SPEC-PFG-01). The same picture gets the same decision in the PDF/UA tree (figureChoice) and in the
// EPUB (pdfPictureAlt): size relative to the page, the file-name tokens, a thin-rule test; a caption or text in it keeps it a figure,
// and so does a captioned picture of about its size beside it (a set of photos, Ceramics p. 66).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildStructure, type Figure, type UaRole } from '../src/engine/pdfua/structure.ts'
import { figureChoice } from '../src/engine/pdfua/index.ts'
import { pdfPictureAlt } from '../src/engine/pdfepub/build.ts'
import { decorativeReason, isDecorative } from '../src/engine/epub/alt.ts'
import type { PdfBook, PLine } from '../src/engine/pdfepub/analyze.ts'

const W = 400
const H = 560
const line = (text: string, x0: number, y: number, size = 11): PLine => ({
  runs: [{ text, x0, x1: x0 + text.length * 5, font: 'F', size, bold: false, italic: false }],
  x0, x1: x0 + text.length * 5, y, base: y + size * 0.8, size, font: 'F', text, marker: false, key: 'B 11', page: 0, col: 40,
}) as PLine
const roles = new Map<string, UaRole>([['B 11', 'P']])

/** a picture at (x, top) in page coordinates (y down), w × h points */
type Case = { what: string; x: number; top: number; w: number; h: number; caption?: string; label?: string; twin?: { w: number; h: number }; decorative: boolean }
const cases: Case[] = [
  { what: 'a small picture with no caption (an ornament)', x: 170, top: 300, w: 60, h: 60, decorative: true },
  { what: 'the same picture with a caption', x: 170, top: 300, w: 60, h: 60, caption: 'Figure 1. A small map of the coast', decorative: false },
  { what: 'a thin rule wider than an ornament', x: 50, top: 300, w: 300, h: 6, decorative: true },
  { what: 'a photo', x: 100, top: 200, w: 200, h: 150, decorative: false },
  { what: 'a tiny picture with a caption', x: 190, top: 300, w: 20, h: 20, caption: 'Figure 2. The seal of the city', decorative: false },
  { what: 'a small picture with a label drawn in it', x: 170, top: 300, w: 60, h: 60, label: 'N', decorative: false },
  { what: 'an uncaptioned photo beside a captioned one of about its size', x: 40, top: 300, w: 110, h: 100, twin: { w: 100, h: 90 }, decorative: false },
  { what: 'a small ornament beside a captioned photo much larger', x: 40, top: 300, w: 50, h: 40, twin: { w: 250, h: 160 }, decorative: true },
]
const TWIN_CAPTION = 'Figure 3. The next section joined on'
const twinBox = (c: Case) => c.twin && { x: c.x + c.w + 20, w: c.twin.w, h: c.twin.h }

const uaDecision = (c: Case) => {
  const box = (x: number, w: number, h: number) => ({ x0: x, x1: x + w, y0: H - c.top - h, y1: H - c.top })
  const fig: Figure = { page: 0, box: box(c.x, c.w, c.h), lines: [], caption: '', vector: false }
  const t = twinBox(c)
  const figs = t ? [fig, { page: 0, box: box(t.x, t.w, t.h), lines: [], caption: '', vector: false } as Figure] : [fig]
  const lines = [line('A paragraph of body text that runs on for a while.', 40, 60), line('And a second line of the same paragraph.', 40, 74)]
  if (c.caption) lines.push(line(c.caption, c.x, c.top + c.h + 6))
  if (c.label) lines.push(line(c.label, c.x + 20, c.top + 20))
  if (t) lines.push(line(TWIN_CAPTION, t.x, c.top + t.h + 6))
  const book = { pages: [{ index: 0, width: W, height: H, lines, images: [], fills: [], rules: { h: [], v: [] }, shades: [] }], front: [], lead: 14, step: 18, bodySize: 11, numbers: [1] } as unknown as PdfBook
  const f = buildStructure(book, roles, new Map([[0, figs]])).figures.find((f) => f.box.x0 === c.x)!
  assert.equal(f.caption, c.caption ?? '', `${c.what}: caption paired in PDF/UA`)
  return figureChoice({ key: 'k', caption: f.caption, alt: {}, ornamentArtifact: !!f.ornament }).decorative
}
const epubDecision = (c: Case) =>
  pdfPictureAlt({
    name: 'images/pg-1.jpg', width: c.w, height: c.h, caption: c.caption, text: !!c.label,
    page: { width: W, figures: [{ width: c.w, height: c.h, caption: c.caption }, ...(c.twin ? [{ width: c.twin.w, height: c.twin.h, caption: TWIN_CAPTION }] : [])] },
  }).decorative

test('R3: every picture gets the same decorative decision in PDF/UA and EPUB', () => {
  for (const c of cases) {
    assert.equal(uaDecision(c), c.decorative, `PDF/UA: ${c.what}`)
    assert.equal(epubDecision(c), c.decorative, `EPUB: ${c.what}`)
  }
})

test('R3: isDecorative is the one rule; decorativeReason (no page known) keeps the file-name, thin-rule and tiny tests', () => {
  assert.match(isDecorative({ width: 60, height: 60 }, { width: W }) ?? '', /ornament/i)
  assert.equal(isDecorative({ width: 60, height: 60, caption: 'Figure 1' }, { width: W }), undefined)
  assert.equal(isDecorative({ width: 60, height: 60, text: true }, { width: W }), undefined)
  assert.equal(isDecorative({ width: 60, height: 60, logo: true }, { width: W }), undefined)
  assert.equal(isDecorative({ width: 130, height: 60 }, { width: W }), undefined)
  assert.equal(decorativeReason({ name: 'images/pg-1.jpg', width: 60, height: 60 }), undefined)
  assert.match(decorativeReason({ name: 'images/zierleiste.png', width: 900, height: 60 }) ?? '', /ornament/i)
})
