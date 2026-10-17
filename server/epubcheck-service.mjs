// EPUBCheck as a local service: a JRE and epubcheck.jar, no network needed. Plain ESM so Vite, Node tests and the
// Electron shell all load it. Where the tools are, in order:
//   1. EPUBCHECK_HOME            (an override)
//   2. <resources dir>/tools     (the packaged desktop app: electron-builder extraResources)
//   3. <repo>/tools              (development; git ignores it, scripts/fetch-tools.mjs fills it)
//   POST /api/epubcheck   body = the .epub        →  { errors: string[], warnings: string[] }
//   GET  /api/epubcheck                           →  { available: boolean }
import { execFile } from 'node:child_process'
import { existsSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

export function toolDirs() {
  return [process.env.EPUBCHECK_HOME, process.resourcesPath && join(process.resourcesPath, 'tools'), resolve(here, '../tools')].filter(Boolean)
}

/** @returns {{ java: string, jar: string, dir: string } | null} */
export function toolPaths() {
  for (const dir of toolDirs()) {
    if (!existsSync(dir)) continue
    const jre = readdirSync(dir).find((d) => d.startsWith('jdk-'))
    const ec = readdirSync(dir).find((d) => d.startsWith('epubcheck-'))
    const java = jre && join(dir, jre, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
    if (java && ec && existsSync(java)) return { java, jar: join(dir, ec, 'epubcheck.jar'), dir }
  }
  return null
}

/** @param {Uint8Array} epub @returns {Promise<{ errors: string[], warnings: string[] } | null>} */
export async function runEpubcheck(epub) {
  const p = toolPaths()
  if (!p) return null
  const dir = mkdtempSync(join(tmpdir(), 'epc-'))
  const file = join(dir, 'book.epub')
  writeFileSync(file, epub)
  try {
    const output = await new Promise((done) =>
      execFile(p.java, ['-Xmx384m', '-Xss2m', '-XX:+UseSerialGC', '-jar', p.jar, file], { encoding: 'utf8', timeout: 240_000, maxBuffer: 32 << 20 }, (_e, out, err) => done(`${out}${err}`)),
    )
    const lines = output.split(/\r?\n/)
    return { errors: lines.filter((l) => /^(ERROR|FATAL)/.test(l)), warnings: lines.filter((l) => /^WARNING/.test(l)) }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Connect-style handler, usable by Vite, the Electron shell or a bare node:http server. */
export function epubcheckHandler(req, res) {
  res.setHeader('content-type', 'application/json')
  if (req.method !== 'POST') return void res.end(JSON.stringify({ available: !!toolPaths() }))
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', async () => {
    const r = await runEpubcheck(new Uint8Array(Buffer.concat(chunks)))
    res.statusCode = r ? 200 : 503
    res.end(JSON.stringify(r ?? { error: 'EPUBCheck is not installed in tools/' }))
  })
}

export function epubcheckPlugin() {
  return {
    name: 'epubcheck-service',
    configureServer: (s) => void s.middlewares.use('/api/epubcheck', epubcheckHandler),
    configurePreviewServer: (s) => void s.middlewares.use('/api/epubcheck', epubcheckHandler),
  }
}
