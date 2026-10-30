// The unattended batch (OPUS_DESIGN2 T19, OPUS_PLAN 5.1–5.2): every PDF in a folder becomes an Accessible PDF, in phases, so the page-reader
// model and the validators are never in memory together.
//   node --import ./test/setup.ts scripts/batch.ts <inputDir> <outDir> [--replay] [--timeout-min=8] [--ai-timeout-min=60]
// 1 build every book with no model · 2 the model loads once and answers every flagged page of every book · 3 the model is unloaded, then each
// book is rebuilt with the answers · 4 validate · 5 score, and write <outDir>/QUEUE.md (worst book first).
// Each stage of each book is a child process with its own timeout; a book that fails is listed in QUEUE.md and the run goes on.
// The model: config/page-model.json (the bake-off's pick, T20) or SNS_MODEL_BASE_URL (default http://127.0.0.1:8000/v1), SNS_MODEL, SNS_MODEL_KEY (if the server wants one; never printed).
// SNS_MODEL_CMD starts the server (and is killed after phase 2, so its memory is free for the validators); without it a server that is
// already running is used and stays up. No server: the books are built and validated as they are, and every flagged page is "left".
// ponytail: Accessible PDF only (EPUB books need the JVM EPUBCheck stage, the same shape); no resume of finished books.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, rmSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { runBatch, queueMd, type Model, type Phase, type Validation } from '../src/engine/batch/run.ts'
import { analyzeUa, buildUa, cloneFigs } from '../src/engine/pdfua/index.ts'
import { buildStructure, uaOptionsFrom, type UaRole } from '../src/engine/pdfua/structure.ts'
import { checkUa } from '../src/engine/pdfua/check.ts'
import { collectPdfGate } from '../src/engine/check/exportgate.ts'
import { uaPageFlags } from '../src/engine/pdf/flags.ts'
import { lineTexts, type EvidencePage } from '../src/engine/pdf/evidence.ts'
import { validate } from '../src/engine/pdf/validate.ts'
import { askPage, renderPage, type PageReply, type PageRequest } from '../src/engine/pdf/page-model.ts'
import { readChoice } from '../src/engine/pdf/bakeoff.ts'
import { PageCache, ReplayMiss, pageKey, type ModelId } from '../src/engine/pdf/page-cache.ts'
import { buildPrompt, promptVersion } from '../src/engine/pdf/prompt.ts'
import { runRounds, type Check } from '../src/engine/pdf/page-rounds.ts'
import { decisionsJsonl, reviewNotes, type DecisionNote } from '../src/engine/review/decisions.ts'
import type { PageDecision } from '../src/engine/pdf/decision.ts'
import type { VisionConfig } from '../src/engine/epub/alt-ai.ts'
import type { ReviewItem } from '../src/engine/epub/package.ts'
import { openSpec } from '../src/engine/spec/session.ts'
import { aiPageSet, compileInstruction, holdStrict, instructionLayer, instructionNotes, knobsOf, skipDecisions, type AppliedInstruction, type Compile } from '../src/engine/spec/instruction.ts'
import { fileCache, readInstruction } from '../src/engine/spec/instruction-fs.ts'
import { nodeRaster } from '../test/raster-node.ts'
import { read } from '../test/samples.ts'

const argv = process.argv.slice(2)
const opt = (n: string) => argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const replay = argv.includes('--replay')
// the model the bake-off chose (scripts/bakeoff.ts, T20); the environment overrides it
const chosen = () => readChoice(resolve('config/page-model.json'))
const cfg = (): VisionConfig => ({ apiKey: process.env.SNS_MODEL_KEY ?? '', baseUrl: (process.env.SNS_MODEL_BASE_URL ?? 'http://127.0.0.1:8000/v1').replace(/\/$/, ''), model: process.env.SNS_MODEL ?? chosen()?.model ?? '' })
// the schema is fixed by page-model.ts (bump with it); the prompt is generated per page (prompt.ts, T27) and its version goes in the key (OPUS_DESIGN2 b.6)
const modelId = (): ModelId => ({ modelId: cfg().model, weightsSha256: process.env.SNS_MODEL_SHA256 ?? chosen()?.weightsSha256, quant: chosen()?.quant, serverVersion: chosen()?.serverVersion, promptVersion: 'T14-1', schemaVersion: 'T14-1' })
const sha = (x: string | Uint8Array) => createHash('sha256').update(x).digest('hex')
const json = (file: string, v: unknown) => writeFileSync(file, JSON.stringify(v, null, 2))
const loadText = (file: string) => (existsSync(file) ? readFileSync(file, 'utf8') : undefined)
const loadJson = <T>(file: string): T | undefined => (existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : undefined)

