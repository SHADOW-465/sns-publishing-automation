// Fills the rules and corrections tables from the rulebook workbook, and regenerates src/engine/spec/rulebook-ids.ts.
//   npx tsx scripts/seed-rulebook.ts [path-to.xlsx|path-to.json]     (or RULEBOOK_XLSX=...; node scripts/seed-rulebook.ts works too)
//   add --ids-only to write rulebook-ids.ts without touching Supabase
// The workbook is read by python + openpyxl (no xlsx reader in node_modules) into data/rulebook.json, which is not in git.
// Writing needs SUPABASE_SERVICE_ROLE_KEY: row level security gives the anon key no write access. The key is never printed.
import { spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { loadEnvLocal, supabaseFromEnv } from '../src/engine/spec/env.ts'

const DEFAULT_XLSX = 'C:\\Users\\acer\\Documents\\GitHub\\pdf-tagger-sns-pdfua\\corrections\\SNS_Rulebook_2026-10-25.xlsx'
const JSON_OUT = resolve('data/rulebook.json')
const IDS_OUT = resolve('src/engine/spec/rulebook-ids.ts')
type Row = Record<string, string | null>

const fail = (msg: string): never => {
  console.error(`FAIL ${msg}`)
  process.exit(1)
}

loadEnvLocal()
const idsOnly = process.argv.includes('--ids-only')
const src = resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) ?? process.env.RULEBOOK_XLSX ?? DEFAULT_XLSX)

if (src.endsWith('.xlsx')) {
  mkdirSync(dirname(JSON_OUT), { recursive: true })
  const py = spawnSync('python', ['-P', resolve('scripts/export-rulebook.py'), src, JSON_OUT], { encoding: 'utf8' })
  if (py.status !== 0) fail(`could not read ${src} with python/openpyxl: ${(py.stderr || py.error?.message || '').trim().split('\n').pop()}`)
}
const book = JSON.parse(readFileSync(src.endsWith('.xlsx') ? JSON_OUT : src, 'utf8')) as { Rules: Row[]; 'Client corrections log': Row[] }

const rules = book.Rules.map((r) => ({
  id: r.ID,
  category: r.Category,
  output_type: r['Output type'],
  source_format: r['Source format'],
  statement: r['Rule statement'],
  rationale: r.Rationale,
  origin_type: r['Origin type'],
  origin: r.Origin,
  scope: r['Client-specific vs default'],
  verify: r['How to verify'],
  engine_status: r['Engine class'], // the workbook's "Engine class" holds the status word; its "Engine status" column is the longer note
  engine_detail: r['Engine status'],
  priority: r.Priority,
  notes: r.Notes,
}))
const corrections = book['Client corrections log'].map((r) => {
  const [from, to] = (r['Output / source type'] ?? '').split(' -> ')
  return {
    id: r.ID,
    received_date: r['Date received'],
    kind: r.Kind,
    source_file: r['Source file'],
    book: r.Book,
    page: r['Page / location'],
    output_type: to ?? from ?? null,
    source_format: to ? from : null,
    text: r['Client text (verbatim-ish)'] ?? '',
    rule_ids: (r['Mapped rule IDs'] ?? '').split(/[,;\s]+/).filter((x) => /^[A-Z0-9]+-\d+$/.test(x)),
    status: r.Status,
    fix_commit: r['Status evidence']?.match(/commits?\s+([0-9a-f]{7,10}(?:\s*[/,]\s*[0-9a-f]{7,10})*)/)?.[1] ?? null,
    proof: r['Status evidence'],
  }
})
if (rules.length !== 242 || corrections.length !== 130) fail(`expected 242 rules and 130 corrections, read ${rules.length} and ${corrections.length}`)

const q = (s: string | null) => JSON.stringify(s ?? '')

