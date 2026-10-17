// EPUBCheck as a local service: the bundled JRE and epubcheck.jar in tools/ (or EPUBCHECK_HOME), no network needed.
// Vite serves it at /api/epubcheck in dev and preview; the same function backs a desktop shell later.
//   POST /api/epubcheck   body = the .epub        →  { errors: string[], warnings: string[] }
//   GET  /api/epubcheck                           →  { available: boolean }
import { execFile } from 'node:child_process'
import { existsSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

const TOOLS = process.env.EPUBCHECK_HOME ?? resolve(dirname(fileURLToPath(import.meta.url)), '../tools')

export function toolPaths(): { java: string; jar: string } | null {
  if (!existsSync(TOOLS)) return null
  const jre = readdirSync(TOOLS).find((d) => d.startsWith('jdk-'))
  const ec = readdirSync(TOOLS).find((d) => d.startsWith('epubcheck-'))
  return jre && ec ? { java: join(TOOLS, jre, 'bin', 'java'), jar: join(TOOLS, ec, 'epubcheck.jar') } : null
}

export async function runEpubcheck(epub: Uint8Array): Promise<{ errors: string[]; warnings: string[] } | null> {
  const p = toolPaths()
  if (!p) return null
  const dir = mkdtempSync(join(tmpdir(), 'epc-'))
  const file = join(dir, 'book.epub')
  writeFileSync(file, epub)
  try {
    const output = await new Promise<string>((done) =>
      execFile(p.java, ['-Xmx384m', '-Xss2m', '-XX:+UseSerialGC', '-jar', p.jar, file], { encoding: 'utf8', timeout: 240_000, maxBuffer: 32 << 20 }, (_e, out, err) => done(`${out}${err}`)),
    )
    const lines = output.split(/\r?\n/)
    return { errors: lines.filter((l) => /^(ERROR|FATAL)/.test(l)), warnings: lines.filter((l) => /^WARNING/.test(l)) }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

type Req = import('node:http').IncomingMessage
type Res = import('node:http').ServerResponse

/** Connect-style handler, usable by Vite or a bare node:http server. */
export function epubcheckHandler(req: Req, res: Res): void {
  res.setHeader('content-type', 'application/json')
  if (req.method !== 'POST') return void res.end(JSON.stringify({ available: !!toolPaths() }))
  const chunks: Buffer[] = []
  req.on('data', (c: Buffer) => chunks.push(c))
  req.on('end', async () => {
    const r = await runEpubcheck(new Uint8Array(Buffer.concat(chunks)))
    res.statusCode = r ? 200 : 503
    res.end(JSON.stringify(r ?? { error: 'EPUBCheck is not installed in tools/' }))
  })
}

export function epubcheckPlugin(): Plugin {
  return {
    name: 'epubcheck-service',
    configureServer: (s) => void s.middlewares.use('/api/epubcheck', epubcheckHandler),
    configurePreviewServer: (s) => void s.middlewares.use('/api/epubcheck', epubcheckHandler),
  }
}
