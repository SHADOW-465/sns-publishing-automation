// Is this text a person (or a list of people) a book can name as its author? A printing line, a copyright line, a date or a
// publisher is not. Used before a guess reaches dc:creator or the cover's description, so a wrong guess is dropped, not shown.

const NOT_AN_AUTHOR =
  /first published|published (by|in)|©|\(c\)|\bisbn\b|copyright|all rights|rights reserved|printed|edition|\bcatalogu|british library|www\.|https?:|@|\b(19|20)\d{2}\b|\d{3,}|\b(press|publishing|publishers|verlag|ltd|limited|gmbh|inc)\b/i

export function plausibleAuthor(s: string | undefined | null): boolean {
  const t = (s ?? '').replace(/\s+/g, ' ').trim()
  if (!t || t.length > 160 || !/\p{L}/u.test(t)) return false
  return !NOT_AN_AUTHOR.test(t)
}
