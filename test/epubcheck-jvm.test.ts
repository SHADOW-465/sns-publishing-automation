// T29: EPUBCheck's JVM is capped and kept light, a crashed JVM's logs stay out of git, and package.json has no duplicate key.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JVM_ARGS } from '../server/epubcheck-service.mjs'

const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')

test('EPUBCheck JVM: -Xmx768m -XX:TieredStopAtLevel=1, in the service and in the test runner alike', () => {
  assert.ok(JVM_ARGS.includes('-Xmx768m') && JVM_ARGS.includes('-XX:TieredStopAtLevel=1'))
  assert.ok(!JVM_ARGS.some((a: string) => a.startsWith('-Xmx') && a !== '-Xmx768m'))
  assert.match(read('test/epubcheck.ts'), /JVM_ARGS/, 'test/epubcheck.ts uses the same options')
  assert.doesNotMatch(read('test/epubcheck.ts') + read('server/epubcheck-service.mjs'), /-Xmx384m/)
})

test('.gitignore keeps the JVM crash logs (hs_err_*, replay_*) out of git', () => {
  const lines = read('.gitignore').split(/\r?\n/)
  for (const p of ['hs_err_*', 'replay_*']) assert.ok(lines.some((l) => l.startsWith(p)), `.gitignore lists ${p}`)
})

test('package.json has no duplicate key (npm warns about those)', () => {
  const dup: string[] = []
  const seen: Record<string, Set<string>> = {}
  let section = ''
  for (const l of read('package.json').split(/\r?\n/)) {
    const open = /^ {2}"([^"]+)": \{/.exec(l)
    if (open) { section = open[1]; seen[section] = new Set(); continue }
    if (/^ {2}\}/.test(l)) { section = ''; continue }
    const k = /^ {4}"([^"]+)":/.exec(l)?.[1]
    if (section && k && seen[section].has(k)) dup.push(`${section}.${k}`)
    if (section && k) seen[section].add(k)
  }
  assert.deepEqual(dup, [])
})
