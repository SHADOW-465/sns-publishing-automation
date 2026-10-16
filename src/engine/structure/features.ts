// One record per block, filled by every reader (InDesign, PDF, later Word) and read by the scorer (design §3.1).
// The scorer never looks at a source format: it only sees these fields, so one code path decides every source.

export type Pattern = 'chapterWord' | 'partWord' | 'numberOnly' | 'roman' | 'bullet' | 'tocLine' | 'imprint' | 'sectionKeyword'

export interface BlockFeatures {
  styleKey: string // InDesign paragraph style / PDF font+size key / Word style
  styleName?: string // human name when known ("Kapitelüberschrift", "BU")
  tag?: string // source element (h1, p, li…), InDesign only
  fontFamily?: string
  sizeRatio?: number // font size / body font size
  bold?: boolean
  italic?: boolean
  caps?: boolean
  align?: 'left' | 'center' | 'right' | 'justify'
  spaceAbove?: number // em
  spaceBelow?: number
  page?: string // the printed page the block sits on
  yFrac?: number // 0 top … 1 bottom of the printed page (PDF)
  firstOnPage?: boolean
  afterPageBreak?: boolean
  textLen: number
  endsWithPunct: boolean
  pattern?: Pattern
  /** matched an entry of the source's own nav (`nav`) or of the printed contents page (`contents`); level 1 = chapters */
  contentsMatch?: { level: number; entry: string; source: 'nav' | 'contents'; /** the number/label line of a heading, or its title line */ part?: 'label' | 'title' }
  styleFreq: number // how often this style occurs
  /** PDF only: a dingbat (▶, bullet) started the line and was removed; the line sits right under or beside a picture */
  marker?: boolean
  nearImage?: boolean
  /** the reader judged the style to look like a heading: short, set apart, and not like the body text */
  headingLook?: boolean
  /** the style of the next block, to find label/title pairs and "a heading is followed by text" */
  nextStyleKey?: string
}

export interface StyleStats {
  key: string
  n: number
  avgLen: number
  sizeRatio: number
  /** share of the style's blocks for which the test holds */
  share: (f: (b: BlockFeatures) => boolean) => number
  /** the most common value of a field, if it covers at least 70% of the blocks */
  mostly: <T>(f: (b: BlockFeatures) => T | undefined) => T | undefined
  /** the style that follows this one at least 70% of the time */
  follower?: string
  /** the contents level when at least half of the blocks match an entry (≥ 2 blocks) */
  contents?: { level: number; source: 'nav' | 'contents'; share: number; part?: 'label' | 'title' }
  /** a block sample, for the look of the style */
  first: BlockFeatures
}

export function styleStats(key: string, bl: BlockFeatures[]): StyleStats {
  const share = (f: (b: BlockFeatures) => boolean) => (bl.length ? bl.filter(f).length / bl.length : 0)
  const mostly = <T>(f: (b: BlockFeatures) => T | undefined): T | undefined => {
    const m = new Map<T | undefined, number>()
    for (const b of bl) m.set(f(b), (m.get(f(b)) ?? 0) + 1)
    const top = [...m].sort((a, b) => b[1] - a[1])[0]
    return top && top[1] / bl.length >= 0.7 ? top[0] : undefined
  }
  const next = new Map<string, number>()
  for (const b of bl) if (b.nextStyleKey) next.set(b.nextStyleKey, (next.get(b.nextStyleKey) ?? 0) + 1)
  const nx = [...next].sort((a, b) => b[1] - a[1])[0]
  const hits = bl.filter((b) => b.contentsMatch)
  const level = new Map<number, number>()
  for (const b of hits) level.set(b.contentsMatch!.level, (level.get(b.contentsMatch!.level) ?? 0) + 1)
  const lv = [...level].sort((a, b) => b[1] - a[1])[0]
  return {
    key, n: bl.length, first: bl[0], share, mostly,
    avgLen: bl.reduce((n, b) => n + b.textLen, 0) / Math.max(1, bl.length),
    sizeRatio: bl[0]?.sizeRatio ?? 1,
    follower: nx && nx[1] / bl.length >= 0.7 ? nx[0] : undefined,
    contents: lv && hits.length >= 2 && hits.length / bl.length >= 0.5 ? { level: lv[0], source: hits.find((b) => b.contentsMatch!.level === lv[0])!.contentsMatch!.source, share: hits.length / bl.length, part: hits.filter((b) => b.contentsMatch!.part === 'label').length > hits.length / 2 ? 'label' : undefined } : undefined,
  }
}