// ---- the stages, in the child process (--stage=<phase> --book=<pdf> --work=<dir>) --------------------------------------------------------

/**
 * The book's typed instruction (T21): `instruction.txt` in the job folder, or `<book>.instruction.txt` beside the PDF. `live` asks the model
 * (only the page-reader stage has one); the other stages read the compile from the cache, so the same text is the same rules in every stage.
 * ponytail: unattended, so only confident items that touch no accessibility rule become rules; the rest are hints and are listed.
 */
async function instructionFor(pdf: string, work: string, pages: number, live: boolean): Promise<{ text?: string; result?: Compile; applied?: AppliedInstruction }> {
  const text = readInstruction(work, pdf)
  if (!text) return {}
  const result = await compileInstruction(text, cfg(), { pages, cache: fileCache(resolve('cache', 'instruction')), cacheOnly: !live })
  return { text, result, ...(result.ok ? { applied: { compiled: result.compiled, actor: 'batch', at: new Date().toISOString(), text, unattended: true } } : {}) }
}

/** analyse once; the options are the Accessible PDF settings (a client's layer is not known before the book is read), then the instruction's */
async function open(pdf: string, work: string, live = false) {
  const book = basename(pdf, '.pdf')
  const task = pdfjs.getDocument({ data: new Uint8Array(read(pdf)) })
  const pages = (await task.promise).numPages
  await task.destroy()
  const ins = await instructionFor(pdf, work, pages, live)
  const spec = await openSpec({ client: '', series: '', book, kind: 'accessible-pdf', ...(ins.applied ? { instruction: ins.applied } : {}) })
  const knobs = ins.applied && knobsOf(ins.applied.compiled)
  const options = { ...uaOptionsFrom(spec.resolved.settings), ...(knobs?.captionStyle ? { captionStyle: knobs.captionStyle } : {}) }
  const a = await analyzeUa(pdfjs, nodeRaster, { main: read(pdf), extras: [], options })
  return { a, options, spec, ins, knobs }
}
const make = async (a: Awaited<ReturnType<typeof open>>['a'], pdf: string, options: Awaited<ReturnType<typeof open>>['options'], decisions?: PageDecision[]) =>
  buildUa(a, { styles: a.styles, meta: { ...a.meta, isbn: '' }, alt: {}, cropToTrim: true, sourceName: basename(pdf), options: { ...options, ...(decisions ? { decisions } : {}) } })

