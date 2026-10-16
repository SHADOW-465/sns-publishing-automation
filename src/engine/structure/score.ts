// Evidence for what a style means. Each signal votes for a role with a weight (design §3.2);
// the decision keeps its evidence and a confidence, so the review screen can show why and how sure.
//   ≥ 0.85  applied silently      0.6–0.85  applied, listed under "check these first"      < 0.6  needs a person
import type { Role } from '../indesign/read.ts'

export type Signal = 'saved' | 'nav' | 'contents' | 'tag' | 'name' | 'pattern' | 'typography' | 'position' | 'rare'
export interface Evidence { signal: Signal; role: Role; weight: number; note: string }
// ponytail: hand-set weights, no learning; tune against test/corpus.ts if they misfire
export const WEIGHTS: Record<Signal, number> = { saved: 1, nav: 0.9, contents: 0.8, tag: 0.7, name: 0.6, pattern: 0.5, typography: 0.4, position: 0.3, rare: 0.2 }

export const evidence = (signal: Signal, role: Role, note: string, weight = WEIGHTS[signal]): Evidence => ({ signal, role, weight, note })

export interface Decision { role: Role; confidence: number; evidence: Evidence[]; action: 'silent' | 'listed' | 'blocked' }

/** Votes combine as 1 - Π(1 - w) per role; the confidence is the chosen role's score, reduced by how strong the best rival is. */
export function decide(ev: Evidence[], pick?: Role): Decision {
  const score = new Map<Role, number>()
  for (const e of ev) score.set(e.role, 1 - (1 - (score.get(e.role) ?? 0)) * (1 - e.weight))
  const ranked = [...score].sort((a, b) => b[1] - a[1])
  const [role, top] = pick && score.has(pick) ? [pick, score.get(pick)!] : (ranked[0] ?? ['p' as Role, 0])
  const rival = ranked.find(([r]) => r !== role)?.[1] ?? 0
  const confidence = Math.round(top * (1 - rival * 0.5) * 100) / 100
  return { role, confidence, evidence: ev, action: confidence >= 0.85 ? 'silent' : confidence >= 0.6 ? 'listed' : 'blocked' }
}

export interface SecStat { type: string; nav: string; words: number }
/** Book-level sanity checks (design §3.2): each message names a likely misdetection. */
export function crossChecks(secs: SecStat[]): string[] {
  const out: string[] = []
  const total = secs.reduce((n, s) => n + s.words, 0) || 1
  for (const s of secs) {
    if (s.type === 'chapter' && s.words < 150) out.push(`Chapter "${s.nav}" has only ${s.words} words: probably a heading that does not open a chapter.`)
    if (s.words / total > 0.4 && secs.length > 3) out.push(`"${s.nav}" is ${Math.round((s.words / total) * 100)}% of the book: chapters may have been missed.`)
    if (s.type === 'copyright' && s.words > 400) out.push(`The copyright page "${s.nav}" has ${s.words} words: text after the imprint may have been taken for it.`)
  }
  return out
}
