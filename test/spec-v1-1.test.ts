// T30: the capability spec v1.1 (docs/SNS_Capability_Spec_v1.1.md) and the code say the same thing. The spec's op list, roles, limits,
// retry counts, audit names and prompts are read from the file and compared with what T12/T13 (decision.ts, validate.ts), T15-T18 do.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { PAGE_MODEL_TIMEOUT_MS, pageAnswerSchema } from '../src/engine/pdf/page-model.ts'
import { AGREE, BAND, BIG_CHANGE, FIELDS, MAX_HEADING_WORDS, ROLES, SURE } from '../src/engine/pdf/validate.ts'
import { MAX_ASKS, MAX_ROUNDS } from '../src/engine/pdf/page-rounds.ts'
import { decisionsName } from '../src/engine/review/decisions.ts'

const spec = readFileSync('docs/SNS_Capability_Spec_v1.1.md', 'utf8')
const src = (f: string) => readFileSync(f, 'utf8')
const rule = (id: string) => spec.match(new RegExp(`\\*\\*${id} [^\\n]*`))?.[0] ?? assert.fail(`${id} is not in the spec`)
const ticks = (s: string) => [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1])
const section = (title: RegExp) => {
  const at = spec.search(title)
  assert.ok(at >= 0, `${title} is not in the spec`)
  return spec.slice(at).split(/\n(?=#{1,3} )/)[0]
}
const OPS = Object.keys(FIELDS)

test('the spec is v1.1 and replaces §1.3 principle 1, §4.3, P4, P5 and P9', () => {
  assert.match(spec, /^# .*version 1\.1/im)
  for (const h of [/^## 1\.3 /m, /^## 4\.3 /m, /^### P4\./m, /^### P5\./m, /^### P9\./m]) assert.match(spec, h)
  assert.match(section(/^## 1\.3 /m), /the model proposes, the engine decides/)
})

test('SPEC-AI-01 lists the ops and roles the code has, no more and no fewer', () => {
  const r = rule('SPEC-AI-01')
  const schemaOps = pageAnswerSchema().properties.ops.items.anyOf.map((o) => o.properties.op.const)
  assert.deepEqual([...schemaOps].sort(), [...OPS].sort())
  const found = ticks(r)
  assert.deepEqual(OPS.filter((o) => !found.includes(o)), [], 'an op the code has is missing from the spec')
  const named = found.filter((t) => /^[a-z]+$/.test(t))
  assert.deepEqual(named.filter((t) => !OPS.includes(t)), [], 'the spec names an op the code does not have')
  const roleOp = pageAnswerSchema().properties.ops.items.anyOf.find((o) => o.properties.op.const === 'role')?.properties as unknown as { role: { enum: string[] } }
  assert.deepEqual([...ROLES].sort(), [...roleOp.role.enum].sort())
  assert.deepEqual(found.filter((t) => /^(P|H[1-6]|Caption|Note|Artifact|Aside|LI|TOCI|BlockQuote)$/.test(t)).sort(), [...ROLES].sort())
})

test('the guards, limits and retries in the spec are the code’s', () => {
  const v = src('src/engine/pdf/validate.ts')
  assert.match(rule('SPEC-AI-04'), new RegExp(`${BAND * 100}%`))
  assert.match(rule('SPEC-AI-04'), new RegExp(`over ${MAX_HEADING_WORDS} words`))
  assert.match(rule('SPEC-AI-04'), /within 3 em of a figure/)
  assert.match(rule('SPEC-AI-04'), /grown by 2 em/)
  assert.match(rule('SPEC-AI-04'), /repeated on 3 pages or more/)
  for (const s of [/em \* 3/, /em \* 2/, /repeats\(b\) < 3/]) assert.match(v, s)
  const geo = rule('SPEC-AI-05')
  for (const n of [BIG_CHANGE, SURE, AGREE]) assert.ok(geo.includes(String(n)), `${n} is missing from SPEC-AI-05`)
  const c = rule('SPEC-AI-07')
  assert.match(c, new RegExp(`at most ${MAX_ASKS} times per round`))
  assert.match(c, new RegExp(`at most ${MAX_ROUNDS} rounds`))
  assert.match(c, new RegExp(`${PAGE_MODEL_TIMEOUT_MS / 1000} seconds`))
  assert.match(c, /cache\/ai\/<bookHash>\/<pageKey>\.json/)
  assert.match(src('src/engine/pdf/page-cache.ts'), /cache\/ai\/<bookHash>\/<pageKey>\.json/)
})

test('SPEC-AI-03 conservation drops the whole answer, and the validator does', () => {
  assert.match(rule('SPEC-AI-03'), /whole answer is dropped/)
  assert.match(src('src/engine/pdf/validate.ts'), /answerRejected/)
})

test('the audit names in SPEC-AI-08 are the ones the code writes', () => {
  const r = rule('SPEC-AI-08')
  const d = src('src/engine/review/decisions.ts')
  assert.ok(r.includes('Structure corrected by the page reader') && d.includes('Structure corrected by the page reader'))
  assert.match(r, /<epub-basename>_DECISIONS\.jsonl/)
  assert.equal(decisionsName('book.epub'), 'book_DECISIONS.jsonl')
  for (const s of ['applied', 'refused', 'reverted']) assert.ok(r.includes(`\`${s}\``) && d.includes(`'${s}'`), s)
  for (const f of ['page', 'page key', 'model', 'op', 'before', 'after', 'validator result', 'rule ID', 'status']) assert.ok(r.includes(f), f)
})

test('every SPEC-AI rule cites the task and the file that built it; T12 and T13 are both cited', () => {
  const ids = [...spec.matchAll(/^\*\*(SPEC-AI-\d\d) /gm)].map((m) => m[1])
  assert.deepEqual(ids, ['SPEC-AI-01', 'SPEC-AI-02', 'SPEC-AI-03', 'SPEC-AI-04', 'SPEC-AI-05', 'SPEC-AI-06', 'SPEC-AI-07', 'SPEC-AI-08'])
  const tasks = new Set<string>()
  for (const id of ids) {
    const r = rule(id)
    const t = [...r.matchAll(/\bT(\d+)\b/g)].map((m) => `T${m[1]}`)
    assert.ok(t.length, `${id} cites no task`)
    t.forEach((x) => tasks.add(x))
    for (const f of ticks(r).filter((x) => x.startsWith('src/'))) assert.ok(existsSync(f), `${id} cites ${f}, which is not there`)
  }
  assert.ok(tasks.has('T12') && tasks.has('T13'))
  assert.ok(rule('SPEC-AI-01').includes('src/engine/pdf/decision.ts') && rule('SPEC-AI-02').includes('src/engine/pdf/validate.ts'))
})

test('P4, P5 and P9 return the op schema, and only ops the code has', () => {
  for (const [p, next] of [['P4', 'P5'], ['P5', 'P9'], ['P9', '']] as const) {
    const at = spec.indexOf(`### ${p}.`)
    const body = spec.slice(at, next ? spec.indexOf(`### ${next}.`) : undefined)
    const used = [...body.matchAll(/"op":\s*"([a-z]+)"/g)].map((m) => m[1])
    assert.deepEqual(used.filter((o) => !OPS.includes(o)), [], `${p} names an op the code does not have`)
    if (p !== 'P5') assert.ok(used.length >= 3, `${p} returns ops`)
    assert.match(body, /(never write|Never write|do not add or change|You never write)/i, `${p} keeps the text`)
  }
  assert.match(section(/^### P5\./m), /"levels":\[\{"key":/)
  assert.match(section(/^### P9\./m), /"review":\[/)
  assert.ok(!OPS.includes('table'), 'there is no table op, so P9 sends what an op cannot fix to review')
})