const stages: Record<Phase, (pdf: string, work: string) => Promise<void>> = {
  async build(pdf, work) {
    const { a, options } = await open(pdf, work)
    const r = await make(a, pdf, options)
    writeFileSync(join(work, 'book.pdf'), r.pdf)
    json(join(work, 'review.json'), r.review)
  },

  async ai(pdf, work) {
    const model = cfg()
    const { a, options, spec, ins, knobs } = await open(pdf, work, true)
    const roles = new Map<string, UaRole>(a.styles.map((s) => [s.key, s.role]))
    const evidence = a.book.evidence
    if (!evidence) throw new Error('the book has no page evidence')
    const st = buildStructure(a.book, roles, cloneFigs(a.detected), options)
    const flagMap = new Map(uaPageFlags(evidence, st, roles).filter((p) => p.flags.length).map((p) => [p.evidence.page, p.flags]))
    // ai_pages (instruction): the flagged pages by default, every page, or the flagged pages and the named ones
    const asked = aiPageSet(knobs?.aiPages ?? 'flagged', [...flagMap.keys()], evidence.map((e) => e.page))
    const flagged = evidence.filter((e) => asked.includes(e.page)).map((e) => ({ evidence: e, flags: flagMap.get(e.page) ?? [] }))
    const unattended = ins.applied ? instructionLayer(spec.ctx.book, ins.applied.compiled, ins.applied) : undefined
    const doc = (a.book as unknown as { doc: { getPage(n: number): Promise<unknown> } }).doc
    const hashes = new Map<number, string>()
    const pages: PageRequest[] = []
    for (const { evidence: ev, flags } of flagged) {
      const page = await doc.getPage(ev.page)
      const images = [{ dpi: 150, png: await renderPage(nodeRaster, page, 150) }]
      if (flags.some((f) => f.flag === 'figure-pieces')) for (const b of ev.blocks.filter((x) => x.kind === 'figure')) images.push({ dpi: 300, png: await renderPage(nodeRaster, page, 300, { x0: b.bbox[0], y0: b.bbox[1], x1: b.bbox[2], y1: b.bbox[3] }) })
      pages.push({ ev, images, system: buildPrompt(flags.map((f) => f.flag)).system, hints: [...flags.map((f) => f.reason), ...(unattended?.asHints ?? []), ...(knobs?.hintsFor(ev.page) ?? [])] })
      hashes.set(ev.page, sha(JSON.stringify(a.book.pages[ev.page - 1]?.lines.map((l) => [l.text, l.x0, l.y, l.size, l.key]) ?? [])))
    }
    const repeats = new Map<string, number>()
    for (const p of a.book.pages) for (const t of new Set(p.lines.map((l) => l.text.trim()))) repeats.set(t, (repeats.get(t) ?? 0) + 1)
    const cache = new PageCache(resolve('cache'), sha(read(pdf)))
    const keys = new Map<number, string>()
    const ask = async (r: PageRequest): Promise<PageReply> => {
      const key = pageKey({ pdfPageHash: hashes.get(r.ev.page) ?? '', req: r, model: { ...modelId(), promptVersion: promptVersion(r.system ?? '') } })
      keys.set(r.ev.page, key)
      const e = cache.get(key)
      if (e?.override) return { status: 'ok', answer: { page: r.ev.page, ops: e.override.ops, confidence: 1, reasons: [] }, raw: '' }
      if (e?.answer) return { status: 'ok', answer: e.answer, raw: e.raw ?? '' }
      if (replay) throw new ReplayMiss(r.ev.page, key)
      const reply = await askPage(model, r)
      const now = new Date().toISOString()
      if (reply.status === 'ok') cache.put({ key, page: r.ev.page, raw: reply.raw, answer: reply.answer, created: now, updated: now })
      return reply
    }
    const rebuild = async (decisions: PageDecision[]): Promise<Check> => {
      const r = await make(a, pdf, options, decisions)
      const errors = new Map<number, string[]>()
      for (const x of r.review.filter((i) => i.level === 'error')) {
        const page = Number(/page (\d+)/i.exec(x.where ?? x.msg)?.[1] ?? 0)
        errors.set(page, [...(errors.get(page) ?? []), x.msg])
      }
      return { errors }
    }
    const res = await runRounds({
      pages, ask, rebuild, model: model.model, keyOf: (p) => keys.get(p),
      validate: (ev, ops) => validate(ev, ops, { lineText: lineTexts(a.book.pages[ev.page - 1] as unknown as EvidencePage, ev.page), repeats: (t) => repeats.get(t.trim()) ?? 0, runningHeads: options.runningHeads, captionIn: options.captionIn }),
    })
    // strict_review (instruction): the page reader's edits on those pages wait for a person; skip_pages as artifact is a person's decision
    const done = knobs ? holdStrict(res, knobs) : { ...res, held: [] as PageDecision[] }
    json(join(work, 'decisions.json'), [...(knobs ? skipDecisions(evidence, knobs) : []), ...done.decisions])
    json(join(work, 'pending.json'), done.held)
    const said = ins.result && !ins.result.ok ? { unreadable: { text: ins.text ?? '', why: ins.result.why } } : { compiled: ins.applied?.compiled, refused: ins.result?.ok ? ins.result.refused : [], resolved: spec.resolved, partly: unattended?.partly }
    json(join(work, 'notes.json'), [...(ins.text ? instructionNotes(said) : []), ...done.notes])
    writeFileSync(join(work, 'DECISIONS.jsonl'), decisionsJsonl(res.log))
  },

  /** the rebuild with the answers; book.pdf is replaced only when it is whole, so a failure here leaves the first build to be validated */
  async apply(pdf, work) {
    const decisions = loadJson<PageDecision[]>(join(work, 'decisions.json')) ?? []
    if (!decisions.length && !readInstruction(work, pdf)) return
    const { a, options } = await open(pdf, work)
    const r = await make(a, pdf, options, decisions)
    writeFileSync(join(work, 'book.next.pdf'), r.pdf)
    renameSync(join(work, 'book.next.pdf'), join(work, 'book.pdf'))
    json(join(work, 'review.json'), r.review)
  },

  async validate(pdf, work) {
    const review = loadJson<ReviewItem[]>(join(work, 'review.json')) ?? []
    const gate = collectPdfGate(await checkUa(new Uint8Array(readFileSync(join(work, 'book.pdf')))), review)
    const v: Validation = {
      pass: !gate.blocked,
      items: [
        ...gate.fixes.map((f) => ({ score: 0.2, msg: `${f.source}: ${f.msg}`, where: f.where })),
        ...gate.checks.map((f) => ({ score: 0.7, msg: `${f.source}: ${f.msg}`, where: f.where })),
      ],
    }
    json(join(work, 'validate.json'), v)
    const notes = loadJson<DecisionNote[]>(join(work, 'notes.json')) ?? []
    writeFileSync(join(work, `${basename(pdf, '.pdf')}_REVIEW_NOTES.txt`), reviewNotes({ file: basename(pdf), kind: 'Accessible PDF', notes, gate }))
  },
}

