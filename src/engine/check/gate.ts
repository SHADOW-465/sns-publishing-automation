// The validation gate: one verdict for a built EPUB, from the stages below. Green needs EPUBCheck to have run and passed.
//   1 our structure checks  2 spec conformance  3 accessibility (claims, pageRules, axe-core per page)  4 EPUBCheck (service)
//   5 Ace by DAISY (service, accessible books only)  6 reference diff
// EPUBCheck needs Java and Ace a headless Chrome, so the browser reaches both through a local service. axe-core runs in the browser.
import { unzip, text, type Files } from '../zip.ts'
import type { HouseSettings } from '../settings.ts'
import { checkEpubBytes, type CheckSource } from './epub.ts'
import { conformance } from './conform.ts'
import { refdiff } from './refdiff.ts'
import { axePages, type AxeRunner } from './axe.ts'

export interface ValidatorResult { errors: string[]; warnings: string[] }
/** Runs EPUBCheck somewhere with Java; resolves null when it cannot run (offline, no service configured). */
export type EpubValidator = (epub: Uint8Array) => Promise<ValidatorResult | null>

/** Stub used where no service exists yet (the web app). */
export const noValidator: EpubValidator = async () => null

/** POSTs the EPUB to a service that answers { errors: string[], warnings: string[] } (EPUBCheck output, flattened). */
export const httpValidator = (url: string): EpubValidator => async (epub) => {
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/epub+zip' }, body: epub as unknown as BodyInit })
    return r.ok ? ((await r.json()) as ValidatorResult) : null
  } catch {
    return null
  }
}

export interface GateStage { id: 'structure' | 'conformance' | 'accessibility' | 'epubcheck' | 'ace' | 'reference'; title: string; ran: boolean; errors: string[]; warnings: string[] }
export interface GateReport { verdict: 'green' | 'amber' | 'red'; stages: GateStage[]; notes: string[] }

/** Claims in the package that the content does not back up. */
export function claimsCheck(files: Files): string[] {
  const opf = text([...files].find(([p]) => p.endsWith('.opf'))?.[1] ?? new Uint8Array())
  if (!/schema:accessMode/.test(opf)) return []
  const html = [...files].filter(([p]) => p.endsWith('.xhtml')).map(([, d]) => text(d)).join('\n')
  const imgs = html.match(/<img\b[^>]*>/g) ?? []
  const bad: string[] = []
  const undescribed = imgs.filter((t) => !(/\balt="[^"]+"/.test(t) || (/\balt=""/.test(t) && /role="presentation"/.test(t)))).length
  if (/accessModeSufficient/.test(opf) && undescribed) bad.push(`The package says text alone is enough, but ${undescribed} picture(s) have no description`)
  if (/accessMode">visual</.test(opf) && !imgs.length) bad.push('The package claims visual content, but the book has no pictures')
  if (/pageNavigation/.test(opf) && !/pageBreakSource/.test(opf)) bad.push('Page navigation is declared without pageBreakSource')
  return bad
}

/** What axe-core / Ace report most often, read straight from the XHTML (no browser needed): empty links, repeated ids, a table with no header cell, a skipped heading level. */
export function pageRules(files: Files): { errors: string[]; warnings: string[] } {
  const errors: string[] = []
  const warnings: string[] = []
  for (const [path, data] of files) {
    if (!path.endsWith('.xhtml')) continue
    const doc = new DOMParser().parseFromString(text(data), 'application/xhtml+xml')
    if (doc.getElementsByTagName('parsererror').length) continue
    const name = path.replace(/^.*\//, '')
    const seen = new Set<string>()
    for (const el of Array.from(doc.getElementsByTagName('*'))) {
      const id = el.getAttribute('id')
      if (id && seen.has(id)) errors.push(`${name}: the id "${id}" is used twice`)
      if (id) seen.add(id)
    }
    for (const a of Array.from(doc.getElementsByTagName('a')).filter((x) => x.hasAttribute('href')))
      if (!(a.textContent ?? '').trim() && !a.getAttribute('aria-label') && !a.querySelector('img[alt]:not([alt=""])')) errors.push(`${name}: a link to "${a.getAttribute('href')}" has no text`)
    for (const t of Array.from(doc.getElementsByTagName('table'))) if (!t.getElementsByTagName('th').length) warnings.push(`${name}: a table has no header cells`)
    let level = 0
    for (const h of Array.from(doc.getElementsByTagName('*')).filter((x) => /^h[1-6]$/i.test(x.localName))) {
      const n = Number(h.localName[1])
      if (level && n > level + 1) warnings.push(`${name}: heading level jumps from h${level} to h${n} ("${(h.textContent ?? '').trim().slice(0, 40)}")`)
      level = n
    }
  }
  return { errors, warnings }
}

/** `validator` is EPUBCheck, `ace` the Ace service (same answer shape), `axe` runs axe-core on one page. */
export async function gate(epub: Uint8Array, s: HouseSettings, o: { source?: CheckSource; validator?: EpubValidator; ace?: EpubValidator; axe?: AxeRunner; reference?: Files; conformance?: boolean } = {}): Promise<GateReport> {
  const files = unzip(epub)
  const stages: GateStage[] = []
  const notes: string[] = []
  const flat = checkEpubBytes(epub, o.source).groups.flatMap((g) => g.findings)
  stages.push({ id: 'structure', title: 'Structure checks', ran: true, errors: flat.filter((f) => f.level === 'error').map((f) => f.msg), warnings: flat.filter((f) => f.level === 'warn').map((f) => f.msg) })
  // conformance only makes sense for a book built under these settings, not for any EPUB dropped into the checker
  if (o.conformance !== false) stages.push({ id: 'conformance', title: 'Spec conformance', ran: true, errors: conformance(files, s), warnings: [] })
  const rules = pageRules(files)
  const axe = o.axe ? await axePages(files, o.axe) : null
  if (!axe) notes.push('axe-core did not run here, so the pages were checked by the built-in rules only.')
  stages.push({ id: 'accessibility', title: 'Accessibility', ran: true, errors: [...claimsCheck(files), ...rules.errors, ...(axe?.errors ?? [])], warnings: [...rules.warnings, ...(axe?.warnings ?? [])] })
  const v = await (o.validator ?? noValidator)(epub)
  stages.push({ id: 'epubcheck', title: 'EPUBCheck', ran: !!v, errors: v?.errors ?? [], warnings: v?.warnings ?? [] })
  if (!v) notes.push('EPUBCheck could not run here, so this file is not cleared for delivery.')
  // Ace judges the accessibility layer, so a standard EPUB (no accessibility metadata) is not sent to it
  const accessible = /schema:accessMode/.test(text([...files].find(([p]) => p.endsWith('.opf'))?.[1] ?? new Uint8Array()))
  const ace = accessible ? await (o.ace ?? noValidator)(epub) : null
  if (accessible) stages.push({ id: 'ace', title: 'Ace by DAISY', ran: !!ace, errors: ace?.errors ?? [], warnings: ace?.warnings ?? [] })
  if (accessible && !ace) notes.push('Ace by DAISY could not run here; run it before an accessibility certification.')
  if (o.reference) stages.push({ id: 'reference', title: 'Reference diff', ran: true, errors: [], warnings: refdiff(files, o.reference).map((d) => `Differs from your reference: ${d}`) })
  const errors = stages.some((x) => x.errors.length)
  const warned = stages.some((x) => x.warnings.length)
  return { verdict: errors ? 'red' : warned || !v ? 'amber' : 'green', stages, notes }
}
