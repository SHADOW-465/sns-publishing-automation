// The model bake-off (OPUS_DESIGN2 §b.8, T20): runs each candidate page model over the eval pages and writes the comparison table.
//   node --import ./test/setup.ts scripts/bakeoff.ts <models.json> <cases.json> [--out=bakeoff.md] [--config=config/page-model.json] [--no-record]
// models.json: [{ "name", "baseUrl", "model", "keyEnv"?, "cmd"?, "weights"?, "weightsSha256"?, "quant"?, "serverVersion"? }]
//   cmd starts the server for that model (it is stopped after its pages, so the VRAM reading is that model's own); without it the server
//   at baseUrl must already be up. keyEnv names the environment variable that holds the key; the key is never printed.
//   weights is a file or a folder, hashed here; or give weightsSha256.
// cases.json: [{ "req": { "ev": <page evidence>, "rules"?, "hints"? }, "images": [{ "dpi", "png": "<path, relative to this file>" }],
//   "lineText": { "<line id>": "<text>" }, "expected": { "order": [ids], "roles": { "<block id>": "<role>" }, "figures": [[piece ids]] } }]
//   built from the eval pages (test/eval-pages.json) and the client's finished files; those files are never in git.
// The pick (most accurate, p95 under 20 s) is written to config/page-model.json with its weights hash, which scripts/batch.ts reads.
// ponytail: GPU memory by nvidia-smi only (sum over cards); on another vendor the column is "–".
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { bakeoffTable, chooseModel, recordChoice, runBakeoff, type BakeCase, type Candidate } from '../src/engine/pdf/bakeoff.ts'

interface ModelSpec {
  name: string
  baseUrl: string
  model: string
  keyEnv?: string
  cmd?: string
  weights?: string
  weightsSha256?: string
  quant?: string
  serverVersion?: string
}

const argv = process.argv.slice(2)
const opt = (n: string) => argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const [modelsFile, casesFile] = argv.filter((a) => !a.startsWith('--'))
if (!modelsFile || !casesFile) throw new Error('usage: scripts/bakeoff.ts <models.json> <cases.json> [--out=bakeoff.md] [--config=config/page-model.json] [--no-record]')

const files = (p: string): string[] => (statSync(p).isDirectory() ? readdirSync(p).sort().flatMap((f) => files(join(p, f))) : [p])
/** sha256 of a file, or of a folder's files in name order (each file's own hash, so a big folder is never held in memory) */
async function weightsHash(path: string): Promise<string> {
  const all = createHash('sha256')
  for (const f of files(path)) {
    const h = createHash('sha256')
    for await (const chunk of createReadStream(f)) h.update(chunk)
    all.update(`${f.slice(path.length)}:${h.digest('hex')}\n`)
  }
  return all.digest('hex')
}

const gpuMiB = async () => {
  const r = spawnSync('nvidia-smi', ['--query-gpu=memory.used', '--format=csv,noheader,nounits'], { encoding: 'utf8' })
  const v = r.status === 0 ? r.stdout.split('\n').map(Number).filter((n) => n > 0) : []
  return v.length ? v.reduce((a, b) => a + b, 0) : undefined
}

async function candidate(s: ModelSpec): Promise<Candidate> {
  const base = s.baseUrl.replace(/\/$/, '')
  const up = async () => {
    try {
      return (await fetch(`${base}/models`, { signal: AbortSignal.timeout(3000) })).ok
    } catch {
      return false
    }
  }
  let proc: ChildProcess | undefined
  return {
    name: s.name,
    cfg: { apiKey: s.keyEnv ? (process.env[s.keyEnv] ?? '') : '', baseUrl: base, model: s.model },
    weightsSha256: s.weightsSha256 ?? (s.weights ? await weightsHash(resolve(s.weights)) : undefined),
    quant: s.quant,
    serverVersion: s.serverVersion,
    async load() {
      if (s.cmd && !(await up())) proc = spawn(s.cmd, { shell: true, stdio: 'ignore' })
      const end = Date.now() + Number(process.env.SNS_MODEL_WAIT_S ?? 300) * 1000
      while (!(await up())) {
        if (Date.now() > end) throw new Error(`no model server at ${base} for ${s.name}`)
        await new Promise((r) => setTimeout(r, 2000))
      }
    },
    async unload() {
      if (!proc?.pid) return
      if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'])
      else proc.kill('SIGTERM')
      proc = undefined
    },
    vram: gpuMiB,
  }
}

interface CaseFile extends Omit<BakeCase, 'req'> {
  req: { ev: BakeCase['req']['ev']; rules?: string[]; hints?: string[] }
  images?: { dpi: number; png: string }[]
}
const dir = dirname(resolve(casesFile))
const cases: BakeCase[] = (JSON.parse(readFileSync(resolve(casesFile), 'utf8')) as CaseFile[]).map((c) => ({
  ...c,
  req: { ...c.req, images: (c.images ?? []).map((i) => ({ dpi: i.dpi, png: new Uint8Array(readFileSync(resolve(dir, i.png))) })) },
}))
const cands = await Promise.all((JSON.parse(readFileSync(resolve(modelsFile), 'utf8')) as ModelSpec[]).map(candidate))

const rows = await runBakeoff(cands, cases)
const table = bakeoffTable(rows)
console.log(table)
const out = opt('out')
if (out) writeFileSync(resolve(out), `# Page model bake-off\n\n${cases.length} pages\n\n${table}`)
const pick = chooseModel(rows)
if (!pick) console.log('No model has a p95 under 20 s per page; nothing recorded.')
else if (argv.includes('--no-record')) console.log(`Best under 20 s: ${pick.model} (not recorded)`)
else {
  const file = resolve(opt('config') ?? 'config/page-model.json')
  recordChoice(file, pick, cands.find((c) => c.name === pick.model)!)
  console.log(`Chosen: ${pick.model} → ${file}`)
}
