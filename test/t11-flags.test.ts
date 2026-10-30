// T11 (OPUS_DESIGN2 §b.3): page flags and the engine's page order confidence. Each flag is read off the layout JSON
// (pdf/evidence.ts) and what the engine says about its own order, and names its reason. A unit test per flag on a
// synthetic page, then the eval set: every page with a known fault is flagged, and under 40% of the others.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { pageFlags, uaPageFlags, type PageFlag } from '../src/engine/pdf/flags.ts'
import { orderConfidence, pageEvidence, withEngine, type EvidenceBlock, type PageEvidence } from '../src/engine/pdf/evidence.ts'
import { buildStructure, uaOptionsFrom, type Structure, type UaOptions, type UaRole } from '../src/engine/pdfua/structure.ts'
import { unlinkedNotes } from '../src/engine/pdfua/notes.ts'
import { openSpec } from '../src/engine/spec/session.ts'
import { MemoryStore, setStore } from '../src/engine/spec/store.ts'
import { analyzeUa } from '../src/engine/pdfua/index.ts'
import { placeholderCover } from '../src/engine/epub/placeholder-cover.ts'
import type { PdfBook, PLine } from '../src/engine/pdfepub/analyze.ts'
import { nodeRaster } from './raster-node.ts'
import { AUTOMATION, has, read } from './samples.ts'

import { loadEvalSet } from './eval-set.ts'
const T = (id: string, bbox: [number, number, number, number], o: Partial<EvidenceBlock> = {}): EvidenceBlock => ({
  id, kind: 'text', bbox, style: 'Serif 10', italic: false, bold: false, size: 10, bodySize: 10, lines: 3, text: 'The river crosses the plain and the old road follows it down to the sea.', lineIds: [], ...o,
})
const F = (id: string, bbox: [number, number, number, number]): EvidenceBlock => ({ id, kind: 'figure', bbox, pieces: [], caption: null })
const ev = (blocks: EvidenceBlock[], o: Partial<PageEvidence> = {}): PageEvidence => ({ page: 1, printed: '1', w: 432, h: 648, columns: [[36, 396]], blocks, ...o })
const flags = (e: PageEvidence, s = {}) => pageFlags(e, s).map((h) => h.flag)
// a plain one-column page: three paragraphs, read top down, all P
const plain = () => ev([T('p1.b01', [36, 40, 396, 80], { role: 'P' }), T('p1.b02', [36, 90, 396, 130], { role: 'P' }), T('p1.b03', [36, 140, 396, 180], { role: 'P' })], { engineOrder: ['p1.b01', 'p1.b02', 'p1.b03'] })

test('T11: a plain one-column page in reading order has no flag and order confidence 1', () => {
  assert.deepEqual(pageFlags(plain()), [])
  assert.equal(orderConfidence(plain()), 1)
})

test('T11 multi-column: columns of running text, or blocks whose lines interleave; a folio or hanging note numbers are no column', () => {
  const two = ev([T('p1.b01', [36, 40, 204, 300], { role: 'P' }), T('p1.b02', [228, 40, 396, 300], { role: 'P' })], { columns: [[36, 204], [228, 396]] })
  const hit = pageFlags(two).find((h) => h.flag === 'multi-column')
  assert.ok(hit && /2 columns of text/.test(hit.reason), JSON.stringify(pageFlags(two)))
  // hanging note numbers beside the notes, and a folio, are no column
  const notes = ev([T('p1.b01', [78, 90, 92, 280], { text: '10. 11. 12.' }), T('p1.b02', [99, 90, 418, 280]), T('p1.b03', [210, 620, 222, 630], { lines: 1, text: '131' })], { columns: [[78, 92], [99, 418], [210, 222]] })
  assert.ok(!flags(notes).includes('multi-column'), JSON.stringify(pageFlags(notes)))
  assert.ok(!flags(plain()).includes('multi-column'))
  // two blocks whose lines interleave (a line of Spanish, a line of English)
  const mixed = ev([T('p1.b01', [138, 590, 400, 632], { lines: 4 }), T('p1.b02', [138, 596, 360, 618], { lines: 2, style: 'Serif-Med 10' })])
  const hit2 = pageFlags(mixed).find((h) => h.flag === 'multi-column')
  assert.ok(hit2 && /interleave/.test(hit2.reason))
})

