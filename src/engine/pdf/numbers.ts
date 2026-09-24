/** Printed page numbers for every PDF page, from the folios that could be read (undefined = none). */
export function fillNumbers(folios: (number | undefined)[]): number[] {
  const nums = [...folios]
  // pages without a folio (chapter openers, blanks, full-page images): count from the neighbours
  for (let i = 1; i < nums.length; i++) if (nums[i] === undefined && nums[i - 1] !== undefined) nums[i] = nums[i - 1]! + 1
  for (let i = nums.length - 2; i >= 0; i--) if (nums[i] === undefined && nums[i + 1] !== undefined) nums[i] = nums[i + 1]! - 1
  // a stray number read as a folio breaks the sequence: repair from both neighbours
  for (let i = 1; i < nums.length - 1; i++) if (nums[i - 1]! + 2 === nums[i + 1] && nums[i] !== nums[i - 1]! + 1) nums[i] = nums[i - 1]! + 1
  return nums.map((n, i) => n ?? i + 1)
}
