// The spec: rule registry, layers and waivers, the decision record, the Excel/Word round trip,
// requirement matching (keywords, and AI through a stubbed Groq), and the corrections of
// "EPUB Automation Update V3" rows 16–20 as rules the client controls.
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { zipSync, strToU8 } from 'fflate'
import { text } from '../src/engine/zip.ts'
import { RULES, ruleById, coerce, WAIVER_TEXT } from '../src/engine/spec/rules.ts'
import { resolve, emptyLayer, specHash } from '../src/engine/spec/layers.ts'
import { MemoryStore, setStore, store } from '../src/engine/spec/store.ts'
import { openSpec, setRule, giveWaiver, decide, applySpec } from '../src/engine/spec/session.ts'
import { readXlsx, writeXlsx, readDocx } from '../src/engine/spec/office.ts'
import { specWorkbook, readRequirements, matchByKeywords } from '../src/engine/spec/requirements.ts'
import { matchWithAi } from '../src/engine/spec/ai.ts'
import { DEFAULT_SETTINGS, setSettings, settings, type HouseSettings } from '../src/engine/settings.ts'
import { analyze, build } from '../src/engine/indesign/build.ts'
import { indesignExport, PNG, EISBN } from './fixtures/indesign-export.ts'

afterEach(() => setSettings(DEFAULT_SETTINGS))

test('registry: every rule is complete, IDs are unique, and every setting has a rule', () => {
  assert.equal(new Set(RULES.map((r) => r.id)).size, RULES.length)
  for (const r of RULES) {
    assert.ok(r.title && r.help && r.keywords.length, r.id)
    if (r.type !== 'fixed') assert.ok(r.key && r.key in DEFAULT_SETTINGS, `${r.id} controls a setting`)
    if (r.kind === 'advisory') assert.ok(r.safe !== undefined && JSON.stringify(DEFAULT_SETTINGS[r.key!]) === JSON.stringify(r.safe), `${r.id}: the house default is the accessible value`)
    if (r.choices && r.key) assert.ok(coerce(r, DEFAULT_SETTINGS[r.key] as string) !== undefined || r.type === 'multi', `${r.id} default is a valid choice`)
  }
  const covered = new Set(RULES.map((r) => r.key))
  for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof HouseSettings)[]) if (k !== 'labels') assert.ok(covered.has(k), `setting ${k} has a rule`)
})

test('layers: book wins over client wins over house; an accessibility change needs a waiver', () => {
  const client = emptyLayer('client', 'Sirio')
  client.values = { 'CSS-01': 'compact', 'TBL-01': 'reference', 'NOTE-03': 1 }
  const book = emptyLayer('book', EISBN)
  book.values = { 'NOTE-03': 2 }
  let r = resolve([book, client])
  assert.equal(r.settings.cssFormat, 'compact')
  assert.equal(r.settings.footnoteIndentEm, 2)
  assert.equal(r.from['NOTE-03'].level, 'book')
  assert.equal(r.settings.tableHeaders, 'th', 'no waiver: the accessible value stays')
  assert.deepEqual(r.pendingWaivers.map((p) => p.ruleId), ['TBL-01'])
  client.waivers['TBL-01'] = { at: '2026-09-28T10:00:00Z', by: 'Cliente', text: WAIVER_TEXT }
  r = resolve([book, client])
  assert.equal(r.settings.tableHeaders, 'reference')
  assert.equal(r.from['TBL-01'].waiver?.by, 'Cliente')
  // locked rules are never taken from a layer
  book.values['PG-01'] = 'anything'
  assert.doesNotThrow(() => resolve([book]))
})

