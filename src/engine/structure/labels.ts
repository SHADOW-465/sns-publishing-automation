// Chapter / part number lines, in any of the book languages: "CHAPTER 1", "Kapitel 3", "Part II", "ACT ONE", "7".
const NUM_WORD = '(\\d{1,3}|[ivxlcdm]{1,7}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|first|second|third|fourth|fifth|eins|zwei|drei|vier|f[üu]nf|uno|due|tre|quattro|cinque|dos|tres|cuatro)'
const LABEL = new RegExp(`^\\s*((chapter|chapitre|kapitel|capitolo|cap[ií]tulo|part|partie|teil|parte|act|book|buch|libro)\\s+${NUM_WORD}|${NUM_WORD})\\s*[.:]?\\s*$`, 'i')
/** A line that is only a chapter / part number. */
export const isLabelLine = (t: string) => LABEL.test(t)
/** A label line that opens a part, not a chapter. */
export const PART_LABEL = /^\s*(part|partie|teil|parte|act|book|buch|libro)\b/i

/** The minimum a section needs for the merge below. */
export interface MergeSec { type: string; number?: string; numberAsTitle?: string; title: unknown[]; blocks: { kind: string; html: string }[]; lead?: string }

const onlyMarkers = (s: MergeSec) => s.blocks.every((b) => b.kind === 'raw' && !b.html.replace(/<span[^>]*epub:type="pagebreak"[^>]*\/>/g, '').trim())

/** A chapter cut in two at its opener: "CHAPTER 1" alone in one section and its title + body in the next, or the title in one
 *  and "CHAPTER 1" + body in the next. The two become one chapter: no empty or two-word chapter files, and the body never
 *  ends up in a back-matter section. A part opener ("ACT ONE", "Part II") stays its own file. `titleText` reads a title. */
export function mergeLabelSections<S extends MergeSec>(secs: S[], titleText: (s: S) => string): S[] {
  const out: S[] = []
  for (let i = 0; i < secs.length; i++) {
    const s = secs[i]
    const nx = secs[i + 1]
    const t = titleText(s).trim()
    const labelOnly = (!!t && isLabelLine(t)) || (!t && !!s.number)
    if (nx && onlyMarkers(s) && labelOnly && !PART_LABEL.test(t || s.number || '') && !(nx.number || isLabelLine(titleText(nx).trim()))) {
      // "CHAPTER 1" | "Title" + body
      const m = { ...nx, type: nx.type === 'other' || nx.type === 'chapter' ? 'chapter' : nx.type, number: s.number ?? t, blocks: [...s.blocks, ...nx.blocks], lead: (s.lead ?? '') + (nx.lead ?? '') } as S
      out.push(m)
      i++
      continue
    }
    if (nx && onlyMarkers(s) && t && !labelOnly && !s.number) {
      const nt = titleText(nx).trim()
      const nLabel = (!!nt && isLabelLine(nt)) || (!nt && !!nx.number)
      if (nLabel && !PART_LABEL.test(nt || nx.number || '')) {
        // "Title" | "CHAPTER 1" + body
        out.push({ ...s, type: s.type === 'other' || s.type === 'chapter' ? 'chapter' : s.type, number: nx.number ?? nt, blocks: [...s.blocks, ...(nx.lead ? [{ kind: 'raw', html: nx.lead }] : []), ...nx.blocks] } as S)
        i++
        continue
      }
    }
    // a section opened by "CHAPTER n" is a chapter, not front or back matter
    if (s.type === 'other' && labelOnly && PART_LABEL.test(t || s.number || '')) out.push({ ...s, type: 'part' })
    else if (s.type === 'other' && (labelOnly || (s.number && isLabelLine(s.number)) || (t && /^(chapter|kapitel|capitolo|cap[ií]tulo|chapitre)\s+\S+/i.test(t)))) out.push({ ...s, type: 'chapter' })
    else out.push(s)
  }
  return out
}

