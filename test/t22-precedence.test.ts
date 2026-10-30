// T22 (OPUS_DESIGN2 §a.3): the spec over the rulebook, with one exception (a client correction dated after the spec), and one test per
// row of the conflict table. Conflicts end as open questions in the workbook that goes back to the client, and in REVIEW_NOTES.
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_SETTINGS, setSettings } from '../src/engine/settings.ts'
import { emptyLayer, resolve, type Layer, type Source } from '../src/engine/spec/layers.ts'
import { MemoryStore, setStore, store } from '../src/engine/spec/store.ts'
import { openSpec, applyInstruction } from '../src/engine/spec/session.ts'
import { bundledLayer } from '../src/engine/spec/clients.ts'
import { instructionLayer, instructionNotes, type CompiledInstruction } from '../src/engine/spec/instruction.ts'
import { conflictNotes, conflictQuestions, promotionSuggestions, settleSameSource } from '../src/engine/spec/precedence.ts'
import { specWorkbook } from '../src/engine/spec/requirements.ts'
import { readXlsx } from '../src/engine/spec/office.ts'

afterEach(() => (setSettings(DEFAULT_SETTINGS), setStore(new MemoryStore())))

const src = (o: Partial<Source> & { text: string }): Source => ({ file: 'spec.xlsx', where: 'row 4', by: 'template', ...o })
function layer(level: 'client' | 'series' | 'book', name: string, rows: Record<string, [string | number | boolean, Source]>, rank?: number): Layer {
  const l = emptyLayer(level, name)
  if (rank) l.rank = rank
  for (const [id, [v, s]] of Object.entries(rows)) ((l.values[id] = v), (l.sources[id] = s))
  return l
}
const correction = (text: string, date?: string) => src({ file: 'Corrections 24 Oct.docx', where: 'P5', by: 'person', correction: true, text, ...(date ? { date } : {}) })
const compiled = (rules: CompiledInstruction['rules']): CompiledInstruction => ({ rules, directives: [], hints: [], unmapped: [] })

// ---- the order: S1 > S2 > S3, and a correction dated after the spec --------------------------------------------------------------------------

test('the spec beats the rulebook, and from[] says which', () => {
  const rulebook = layer('client', 'Acme', { 'TYP-01': ['left', correction('Left, please', '2026-10-01')] })
  const spec = layer('book', '978', { 'TYP-01': ['justify', src({ text: 'justified', date: '2026-10-10' })] })
  const r = resolve([rulebook, spec])
  assert.equal(r.settings.bodyAlign, 'justify')
  assert.equal(r.from['TYP-01'].level, 'book')
  assert.deepEqual(r.conflicts, [])
})

test('a correction dated after the spec wins; the conflict is an open question with both quotes', () => {
  const rulebook = layer('client', 'Acme', { 'TYP-01': ['left', correction('Body text must be left aligned', '2026-10-24')] })
  const spec = layer('book', '978', { 'TYP-01': ['justify', src({ text: 'Justify the body text', where: 'row 9', date: '2026-10-10' })] })
  const r = resolve([rulebook, spec])
  assert.equal(r.settings.bodyAlign, 'left')
  assert.equal(r.from['TYP-01'].level, 'client')
  assert.equal(r.conflicts.length, 1)
  const [c] = r.conflicts
  assert.equal(c.kind, 'correction')
  assert.equal(c.ruleId, 'TYP-01')
  assert.ok(c.quotes.includes('Justify the body text') && c.quotes.includes('Body text must be left aligned'))
  assert.ok(c.ask && c.ask.includes('Justify the body text') && c.ask.includes('Body text must be left aligned') && c.ask.includes('2026-10-24'))
  const qs = conflictQuestions(r.conflicts)
  assert.equal(qs.length, 1)
  assert.ok(qs[0].text.includes('TYP-01'))
})

test('an undated spec counts as older than every correction', () => {
  const rulebook = layer('client', 'Acme', { 'TYP-01': ['left', correction('Left', '2026-10-24')] })
  const spec = layer('book', '978', { 'TYP-01': ['justify', src({ text: 'justified' })] })
  const r = resolve([rulebook, spec])
  assert.equal(r.settings.bodyAlign, 'left')
  assert.equal(r.conflicts[0].kind, 'correction')
})

test('a spec dated after the correction, or a correction with no date, leaves the spec in force', () => {
  const spec = layer('book', '978', { 'TYP-01': ['justify', src({ text: 'justified', date: '2026-10-30' })] })
  const later = resolve([layer('client', 'Acme', { 'TYP-01': ['left', correction('Left', '2026-10-24')] }), spec])
  assert.equal(later.settings.bodyAlign, 'justify')
  assert.deepEqual(later.conflicts, [])
  const undated = resolve([layer('client', 'Acme', { 'TYP-01': ['left', correction('Left')] }), spec])
  assert.equal(undated.settings.bodyAlign, 'justify')
})

