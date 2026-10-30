// Every rule ID a check or guard names in its message must be a real rule: in the client rulebook
// (src/engine/spec/rulebook-ids.ts, generated) or one of the engine's own setting rules (spec/rules.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { RULEBOOK, RULEBOOK_IDS } from '../src/engine/spec/rulebook-ids.ts'
import { RULES } from '../src/engine/spec/rules.ts'
import { syllabusRows, syllabusReport } from '../src/engine/spec/syllabus.ts'

test('the rulebook list holds the 242 rules, each with a statement and a priority', () => {
  assert.equal(RULEBOOK.length, 242)
  assert.equal(RULEBOOK_IDS.size, 242)
  for (const r of RULEBOOK) assert.ok(r.statement && /^P[0-3]$/.test(r.priority), r.id)
})

test('rule IDs named in check and guard messages exist', () => {
  const known = new Set([...RULEBOOK_IDS, ...RULES.map((r) => r.id)])
  const dir = new URL('../src/engine/check/', import.meta.url)
  const bad: string[] = []
  let seen = 0
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
    for (const m of readFileSync(new URL(f, dir), 'utf8').matchAll(/['"`]([A-Z][A-Z0-9]{1,4}-\d{2,3}):/g)) {
      seen++
      if (!known.has(m[1])) bad.push(`${f}: ${m[1]}`)
    }
  }
  assert.ok(seen > 0, 'the scan found no rule IDs at all; the pattern is stale')
  assert.deepEqual(bad, [])
})

// T24 rule cards: every rulebook rule carries the card fields, and the tests a card cites exist.
const STATUSES = ['implemented', 'check-only', 'AI-assisted', 'manual', 'not-built']

test('every card has applies_when, check, fix, examples, prompt_text, status and tests', () => {
  for (const r of RULEBOOK) {
    assert.ok(r.applies_when, `${r.id} applies_when`)
    assert.equal(typeof r.check, 'string', `${r.id} check`)
    assert.ok(r.fix === 'person' || /^(engine|ai):\S/.test(r.fix), `${r.id} fix "${r.fix}"`)
    assert.ok(Array.isArray(r.examples) && Array.isArray(r.tests), `${r.id} examples/tests`)
    assert.equal(typeof r.prompt_text, 'string', `${r.id} prompt_text`)
    assert.ok(STATUSES.includes(r.status), `${r.id} status "${r.status}"`)
  }
})

test('the test names a card cites exist in the test files', () => {
  const dir = new URL('./', import.meta.url)
  const bad: string[] = []
  let cited = 0
  for (const r of RULEBOOK) {
    for (const t of r.tests) {
      cited++
      const [file, name] = t.split(' › ')
      let src = ''
      try { src = readFileSync(new URL(file, dir), 'utf8') } catch { /* reported below */ }
      if (!name || !src.includes(name)) bad.push(`${r.id}: ${t}`)
    }
  }
  assert.ok(cited > 20, `only ${cited} tests are cited; the scan is stale`)
  assert.deepEqual(bad, [])
})

test('the syllabus report lists all 242 cards with check, fix and test flags', () => {
  const rows = syllabusRows()
  assert.equal(rows.length, 242)
  assert.deepEqual(rows.map((r) => r.id), RULEBOOK.map((r) => r.id))
  for (const r of rows) for (const k of ['check', 'fix', 'test'] as const) assert.equal(typeof r[k], 'boolean', `${r.id} ${k}`)
  const text = syllabusReport(rows)
  for (const r of rows) assert.ok(text.includes(r.id), r.id)
  assert.match(text, /P0 and P1 cards with check, fix and test: \d+ of 160/)
})
