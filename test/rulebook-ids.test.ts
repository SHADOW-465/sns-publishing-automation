// Every rule ID a check or guard names in its message must be a real rule: in the client rulebook
// (src/engine/spec/rulebook-ids.ts, generated) or one of the engine's own setting rules (spec/rules.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { RULEBOOK, RULEBOOK_IDS } from '../src/engine/spec/rulebook-ids.ts'
import { RULES } from '../src/engine/spec/rules.ts'

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
