// PDF reader → BlockFeatures (structure/features.ts): one record per text line, measured from the page.
import type { BlockFeatures, Pattern } from '../structure/features.ts'
import { CHAPTER_WORD, PART_WORD } from '../indesign/features.ts'
import { isBoldFont } from '../pdf/layout.ts'
import type { Line, ImgBox } from '../pdf/layout.ts'

export interface FeaturePage { width: number; height: number; lines: (Line & { key: string; forced?: string })[]; images: ImgBox[] }

const ROMAN = /^[ivxlcdm]{1,8}\.?$/i

export function pdfFeatures<L extends Line & { key: string; forced?: string }>(
  pages: { width: number; height: number; lines: L[]; images: ImgBox[] }[],
  numbers: number[],
  c: { bodyKey: string; bodySize: number; imageLines: Set<L> },
): Map<L, BlockFeatures> {
  const out = new Map<L, BlockFeatures>()
  const freq = new Map<string, number>()
  for (const p of pages) for (const l of p.lines) freq.set(l.key, (freq.get(l.key) ?? 0) + 1)
  pages.forEach((p, pi) => {
    const sorted = [...p.lines].sort((a, b) => a.y - b.y || a.x0 - b.x0)
    sorted.forEach((l, i) => {
      const t = l.text.trim()
      const centre = (l.x0 + l.x1) / 2
      const pattern: Pattern | undefined = l.marker ? 'bullet' : /^\d{1,3}$/.test(t) ? 'numberOnly' : ROMAN.test(t) ? 'roman' : PART_WORD.test(t) && t.length < 60 ? 'partWord' : CHAPTER_WORD.test(t) ? 'chapterWord' : undefined
      out.set(l, {
        styleKey: l.key,
        fontFamily: l.font,
        sizeRatio: l.size / c.bodySize,
        bold: isBoldFont(l.font) || l.runs.every((r) => r.bold),
        italic: l.runs.every((r) => r.italic),
        caps: !!l.sc || (t.length > 3 && t === t.toUpperCase() && /\p{L}/u.test(t)),
        align: Math.abs(centre - p.width / 2) < p.width * 0.03 && l.x1 - l.x0 < p.width * 0.7 ? 'center' : 'left',
        page: String(numbers[pi] ?? pi + 1),
        yFrac: l.y / p.height,
        firstOnPage: i === 0,
        afterPageBreak: i === 0,
        textLen: t.length,
        endsWithPunct: /[.;,:!?…»”"')]$/.test(t),
        pattern,
        contentsMatch: l.forced === 'chapter-number' ? { level: 1, entry: t, source: 'contents', part: 'label' } : l.forced === 'title' ? { level: 1, entry: t, source: 'contents', part: 'title' } : l.forced === 'subhead' ? { level: 2, entry: t, source: 'contents' } : l.forced === 'subhead2' ? { level: 3, entry: t, source: 'contents' } : undefined,
        styleFreq: freq.get(l.key) ?? 0,
        nextStyleKey: sorted[i + 1]?.key,
        marker: l.marker,
        nearImage: c.imageLines.has(l),
      })
    })
  })
  return out
}
