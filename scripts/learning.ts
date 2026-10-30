// Prints the weekly learning report: node scripts/learning.ts <dir>
// <dir>/<client>/<book>/DECISIONS.jsonl per book; optional <dir>/instructions.json (Override[]: client, book, ruleId, value)
// and <dir>/overridden.json ({ book, page }[]: pages a person replaced).
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { learningReport, parseDecisions, type BookLog } from '../src/engine/review/learning.ts'

const dir = process.argv[2]
if (!dir) throw new Error('usage: node scripts/learning.ts <dir>')
const dirs = (d: string) => readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
const json = <T>(f: string, none: T): T => (existsSync(join(dir, f)) ? (JSON.parse(readFileSync(join(dir, f), 'utf8')) as T) : none)

const books: BookLog[] = []
for (const client of dirs(dir))
  for (const book of dirs(join(dir, client))) {
    const f = join(dir, client, book, 'DECISIONS.jsonl')
    if (existsSync(f)) books.push({ client, book, lines: parseDecisions(readFileSync(f, 'utf8')) })
  }
console.log(learningReport({ books, instructions: json('instructions.json', []), overridden: json('overridden.json', []) }))
