// PDF/UA gaps from the Accessible-PDF notes and the PAC reports: tables, note links,
// a language on the element that differs from the document, and decorative pictures as artifacts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { type PdfBook, type PLine } from '../src/engine/pdfepub/analyze.ts'
import { buildStructure, type Figure, type UaRole } from '../src/engine/pdfua/structure.ts'
import { planPages, writeUa } from '../src/engine/pdfua/write.ts'
import { pageContent } from '../src/engine/pdfua/pages.ts'
import { figureChoice, specForFigures } from '../src/engine/pdfua/index.ts'

const line = (text: string, x0: number, x1: number, y: number, size: number, key: string, bold = false): PLine => ({
  runs: [{ text, x0, x1, font: bold ? 'Helvetica-Bold' : 'Helvetica', size, bold, italic: false }],
  x0, x1, y, base: y + size * 0.8, size, font: bold ? 'Helvetica-Bold' : 'Helvetica', text, marker: false,
  key, page: 0, col: 40,
})

test('a ruled grid is a table and a note number stays a note', () => {
  const cells = [
    line('Name', 48, 90, 182, 10, 'Helvetica-Bold 10', true),
    line('Wert', 160, 200, 182, 10, 'Helvetica-Bold 10', true),
    line('Uno', 48, 80, 204, 10, 'Helvetica 10'),
    line('Dos', 160, 190, 204, 10, 'Helvetica 10'),
  ]
  const body = line('The author of the book was in the house and the story was for the reader.', 40, 360, 80, 11, 'Helvetica 11')
  const mark = line('1', 370, 378, 78, 7, 'Helvetica 7')
  const note = line('1 See the earlier line for the source of this claim today.', 40, 300, 480, 9, 'Helvetica 9')
  const book = {
    pages: [{
      index: 0, width: 420, height: 560, lines: [body, mark, ...cells, note], images: [], fills: [],
      rules: {
        h: [180, 200, 220].map((p) => ({ a: 40, b: 280, p })),
        v: [40, 150, 280].map((p) => ({ a: 180, b: 220, p })),
      },
      shades: [],
    }],
    front: [], lead: 14, step: 18, bodySize: 11, numbers: [1],
  } as unknown as PdfBook
  const roles = new Map<string, UaRole>([
    ['Helvetica 11', 'P'], ['Helvetica 7', 'Inline'], ['Helvetica 9', 'Note'], ['Helvetica 10', 'P'], ['Helvetica-Bold 10', 'P'],
  ])
  const st = buildStructure(book, roles, new Map())
  const table = st.root.kids.find((n) => n.tag === 'Table') ?? st.nodes.find((n) => n.tag === 'Table')
  assert.ok(table, 'table element')
  assert.equal(table!.kids.length, 2)
  assert.deepEqual(table!.kids[0].kids.map((c) => c.tag), ['TH', 'TH'])
  assert.deepEqual(table!.kids[0].kids.map((c) => c.scope), ['Column', 'Column'])
  assert.deepEqual(table!.kids[1].kids.map((c) => c.text), ['Uno', 'Dos'])
  assert.equal(st.nodes.filter((n) => n.tag === 'Note').length, 1)
  const markOwner = st.owner.get(mark)
  assert.equal(markOwner?.tag, 'P')
  assert.ok(!st.nodes.some((n) => n.tag === 'P' && n.lines.some((l) => l.text === 'Name')))
})

test('spec rows match a caption, and description layers keep their order', () => {
  const specs = [{ file: 'Map 1.png', alt: 'A coastal map of the field.', decorative: false, longDesc: '' }]
  const matched = specForFigures([{ key: '2:10:20', caption: 'Map 1 The coast road' }], specs)
  assert.equal(matched['2:10:20'].alt, 'A coastal map of the field.')
  assert.equal(Object.keys(specForFigures([{ key: '1:0:0', caption: 'Plate' }], specs)).length, 0)

  const spec = { 'k': { alt: 'From the spec sheet, a real sentence.', decorative: false } }
  const ai = { 'k': { alt: 'An unapproved draft of the picture that is long enough.', approved: false } }
  assert.equal(figureChoice({ key: 'k', caption: 'Map 1', alt: { k: 'Typed by hand' }, spec, ai }).alt, 'Typed by hand')
  const open = figureChoice({ key: 'k', caption: 'Map 1', alt: {}, spec: {}, ai })
  assert.equal(open.pendingAi, true)
  assert.equal(figureChoice({ key: 'k', caption: 'Map 1', alt: {}, spec, ai }).alt, spec.k.alt)
  assert.equal(figureChoice({ key: 'k', caption: 'Map 1', alt: {}, decorative: { k: true }, spec, ai }).decorative, true)
  assert.equal(figureChoice({ key: 'k', caption: 'Map 1 The coast', alt: {}, spec: { k: { alt: '', decorative: true } } }).decorative, true)
})

