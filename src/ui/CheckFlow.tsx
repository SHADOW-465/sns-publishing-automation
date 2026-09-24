import { useState } from 'react'
import { FileDrop, type Picked } from './FileDrop.tsx'
import { Status, Outline, CheckReportView, Help } from './wizard.tsx'
import { checkEpubBytes, type CheckReport } from '../engine/check/epub.ts'
import { text, unzip, type Files } from '../engine/zip.ts'
import { parseXml, resolvePath, epubType } from '../engine/xml.ts'
import type { SectionType } from '../engine/epub/locale.ts'

// Check any EPUB — one made here, by a supplier, or by hand — with the same quality report the
// build steps use. With the print PDF, every printed page is also checked for a page marker.

export function CheckFlow() {
  const [epub, setEpub] = useState<Picked>()
  const [pdf, setPdf] = useState<Picked>()
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<string>()
  const [out, setOut] = useState<{ report: CheckReport; files: Files; base: string; sections: { file: string; type: SectionType; nav: string }[] }>()

  const onCheck = async () => {
    setBusy('Checking…')
    setError(undefined)
    await new Promise((r) => setTimeout(r, 30))
    try {
      let printPages: string[] | undefined
      if (pdf) {
        setBusy('Reading the print PDF (page numbers)…')
        const { printPagesOf } = await import('./pdf.ts')
        printPages = (await printPagesOf(pdf.data)).filter((p) => !p.blank).map((p) => p.n)
      }
      setBusy('Checking the EPUB…')
      const report = checkEpubBytes(epub!.data, { printPages })
      const files = unzip(epub!.data)
      setOut({ report, files, ...spineOf(files) })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <div className="flow">
      <section className="card">
        <h2>Check an EPUB</h2>
        <p className="muted">
          Drop any EPUB — made here, by a supplier or by hand — to see whether it is valid, accessible and complete before it goes to the stores. Add the print PDF to
          also check that every printed page has its page marker.
        </p>
        <div className="drops">
          <FileDrop label="EPUB" hint="the e-book to check" accept=".epub" value={epub} onPick={(f) => (setEpub(f), setOut(undefined))} required />
          <FileDrop label="Print PDF (optional)" hint="to check the page numbers" accept="application/pdf" value={pdf} onPick={setPdf} />
        </div>
        <Help title="What is checked?">
          <ul>
            <li><strong>Valid EPUB file</strong> — the rules of EPUBCheck, which every store runs: zip layout, package, file types, links, well-formed pages.</li>
            <li><strong>Accessibility</strong> — the rules of Ace by DAISY: language, headings, picture descriptions, navigation, page list, accessibility metadata.</li>
            <li><strong>Content</strong> — empty or duplicated text, very short chapters, and page markers against the print PDF.</li>
            <li><strong>Book details</strong> — title, author, publisher, ISBN and cover size as stores show them.</li>
          </ul>
          It is a quick first check. For delivery, EPUBCheck and Ace remain the reference tools.
        </Help>
        <div className="row">
          <button className="primary" disabled={!epub || !!busy} onClick={onCheck}>
            Check
          </button>
        </div>
      </section>
      <Status busy={busy} error={error} />
      {out && (
        <section className="card">
          <h2>Report</h2>
          <CheckReportView report={out.report} />
          {out.sections.length > 0 && (
            <>
              <h3>Preview</h3>
              <Outline sections={out.sections} files={out.files} base={out.base} />
            </>
          )}
        </section>
      )}
    </div>
  )
}

const TYPES = new Set<string>(['halftitle', 'title', 'copyright', 'dedication', 'epigraph', 'toc', 'introduction', 'preface', 'foreword', 'prologue', 'part', 'chapter', 'conclusion', 'epilogue', 'afterword', 'glossary', 'appendix', 'bibliography', 'notes', 'index', 'acknowledgments'])
const ALIAS: Record<string, SectionType> = { halftitlepage: 'halftitle', titlepage: 'title', 'copyright-page': 'copyright', endnotes: 'notes', contributors: 'about' }

/** Reading order of any EPUB, with a label per file: its entry in the navigation, else its <title>. */
function spineOf(files: Files): { base: string; sections: { file: string; type: SectionType; nav: string }[] } {
  const opfPath = text(files.get('META-INF/container.xml') ?? new Uint8Array()).match(/full-path="([^"]+)"/)?.[1]
  if (!opfPath || !files.has(opfPath)) return { base: '', sections: [] }
  const opf = parseXml(text(files.get(opfPath)!))
  const items = new Map(Array.from(opf.getElementsByTagName('item')).map((i) => [i.getAttribute('id'), { href: resolvePath(opfPath, i.getAttribute('href') ?? ''), props: i.getAttribute('properties') ?? '' }]))
  const navItem = [...items.values()].find((i) => i.props.includes('nav'))
  const labels = new Map<string, string>()
  if (navItem && files.has(navItem.href)) {
    try {
      const nav = parseXml(text(files.get(navItem.href)!))
      for (const a of Array.from(nav.querySelectorAll('a'))) {
        const h = resolvePath(navItem.href, a.getAttribute('href') ?? '')
        if (!labels.has(h)) labels.set(h, (a.textContent ?? '').trim())
      }
    } catch {
      /* broken nav: the report already says so */
    }
  }
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : ''
  const sections = Array.from(opf.getElementsByTagName('itemref'))
    .map((r) => items.get(r.getAttribute('idref')))
    .filter((i): i is { href: string; props: string } => !!i && files.has(i.href) && i.href.startsWith(base))
    .map((i) => {
      let type: SectionType = 'other'
      let title = ''
      try {
        const d = parseXml(text(files.get(i.href)!))
        title = (d.querySelector('title')?.textContent ?? '').trim()
        const t = [d.body, ...Array.from(d.querySelectorAll('section'))].map((e) => (e ? epubType(e) : '')).join(' ').split(/\s+/)
        const hit = t.map((x) => ALIAS[x] ?? x).find((x) => TYPES.has(x))
        if (hit) type = hit as SectionType
        if (/cover/i.test(i.href) && type === 'other') type = 'cover' as SectionType
      } catch {
        /* not well-formed: reported */
      }
      return { file: i.href.slice(base.length), type, nav: labels.get(i.href) ?? title }
    })
  return { base, sections }
}
