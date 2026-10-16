// Where a picture belongs, and which signal says so (design §3.5). Signals in order of trust:
//   anchor        the picture sits inside the text flow where the author anchored it
//   layout-page   the page marker of the layout div that holds the frame (InDesign often dumps frames far from their page)
//   caption-pdf   the caption text is found on exactly one printed page of the print PDF
//   pdf-position  the picture box in the print PDF, matched by image hash. Not built: needs the PDF's pictures decoded in the build.
import { actionOf } from '../structure/score.ts'
import type { PrintPage } from '../pdf/pages.ts'

export type PlaceSignal = 'anchor' | 'layout-page' | 'caption-pdf' | 'pdf-position'
// ponytail: hand-set like the style weights; a caption found on one printed page is the strongest evidence a page can give
export const PLACE_WEIGHTS: Record<PlaceSignal, number> = { anchor: 0.9, 'layout-page': 0.6, 'caption-pdf': 0.85, 'pdf-position': 0.6 }

export interface PlaceEvidence { signal: PlaceSignal; page?: string; weight: number; note: string }

export interface PicturePlacement {
  src: string
  name: string
  /** the signal that placed the picture: the strongest one that holds, or 'none' */
  signal: PlaceSignal | 'none'
  confidence: number
  action: 'silent' | 'listed' | 'blocked'
  page?: string
  evidence: PlaceEvidence[]
  /** for a picture nothing places: the printed pages whose text is closest to its caption */
  candidates: string[]
  /** why it ended up where it did, in plain words */
  note: string
}

export const placeEvidence = (signal: PlaceSignal, note: string, page?: string): PlaceEvidence => ({ signal, page, weight: PLACE_WEIGHTS[signal], note })

/** Votes for the same page add up like style votes; a signal that points to another page is a rival, not a vote. */
export function decidePlacement(src: string, name: string, ev: PlaceEvidence[], moved: boolean, candidates: string[], note = ''): PicturePlacement {
  // the caption outranks the layout page when they disagree (that is why the picture moved); only agreeing signals add up
  const lead = [...ev].sort((a, b) => b.weight - a.weight)[0]
  if (!lead) return { src, name, signal: 'none', confidence: 0, action: 'blocked', evidence: ev, candidates, note: note || 'no signal places this picture' }
  const agree = ev.filter((e) => e.page === lead.page || e.page === undefined)
  const conf = 1 - agree.reduce((p, e) => p * (1 - e.weight), 1)
  const confidence = Math.round(conf * 100) / 100
  return { src, name, signal: lead.signal, confidence, action: actionOf(confidence), page: lead.page, evidence: ev, candidates: confidence < 0.6 ? candidates : [], note: note || (moved ? `moved to printed page ${lead.page}: ${lead.note}` : lead.note) }
}

const words = (s: string) => new Set(s.toLocaleLowerCase().normalize('NFD').replace(/\p{M}/gu, '').split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3))

/** The printed pages whose text shares the most words with the picture's caption and the text beside it. */
export function candidatePages(text: string, pages: PrintPage[], n = 3): string[] {
  const mine = words(text)
  if (mine.size < 3) return []
  return pages
    .filter((p) => !p.blank && p.text)
    .map((p) => ({ n: p.n, hit: [...words(p.text)].filter((w) => mine.has(w)).length }))
    .filter((p) => p.hit >= 2)
    .sort((a, b) => b.hit - a.hit)
    .slice(0, n)
    .map((p) => p.n)
}