test('written tags carry the table, the note link, a foreign language, and a decorative artifact', async () => {
  const H = 560
  const cells = [
    line('Name', 48, 90, 182, 10, 'Helvetica-Bold 10', true),
    line('Wert', 160, 200, 182, 10, 'Helvetica-Bold 10', true),
    line('Uno', 48, 80, 204, 10, 'Helvetica 10'),
    line('Dos', 160, 190, 204, 10, 'Helvetica 10'),
  ]
  const body = line('The author of the book was in the house and the story was for the reader.', 40, 360, 80, 11, 'Helvetica 11')
  const mark = line('1', 370, 378, 78, 7, 'Helvetica 7')
  const note = line('1 See the earlier line for the source of this claim today.', 40, 300, 480, 9, 'Helvetica 9')
  const foreign = line('El autor dice que la casa y los libros en la calle son de una familia.', 40, 360, 260, 11, 'Helvetica 11b')
  const book = {
    pages: [{
      index: 0, width: 420, height: H, lines: [body, mark, ...cells, foreign, note], images: [], fills: [],
      rules: {
        h: [180, 200, 220].map((p) => ({ a: 40, b: 280, p })),
        v: [40, 150, 280].map((p) => ({ a: 180, b: 220, p })),
      },
      shades: [],
    }],
    front: [], lead: 14, step: 18, bodySize: 11, numbers: [1],
  } as unknown as PdfBook
  const roles = new Map<string, UaRole>([
    ['Helvetica 11', 'P'], ['Helvetica 11b', 'P'], ['Helvetica 7', 'Inline'], ['Helvetica 9', 'Note'], ['Helvetica 10', 'P'], ['Helvetica-Bold 10', 'P'],
  ])
  const ornament: Figure = { page: 0, box: { x0: 300, y0: 300, x1: 330, y1: 330 }, vector: false, lines: [], caption: '' }
  const st = buildStructure(book, roles, new Map([[0, [ornament]]]))
  assert.ok(st.nodes.some((n) => n.tag === 'Table'))
  // the ornament has no description and is decoration: drop the figure so its pixels are an artifact
  const fig = st.figures[0]
  assert.ok(fig.node)
  const drop = (n: { kids: { tag: string; kids: unknown[] }[] }, gone: unknown) => {
    n.kids = n.kids.filter((k) => k !== gone)
    for (const k of n.kids) drop(k as never, gone)
  }
  drop(st.root, fig.node)
  fig.node = undefined

  const doc = await PDFDocument.create()
  const page = doc.addPage([420, H])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))
  const img = await doc.embedPng(png)
  page.drawImage(img, { x: 300, y: 300, width: 30, height: 30 })
  for (const l of book.pages[0].lines) {
    page.drawText(l.text, { x: l.x0, y: H - l.base, size: l.size, font: l.runs[0].bold ? bold : font })
  }
  const bytes = new Uint8Array(await doc.save())
  const plan = await planPages(bytes)
  const out = writeUa(plan, book, st, { title: 'Probe', author: 'A', lang: 'en', subject: '', keywords: '' }, { cropToTrim: false })
  const pdf = await out.pdf
  const raw = new TextDecoder('latin1').decode(pdf)
  assert.match(raw, /\/S \/Table/)
  assert.match(raw, /\/S \/TR/)
  assert.match(raw, /\/S \/TH/)
  assert.match(raw, /\/S \/TD/)
  assert.match(raw, /\/Scope \/Column/)
  assert.match(raw, /\/Lang \(es\)/)
  assert.match(raw, /\/S \/Reference/)
  assert.match(raw, /\/S \/Link/)
  assert.match(raw, /\/ID \(note-0-1\)/)
  assert.doesNotMatch(raw, /\/S \/Figure/)
  const written = await PDFDocument.load(pdf)
  const src = pageContent(written, written.getPages()[0])
  assert.match(src, /\/Artifact BMC[\s\S]*\bDo\b/)
  assert.equal(out.review.filter((r) => r.level === 'error' && /alternative text/.test(r.msg)).length, 0)
  assert.ok(out.review.some((r) => /note number/.test(r.msg)))
})
