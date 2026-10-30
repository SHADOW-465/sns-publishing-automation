// T23 (OPUS_DESIGN2 §c.5): a partial client file becomes a drafted spec workbook. Every requirement is mapped to a rule (with its quote) or
// listed as unmapped with its quote; every rule has a status and its evidence; the workbook comes back through route 1 (the template) exactly.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { emptyLayer } from '../src/engine/spec/layers.ts'
import { draftSpec, STATUS } from '../src/engine/spec/drafter.ts'
import { fromSpecWorkbook, readRequirements } from '../src/engine/spec/requirements.ts'
import { readXlsx } from '../src/engine/spec/office.ts'
import { RULES, ruleById } from '../src/engine/spec/rules.ts'

const enc = (s: string) => new TextEncoder().encode(s)
const txt = (name: string, lines: string[]) => ({ name, data: enc(lines.join('\n')) })

const file = txt('acme-notes.txt', [
  'TYP-01: justify the body text', // explicit rule ID: client said
  'Add a table of contents', // a rule hit, but weak: ASK CLIENT
  'Please be kind to the author', // no rule: unmapped
  'TYP-02: center the chapter titles', // client said
  'TYP-02 center please', // the same value again: not a conflict
  'HD-02: required, but we want it off', // a locked standard: kept, with a question
])

const rows = (wb: Uint8Array) => {
  const sh = readXlsx(wb).find((s) => s.name === 'Spec')!
  const col = (h: string) => sh.rows[0].indexOf(h)
  return sh.rows.slice(1).map((r) => ({ id: r[col('Rule ID')], value: r[col('Value')], status: r[col('Status')], evidence: r[col('Evidence')] }))
}

test('every requirement is mapped or listed as unmapped with its quote', async () => {
  const d = await draftSpec({ client: 'Acme', book: '978', files: [file] })
  assert.equal(d.mapped.length + d.unmapped.length, d.total)
  assert.equal(d.total, 6)
  assert.deepEqual(d.unmapped.map((u) => u.text), ['Please be kind to the author'])
  assert.ok(d.unmapped[0].where.includes('acme-notes.txt') && d.unmapped[0].where.includes('line 3'))
  const q = readXlsx(d.workbook).find((s) => s.name === 'Open questions')!
  assert.ok(q.rows.some((r) => r[0] === 'Please be kind to the author' && r[1].includes('acme-notes.txt')))
})

test('one row per rule, each with a status from the fixed list and evidence for what the client said', async () => {
  const d = await draftSpec({ client: 'Acme', book: '978', files: [file] })
  const r = rows(d.workbook)
  assert.equal(r.length, RULES.length)
  for (const x of r) assert.ok((STATUS as readonly string[]).includes(x.status), `${x.id}: ${x.status}`)
  const typ = r.find((x) => x.id === 'TYP-01')!
  assert.equal(typ.status, 'client said')
  assert.equal(typ.value, 'justify')
  assert.ok(typ.evidence.includes('TYP-01: justify the body text') && typ.evidence.includes('acme-notes.txt') && typ.evidence.includes('line 1'))
  const tbl = r.find((x) => x.id === 'TBL-01')!
  assert.equal(tbl.status, 'ASK CLIENT') // weak keyword hit on line 2
  assert.ok(tbl.evidence.includes('Add a table of contents'))
  assert.equal(r.find((x) => x.id === 'TYP-02')!.status, 'client said') // twice, same value
  assert.equal(r.find((x) => x.id === 'TYP-04')!.status, 'house default')
})

test('a rule the rulebook already sets is "from rulebook"; a client correction is "inferred"', async () => {
  const book = emptyLayer('client', 'Acme')
  book.values['TYP-03'] = 'sans-serif'
  book.sources['TYP-03'] = { file: 'rulebook', where: 'row 2', text: 'x', by: 'person' }
  book.values['TYP-01'] = 'left'
  book.sources['TYP-01'] = { file: 'Corrections.docx', where: 'paragraph 4', text: 'Left, please', by: 'person', correction: true, date: '2026-10-24' }
  const d = await draftSpec({ client: 'Acme', book: '978', files: [txt('empty.txt', ['nothing here'])], layers: [book] })
  const r = rows(d.workbook)
  assert.equal(r.find((x) => x.id === 'TYP-03')!.status, 'from rulebook')
  const t1 = r.find((x) => x.id === 'TYP-01')!
  assert.equal(t1.status, 'inferred')
  assert.ok(t1.evidence.includes('Left, please') && t1.evidence.includes('Corrections.docx'))
})