const strip = (h: string) => h.replace(/<span[^>]*epub:type="pagebreak"[^>]*\/>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const markersOf = (blocks: { kind: string; html: string }[]) => blocks.map((b) => (b.html.match(/<span[^>]*epub:type="pagebreak"[^>]*\/>/g) ?? []).join('')).join('')
const OPENER_TYPES = /^(prologue|epilogue|foreword|preface|introduction|afterword|conclusion)$/

/** The second pass, for openers set over several lines that the reader read as separate headings:
 *  - "ACT ONE" | "Your Writing World" + "CHAPTER 1" | "A Roadmap…" + body: the subtitle joins the part, the label the chapter;
 *  - "The Blessing and" + "CHAPTER 4" | "The Curse of Story Telling" + body: one title, one chapter;
 *  - a chapter numbered "ACT THREE" is a part;
 *  - "EPILOGUE" alone | "The Genie's Curse" + body: one epilogue. */
export function mergeOpeners<S extends MergeSec>(secs: S[], titleText: (s: S) => string): S[] {
  const out: S[] = []
  for (let i = 0; i < secs.length; i++) {
    let s = secs[i]
    const nx = secs[i + 1]
    const prev = out[out.length - 1]
    if (s.type === 'chapter' && s.number && PART_LABEL.test(s.number) && isLabelLine(s.number)) s = { ...s, type: 'part' }
    const t = titleText(s).trim()
    const texts = s.blocks.map((b) => strip(b.html)).filter(Boolean)
    const trailingLabel = texts.length === 1 && isLabelLine(texts[0]) && !PART_LABEL.test(texts[0]) ? texts[0] : ''
    if (nx && trailingLabel && t && !isLabelLine(t) && !nx.number && t.split(/\s+/).length <= 10) {
      const lead = (s.lead ?? '') + markersOf(s.blocks)
      if (prev && prev.type === 'part' && onlyMarkers(prev) && prev.title.length) {
        // the part's subtitle
        out[out.length - 1] = { ...prev, title: [...prev.title, ...s.title] }
        out.push({ ...nx, type: nx.type === 'other' || nx.type === 'chapter' ? 'chapter' : nx.type, number: trailingLabel, lead: lead + (nx.lead ?? '') } as S)
      } else {
        // the first half of the next title
        out.push({ ...nx, type: nx.type === 'other' || nx.type === 'chapter' ? 'chapter' : nx.type, number: trailingLabel, title: [...s.title, ...nx.title], lead: lead + (nx.lead ?? '') } as S)
      }
      i++
      continue
    }
    // "ACT ONE" alone, then "Your Writing World" set below it as a heading of its own (the chapter label that used to follow it now opens the chapter): the subtitle of the part
    if (prev && prev.type === 'part' && prev.title.length && isLabelLine(titleText(prev).trim()) && s.type === 'other' && !s.number && onlyMarkers(s) && onlyMarkers(prev) && t && !isLabelLine(t) && t.split(/\s+/).length <= 10 && nx && nx.type === 'chapter' && nx.number) {
      out[out.length - 1] = { ...prev, title: [...prev.title, ...s.title], blocks: [...prev.blocks, ...s.blocks] }
      continue
    }
    if (nx && onlyMarkers(s) && OPENER_TYPES.test(s.type) && t.split(/\s+/).length <= 2 && (nx.type === 'other' || nx.type === s.type) && !nx.number) {
      out.push({ ...nx, type: s.type, title: [...s.title, ...nx.title], blocks: [...s.blocks, ...nx.blocks], lead: (s.lead ?? '') + (nx.lead ?? '') } as S)
      i++
      continue
    }
    out.push(s)
  }
  // "CHAPTER 8" alone | a section whose heading was read as number + title ("THE POWER OF A SINGLE STEP:" / "TOWARD MOVES"):
  // the number is the label, the misread number goes back into the title
  const fixed: S[] = []
  for (let i = 0; i < out.length; i++) {
    const s = out[i]
    const nx = out[i + 1]
    if (nx && s.type === 'chapter' && onlyMarkers(s) && s.number && isLabelLine(s.number) && !titleText(s).trim() && nx.number && !isLabelLine(nx.number)) {
      fixed.push({ ...nx, type: 'chapter', number: s.number, numberAsTitle: nx.number, blocks: [...s.blocks, ...nx.blocks] } as S)
      i++
      continue
    }
    fixed.push(s)
  }
  // between the first part or chapter and the back matter, a long titled section with no label is a chapter whose label was art
  const firstBody = fixed.findIndex((s) => s.type === 'chapter' || s.type === 'part')
  const words = (s: S) => s.blocks.reduce((n, b) => n + strip(b.html).split(/\s+/).length, 0)
  let backAt = fixed.length
  for (let i = fixed.length - 1; i > firstBody; i--) if (fixed[i].type === 'chapter' || fixed[i].type === 'part') break; else backAt = i
  if (firstBody >= 0) for (let i = firstBody; i < backAt; i++) if (fixed[i].type === 'other' && titleText(fixed[i]).trim() && words(fixed[i]) >= 300) fixed[i] = { ...fixed[i], type: 'chapter' }
  // a label left alone with its number and nothing else: the next section's number
  return mergeLabelSections(fixed, titleText)
}