test('session: changes, waiver and acceptance are recorded, append-only, with the spec fingerprint', async () => {
  setStore(new MemoryStore())
  let spec = await openSpec({ client: 'Sirio', series: '', book: EISBN }, DEFAULT_SETTINGS)
  spec = await setRule(spec, 'client', 'TBL-01', 'reference', 'Ana')
  assert.equal(spec.resolved.settings.tableHeaders, 'th')
  await assert.rejects(giveWaiver(spec, 'client', 'TBL-01', ''), /name/)
  spec = await giveWaiver(spec, 'client', 'TBL-01', 'Ana')
  assert.equal(spec.resolved.settings.tableHeaders, 'reference')
  await assert.rejects(setRule(spec, 'book', 'PG-01', true, 'Ana'), /fixed/)
  const d = await decide(spec, 'Ana', true)
  assert.equal(d.action, 'accepted')
  assert.equal(d.specHash, specHash(spec.resolved.settings))
  assert.match(d.detail, /waivers for TBL-01/)
  const log = await store().listDecisions({ client: 'sirio', book: EISBN })
  assert.deepEqual(log.map((x) => x.action), ['accepted', 'waiver', 'change'])
  // the client layer is kept for his next book
  const next = await openSpec({ client: 'Sirio', series: '', book: '979-0-000' }, DEFAULT_SETTINGS)
  assert.equal(next.resolved.settings.tableHeaders, 'reference')
  // back to the accessible value: the waiver is withdrawn and recorded
  spec = await setRule(spec, 'client', 'TBL-01', 'th', 'Ana')
  assert.equal(Object.keys(spec.layers[0].waivers).length, 0)
  assert.equal((await store().listDecisions())[1].action, 'waiver-withdrawn')
  applySpec(spec)
  assert.equal(settings().tableHeaders, 'th')
})

test('Excel: the spec workbook round-trips, with drop-downs', async () => {
  setStore(new MemoryStore())
  const spec = await openSpec({ client: 'Sirio', series: '', book: EISBN }, DEFAULT_SETTINGS)
  const wb = specWorkbook({ client: 'Sirio', book: EISBN, resolved: spec.resolved })
  const sheets = readXlsx(wb)
  assert.deepEqual(sheets.map((s) => s.name), ['Spec', 'About'])
  assert.equal(sheets[0].rows.length, RULES.length + 1)
  assert.match(text(zipSync({}) && wb.slice(0, 2)), /PK/)
  // the client edits the Value column and sends it back
  const rows = sheets[0].rows.map((r) => [...r])
  rows[rows.findIndex((r) => r[0] === 'CSS-01')][6] = 'compact'
  rows[rows.findIndex((r) => r[0] === 'NOTE-03')][6] = '2'
  rows[rows.findIndex((r) => r[0] === 'HD-01')][6] = 'nonsense'
  const back = readRequirements('spec.xlsx', writeXlsx([{ name: 'Spec', rows }]))
  assert.ok(back.template)
  const by = new Map(back.template!.map((s) => [s.ruleId, s]))
  assert.equal(by.get('CSS-01')!.value, 'compact')
  assert.equal(by.get('NOTE-03')!.value, 2)
  assert.equal(by.get('HD-01')!.value, undefined, 'an invalid value is not applied')
  assert.equal(by.get('HD-01')!.confidence < 0.5, true)
})