test('T11 figure-pieces: two pictures within 1.5 em of each other may be one picture; 3 em apart they are two', () => {
  const near = ev([F('p1.f01', [36, 100, 200, 300]), F('p1.f02', [212, 100, 396, 300])])
  const hit = pageFlags(near).find((h) => h.flag === 'figure-pieces')
  assert.ok(hit && /p1\.f01/.test(hit.reason) && /p1\.f02/.test(hit.reason))
  assert.ok(!flags(ev([F('p1.f01', [36, 100, 200, 300]), F('p1.f02', [230, 100, 396, 300])])).includes('figure-pieces'))
  assert.ok(!flags(ev([F('p1.f01', [36, 100, 396, 300])])).includes('figure-pieces'))
})

test('T11 caption-candidate: an italic or small line by a figure that is not a Caption; a figure label tagged P', () => {
  const fig = F('p1.f01', [100, 100, 300, 280])
  const cap = (o: Partial<EvidenceBlock>, y = 290) => ev([fig, T('p1.b01', [120, y, 280, y + 12], { lines: 1, text: 'Octaves on a piano keyboard', ...o })])
  assert.ok(flags(cap({ italic: true, role: 'P' })).includes('caption-candidate'))
  assert.ok(flags(cap({ size: 8.5, role: 'P' })).includes('caption-candidate'))
  assert.ok(!flags(cap({ italic: true, role: 'Caption' })).includes('caption-candidate'), 'already a Caption')
  assert.ok(!flags(cap({ italic: true, role: 'P' }, 330)).includes('caption-candidate'), 'over 3 em from the figure')
  assert.ok(!flags(cap({ role: 'P' })).includes('caption-candidate'), 'upright body-size text')
  assert.ok(!flags({ ...cap({ italic: true }), engineOrder: ['p1.f01'] }).includes('caption-candidate'), 'left out of the order by the engine: an artifact')
  // a figure label tagged P, wherever it stands
  const label = ev([fig, T('p1.b01', [36, 500, 396, 512], { lines: 1, text: 'Figura 7.2. Octavas en un piano', role: 'P' })])
  const hit = pageFlags(label).find((h) => h.flag === 'caption-candidate')
  assert.ok(hit && /Figura 7\.2/.test(hit.reason))
})

test('T11 style-mixed: one style in two roles; a block not in the role of its style; a heading over 25 words; a short bold or big paragraph', () => {
  const two = ev([T('p1.b01', [36, 40, 396, 52], { lines: 1, text: 'Introducción de Gerry', role: 'H3' }), T('p1.b02', [36, 60, 396, 100], { role: 'P' })])
  const hit = pageFlags(two).find((h) => h.flag === 'style-mixed')
  assert.ok(hit && /Serif 10/.test(hit.reason) && /H3/.test(hit.reason) && /P/.test(hit.reason))
  const long = 'This display line runs on and on for many words so that it reads like a paragraph set in large type and not like a heading at all in the end'
  assert.ok(flags(ev([T('p1.b01', [36, 40, 396, 100], { style: 'Sans 18', size: 18, text: long, role: 'H2' })])).includes('style-mixed'))
  assert.ok(flags(ev([T('p1.b01', [36, 40, 396, 52], { style: 'Serif-Bold 10', bold: true, lines: 1, text: 'Notas al capítulo', role: 'P' })])).includes('style-mixed'))
  assert.ok(flags(ev([T('p1.b01', [36, 40, 396, 56], { style: 'Serif 14', size: 14, lines: 1, text: 'Notas al capítulo', role: 'P' })])).includes('style-mixed'))
  assert.ok(!flags(ev([T('p1.b01', [36, 40, 396, 52], { style: 'Serif-Bold 10', bold: true, lines: 1, text: 'Notas al capítulo', role: 'H3' })])).includes('style-mixed'))
  // a per-block signal made an italic body-style line a Caption; a heading style read at another level is not mixed
  const cap = pageFlags(ev([T('p1.b01', [36, 40, 396, 52], { style: 'Myriad-It 9.5', lines: 1, text: 'Figura 7.2. Octavas en un piano', role: 'Caption', styleRole: 'P' })]))
  assert.ok(cap.some((h) => h.flag === 'style-mixed' && /is Caption; its style Myriad-It 9.5 is P/.test(h.reason)), JSON.stringify(cap))
  assert.ok(!flags(ev([T('p1.b01', [36, 40, 396, 52], { lines: 1, text: 'Arena', role: 'H2', styleRole: 'H1' })])).includes('style-mixed'))
})