test('a value a person typed in the Spec step (no spec file behind it) is not held back by a correction', () => {
  const rulebook = layer('client', 'Acme', { 'TYP-01': ['left', correction('Left', '2026-10-24')] })
  const typed = emptyLayer('book', '978')
  typed.values['TYP-01'] = 'justify'
  assert.equal(resolve([rulebook, typed]).settings.bodyAlign, 'justify')
})

test('the shipped client file can carry correction dates', () => {
  const l = bundledLayer('client', 'Acme Press', [{ match: 'acme', name: 'Acme', file: 'Corrections.docx', values: { 'TYP-01': 'left' }, corrections: { 'TYP-01': '2026-10-24' } }])!
  assert.equal(l.sources['TYP-01'].correction, true)
  assert.equal(l.sources['TYP-01'].date, '2026-10-24')
  const plain = bundledLayer('client', 'Acme Press', [{ match: 'acme', name: 'Acme', file: 'Style.docx', values: { 'TYP-01': 'left' } }])!
  assert.equal(plain.sources['TYP-01'].correction, undefined)
})

// ---- the conflict table, row by row ------------------------------------------------------------------------------------------------------------

test('row 1: a source that asks for what a locked standard forbids: the standard stays, a note and an open question', () => {
  const rulebook = layer('client', 'Acme', { 'PG-01': ['end', src({ file: 'Style.docx', where: 'row 2', text: 'Page numbers at the end of the chapter', by: 'keywords' })] })
  const r = resolve([rulebook])
  assert.deepEqual(r.settings, resolve([]).settings)
  assert.equal(r.conflicts.length, 1)
  assert.equal(r.conflicts[0].kind, 'locked')
  const notes = conflictNotes(r)
  assert.equal(notes.length, 1)
  assert.match(notes[0].chosen, /^Not applied: breaks EPUB page navigation/)
  assert.equal(notes[0].rule, 'PG-01')
  assert.equal(conflictQuestions(r.conflicts).length, 1)
})

test('row 2: an advisory value from the spec or the rulebook is a pending waiver, as before', () => {
  const spec = layer('book', '978', { 'TBL-01': ['td', src({ text: 'plain cells' })] })
  const r = resolve([spec])
  assert.equal(r.settings.tableHeaders, 'th')
  assert.deepEqual(r.pendingWaivers.map((p) => p.ruleId), ['TBL-01'])
  spec.waivers['TBL-01'] = { at: '2026-10-30T10:00:00Z', by: 'Ana', text: 'ok' }
  assert.equal(resolve([spec]).settings.tableHeaders, 'td')
})

test('row 3: an advisory value the instruction asks for in so many words is applied, and the typed words are the waiver in the log', async () => {
  setStore(new MemoryStore())
  const spec = await openSpec({ client: 'Acme', series: '', book: '978' })
  const c = compiled([{ ruleId: 'TBL-01', value: 'td', quote: 'plain cells even though it is less accessible', confidence: 0.95, waiver: true }])
  const out = await applyInstruction(spec, { compiled: c, actor: 'Ana', at: '2026-10-30T10:00:00Z', text: 'plain cells even though it is less accessible' })
  assert.equal(out.resolved.settings.tableHeaders, 'td')
  assert.equal(out.resolved.from['TBL-01'].waiver?.by, 'Ana')
  assert.equal(out.resolved.from['TBL-01'].waiver?.text, 'plain cells even though it is less accessible')
  const w = (await store().listDecisions()).filter((d) => d.action === 'waiver')
  assert.equal(w.length, 1)
  assert.equal(w[0].ruleId, 'TBL-01')
  // without the words, the instruction is only a pending waiver
  const bare = layer('book', '978', { 'TBL-01': ['td', src({ text: 'x', file: 'instruction', by: 'person' })] }, 1)
  assert.equal(resolve([bare]).pendingWaivers.length, 1)
})

test('row 4a: two rows of one file on different levels: the level nearest the book wins and the conflict is listed, with no question', () => {
  const file = { file: 'Style.docx', by: 'keywords' as const }
  const client = layer('client', 'Acme', { 'TYP-01': ['left', src({ ...file, where: 'row 3', text: 'Left aligned' })] })
  const series = layer('series', 'Poetry', { 'TYP-01': ['justify', src({ ...file, where: 'row 8', text: 'Poetry justified' })] })
  const r = resolve([client, series])
  assert.equal(r.settings.bodyAlign, 'justify')
  assert.equal(r.from['TYP-01'].level, 'series')
  assert.equal(r.conflicts.length, 1)
  assert.equal(r.conflicts[0].kind, 'same-source')
  assert.equal(r.conflicts[0].ask, undefined)
  assert.equal(conflictQuestions(r.conflicts).length, 0)
  assert.equal(conflictNotes(r).length, 1)
})

