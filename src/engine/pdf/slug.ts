// InDesign prints a slug under every page or spread: the file name and the print date and time
// ("88228-02 Cambia tu mente.indd 8-9   1/9/26 15:00"), often drawn twice on top of itself
// ("1/9/261/9/26 15:0015:00"). It is never book text.

const DATE = /\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/g
const TIME = /\d{1,2}[:.]\d{2}(?:[:.]\d{2})?/g

export function isSlug(text: string): boolean {
  if (/\.(indd|indb|idml)\b/i.test(text)) return true
  const hasDate = new RegExp(DATE.source).test(text)
  const hasTime = new RegExp(/\d{1,2}:\d{2}/.source).test(text)
  if (!hasDate || !hasTime) return false
  // only dates, times and page-range numbers: nothing a reader would call a sentence
  const rest = text.replace(DATE, ' ').replace(TIME, ' ').replace(/[\d\s\-–/.,:]+/g, ' ').trim()
  return (rest.match(/\p{L}/gu) ?? []).length <= 3
}
