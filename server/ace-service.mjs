// Ace by DAISY as a local service (gate stage 5), next to EPUBCheck. Ace is a Node program that drives a headless Chrome
// (about 450 MB), so it is optional: `npm run tools:ace` installs it into tools/ace, and neither the web copy nor the
// installer carries it. Without it, or when it fails to run, the service answers 503 and the app checks the pages with
// axe-core (the engine inside Ace) instead. Where it is looked for, in order:
//   1. ACE_HOME                  (a folder holding node_modules/@daisy/ace)
//   2. <resources dir>/tools/ace (the packaged desktop app)
//   3. <repo>/tools/ace          (development; git ignores tools/)
//   POST /api/ace   body = the .epub   →  { errors: string[], warnings: string[] }   (critical/serious = errors), 503 when Ace did not run
//   GET  /api/ace                      →  { available: boolean }
import { execFile } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { toolDirs } from './epubcheck-service.mjs'

/** @returns {string | null} the Ace command line that drives puppeteer's headless Chrome (ace.js would start an Electron of its own) */
export function acePath() {
  for (const dir of [process.env.ACE_HOME, ...toolDirs().map((d) => join(d, 'ace'))].filter(Boolean)) {
    const js = join(dir, 'node_modules', '@daisy', 'ace', 'bin', 'ace-puppeteer.js')
    if (existsSync(js)) return js
  }
  return null
}

/** Ace's report.json → one line per failed check: "chapter01.xhtml: Images must have alternative text (image-alt)". */
export function aceFindings(report) {
  const errors = []
  const warnings = []
  for (const doc of report.assertions ?? []) {
    const file = String(doc['earl:testSubject']?.url ?? '').replace(/^.*\//, '')
    for (const a of doc.assertions ?? []) {
      if (a['earl:result']?.['earl:outcome'] !== 'fail') continue
      const t = a['earl:test'] ?? {}
      const line = `${file ? `${file}: ` : ''}${t['help']?.['dct:description'] ?? t['dct:description'] ?? t['dct:title']} (Ace ${t['dct:title']})`
      ;(/^(critical|serious)$/.test(t['earl:impact']) ? errors : warnings).push(line)
    }
  }
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] }
}

/** null when Ace is not installed or did not write a report (no headless Chrome, a crash, the time limit): the caller
 *  falls back to axe-core. A broken file is EPUBCheck's to report, not Ace's.
 *  @param {Uint8Array} epub @returns {Promise<{ errors: string[], warnings: string[] } | null>} */
export async function runAce(epub) {
  const js = acePath()
  if (!js) return null
  const dir = mkdtempSync(join(tmpdir(), 'ace-'))
  const file = join(dir, 'book.epub')
  writeFileSync(file, epub)
  try {
    // the Electron shell has no separate node: its own binary runs as node with ELECTRON_RUN_AS_NODE
    const env = process.versions.electron ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' } : process.env
    const failed = await new Promise((done) =>
      execFile(process.execPath, [js, '--silent', '--force', '--outdir', join(dir, 'out'), file], { env, timeout: 300_000, maxBuffer: 32 << 20 }, (e, _out, err) => done(e ? String(err || e.message) : '')),
    )
    const report = join(dir, 'out', 'report.json')
    if (!existsSync(report)) return console.warn(`Ace by DAISY did not run: ${String(failed).trim().slice(0, 500)}`), null
    return aceFindings(JSON.parse(readFileSync(report, 'utf8')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Connect-style handler, as epubcheckHandler. */
export function aceHandler(req, res) {
  res.setHeader('content-type', 'application/json')
  if (req.method !== 'POST') return void res.end(JSON.stringify({ available: !!acePath() }))
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', async () => {
    const r = await runAce(new Uint8Array(Buffer.concat(chunks))).catch((e) => (console.warn(`Ace by DAISY failed: ${e}`), null))
    res.statusCode = r ? 200 : 503
    res.end(JSON.stringify(r ?? { error: acePath() ? 'Ace by DAISY did not run on this file' : 'Ace by DAISY is not installed (npm run tools:ace)' }))
  })
}

export function acePlugin() {
  return {
    name: 'ace-service',
    configureServer: (s) => void s.middlewares.use('/api/ace', aceHandler),
    configurePreviewServer: (s) => void s.middlewares.use('/api/ace', aceHandler),
  }
}
