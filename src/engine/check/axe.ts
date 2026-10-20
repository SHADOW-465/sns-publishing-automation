// axe-core on every XHTML page of a book (gate stage 3): Ace's own build of it (@daisy/axe-core-for-ace, the version
// Ace 1.4.6 ships), which knows EPUB roles such as doc-pagebreak on a <span>; stock axe-core reports those. The page is loaded into a window of its
// own with its scripts removed, axe is put into that window, and its violations come back. The browser uses a hidden
// iframe; Node (the tests) passes a jsdom window through the same `axeIn`.
import type { AxeResults, RunOptions } from '@daisy/axe-core-for-ace'
import { text, type Files } from '../zip.ts'

export interface AxeFinding { rule: string; impact: string; help: string; nodes: number }
/** Runs axe on one XHTML page; resolves null when axe cannot run here. */
export type AxeRunner = (xhtml: string) => Promise<AxeFinding[] | null>

/** The rules Ace runs (it turns off bypass, region, page-has-heading-one and landmark-complementary-is-top-level for book
 *  pages). Contrast also stays off: it needs the stylesheet and a real layout, which a page loaded on its own does not have;
 *  the look checker covers colour. */
export const AXE_OPTIONS: RunOptions = {
  rules: Object.fromEntries(['bypass', 'region', 'page-has-heading-one', 'landmark-complementary-is-top-level', 'color-contrast'].map((r) => [r, { enabled: false }])),
  resultTypes: ['violations'],
}

/** A page without its scripts and event handlers: the book's own code never runs inside the checker. */
export function withoutScripts(xhtml: string): string {
  const doc = new DOMParser().parseFromString(xhtml, 'application/xhtml+xml')
  if (doc.getElementsByTagName('parsererror').length) return xhtml
  for (const s of Array.from(doc.getElementsByTagName('script'))) s.remove()
  for (const el of Array.from(doc.getElementsByTagName('*')))
    for (const a of Array.from(el.attributes)) if (/^on/i.test(a.name) || /^\s*javascript:/i.test(a.value)) el.removeAttribute(a.name)
  return new XMLSerializer().serializeToString(doc)
}

/** axe in a window that already shows the page: inject the source, run, keep the violations. */
export async function axeIn(win: Window & { axe?: { run: (c: unknown, o: RunOptions) => Promise<AxeResults> } }, source: string, evalIn: (code: string) => void): Promise<AxeFinding[]> {
  if (!win.axe) evalIn(source)
  const r = await win.axe!.run(win.document, AXE_OPTIONS)
  return r.violations.map((v) => ({ rule: v.id, impact: v.impact ?? 'minor', help: v.help, nodes: v.nodes.length }))
}

/** The browser runner: a hidden same-origin iframe per page (a blob URL keeps the XHTML parsed as XML). No sandbox attribute:
 *  axe has to run inside the frame and the parent has to read it, which a sandbox with both allowances would not stop anyway.
 *  The book's own scripts are removed before the page is loaded (withoutScripts). */
export const iframeAxe: AxeRunner = async (xhtml) => {
  if (typeof document === 'undefined') return null
  const { default: axe } = await import('@daisy/axe-core-for-ace')
  const url = URL.createObjectURL(new Blob([withoutScripts(xhtml)], { type: 'application/xhtml+xml' }))
  const f = document.createElement('iframe')
  f.setAttribute('aria-hidden', 'true')
  f.tabIndex = -1
  f.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;height:600px;border:0'
  try {
    await new Promise<void>((done, fail) => {
      f.onload = () => done()
      f.onerror = () => fail(new Error('page did not load'))
      f.src = url
      document.body.append(f)
    })
    const w = f.contentWindow as Window & { axe?: never }
    return await axeIn(w, axe.source, (code) => {
      const s = w.document.createElementNS('http://www.w3.org/1999/xhtml', 'script')
      s.textContent = code
      ;(w.document.head ?? w.document.documentElement).append(s)
    })
  } catch {
    return null
  } finally {
    f.remove()
    URL.revokeObjectURL(url)
  }
}

/** axe over every content page: critical and serious violations are errors, the rest warnings. null when axe could not run. */
export async function axePages(files: Files, run: AxeRunner): Promise<{ errors: string[]; warnings: string[] } | null> {
  const errors: string[] = []
  const warnings: string[] = []
  for (const [path, data] of files) {
    if (!path.endsWith('.xhtml')) continue
    const found = await run(text(data))
    if (!found) return null
    const name = path.replace(/^.*\//, '')
    for (const v of found) (v.impact === 'critical' || v.impact === 'serious' ? errors : warnings).push(`${name}: ${v.help} (axe ${v.rule}, ${v.nodes} place${v.nodes === 1 ? '' : 's'})`)
  }
  return { errors, warnings }
}