// Rule cards (OPUS_DESIGN2 §c.1). A workbook column ("Applies when", "Check", "Fix", "Examples", "Prompt text", "Status", "Tests")
// wins when it is filled in; otherwise the card is derived from the columns the sheet already has and from the test names.
const list = (s: string | null | undefined) => (s ?? '').split(/[;\n]+/).map((x) => x.trim()).filter(Boolean)
const STATUS: Record<string, string> = { Implemented: 'implemented', 'Partial / open': 'check-only', 'Needs code': 'not-built', Unknown: 'not-built' }
const testNames: { file: string; name: string }[] = []
for (const f of readdirSync(resolve('test')).filter((n) => n.endsWith('.test.ts')))
  for (const m of readFileSync(resolve('test', f), 'utf8').matchAll(/^\s*(?:test|it)\((['"`])(.+?)\1/gm)) testNames.push({ file: f, name: m[2] })
// rule IDs the engine's checks and guards name in their messages ('PFG-003: ...'): those rules have a check in code
const inCode = new Set<string>()
const walk = (d: string): void => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    if (e.isDirectory()) walk(resolve(d, e.name))
    else if (e.name.endsWith('.ts')) for (const m of readFileSync(resolve(d, e.name), 'utf8').matchAll(/['"`]([A-Z][A-Z0-9]{1,4}-\d{2,3}):/g)) inCode.add(m[1])
  }
}
walk(resolve('src/engine'))
const byId = new Map(corrections.map((c) => [c.id, c]))
const cards = rules.map((r, i) => {
  const row = book.Rules[i]
  const how = r.verify ?? '', st = r.engine_detail ?? ''
  const live = r.engine_status === 'Implemented' || r.engine_status === 'Partial / open'
  // an engine rule code ("Rule UA-01") in the status note is also a name a test may carry
  const codes = [...st.matchAll(/\b([A-Z][A-Z0-9]{1,4}-\d{2})\b/g)].map((m) => m[1])
  const ref = codes[0] ?? st.match(/\b((?:[a-z]+\/)?[\w-]+\.ts)\b/)?.[1]
  const related = list(row['Related corrections']?.replace(/,/g, ';')).map((id) => byId.get(id)).filter((c) => !!c)
  const names = [r.id, ...codes]
  const tests = testNames.filter((t) => names.some((n) => new RegExp(`\\b${n}\\b`).test(t.name))).map((t) => `${t.file} › ${t.name}`)
  return {
    id: r.id,
    statement: r.statement,
    priority: r.priority,
    origin: r.origin_type ?? '',
    clients: r.scope ?? '',
    date: related.map((c) => c!.received_date?.match(/^\d{4}-\d\d-\d\d/)?.[0] ?? '').filter(Boolean).sort()[0] ?? '',
    applies_when: row['Applies when'] ?? [r.output_type, r.source_format].filter(Boolean).join(' | '),
    check: row.Check ?? (live && (inCode.has(r.id!) || /check|guard|gate|validat|verap|pac\b|audit|score|test/i.test(st)) ? how : ''),
    fix: row.Fix ?? (live && ref ? `engine:${ref}` : 'person'),
    examples: row.Examples ? list(row.Examples) : related.map((c) => `${c!.id} ${c!.book ?? ''} ${c!.page ?? ''}`.trim()),
    prompt_text: row['Prompt text'] ?? '',
    status: row.Status ?? STATUS[r.engine_status ?? ''] ?? 'not-built',
    tests: row.Tests ? list(row.Tests) : tests,
  }
})
const cardLine = (c: (typeof cards)[number]) => `  { ${Object.entries(c).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ')} },`
writeFileSync(
  IDS_OUT,
  `// Generated by scripts/seed-rulebook.ts from SNS_Rulebook_2026-10-25.xlsx. Do not edit by hand.
// Rule cards (OPUS_DESIGN2 §c.1): the client rulebook rules with check, fix, examples, prompt line, status and the tests that cover them.
// A rule ID named in a check or guard message must be one of these (test/rulebook-ids.test.ts); \`npm run syllabus\` reports the coverage.
export interface RulebookEntry {
  id: string
  statement: string
  priority: string
  origin: string
  clients: string
  date: string
  applies_when: string
  check: string
  fix: string // engine:<function>, ai:<op> or person
  examples: string[]
  prompt_text: string
  status: string // implemented | check-only | AI-assisted | manual | not-built
  tests: string[] // "file.test.ts › test name"
}
export const RULEBOOK: readonly RulebookEntry[] = [
${cards.map(cardLine).join('\n')}
]
export const RULEBOOK_IDS: ReadonlySet<string> = new Set(RULEBOOK.map((r) => r.id))
`,
)
console.log(`PASS wrote ${relative('.', IDS_OUT)} (${rules.length} rules)`)
if (idsOnly) process.exit(0)

const sb = supabaseFromEnv()
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!sb) fail('no Supabase URL in the environment or .env.local')
if (!key) fail('SUPABASE_SERVICE_ROLE_KEY is not set; row level security does not let the anon key write')
const base = `${sb!.url.replace(/\/$/, '')}/rest/v1`
const call = (path: string, init: RequestInit = {}) =>
  fetch(`${base}/${path}`, { ...init, headers: { apikey: key!, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } })

for (const t of ['rules', 'corrections']) {
  const r = await call(`${t}?select=id&limit=0`)
  if (r.status === 404) fail(`table ${t} does not exist: apply supabase/migrations/20261025120000_rules_corrections.sql first`)
  if (!r.ok) fail(`table ${t} could not be read (status ${r.status})`)
}
for (const [t, rows] of [['rules', rules], ['corrections', corrections]] as const) {
  for (let i = 0; i < rows.length; i += 100) {
    const r = await call(`${t}?on_conflict=id`, { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows.slice(i, i + 100)) })
    if (!r.ok) fail(`upsert into ${t} was refused (status ${r.status}): ${(await r.text()).slice(0, 200)}`)
  }
  console.log(`PASS upserted ${rows.length} rows into ${t}`)
}
