/** Printed page numbers for every PDF page, from the folios that could be read (undefined = none).
 *  Numbers that disagree with the book's page sequence — a lone "16" at the top of a contents
 *  page, a chapter number, a year — are ignored: most folios agree on one offset from the PDF page
 *  index, and that offset wins. Pages before page 1 (unnumbered front matter) get roman numerals. */
export function fillNumbers(folios: (number | undefined)[]): (number | string)[] {
  const offsets = new Map<number, number>()
  folios.forEach((f, i) => f !== undefined && offsets.set(f - i, (offsets.get(f - i) ?? 0) + 1))
  const best = [...offsets].sort((a, b) => b[1] - a[1])[0]
  const known = folios.filter((f) => f !== undefined).length
  // a clear majority offset: trust it and drop the stray numbers
  const nums = best && best[1] >= Math.max(2, known * 0.5) ? folios.map((f, i) => (f === i + best[0] ? f : undefined)) : [...folios]
  // pages without a folio (chapter openers, blanks, full-page images): count from the neighbours
  for (let i = 1; i < nums.length; i++) if (nums[i] === undefined && nums[i - 1] !== undefined) nums[i] = nums[i - 1]! + 1
  for (let i = nums.length - 2; i >= 0; i--) if (nums[i] === undefined && nums[i + 1] !== undefined) nums[i] = nums[i + 1]! - 1
  // a stray number read as a folio breaks the sequence: repair from both neighbours
  for (let i = 1; i < nums.length - 1; i++) if (nums[i - 1]! + 2 === nums[i + 1] && nums[i] !== nums[i - 1]! + 1) nums[i] = nums[i - 1]! + 1
  return nums.map((n, i) => (n === undefined ? i + 1 : n >= 1 ? n : roman(i + 1)))
}

export function roman(n: number): string {
  const t: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]
  let s = ''
  for (const [v, r] of t) while (n >= v) (s += r), (n -= v)
  return s
}
