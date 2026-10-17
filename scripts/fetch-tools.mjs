// Puts the JRE and epubcheck.jar in tools/ when they are missing (tools/ is git-ignored; the installer packs it).
//   node scripts/fetch-tools.mjs [--from <dir>]
// --from copies a folder that already holds jdk-*/ and epubcheck-*/ (an offline build machine); otherwise the pinned
// archives in scripts/tools.lock.json are downloaded. Every archive is checked against its sha256 before it is unpacked,
// and the jar is checked after, so a changed or truncated download stops the build.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzipSync } from 'fflate'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tools = process.env.TOOLS_DIR ? resolve(process.env.TOOLS_DIR) : join(root, 'tools')
const lock = JSON.parse(readFileSync(join(root, 'scripts/tools.lock.json'), 'utf8'))
const sha = (b) => createHash('sha256').update(b).digest('hex')
const javaExe = join(tools, lock.jre.dir, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
const jar = join(tools, lock.epubcheck.dir, 'epubcheck.jar')
const from = process.argv.includes('--from') ? resolve(process.argv[process.argv.indexOf('--from') + 1]) : undefined

async function fetchZip(spec) {
  const r = await fetch(spec.url, { redirect: 'follow' })
  if (!r.ok) throw new Error(`${spec.url}: HTTP ${r.status}`)
  const bytes = new Uint8Array(await r.arrayBuffer())
  if (sha(bytes) !== spec.sha256) throw new Error(`${spec.dir}: the download does not match the pinned sha256 (${sha(bytes)}). Not unpacked.`)
  for (const [name, data] of Object.entries(unzipSync(bytes))) {
    if (name.endsWith('/')) continue
    const out = join(tools, name)
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, data)
  }
}

mkdirSync(tools, { recursive: true })
for (const [spec, ok] of [[lock.jre, existsSync(javaExe)], [lock.epubcheck, existsSync(jar)]]) {
  if (ok) continue
  if (from) {
    if (!existsSync(join(from, spec.dir))) throw new Error(`${join(from, spec.dir)} is missing`)
    cpSync(join(from, spec.dir), join(tools, spec.dir), { recursive: true })
    console.log(`copied ${spec.dir} from ${from}`)
  } else {
    console.log(`fetching ${spec.dir} …`)
    await fetchZip(spec)
  }
}
if (sha(readFileSync(jar)) !== lock.epubcheck.jarSha256) throw new Error('epubcheck.jar does not match the pinned sha256')
if (!existsSync(javaExe)) throw new Error(`${javaExe} is missing`)
console.log(`tools/ ready: ${lock.jre.dir}, ${lock.epubcheck.dir} (jar sha256 ok)`)
