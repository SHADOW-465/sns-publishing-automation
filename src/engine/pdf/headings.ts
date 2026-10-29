// Book-level reconciliation of headings (OPUS_DESIGN2 §b.5.4, T17). Page answers only propose a role per block; once every page has run,
// this one deterministic pass groups the heading proposals by look (font, size, weight, case, alignment, space above) and gives each
// look one level across the book (PHD-008). The majority of the page proposals wins (the engine's own heading on a page the reader did
// not touch votes as it reads); the instruction's heading_map beats the majority; a look that splits about 50/50 goes to one text-only
// call (P5), and if that gives no answer the look goes to a person and the engine keeps its reading of it. Levels are then pulled up
// wherever one would skip (H1 → H3, or a first heading that is not H1). Only role ops are written: no word is touched.
import type { DecisionNote } from '../review/decisions.ts'
import type { VisionConfig } from '../epub/alt-ai.ts'
import { pageOrder, type EvidenceBlock, type PageEvidence } from './evidence.ts'
import type { Op, PageDecision } from './decision.ts'
import { PAGE_MODEL_TIMEOUT_MS } from './page-model.ts'

const STEP = 'Headings'
const HEAD = /^H([1-6])$/
const levelOf = (r?: string) => Number(r?.match(HEAD)?.[1] ?? 0)
/** a look splits "about 50/50" when its second level holds at least this share of the two biggest */
const TIE = 0.4

/** instruction `heading_map`: "the 'Conclusiones' heads are H3" */
export interface HeadingMapEntry {
  sample: string
  level: 'H1' | 'H2' | 'H3' | 'H4' | 'H5' | 'H6' | 'P'
}

export interface TieCluster {
  key: string
  /** the look in plain words */
  look: string
  /** proposals per level */
  votes: Record<number, number>
  samples: string[]
  pages: number[]
}
export interface TieQuery {
  clusters: TieCluster[]
}
/** The P5 call: a level per cluster key. A missing, unknown or untied answer leaves the look to a person. */
export type TieBreak = (q: TieQuery) => Promise<Record<string, number> | undefined>

export interface Reconciled {
  decisions: PageDecision[]
  /** looks left to a person */
  person: TieCluster[]
  notes: DecisionNote[]
}

// ---- the look -------------------------------------------------------------------------------------------------------------------------

const normal = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').replace(/[\s.:;,]+$/, '').trim()
const caseOf = (t: string) => {
  const words = t.split(/\s+/).filter((w) => /\p{L}/u.test(w))
  const letters = t.replace(/[^\p{L}]/gu, '')
  if (letters.length > 1 && letters === letters.toUpperCase()) return 'upper case'
  return words.every((w) => w.length <= 3 || /^\p{Lu}/u.test(w)) ? 'title case' : 'sentence case'
}
const alignOf = (ev: PageEvidence, b: EvidenceBlock) => {
  const em = b.size ?? 10
  const left = Math.min(...ev.columns.map((c) => c[0]), b.bbox[0])
  const right = Math.max(...ev.columns.map((c) => c[1]), b.bbox[2])
  if (Math.abs((b.bbox[0] + b.bbox[2]) / 2 - (left + right) / 2) < ev.w * 0.03 && b.bbox[0] - left > em) return 'centred'
  return b.bbox[2] > right - em && b.bbox[0] - left > (right - left) / 3 ? 'right' : 'left'
}
/** the gap above, in ems of the heading: the first block of a page counts as a big one */
const spaceOf = (ev: PageEvidence, b: EvidenceBlock) => {
  const above = ev.blocks.filter((o) => o !== b && o.bbox[3] <= b.bbox[1] + 1 && o.bbox[0] < b.bbox[2] && o.bbox[2] > b.bbox[0])
  const gap = above.length ? (b.bbox[1] - Math.max(...above.map((o) => o.bbox[3]))) / (b.size ?? 10) : Infinity
  return gap < 1 ? 'tight' : gap < 3 ? 'small' : 'large'
}
const fontOf = (style = '') => style.replace(/\s+[\d.]+$/, '')
function lookOf(ev: PageEvidence, b: EvidenceBlock): { key: string; words: string } {
  const parts = [fontOf(b.style), `${Math.round((b.size ?? 0) * 2) / 2} pt`, b.bold ? 'bold' : 'regular', caseOf(b.text ?? ''), alignOf(ev, b), `${spaceOf(ev, b)} space above`]
  return { key: parts.join('|'), words: parts.join(', ') }
}

// ---- the pass -------------------------------------------------------------------------------------------------------------------------

interface Member {
  page: number
  block: EvidenceBlock
  /** the level it carries now: the page reader's proposal, or the engine's heading */
  level: number
  /** the page reader's op for it, if any */
  op?: Extract<Op, { op: 'role' | 'split' }>
}
interface Group {
  key: string
  words: string
  members: Member[]
  /** 0 = not a heading; undefined = left alone */
  level?: number
  wanted?: number
  how?: 'guess' | 'ai'
  mapped?: boolean
}