test('T11 order-risk: the engine says it row-sorted the page, released held lines or placed a stray', () => {
  const hit = pageFlags(plain(), { risk: ['contents read row by row'] }).find((h) => h.flag === 'order-risk')
  assert.ok(hit && /row by row/.test(hit.reason))
  // buildStructure records it: a contents page is read row by row
  const L = (text: string, x0: number, y: number, size: number, key: string): PLine => ({ runs: [{ text, x0, x1: x0 + text.length * 5, font: 'Serif', size, bold: false, italic: false }], x0, x1: x0 + text.length * 5, y, base: y + size * 0.8, size, font: 'Serif', text, marker: false, key, page: 0, col: 40 })
  const lines = [L('Contents', 40, 40, 18, 'H 18'), L('Chapter one 1', 40, 80, 11, 'B 11'), L('Chapter two 9', 40, 96, 11, 'B 11'), L('Chapter three 17', 40, 112, 11, 'B 11')]
  const book = { pages: [{ index: 0, width: 400, height: 560, lines, images: [], fills: [], rules: { h: [], v: [] }, shades: [] }], front: [], lead: 14, step: 18, bodySize: 11, bodyKey: 'B 11', numbers: [1] } as unknown as PdfBook
  const st = buildStructure(book, new Map<string, UaRole>([['H 18', 'H1'], ['B 11', 'P']]), new Map())
  assert.ok(st.risk.get(0)?.some((r) => /row by row/.test(r)), JSON.stringify([...st.risk]))
  // and a kicker moved into the section of the title under it (PHD-002)
  const kick = [L('Chapter One', 40, 60, 24, 'H 24'), L('Body text of the first chapter goes on here.', 40, 200, 11, 'B 11')]
  const kick2 = [L('INTRODUCCIÓN DE GERRY', 40, 60, 13, 'K 13'), L('La misión del sanador', 40, 92, 24, 'H 24'), L('Comencé a enseñar con Barbara en 1996.', 40, 200, 11, 'B 11')].map((l) => ({ ...l, page: 1 }))
  const two = { ...book, pages: [{ ...book.pages[0], lines: kick }, { ...book.pages[0], index: 1, lines: kick2 }], numbers: [1, 2] } as unknown as PdfBook
  const st2 = buildStructure(two, new Map<string, UaRole>([['H 24', 'H1'], ['K 13', 'H3'], ['B 11', 'P']]), new Map())
  assert.ok(st2.risk.get(1)?.some((r) => /kicker/.test(r)), JSON.stringify([...st2.risk]))
  assert.ok(!st2.risk.get(0))
})

test('T11 low-confidence: an engine order far from the page order is under 0.85 and flagged', () => {
  const e = plain()
  assert.ok(!flags(e).includes('low-confidence'))
  const back = { ...e, engineOrder: ['p1.b03', 'p1.b02', 'p1.b01'] }
  assert.ok(orderConfidence(back) < 0.85)
  const hit = pageFlags(back).find((h) => h.flag === 'low-confidence')
  assert.ok(hit && /0\.33/.test(hit.reason), JSON.stringify(hit))
  // two columns read left then right, a heading across both first: confidence 1
  const cols = ev([T('p1.b01', [36, 20, 396, 34], { role: 'H1', style: 'Sans 18', size: 18, lines: 1, text: 'Chapter' }), T('p1.b02', [36, 40, 204, 300], { role: 'P' }), T('p1.b03', [228, 40, 396, 300], { role: 'P' })], { columns: [[36, 204], [228, 396]], engineOrder: ['p1.b01', 'p1.b02', 'p1.b03'] })
  assert.equal(orderConfidence(cols), 1)
  assert.ok(orderConfidence({ ...cols, engineOrder: ['p1.b01', 'p1.b03', 'p1.b02'] }) < 0.85)
})