test('row 4b: two rows of one file on the same level: the accessible value is taken and the client is asked, with both quotes', () => {
  const rows = [
    { ruleId: 'TBL-01', value: 'td', quote: 'Plain table cells', where: 'row 5' },
    { ruleId: 'TBL-01', value: 'th', quote: 'Header cells in tables', where: 'row 11' },
    { ruleId: 'TYP-03', value: 'serif', quote: 'Serif titles', where: 'row 6' },
  ]
  const { kept, conflicts } = settleSameSource(rows)
  assert.deepEqual(kept.map((k) => [k.ruleId, k.value]), [['TBL-01', 'th'], ['TYP-03', 'serif']])
  assert.equal(conflicts.length, 1)
  assert.equal(conflicts[0].ruleId, 'TBL-01')
  assert.deepEqual(conflicts[0].quotes, ['Plain table cells', 'Header cells in tables'])
  assert.ok(conflicts[0].ask?.includes('row 5') && conflicts[0].ask.includes('row 11'))
})

test('row 4b: with no accessible choice, the rulebook value is taken, else the house default', () => {
  const rows = [
    { ruleId: 'TYP-01', value: 'left', quote: 'Left', where: 'row 1' },
    { ruleId: 'TYP-01', value: 'justify', quote: 'Justified', where: 'row 2' },
  ]
  assert.equal(settleSameSource(rows, { 'TYP-01': 'justify' }).kept[0].value, 'justify')
  assert.equal(settleSameSource(rows, { 'TYP-01': 'left' }).kept[0].value, 'left')
  // neither is the rulebook's: the house default (print) is not a candidate either, so the first row stands
  assert.equal(settleSameSource(rows, { 'TYP-01': 'print' }).kept[0].value, 'left')
  // the same value twice is not a conflict
  const same = settleSameSource([rows[0], { ...rows[0], where: 'row 9' }])
  assert.equal(same.conflicts.length, 0)
  assert.equal(same.kept.length, 1)
})

test('row 5: the instruction beats the spec and the rulebook for this book; from[] and REVIEW_NOTES say what it overrode', () => {
  const rulebook = layer('client', 'Acme', { 'TYP-03': ['serif', correction('Serif titles', '2026-10-01')] })
  const spec = layer('book', '978', { 'TYP-01': ['justify', src({ where: 'row 9', text: 'justified' })] })
  const c = compiled([
    { ruleId: 'TYP-01', value: 'left', quote: 'body text left', confidence: 0.95 },
    { ruleId: 'TYP-03', value: 'sans-serif', quote: 'sans titles', confidence: 0.95 },
  ])
  const { layer: ins } = instructionLayer('978', c, { actor: 'Ana' })
  const r = resolve([rulebook, spec, ins])
  assert.equal(r.settings.bodyAlign, 'left')
  assert.equal(r.settings.chapterTitleFont, 'sans-serif')
  assert.equal(r.from['TYP-01'].overrode?.level, 'book')
  assert.equal(r.from['TYP-03'].overrode?.level, 'client')
  const items = instructionNotes({ compiled: c, resolved: r }).map((n) => n.item)
  assert.ok(items.some((i) => i.startsWith('Instruction overrode TYP-01 (spec row 9 said')))
  assert.ok(items.some((i) => i.startsWith('Instruction overrode TYP-03 (client style')))
  // an instruction beating a dated correction is not the exception: nothing to ask the client
  assert.deepEqual(r.conflicts, [])
})

test('row 6: the same instruction override on 3 books of one client is suggested for the client layer', () => {
  const o = (client: string, book: string, ruleId = 'TYP-01', value: string = 'left') => ({ client, book, ruleId, value })
  const list = promotionSuggestions([o('Acme', 'a'), o('Acme', 'b'), o('Acme', 'c'), o('Acme', 'd', 'TYP-03', 'serif'), o('Other', 'e'), o('Other', 'f')])
  assert.equal(list.length, 1)
  assert.deepEqual({ client: list[0].client, ruleId: list[0].ruleId, value: list[0].value, books: list[0].books }, { client: 'Acme', ruleId: 'TYP-01', value: 'left', books: ['a', 'b', 'c'] })
  // the same book twice counts once; a different value is another override
  assert.equal(promotionSuggestions([o('Acme', 'a'), o('Acme', 'a'), o('Acme', 'b'), o('Acme', 'c', 'TYP-01', 'justify')]).length, 0)
})

// ---- the client report ------------------------------------------------------------------------------------------------------------------------

test('conflicts that need the client go on the Open questions sheet of the spec workbook', () => {
  const rulebook = layer('client', 'Acme', { 'TYP-01': ['left', correction('Left aligned', '2026-10-24')] })
  const spec = layer('book', '978', { 'TYP-01': ['justify', src({ text: 'Justify it', date: '2026-10-10' })] })
  const resolved = resolve([rulebook, spec])
  const sheets = readXlsx(specWorkbook({ client: 'Acme', book: '978', resolved }))
  const q = sheets.find((s) => s.name === 'Open questions')
  assert.ok(q, 'the sheet exists')
  assert.equal(q.rows.length, 2)
  assert.ok(q.rows[1][0].includes('Justify it') && q.rows[1][0].includes('Left aligned'))
  // no conflict, no sheet
  assert.equal(readXlsx(specWorkbook({ client: 'Acme', book: '978', resolved: resolve([]) })).some((s) => s.name === 'Open questions'), false)
})
