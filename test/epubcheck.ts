// Runs W3C EPUBCheck from tools/ (portable JRE + epubcheck.jar, see README). Returns null when
// the tools are not installed, so tests can skip instead of failing.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, writeFileSync, mkdtempSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const TOOLS = resolve(dirname(fileURLToPath(import.meta.url)), '../tools')

function paths() {
  if (!existsSync(TOOLS)) return null
  const jre = readdirSync(TOOLS).find((d) => d.startsWith('jdk-'))
  const ec = readdirSync(TOOLS).find((d) => d.startsWith('epubcheck-'))
  return jre && ec ? { java: join(TOOLS, jre, 'bin', 'java'), jar: join(TOOLS, ec, 'epubcheck.jar') } : null
}

export function epubcheck(epub: Uint8Array | string): { errors: string[]; warnings: string[]; output: string } | null {
  const p = paths()
  if (!p) return null
  let file = epub as string
  if (typeof epub !== 'string') writeFileSync((file = join(mkdtempSync(join(tmpdir(), 'epc-')), 'book.epub')), epub)
  let output: string
  try {
    output = execFileSync(p.java, ['-jar', p.jar, file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    const x = e as { stdout?: string; stderr?: string }
    output = (x.stdout ?? '') + (x.stderr ?? '')
  }
  const lines = output.split(/\r?\n/)
  return { errors: lines.filter((l) => /^(ERROR|FATAL)/.test(l)), warnings: lines.filter((l) => /^WARNING/.test(l)), output }
}

// CLI: node test/epubcheck.ts book.epub
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const r = epubcheck(resolve(process.argv[2]))
  if (!r) throw new Error('EPUBCheck not installed in tools/ (see README)')
  console.log(r.output)
  process.exitCode = r.errors.length ? 1 : 0
}