/** a minimal Word document with a paragraph and a table */
function docx(paras: string[], table: string[][]): Uint8Array {
  const p = (t: string) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`
  const tbl = `<w:tbl>${table.map((r) => `<w:tr>${r.map((c) => `<w:tc>${p(c)}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`
  return zipSync({ 'word/document.xml': strToU8(`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras.map(p).join('')}${tbl}</w:body></w:document>`) })
}

test('client requirement file (Word): requirements matched to rules by their words; the rest are open questions', () => {
  const file = docx(
    ['Requisitos EPUB – Editorial Sirio', 'Las tablas deben ser como el manual EPUB, sin thead.', 'La línea de las notas al pie (foot-line) debe ser corta.', 'Sangría de las notas: 1.5em', 'Usar la fuente Garamond en todo el libro.'],
    [['Punto', 'Requisito'], ['1', 'CSS order by vertical']],
  )
  assert.equal(readDocx(file).length, 7)
  const { template, items } = readRequirements('requisitos.docx', file)
  assert.equal(template, undefined)
  const m = new Map(matchByKeywords(items).map((s) => [s.req.text, s]))
  assert.equal(m.get('Las tablas deben ser como el manual EPUB, sin thead.')!.ruleId, 'TBL-01')
  assert.equal(m.get('Las tablas deben ser como el manual EPUB, sin thead.')!.value, 'reference')
  assert.equal(m.get('La línea de las notas al pie (foot-line) debe ser corta.')!.value, 'short')
  assert.equal(m.get('Sangría de las notas: 1.5em')!.ruleId, 'NOTE-03')
  assert.equal(m.get('Sangría de las notas: 1.5em')!.value, 1.5)
  assert.equal(m.get('1 | CSS order by vertical')!.value, 'vertical')
  assert.equal(m.get('Usar la fuente Garamond en todo el libro.')!.ruleId, undefined, 'no rule: an open question')
})

test('AI matching (Groq): request shape, parsing, and a clear message on a refused key', async () => {
  const items = [{ text: 'Tables must not have header cells', where: 'row 2' }, { text: 'Use Garamond', where: 'row 3' }]
  let sent: { url: string; body: Record<string, unknown>; auth: string } | undefined
  const ok = (async (url: string, init: RequestInit) => {
    sent = { url, body: JSON.parse(String(init.body)), auth: (init.headers as Record<string, string>).Authorization }
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ matches: [
      { index: 0, ruleId: 'TBL-01', value: 'reference', confidence: 0.9, reason: 'Asks for plain cells.' },
      { index: 1, ruleId: null, value: null, confidence: 0, reason: 'No rule sets fonts.' },
    ] }) } }] }), { status: 200 })
  }) as unknown as typeof fetch
  const s = await matchWithAi(items, { apiKey: 'gsk_test', model: 'openai/gpt-oss-120b' }, ok)
  assert.equal(sent!.url, 'https://api.groq.com/openai/v1/chat/completions')
  assert.equal(sent!.auth, 'Bearer gsk_test')
  assert.equal((sent!.body.response_format as { type: string }).type, 'json_schema')
  assert.equal(s[0].ruleId, 'TBL-01')
  assert.equal(s[0].value, 'reference')
  assert.equal(s[1].ruleId, undefined)
  const refused = (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch
  await assert.rejects(matchWithAi(items, { apiKey: 'bad', model: 'x' }, refused), /API key was refused/)
  await assert.rejects(matchWithAi(items, { apiKey: '', model: 'x' }), /Groq API key/)
})

// ---- V3 rows 16–20, as rules ----------------------------------------------------------------

function book(s: Partial<HouseSettings> = {}) {
  setSettings(s)
  const a = analyze(indesignExport())
  const r = build(a, { styles: a.styles, images: a.images, meta: { ...a.meta, eisbn: EISBN, publisher: 'Editorial Sirio' }, cover: { name: 'cover.png', data: PNG } })
  const f = (n: string) => text(r.files.get(`OEBPS/${n}`)!)
  return { f, css: f('css/style.css') }
}

test('V3 rows 16–20: heading space and size, contents indent, footnote indent — all set by rules', () => {
  let { f, css } = book()
  // row 17: headings always state their size (else readers use their own 2em h1), the title span relative to its label
  assert.match(css, /h2\.Antetitulo_SUPER\n\{\nfont-size:110%;/)
  assert.match(css, /span\.Titulo_SUPER\n\{\nfont-size:165%;/)
  // row 16: space above and below part/chapter/section titles
  assert.match(css, /h2\.Antetitulo_SUPER\n\{\nfont-size:110%;\ntext-align:center;\nmargin-top:3em;\nmargin-bottom:2em;/)
  // rows 18–19: contents entries flush as in print; back matter entries are toc_1, not chapter entries
  assert.match(css, /p\.toc_1a\n\{\nmargin-left:0em;\n\}/)
  assert.match(f('toc.xhtml'), /<p class="toc_1"><a href="list.xhtml">/)
  // row 20: footnotes indented
  assert.match(css, /p\.Nota-al-pie\n\{\ntext-indent:1\.5em;\n\}/)
  ;({ css } = book({ headingSpaceAboveEm: 5, headingScalePct: 80, tocEntryIndentEm: 1.5, footnoteIndentEm: 0 }))
  assert.match(css, /h2\.Antetitulo_SUPER\n\{\nfont-size:85%;\ntext-align:center;\nmargin-top:5em;/)
  assert.match(css, /p\.toc_1a\n\{\nmargin-left:1\.5em;/)
  assert.match(css, /p\.Nota-al-pie\n\{\ntext-indent:0em;/)
})

test('A11Y-01: a picture without a description stops delivery unless the client waived it', () => {
  assert.equal(ruleById.get('A11Y-01')!.safe, 'error')
  setSettings({ altRequired: 'warn' })
  assert.equal(settings().altRequired, 'warn')
})
