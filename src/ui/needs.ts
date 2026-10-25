// What a wizard step still needs before Next can go on, in plain words. Pure: the dialog, the status line and the tests use it.
// Rule (Showmik, Oct 25): Next is never silently disabled. A step that is not complete says what it needs, offers the
// one-click fix where there is one, and points at each item.

export interface Need {
  id: string
  /** what the person sees in the list, e.g. 'Style “tital”: choose what it is' */
  label: string
  /** the short name used in the status line, grouped and counted: 'style', 'publisher name', 'picture' */
  group: string
  /** a needs-a-choice item cannot be accepted in bulk; an acceptable one can */
  kind: 'choice' | 'acceptable'
  /** DOM id of the element "Go to it" scrolls to */
  target?: string
}

/** DOM id for a "Check these first" item (ids like "picture:OEBPS/image/1.jpg" are not valid fragment ids). */
export const targetId = (itemId: string) => 'check-' + itemId.replace(/[^A-Za-z0-9_-]/g, '_')

const plural = (n: number, word: string) => (n === 1 || /(name|title)$/.test(word) ? word : /s$/.test(word) ? word : word.replace(/y$/, 'ie') + 's')

/** "1 style, publisher name, 83 pictures": groups in first-seen order, counted when more than one or countable. */
export function needsSummary(needs: Need[]): string {
  const groups = new Map<string, number>()
  for (const n of needs) groups.set(n.group, (groups.get(n.group) ?? 0) + 1)
  return [...groups].map(([g, c]) => (/(name|title)$/.test(g) && c === 1 ? g : `${c} ${plural(c, g)}`)).join(', ')
}

/** Dialog heading: "2 things need your choice before you can continue". */
export function needsHeadline(needs: Need[]): string {
  const n = needs.length
  return n === 1 ? '1 thing needs your attention before you can continue' : `${n} things need your attention before you can continue`
}

export const acceptableNeeds = (needs: Need[]) => needs.filter((n) => n.kind === 'acceptable')
export const choiceNeeds = (needs: Need[]) => needs.filter((n) => n.kind === 'choice')

/** Structure step: the blocking "Check these first" items as needs. */
export function structureNeeds<T extends { id: string; area: string; title: string }>(items: T[], isAcceptable: (it: T) => boolean): Need[] {
  return items.map((it) => {
    const meta = it.area === 'meta' ? it.id.replace(/^meta:/, '') : ''
    const group = it.area === 'style' ? 'style' : meta ? ({ title: 'book title', authors: 'author name', publisher: 'publisher name' } as Record<string, string>)[meta] ?? `${meta} name` : it.area === 'section' ? 'section' : it.area === 'picture' ? 'picture' : 'note'
    return { id: it.id, label: it.title, group, kind: isAcceptable(it) ? 'acceptable' : 'choice', target: targetId(it.id) }
  })
}

/** "Keep as it is" on a style the tool was unsure of: the reviewer confirms the tool's reading. Without it the only way to
 *  keep the guess was to pick another meaning and back, and Next asked again and again (dinamicas "subtitulo-1"). */
export const keepStylePatch = <R extends string>(role: R) => ({ role, reason: 'kept as read by the reviewer' })