// ---- the parent: one child process per stage and book, the model server, QUEUE.md --------------------------------------------------------

function child(stage: Phase, pdf: string, work: string, signal: AbortSignal): Promise<void> {
  return new Promise((done, fail) => {
    rmSync(join(work, 'error.txt'), { force: true })
    const p = spawn(process.execPath, ['--import', pathToFileURL(resolve(import.meta.dirname, '../test/setup.ts')).href, import.meta.filename, `--stage=${stage}`, `--book=${pdf}`, `--work=${work}`, ...(replay ? ['--replay'] : [])], { stdio: ['ignore', 'inherit', 'inherit'], signal })
    p.on('error', (e) => fail(signal.aborted ? new Error('stopped at the timeout') : e))
    p.on('exit', (code) => (code === 0 ? done() : fail(new Error(signal.aborted ? 'stopped at the timeout' : (loadText(join(work, 'error.txt')) ?? `the ${stage} stage exited with code ${code}`)))))
  })
}

/** A server the batch started (SNS_MODEL_CMD) is stopped after phase 2; one that was already running is left alone. */
function modelServer(): Model {
  let proc: ChildProcess | undefined
  const up = async () => {
    try {
      return (await fetch(`${cfg().baseUrl}/models`, { signal: AbortSignal.timeout(3000) })).ok
    } catch {
      return false
    }
  }
  return {
    async load() {
      if (process.env.SNS_MODEL_CMD && !(await up())) proc = spawn(process.env.SNS_MODEL_CMD, { shell: true, stdio: 'ignore' })
      const end = Date.now() + Number(process.env.SNS_MODEL_WAIT_S ?? 300) * 1000
      while (!(await up())) {
        if (Date.now() > end) throw new Error(`no model server at ${cfg().baseUrl}`)
        await new Promise((r) => setTimeout(r, 2000))
      }
    },
    async unload() {
      if (!proc?.pid) return
      if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'])
      else proc.kill('SIGTERM')
      proc = undefined
    },
  }
}

if (opt('stage')) {
  // the reason goes to a file the parent reads, so QUEUE.md says what was wrong with the book
  await stages[opt('stage') as Phase](opt('book')!, opt('work')!).catch((e) => {
    writeFileSync(join(opt('work')!, 'error.txt'), e instanceof Error ? e.message : String(e))
    process.exit(1)
  })
} else {
  const [inDir, outDir] = argv.filter((a) => !a.startsWith('--'))
  if (!inDir || !outDir) throw new Error('usage: scripts/batch.ts <inputDir> <outDir> [--replay] [--timeout-min=8] [--ai-timeout-min=60]')
  const books = readdirSync(resolve(inDir)).filter((f) => /\.pdf$/i.test(f)).sort()
  const work = (b: string) => join(resolve(outDir), basename(b, '.pdf'))
  for (const b of books) mkdirSync(work(b), { recursive: true })
  const run = (phase: Phase) => (b: string, signal: AbortSignal) => child(phase, join(resolve(inDir), b), work(b), signal)
  const min = (v: string | undefined, d: number) => Number(v ?? d) * 60_000
  const results = await runBatch({
    books,
    model: modelServer(),
    timeoutMs: { build: min(opt('timeout-min'), 8), apply: min(opt('timeout-min'), 8), validate: min(opt('timeout-min'), 8), ai: min(opt('ai-timeout-min'), 60) },
    stages: {
      build: run('build'),
      ai: run('ai'),
      apply: run('apply'),
      validate: async (b, signal) => (await run('validate')(b, signal), loadJson<Validation>(join(work(b), 'validate.json'))!),
    },
    log: (m) => console.log(m),
  })
  writeFileSync(join(resolve(outDir), 'QUEUE.md'), queueMd(results))
  console.log(`→ ${join(resolve(outDir), 'QUEUE.md')}`)
}