test('two rows that disagree: ASK CLIENT, both quotes asked; a locked standard stays and is asked about', async () => {
  const f = txt('two.txt', ['TYP-01: justify', 'TYP-01: left aligned please', 'HD-02: switch it off'])
  const d = await draftSpec({ client: 'Acme', book: '978', files: [f] })
  const typ = rows(d.workbook).find((x) => x.id === 'TYP-01')!
  assert.equal(typ.status, 'ASK CLIENT')
  assert.ok(typ.evidence.includes('TYP-01: justify') && typ.evidence.includes('TYP-01: left aligned please'))
  const asks = d.questions.map((q) => q.text).join('\n')
  assert.ok(asks.includes('TYP-01: justify') && asks.includes('TYP-01: left aligned please'))
  assert.ok(asks.includes('HD-02'))
  const hd = rows(d.workbook).find((x) => x.id === 'HD-02')!
  assert.equal(hd.status, 'from rulebook')
  assert.ok(hd.evidence.includes('HD-02: switch it off'))
})

test('the text model refines what keywords could not place', async () => {
  const f = txt('vague.txt', ['Titles in a clean modern face'])
  const ai = async (items: { text: string; where: string }[]) =>
    items.map((req) => ({ req, ruleId: 'TYP-03', value: 'sans-serif', confidence: 0.95, by: 'ai' as const, reason: 'type' }))
  const d = await draftSpec({ client: 'Acme', book: '978', files: [f], ai })
  assert.equal(d.unmapped.length, 0)
  const r = rows(d.workbook).find((x) => x.id === 'TYP-03')!
  assert.equal(r.status, 'client said')
  assert.equal(r.value, 'sans-serif')
  assert.ok(r.evidence.includes('Titles in a clean modern face'))
})

test('the workbook round-trips through route 1 (template) exactly', async () => {
  const d = await draftSpec({ client: 'Acme', book: '978', files: [file] })
  const back = readRequirements('draft.xlsx', d.workbook)
  assert.ok(back.template, 'read as our own spec workbook')
  const keyed = RULES.filter((r) => r.key)
  assert.equal(back.template!.length, keyed.length)
  for (const s of back.template!) {
    const r = ruleById.get(s.ruleId!)!
    assert.equal(s.confidence, 1, String(s.ruleId))
    assert.deepEqual(s.value, d.resolved.settings[r.key!], String(s.ruleId))
  }
  assert.deepEqual(fromSpecWorkbook(readXlsx(d.workbook))!.map((s) => s.ruleId), back.template!.map((s) => s.ruleId))
  // drafted again from its own output, nothing moves
  const again = await draftSpec({ client: 'Acme', book: '978', files: [{ name: 'draft.xlsx', data: d.workbook }] })
  assert.deepEqual(again.resolved.settings.bodyAlign, d.resolved.settings.bodyAlign)
  assert.equal(again.unmapped.length, 0)
})

// The 24 Oct client documents live outside this repo (client files); the test runs where they are and says so where they are not.
const DIR = join(import.meta.dirname, '..', '..', 'pdf-tagger-sns-pdfua', 'corrections', '24102026')
test('the 24 Oct documents: every row is mapped or listed unmapped with its quote', { skip: !existsSync(DIR) && 'the 24 Oct client documents are not on this machine' }, async () => {
  const names = readdirSync(DIR).filter((n) => /\.(docx|xlsx)$/i.test(n))
  assert.ok(names.length >= 3)
  const files = names.map((name) => ({ name, data: new Uint8Array(readFileSync(join(DIR, name))) }))
  const d = await draftSpec({ client: 'SNS 24 Oct', book: 'all', files })
  assert.ok(d.total > 40)
  assert.equal(d.mapped.length + d.unmapped.length + d.otherRoutes, d.total)
  for (const u of d.unmapped) assert.ok(u.text.trim() && u.where.includes('.docx'), 'every unmapped row keeps its quote and place')
  assert.ok(d.otherRoutes > 0, 'Book_Details rows go to the navigation step, and are counted')
  const back = readRequirements('draft.xlsx', d.workbook)
  assert.equal(back.template!.length, RULES.filter((r) => r.key).length)
  for (const s of back.template!) assert.deepEqual(s.value, d.resolved.settings[ruleById.get(s.ruleId!)!.key!], String(s.ruleId))
})

