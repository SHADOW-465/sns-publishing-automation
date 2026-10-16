// The validation gate: one verdict for a built EPUB, from the stages below. Green needs EPUBCheck to have run and passed.
//   1 our structure checks  2 spec conformance  3 accessibility claims  4 EPUBCheck (service)  6 reference diff
// Stage 5 (Ace) and axe-core are not wired yet. EPUBCheck needs Java, so the browser reaches it only through a validator service.
import { unzip, text, type Files } from '../zip.ts'
import type { HouseSettings } from '../settings.ts'
import { checkEpubBytes, type CheckSource } from './epub.ts'
import { conformance } from './conform.ts'
import { refdiff } from './refdiff.ts'

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

export interface GateStage { id: 'structure' | 'conformance' | 'accessibility' | 'epubcheck' | 'reference'; title: string; ran: boolean; errors: string[]; warnings: string[] }
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

export async function gate(epub: Uint8Array, s: HouseSettings, o: { source?: CheckSource; validator?: EpubValidator; reference?: Files; conformance?: boolean } = {}): Promise<GateReport> {
  const files = unzip(epub)
  const stages: GateStage[] = []
  const notes: string[] = []
  const flat = checkEpubBytes(epub, o.source).groups.flatMap((g) => g.findings)
  stages.push({ id: 'structure', title: 'Structure checks', ran: true, errors: flat.filter((f) => f.level === 'error').map((f) => f.msg), warnings: flat.filter((f) => f.level === 'warn').map((f) => f.msg) })
  // conformance only makes sense for a book built under these settings, not for any EPUB dropped into the checker
  if (o.conformance !== false) stages.push({ id: 'conformance', title: 'Spec conformance', ran: true, errors: conformance(files, s), warnings: [] })
  stages.push({ id: 'accessibility', title: 'Accessibility claims', ran: true, errors: claimsCheck(files), warnings: [] })
  const v = await (o.validator ?? noValidator)(epub)
  stages.push({ id: 'epubcheck', title: 'EPUBCheck', ran: !!v, errors: v?.errors ?? [], warnings: v?.warnings ?? [] })
  if (!v) notes.push('EPUBCheck could not run here, so this file is not cleared for delivery.')
  if (o.reference) stages.push({ id: 'reference', title: 'Reference diff', ran: true, errors: [], warnings: refdiff(files, o.reference).map((d) => `Differs from your reference: ${d}`) })
  const errors = stages.some((x) => x.errors.length)
  const warned = stages.some((x) => x.warnings.length)
  return { verdict: errors ? 'red' : warned || !v ? 'amber' : 'green', stages, notes }
}
