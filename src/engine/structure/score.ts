// Evidence for what a style means. Each signal votes for a role with a weight (design §3.2);
// the decision keeps its evidence and a confidence, so the review screen can show why and how sure.
//   ≥ 0.85  applied silently      0.6–0.85  applied, listed under "check these first"      < 0.6  needs a person
import type { Role } from '../indesign/read.ts'
import type { BlockFeatures, StyleStats } from './features.ts'
import { nameVote } from './dict.ts'

/** The roles the scorer knows: the InDesign roles plus the two only a PDF has. */
export type Canon = Role | 'caption' | 'dropcap'
export type Signal = 'saved' | 'nav' | 'contents' | 'tag' | 'name' | 'pattern' | 'typography' | 'position' | 'rare' | 'fallback'
export interface Evidence<R extends string = Role> { signal: Signal; role: R; weight: number; note: string }
// ponytail: hand-set weights, no learning; tune against test/corpus.ts if they misfire
// 'fallback' is the old first-match answer, kept as one weak vote so a style no signal explains still gets a proposal
export const WEIGHTS: Record<Signal, number> = { saved: 1, nav: 0.9, contents: 0.8, tag: 0.7, name: 0.6, pattern: 0.5, typography: 0.4, position: 0.3, rare: 0.2, fallback: 0.25 }

export const evidence = <R extends string = Role>(signal: Signal, role: R, note: string, weight = WEIGHTS[signal]): Evidence<R> => ({ signal, role, weight, note })

export interface Decision<R extends string = Role> { role: R; confidence: number; evidence: Evidence<R>[]; action: 'silent' | 'listed' | 'blocked' }
export const actionOf = (c: number): Decision['action'] => (c >= 0.85 ? 'silent' : c >= 0.6 ? 'listed' : 'blocked')

/** Votes combine as 1 - Π(1 - w) per role; the confidence is the chosen role's score, reduced by how strong the best rival is. */
export function decide<R extends string = Role>(ev: Evidence<R>[], pick?: R): Decision<R> {
  const score = new Map<R, number>()
  for (const e of ev) score.set(e.role, 1 - (1 - (score.get(e.role) ?? 0)) * (1 - e.weight))
  const ranked = [...score].sort((a, b) => b[1] - a[1])
  const [role, top] = pick && score.has(pick) ? [pick, score.get(pick)!] : (ranked[0] ?? ['p' as R, 0])
  const rival = ranked.find(([r]) => r !== role)?.[1] ?? 0
  const confidence = Math.round(top * (1 - rival * 0.5) * 100) / 100
  return { role, confidence, evidence: ev, action: actionOf(confidence) }
}

const HEADING_OF_TAG: Record<string, Canon> = { h1: 'chapter-title', h2: 'h2', h3: 'h3', h4: 'h4', h5: 'h5', h6: 'h5' }
const HEADING_OF_LEVEL: Canon[] = ['chapter-title', 'h2', 'h3', 'h4', 'h5']
const LABEL = /^(chapter|part)-label$/

export interface ScoreCtx {
  bodyKey: string
  /** about how many chapters the book has: a style used at most twice that often is rare */
  chapters: number
  /** label/title pairs (findPairs) */
  pairs: Map<string, Canon>
  /** the first-match answer per style, kept as one weak vote */
  fallback?: Map<string, { role: Canon; reason: string }>
}

const displayLook = (s: StyleStats) => s.mostly((b) => b.align) === 'center' && s.sizeRatio >= 1.15 && s.avgLen < 120
const isPart = (s: StyleStats) => s.share((b) => b.pattern === 'partWord') >= 0.6

/** Label/title pairs: a short centred style always followed by a large title style (design §3.2, "Position"). */
export function findPairs(styles: Map<string, StyleStats>): Map<string, Canon> {
  const out = new Map<string, Canon>()
  for (const s of styles.values()) {
    const f = s.follower ? styles.get(s.follower) : undefined
    if (!f || s.n < 2 || f.key === s.key || out.has(s.key) || out.has(f.key) || s.mostly((b) => b.align) !== 'center' || s.avgLen >= 40 || !displayLook(f)) continue
    out.set(s.key, isPart(s) ? 'part-label' : 'chapter-label')
    out.set(f.key, isPart(s) ? 'part-title' : 'chapter-title')
  }
  return out
}

/** The heading role the strongest non-fallback signal so far points to. */
const best = (ev: Evidence<Canon>[]): Canon | undefined =>
  ev.filter((e) => e.signal !== 'fallback' && /^(chapter-title|h[2-5]|section-title|part-title)$/.test(e.role)).sort((a, b) => b.weight - a.weight)[0]?.role