export async function reconcileHeadings(decisions: PageDecision[], evidence: PageEvidence[], o: { headingMap?: HeadingMapEntry[]; tieBreak?: TieBreak } = {}): Promise<Reconciled> {
  const out: PageDecision[] = structuredClone(decisions)
  const original = new Map(out.map((d) => [d, d.ops.length]))
  const personPages = new Set(out.filter((d) => d.by === 'person').map((d) => d.page))
  const aiOf = new Map<number, PageDecision>()
  for (const d of out) if (d.by !== 'person' && !personPages.has(d.page) && !aiOf.has(d.page)) aiOf.set(d.page, d)
  const personOps = out.filter((d) => d.by === 'person').flatMap((d) => d.ops.map((op) => [d.page, op] as const))

  // every heading, in reading order: a group member, or fixed (a person's page, or a look nobody reconciles)
  const groups = new Map<string, Group>()
  const seq: { group?: Group; member?: Member; fixed: number }[] = []
  for (const ev of [...evidence].sort((a, b) => a.page - b.page)) {
    const order = new Map((ev.engineOrder ?? pageOrder(ev)).map((id, i) => [id, i]))
    const blocks = ev.blocks.filter((b) => b.kind === 'text').sort((a, b) => (order.get(a.id) ?? 1e6) - (order.get(b.id) ?? 1e6) || a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0])
    for (const b of blocks) {
      if (personPages.has(ev.page)) {
        const p = personOps.find(([n, op]) => n === ev.page && (op.op === 'role' || op.op === 'split') && op.id === b.id)?.[1]
        const level = p ? (p.op === 'role' ? levelOf(p.role) : p.op === 'split' ? levelOf(p.roles[0]) || levelOf(p.roles[1]) : 0) : levelOf(b.role)
        if (level) seq.push({ fixed: level })
        continue
      }
      const op = aiOf.get(ev.page)?.ops.find((x): x is Extract<Op, { op: 'role' | 'split' }> => (x.op === 'role' || x.op === 'split') && x.id === b.id)
      const level = op ? (op.op === 'role' ? levelOf(op.role) : levelOf(op.roles[0]) || levelOf(op.roles[1])) : levelOf(b.role)
      if (!level) continue
      const look = lookOf(ev, b)
      const g = groups.get(look.key) ?? { key: look.key, words: look.words, members: [] }
      groups.set(look.key, g)
      const member: Member = { page: ev.page, block: b, level, op }
      g.members.push(member)
      seq.push({ group: g, member, fixed: level })
    }
  }

  const votesOf = (g: Group) => {
    const v = new Map<number, number>()
    for (const m of g.members) v.set(m.level, (v.get(m.level) ?? 0) + 1)
    return [...v].sort((a, b) => b[1] - a[1] || a[0] - b[0])
  }
  const index = new Map([...groups.values()].map((g, i) => [g, i + 1]))
  const clusterOf = (g: Group): TieCluster => ({
    key: `g${index.get(g)}`,
    look: g.words,
    votes: Object.fromEntries(votesOf(g)),
    samples: [...new Set(g.members.map((m) => (m.block.text ?? '').trim()))].slice(0, 6),
    pages: [...new Set(g.members.map((m) => m.page))],
  })

  // 1. the instruction, then the majority; a split look waits for the tie-break
  const tied: Group[] = []
  for (const g of groups.values()) {
    const named = (sample: string, text = '') => !!normal(sample) && (normal(text) === normal(sample) || normal(text).startsWith(normal(sample) + ' '))
    const mapped = o.headingMap?.find((h) => g.members.some((m) => named(h.sample, m.block.text)))
    if (mapped) {
      g.level = g.wanted = levelOf(mapped.level)
      g.mapped = true
      g.how = 'guess'
    } else if (g.members.some((m) => m.op)) {
      const v = votesOf(g)
      if (v.length > 1 && v[1][1] / (v[0][1] + v[1][1]) >= TIE) tied.push(g)
      else g.level = g.wanted = v[0][0]
    }
  }
  // 2. one text-only call for all the split looks (P5); a look it does not answer for goes to a person
  const person: TieCluster[] = []
  if (tied.length) {
    const q: TieQuery = { clusters: tied.map(clusterOf) }
    let answer: Record<string, number> | undefined
    try {
      answer = await o.tieBreak?.(q)
    } catch {
      answer = undefined
    }
    tied.forEach((g, i) => {
      const c = q.clusters[i]
      const a = answer?.[c.key]
      if (typeof a === 'number' && c.votes[a] !== undefined) (g.level = g.wanted = a), (g.how = 'ai')
      else person.push(c)
    })
  }
  const unresolved = new Set(tied.filter((g) => g.level === undefined))

  // 3. no skipped levels, in reading order, and the first heading is H1: a look that would skip is pulled up to the level after the one before it
  const lvl = (s: (typeof seq)[number]) => (s.group && unresolved.has(s.group) ? levelOf(s.member!.block.role) : s.group && s.group.level !== undefined ? s.group.level : s.fixed)
  for (let again = true; again; ) {
    again = false
    let prev = 0
    for (const s of seq) {
      const l = lvl(s)
      if (!l) continue
      if (l > prev + 1 && s.group && s.group.level !== undefined && !unresolved.has(s.group)) {
        s.group.level = prev + 1
        again = true
        break
      }
      prev = l
    }
  }

  // 4. lay the levels on the proposals; an engine heading of the look that differs gets a role op of its own
  const notes: DecisionNote[] = []
  const add = (page: number, op: Op) => {
    let d = aiOf.get(page)
    if (!d) out.push((d = { page, ops: [], by: 'ai' })), aiOf.set(page, d)
    d.ops.push(op)
  }
  for (const g of groups.values()) {
    const sample = (g.members[0].block.text ?? '').trim().slice(0, 40)
    const pages = [...new Set(g.members.map((m) => m.page))]
    const where = `page${pages.length === 1 ? '' : 's'} ${pages.join(', ')}`
    const item = `Headings that look like “${sample}” (${g.members.length} on ${where})`
    if (unresolved.has(g)) {
      // the engine keeps its reading of this look: the page reader's role ops for it come out
      for (const m of g.members) if (m.op?.op === 'role') aiOf.get(m.page)!.ops.splice(aiOf.get(m.page)!.ops.indexOf(m.op), 1)
      notes.push({ step: STEP, item, chosen: `Left as the engine read them: the page reader’s proposals split between ${Object.keys(clusterOf(g).votes).map((l) => `H${l}`).join(' and ')}, so a person should choose one level for this look.`, how: 'left', where })
      continue
    }
    if (g.level === undefined) continue
    const to = g.level ? `H${g.level}` : 'P'
    let changed = 0
    for (const m of g.members) {
      if (m.op?.op === 'role') {
        if (m.op.role !== to) (m.op.role = to as 'P'), changed++
      } else if (m.op?.op === 'split') {
        const at = levelOf(m.op.roles[0]) ? 0 : 1
        if (m.op.roles[at] !== to) (m.op.roles[at] = to as 'P'), changed++
      } else if (m.level !== g.level) (add(m.page, { op: 'role', id: m.block.id, role: to as 'P' }), changed++)
    }
    const lifted = g.wanted && g.level && g.level < g.wanted ? `; H${g.wanted} would have skipped a level` : ''
    if (!changed && !lifted && g.how !== 'ai') continue
    const why = g.mapped ? 'the instruction names it' : g.how === 'ai' ? 'the proposals split, and one question settled it' : 'most of the proposals say so'
    notes.push({ step: STEP, item, chosen: `${to} everywhere (${why}${lifted}).`, how: g.how === 'ai' ? 'ai' : 'guess', where })
  }
  return { decisions: out.filter((d) => d.ops.length || !original.get(d)), person, notes }
}