test('T11 checker: a check that failed on the page in the previous round; an end note no call points to fails PNT-001', () => {
  const hit = pageFlags(plain(), { checks: ['Matterhorn 09-004: a table cell outside a row'] }).find((h) => h.flag === 'checker')
  assert.ok(hit && /09-004/.test(hit.reason))
  const L = (page: number, text: string, x0: number, y: number, size: number, key: string): PLine => ({ runs: [{ text, x0, x1: x0 + text.length * size * 0.45, font: 'Serif', size, bold: false, italic: false }], x0, x1: x0 + text.length * size * 0.45, y, base: y + size * 0.8, size, font: 'Serif', text, marker: false, key, page, col: 40 })
  const body = 'The river crosses the plain and the old road follows it down.'
  const pages = [
    [L(0, 'Chapter One', 40, 60, 24, 'H 24'), L(0, body, 40, 200, 11, 'B 11'), L(0, '1', 40 + body.length * 4.95 + 1, 198, 7, 'S 7')],
    [L(1, 'Notes', 40, 60, 24, 'H 24'), L(1, '1. A source for the river.', 40, 200, 11, 'B 11'), L(1, '2. A note no call points to.', 40, 230, 11, 'B 11')],
  ]
  const book = { pages: pages.map((lines, index) => ({ index, width: 400, height: 560, lines, images: [], fills: [], rules: { h: [], v: [] }, shades: [] })), front: [], lead: 14, step: 18, bodySize: 11, bodyKey: 'B 11', numbers: [1, 2] } as unknown as PdfBook
  const st = buildStructure(book, new Map<string, UaRole>([['H 24', 'H1'], ['B 11', 'P'], ['S 7', 'Inline']]), new Map())
  assert.deepEqual([...unlinkedNotes(st, book)], [[1, ['PNT-001: note 2 has no call in the text to link from']]])
})

test('T11: the engine view puts roles and order on the blocks without changing them; uaPageFlags reads a built structure', () => {
  const L = (text: string, x0: number, y: number, size: number, key: string, font = 'Serif'): PLine => ({ runs: [{ text, x0, x1: x0 + text.length * size * 0.45, font, size, bold: false, italic: /It/.test(font) }], x0, x1: x0 + text.length * size * 0.45, y, base: y + size, size, font, text, marker: false, key, page: 0, col: 36 })
  const lines = [L('Chapter Seven', 36, 40, 18, 'H 18'), L('The river crosses the plain and the road', 36, 80, 10, 'B 10'), L('follows it down to the sea at last.', 36, 92, 10, 'B 10')]
  const page = { width: 432, height: 648, lines, images: [] }
  const e = pageEvidence(page, { page: 1 })
  const v = withEngine(e, [{ ...lines[1], role: 'P' }, { ...lines[0], role: 'H1' }, { ...lines[2], role: 'P' }])
  assert.deepEqual(v.engineOrder, ['p1.b02', 'p1.b01'])
  assert.deepEqual(v.blocks.map((b) => b.role), ['H1', 'P'])
  assert.deepEqual(e.blocks.map((b) => b.role), [undefined, undefined], 'the packet it was given is not changed')
  assert.deepEqual(v.blocks.map((b) => ({ ...b, role: undefined })), e.blocks.map((b) => ({ ...b, role: undefined })))
  assert.equal(v.engineConfidence, 0.5)
  // through buildStructure: the heading and the paragraph, in order, no flag
  const book = { pages: [{ index: 0, ...page, lines: lines.map((l) => ({ ...l })), fills: [], rules: { h: [], v: [] }, shades: [] }], front: [], lead: 12, step: 18, bodySize: 10, bodyKey: 'B 10', numbers: [1] } as unknown as PdfBook
  const roles = new Map<string, UaRole>([['H 18', 'H1'], ['B 10', 'P']])
  const st = buildStructure(book, roles, new Map())
  const [r] = uaPageFlags([e], st, roles)
  assert.deepEqual(r.evidence.engineOrder, ['p1.b01', 'p1.b02'])
  assert.deepEqual(r.evidence.blocks.map((b) => b.role), ['H1', 'P'])
  assert.deepEqual(r.flags, [])
})

