// InDesign reader → note kinds and reference matching (design §3.4).
import { matchNotes, type NoteFinding, type NoteMark } from '../structure/notes.ts'
import { sectionTypeOf } from '../epub/locale.ts'
import { textOf, epubType, classesOf } from '../xml.ts'
import { norm } from './features.ts'
import { isNoteRef } from './inline.ts'
import type { Block, Export, Role } from './read.ts'

type PBlock = Extract<Block, { t: 'p' }>
const HEAD = /^(chapter-title|section-title|part-title|h[2-5])$/
const short = (t: string) => norm(t).slice(0, 12)

export function indesignNotes(ex: Export, roleOf: (b: PBlock) => Role): NoteFinding[] {
  const out: NoteFinding[] = []
  const ps = ex.blocks.filter((b): b is PBlock => b.t === 'p')

  // InDesign's own notes: the reference is a link, the note is a collected element; ids tie them together
  const refs: NoteMark[] = []
  for (const b of ps) for (const a of Array.from(b.el.querySelectorAll('a')).filter(isNoteRef)) {
    const id = (a.getAttribute('href') ?? '').split('#')[1] ?? ''
    if (id) refs.push({ label: textOf(a).trim() || id, scope: 'book', where: b.page ? `page ${b.page}` : '', id })
  }
  const noteMark = (id: string, li: Element): NoteMark => ({ label: textOf(li).match(/^\s*(\d{1,3})/)?.[1] ?? id, scope: 'book', where: '', id })
  const foot = [...ex.footnotes].filter(([id]) => !ex.endnotes.has(id))
  const end = [...ex.footnotes].filter(([id]) => ex.endnotes.has(id))
  const idRefs = (ids: Set<string>) => refs.filter((r) => ids.has(r.id!))
  const known = new Set(ex.footnotes.keys())
  if (foot.length || refs.some((r) => !ex.endnotes.has(r.id!))) {
    const ids = new Set(foot.map(([id]) => id))
    // a reference whose note does not exist belongs to the footnote kind: that is where it was meant to land
    const mine = refs.filter((r) => ids.has(r.id!) || !known.has(r.id!))
    const typed = foot.some(([, li]) => epubType(li) === 'footnote')
    out.push(matchNotes('indesign-footnote', typed ? 0.95 : 0.8, [typed ? 'notes are epub:type footnote elements' : 'notes are in InDesign’s footnote frame (_idFootnotes)'], mine, foot.map(([id, li]) => noteMark(id, li))))
  }
  if (end.length) {
    const ids = new Set(end.map(([id]) => id))
    out.push(matchNotes('indesign-endnote', 0.95, ['notes are collected as epub:type endnotes'], idRefs(ids), end.map(([id, li]) => noteMark(id, li))))
  }

  // a typed endnote section: a "Notes" heading, then numbered paragraphs, often under chapter subheadings
  const typedNotes: NoteMark[] = []
  const seen = new Set<PBlock>()
  ps.forEach((b, i) => {
    if (!b.text || (!HEAD.test(roleOf(b)) && b.text.length > 40) || sectionTypeOf(b.text) !== 'notes') return
    let scope = 'book'
    let misses = 0
    const found: NoteMark[] = []
    for (const n of ps.slice(i + 1)) {
      if (!n.text) continue
      const num = n.text.match(/^(\d{1,3})(?!\d)/)?.[1]
      if (num) {
        found.push({ label: num, scope, where: n.page ? `page ${n.page}` : '' })
        seen.add(n)
        misses = 0
      } else if (HEAD.test(roleOf(n)) && n.text.length < 80 && !sectionTypeOf(n.text)) {
        scope = short(n.text) // numbering restarts under each chapter subheading
        misses = 0
      } else if (++misses > 1 && found.length) break
    }
    if (found.length >= 2) typedNotes.push(...found)
  })
  if (typedNotes.length) {
    const scoped = new Set(typedNotes.map((n) => n.scope)).size > 1
    let chapter = 'book'
    const typedRefs: NoteMark[] = []
    for (const b of ps) {
      if (roleOf(b) === 'chapter-title' && b.text) chapter = short(b.text)
      if (seen.has(b)) continue
      for (const s of Array.from(b.el.querySelectorAll('sup'))) {
        if (s.closest('a') || classesOf(s).includes('_idFootnoteLink')) continue
        const t = textOf(s).trim()
        if (/^\d{1,3}$/.test(t)) typedRefs.push({ label: t, scope: scoped ? chapter : 'book', where: b.page ? `page ${b.page}` : '' })
      }
    }
    if (!scoped) typedNotes.forEach((n) => (n.scope = 'book'))
    out.push(matchNotes('typed-endnote', 0.7, ['a “Notes” heading followed by numbered paragraphs', scoped ? 'numbering restarts under chapter subheadings' : 'one numbering for the book'], typedRefs, typedNotes))
  }
  return out
}
