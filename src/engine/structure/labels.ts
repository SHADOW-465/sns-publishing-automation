// Chapter / part number lines, in any of the book languages: "CHAPTER 1", "Kapitel 3", "Part II", "ACT ONE", "7".
const NUM_WORD = '(\\d{1,3}|[ivxlcdm]{1,7}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|first|second|third|fourth|fifth|eins|zwei|drei|vier|f[üu]nf|uno|due|tre|quattro|cinque|dos|tres|cuatro)'
const LABEL = new RegExp(`^\\s*((chapter|chapitre|kapitel|capitolo|cap[ií]tulo|part|partie|teil|parte|act|book|buch|libro)\\s+${NUM_WORD}|${NUM_WORD})\\s*[.:]?\\s*$`, 'i')
/** A line that is only a chapter / part number. */
export const isLabelLine = (t: string) => LABEL.test(t)
/** A label line that opens a part, not a chapter. */
export const PART_LABEL = /^\s*(part|partie|teil|parte|act|book|buch|libro)\b/i

/** The minimum a section needs for the merge below. */
export interface MergeSec { type: string; number?: string; title: unknown[]; blocks: { kind: string; html: string }[]; lead?: string }

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
