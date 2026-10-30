// The syllabus coverage report (OPUS_DESIGN2 §c.3): one row per rule card with check, fix and test flags.
// The cards come from the generated rulebook-ids.ts; `npm run syllabus` prints the report.
import { RULEBOOK, type RulebookEntry } from './rulebook-ids.ts'

export interface SyllabusRow { id: string; priority: string; status: string; check: boolean; fix: boolean; test: boolean; prompt: boolean; tests: string[] }

export const syllabusRows = (cards: readonly RulebookEntry[] = RULEBOOK): SyllabusRow[] =>
  cards.map((c) => ({
    id: c.id,
    priority: c.priority,
    status: c.status,
    check: c.check !== '',
    fix: c.fix !== 'person', // engine:<function> or ai:<op>; "person" means a staff member fixes it by hand
    test: c.tests.length > 0,
    prompt: c.prompt_text !== '',
    tests: c.tests,
  }))

const mark = (b: boolean) => (b ? '✓' : '✗')

export function syllabusReport(rows: SyllabusRow[]): string {
  const lines = rows.map((r) => `${r.id.padEnd(9)}${r.priority}  ${r.status.padEnd(12)} check ${mark(r.check)}  fix ${mark(r.fix)}  test ${mark(r.test)}  prompt ${mark(r.prompt)}  ${r.tests.join('; ')}`)
  const top = rows.filter((r) => r.priority === 'P0' || r.priority === 'P1')
  const full = top.filter((r) => r.check && r.fix && r.test).length
  const n = (f: (r: SyllabusRow) => boolean) => rows.filter(f).length
  return [
    `Syllabus coverage: ${rows.length} rule cards`,
    ...lines,
    '',
    `With a check: ${n((r) => r.check)}, a fix: ${n((r) => r.fix)}, a test: ${n((r) => r.test)}, a prompt line: ${n((r) => r.prompt)} (of ${rows.length})`,
    `P0 and P1 cards with check, fix and test: ${full} of ${top.length}`,
  ].join('\n')
}