/** Every signal that speaks for a role of this style, whether or not it wins. */
export function scoreStyle(s: StyleStats, c: ScoreCtx): Evidence<Canon>[] {
  const ev: Evidence<Canon>[] = []
  const add = (signal: Signal, role: Canon, note: string, w?: number) => ev.push(evidence<Canon>(signal, role, note, w))
  const fb = c.fallback?.get(s.key)
  if (fb) add('fallback', fb.role, `first match: ${fb.reason}`)
  if (!s.n) {
    add('rare', 'drop', 'only ever empty', 0.9)
    return ev
  }
  const body = s.key === c.bodyKey
  const pair = c.pairs.get(s.key)
  const part = isPart(s)
  const centred = s.mostly((b) => b.align) === 'center'
  const pat = (p: BlockFeatures['pattern']) => s.share((b) => b.pattern === p)

  // 1. what the source itself says: its own nav, or the printed contents (one list shown in two places: the better one counts)
  if (!body && s.contents) {
    const lv = s.contents.level
    // a second level-1 style next to an already paired chapter-title style is a front/back section (Introduction, Bibliography…)
    const otherChapter = [...c.pairs].some(([k, r]) => r === 'chapter-title' && k !== s.key)
    const role: Canon = s.contents.part === 'label' ? 'chapter-label' : lv === 1 && (part || pair === 'part-title') ? 'part-title' : lv === 1 && otherChapter && !pair ? 'section-title' : (HEADING_OF_LEVEL[Math.min(lv, 5) - 1] ?? 'h5')
    add(s.contents.source, role, `${s.contents.source === 'nav' ? 'listed in the book’s navigation' : 'listed in the printed contents'}, level ${lv} (${Math.round(s.contents.share * 100)}% of its lines)`)
  }
  // 2. the element
  const tg = s.mostly((b) => b.tag)
  if (!body && tg && HEADING_OF_TAG[tg] && s.avgLen < 180) add('tag', HEADING_OF_TAG[tg], `paragraphs are <${tg}> elements`)
  // 3. the style's name
  const nv = body ? undefined : nameVote(s.key, s.avgLen)
  if (nv) add('name', nv[0], nv[1])
  // 4. what the lines say
  if (pat('tocLine') >= 0.6) add('pattern', 'toc', 'lines end with a page number')
  if (pat('bullet') >= 0.6) add('pattern', 'bullet', 'lines start with a bullet character')
  if (!body && pat('imprint') >= 0.5) add('pattern', 'imprint', 'ISBN / © / legal lines')
  if (!body && s.n < 3 && pat('chapterWord') >= 0.6 && centred) add('pattern', 'chapter-label', 'short centred “Chapter n” line')
  if (pair) {
    add('pattern', pair, LABEL.test(pair) ? 'short centred line always followed by a large title style' : 'large title style that always follows a label style')
  }
  // 5. typography
  // (a PDF is measured, not styled: its large short lines are voted for as titles in 5b)
  if (!body && displayLook(s) && s.first.nearImage === undefined) {
    add('typography', pair ?? 'section-title', `large (${s.sizeRatio.toFixed(2)}×) and centred`)
  }
  if (!body && s.sizeRatio <= 0.9 && ev.some((e) => e.role === 'imprint' && e.signal !== 'fallback')) add('typography', 'imprint', `small print (${s.sizeRatio.toFixed(2)}×)`)
  // 5b. layout metrics only a PDF has: its sizes and places are measured, not styled
  if (!body && s.first.nearImage !== undefined) {
    const big = pat('numberOnly') >= 0.8 && s.sizeRatio >= 3
    if (big) {
      add('pattern', 'chapter-label', 'a lone number set very large')
      add('typography', 'chapter-label', `${s.sizeRatio.toFixed(1)}× body size`)
    } else if (s.sizeRatio >= 2.5 && s.avgLen <= 2) {
      add('pattern', 'dropcap', 'a single letter')
      add('typography', 'dropcap', `${s.sizeRatio.toFixed(1)}× body size`)
    } else if (s.sizeRatio >= 1.6 && s.avgLen < 70) {
      add('typography', 'chapter-title', `short lines at ${s.sizeRatio.toFixed(1)}× body size`, 0.55)
    } else if (s.share((b) => !!b.bold) >= 0.8 && s.sizeRatio >= 1.05 && s.avgLen < 80) {
      add('typography', 'h2', 'bold and larger than body text', 0.55)
    }
    if (s.sizeRatio <= 0.88 && (s.share((b) => !!b.marker) >= 0.15 || s.share((b) => !!b.nearImage) >= 0.3)) {
      add('pattern', 'caption', 'small text beside pictures')
      add('typography', 'caption', `small (${s.sizeRatio.toFixed(2)}×)`)
    }
  }
  const sized = ev.some((e) => e.signal === 'typography' && /^(h2|chapter-title|chapter-label|dropcap)$/.test(e.role) && e.weight >= 0.4 && e.note.includes('body size') || e.note.startsWith('bold and larger'))
  if (!body && s.first.headingLook && !sized) add('typography', 'h3', 'short, bold/small-caps/sans line with space around it')
  // 6. position
  const opens = pair ?? best(ev) ?? (displayLook(s) ? 'section-title' : undefined)
  if (!body && opens && s.n >= 2 && s.avgLen < 80 && s.share((b) => !!b.firstOnPage) >= 0.6) add('position', opens, 'usually the first line on its page')
  // a heading is followed by running text
  if (!body && s.follower === c.bodyKey && s.n >= 2) {
    const h = ev.find((e) => e.signal === 'typography' && /^(h2|h3)$/.test(e.role))
    if (h) add('position', h.role, 'always followed by body text')
  }
  // 7. rare and short
  if (!body && s.first.headingLook && s.n <= c.chapters * 2) add('rare', 'h3', `used only ${s.n}×`)
  // body text: the absence of structure is itself evidence, weighed by how much like running text the style is.
  // A style that some structural signal already explains (contents lines, an imprint…) does not also count as body text.
  const plain = s.share((b) => !b.bold && !b.caps) >= 0.8 && s.sizeRatio <= 1.1
  const structural = ev.some((e) => e.signal !== 'fallback')
  if (body) add('typography', 'p', 'main body text style', 0.9)
  else if (!structural) {
    if (plain && !s.first.headingLook) add('typography', 'p', `set like body text (${s.sizeRatio.toFixed(2)}×)`, 0.75)
    else if (!s.first.headingLook) add('typography', 'p', 'nothing marks it as a heading, list, contents or imprint', 0.5)
    if (s.avgLen > 60 || s.share((b) => b.endsWithPunct) >= 0.6) add('pattern', 'p', 'reads as running text')
    if (s.share((b) => !!b.firstOnPage) < 0.3) add('position', 'p', 'does not open pages')
  }
  return ev
}