// ---- the P5 call -----------------------------------------------------------------------------------------------------------------------

const TIE_SYSTEM = [
  'You settle heading levels for a whole book. Each cluster is one typographic look; its page proposals split between levels.',
  'Choose, for each cluster, the one level it should have everywhere, among the levels it has votes for.',
  'Reply with one JSON object that follows the schema, and nothing else. You never write or change text.',
].join('\n')

const tieSchema = () => ({
  type: 'object',
  additionalProperties: false,
  properties: { levels: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { key: { type: 'string' }, level: { type: 'integer' } }, required: ['key', 'level'] } } },
  required: ['levels'],
})

/** The P5 tie-break: one text-only request to the same OpenAI-compatible server as the page reader. Never throws; no usable answer is undefined. */
export async function askHeadingTie(cfg: VisionConfig, q: TieQuery, o: { timeoutMs?: number; fetch?: typeof fetch } = {}): Promise<Record<string, number> | undefined> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), o.timeoutMs ?? PAGE_MODEL_TIMEOUT_MS)
  try {
    const res = await (o.fetch ?? fetch)(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cfg.apiKey.trim() ? { Authorization: `Bearer ${cfg.apiKey.trim()}` } : {}) },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0,
        seed: 7,
        top_k: 1,
        max_tokens: 1024,
        response_format: { type: 'json_schema', json_schema: { name: 'heading_levels', strict: true, schema: tieSchema() } },
        messages: [
          { role: 'system', content: TIE_SYSTEM },
          { role: 'user', content: `Clusters (JSON):\n${JSON.stringify(q.clusters)}\nAnswer with a level for each cluster key.` },
        ],
      }),
      signal: ctl.signal,
    })
    if (!res.ok) return undefined
    const reply = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    const raw = reply.choices?.[0]?.message?.content ?? ''
    const v = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) as { levels?: { key?: string; level?: number }[] }
    const got: Record<string, number> = {}
    for (const a of v.levels ?? []) {
      const c = q.clusters.find((c) => c.key === a.key)
      if (c && typeof a.level === 'number' && c.votes[a.level] !== undefined) got[c.key] = a.level
    }
    return Object.keys(got).length ? got : undefined
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}