// ---- the eval set (test/eval-pages.json): the Accessible PDF books, each with the options a job runs it with (the client's
// layers), and the PNT-001 note check of that build as the checks of the previous round. Skipped when the books are missing.
// Known-bad: an eval page with a recorded fault ("wrong"), unless the build is checked below to no longer have it. Clean: every
// other page of these books (the eval pages without a fault, and the rest). The page numbers are pages of the built file.
const UA = resolve(AUTOMATION, 'Accessible-PDF-Automation')
const SACGEO = resolve(process.env.SNS_SACGEO ?? resolve(import.meta.dirname, '../scratch/t1/sacgeo'), 'Accessible-PDF/SacGeo/Input')
const EVAL = [
  {
    id: 'gladiators',
    client: 'Pen & Sword Books',
    need: resolve(UA, 'Simple/Input/Gladiators in the Greek World.pdf'),
    input: () => ({ main: read(resolve(UA, 'Simple/Input/Gladiators in the Greek World.pdf')), extras: [read(resolve(UA, 'Simple/Input/Gladiators in the Greek World_Plates.pdf'))], cover: { data: read(resolve(UA, 'Simple/Input/cover.jpg')), png: false } }),
  },
  { id: 'evers', client: '', need: resolve(UA, 'Medium/Input/DD_Evers-Woelk_2124-6.pdf'), input: () => ({ main: read(resolve(UA, 'Medium/Input/DD_Evers-Woelk_2124-6.pdf')), extras: [] }) },
  {
    id: 'sacgeo',
    client: 'Inner Traditions en Español',
    need: resolve(SACGEO, 'text/AlNiDi ES pages V05.pdf'),
    // the 24 Oct build had a cover first and the back advertisement appended; a blank cover keeps the page numbers
    input: () => ({ main: read(resolve(SACGEO, 'text/AlNiDi ES pages V05.pdf')), extras: [read(resolve(SACGEO, 'Alquimia de las nueve dimensiones 042026 eBoRI.pdf'))], cover: { data: placeholderCover().data, png: true } }),
  },
]
// recorded faults the build is checked to no longer have (0-based page i)
const GONE: Record<string, (st: Structure, i: number, o: UaOptions) => boolean> = {
  // image15: the running-head strip was tagged as Figure pairs; nothing on the page is a Figure now (T6)
  'sacgeo p34': (st, i) => !st.figures.some((f) => f.page === i),
  // image17, image19: the star ornament had no Figure; the client's layer asks for ornaments as figures and it is one, in the order
  'sacgeo p40': (st, i, o) => o.ornaments === 'figure' && st.figures.some((f) => f.page === i && f.ornament && !!f.node),
  'sacgeo p43': (st, i, o) => o.ornaments === 'figure' && st.figures.some((f) => f.page === i && f.ornament && !!f.node),
}
const evalSet = loadEvalSet()

test('T11: on the eval set every known-bad page is flagged and under 40% of the clean pages are', { skip: !EVAL.every((b) => has(b.need)) && 'client books missing', timeout: 1_800_000 }, async () => {
  setStore(new MemoryStore())
  const bad: string[] = []
  const missed: string[] = []
  const gone: string[] = []
  let clean = 0
  let cleanFlagged = 0
  const listed = [0, 0] // clean eval pages, flagged
  const count = new Map<PageFlag, number>()
  for (const b of EVAL) {
    const options = uaOptionsFrom((await openSpec({ client: b.client, series: '', book: b.id, kind: 'accessible-pdf' })).resolved.settings)
    const a = await analyzeUa(pdfjs, nodeRaster, { ...b.input(), options })
    const roles = new Map(a.styles.map((s) => [s.key, s.role]))
    const st = buildStructure(a.book, roles, new Map([...a.detected].map(([k, fs]) => [k, fs.map((f) => ({ ...f, lines: [], caption: '', node: undefined }))])), options)
    const res = uaPageFlags(a.book.evidence!, st, roles, unlinkedNotes(st, a.book))
    const pages = evalSet.books.find((x) => x.id === b.id)!.pages.filter((p) => p.page !== null)
    res.forEach((r, i) => {
      const n = i + 1
      const fl = [...new Set(r.flags.map((h) => h.flag))]
      for (const f of fl) count.set(f, (count.get(f) ?? 0) + 1)
      const tag = `${b.id} p${n}`
      if (pages.some((p) => p.page === n && p.wrong)) {
        if (GONE[tag]?.(st, i, options)) return void gone.push(tag)
        bad.push(`${tag} [${fl.join(', ')}]`)
        if (!fl.length) missed.push(tag)
        return
      }
      clean++
      if (fl.length) cleanFlagged++
      if (pages.some((p) => p.page === n)) {
        listed[0]++
        if (fl.length) listed[1]++
      }
    })
  }
  console.log(`known-bad ${bad.length}: ${bad.join('; ')}\nfault gone (checked): ${gone.join(', ')}\nclean ${clean}, flagged ${cleanFlagged} (${Math.round((cleanFlagged / clean) * 100)}%); clean eval pages ${listed[0]}, flagged ${listed[1]}\npages by flag: ${JSON.stringify(Object.fromEntries(count))}`)
  assert.equal(bad.length + gone.length, 22, 'the dated SacGeo screenshot pages')
  assert.deepEqual(gone, Object.keys(GONE), 'each fault listed as gone is checked gone')
  assert.deepEqual(missed, [], 'recall 1 on the known-bad pages')
  assert.ok(cleanFlagged < clean * 0.4, `${cleanFlagged} of ${clean} clean pages flagged`)
})