export interface SecStat { type: string; nav: string; words: number }
/** What the printed contents says about the chapters: how many it lists and the page it prints for each. */
export type ContentsChapters = { title: string; printed?: string; first?: string }[]
/** Book-level sanity checks (design §3.2): each message names a likely misdetection. */
export function crossChecks(secs: SecStat[], contents?: ContentsChapters): string[] {
  const out: string[] = []
  const total = secs.reduce((n, s) => n + s.words, 0) || 1
  for (const s of secs) {
    if (s.type === 'chapter' && s.words < 150) out.push(`Chapter "${s.nav}" has only ${s.words} words: probably a heading that does not open a chapter.`)
    if (s.words / total > 0.4 && secs.length > 3) out.push(`"${s.nav}" is ${Math.round((s.words / total) * 100)}% of the book: chapters may have been missed.`)
    if (s.type === 'copyright' && s.words > 400) out.push(`The copyright page "${s.nav}" has ${s.words} words: text after the imprint may have been taken for it.`)
  }
  if (contents) {
    const found = secs.filter((s) => s.type === 'chapter').length
    if (contents.length !== found) out.push(`The contents lists ${contents.length} chapter${contents.length === 1 ? '' : 's'}, but ${found} ${found === 1 ? 'was' : 'were'} found.`)
    // the chapters must start on the pages the contents prints, and those pages must rise
    for (const c of contents) {
      const a = Number(c.printed)
      const b = Number(c.first)
      if (Number.isFinite(a) && Number.isFinite(b) && c.printed && c.first && Math.abs(a - b) > 1) out.push(`The contents puts "${c.title}" on page ${a}, but it starts on page ${b}.`)
    }
    const starts = contents.map((c) => Number(c.first)).filter((n) => Number.isFinite(n))
    if (starts.some((n, i) => i > 0 && n < starts[i - 1])) out.push('The chapters do not start on rising page numbers: two of them may be in the wrong order.')
  }
  return out
}
