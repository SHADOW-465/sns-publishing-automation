import { useState } from 'react'
import { IndesignFlow } from './ui/IndesignFlow.tsx'
import { PdfFlow } from './ui/PdfFlow.tsx'
import { PdfUaFlow } from './ui/PdfUaFlow.tsx'
import { CheckFlow } from './ui/CheckFlow.tsx'
import { SettingsFlow, loadSettings } from './ui/SettingsFlow.tsx'
import { Icon, type IconName } from './ui/icons.tsx'

loadSettings() // house settings saved in this browser apply from the first build

const WORKFLOWS = [
  {
    id: 'indd',
    icon: 'indesign',
    label: 'InDesign to EPUB',
    start: 'I have the InDesign EPUB export',
    what: 'Cleans up InDesign’s EPUB export and turns it into a finished, accessible e-book.',
    needs: 'InDesign EPUB export, cover image, print PDF (recommended)',
    gives: 'EPUB 3 ready for the stores',
  },
  {
    id: 'word',
    icon: 'pdf',
    label: 'PDF or Word to EPUB',
    start: 'I only have the print PDF or Word',
    what: 'Rebuilds the e-book from the final print PDF when there is no InDesign file.',
    needs: 'Print PDF, cover image or cover PDF',
    gives: 'EPUB 3 ready for the stores',
  },
  {
    id: 'pdfua',
    icon: 'access',
    label: 'Accessible PDF',
    start: 'I need an accessible PDF',
    what: 'Tags the print PDF so screen readers can read it in order (PDF/UA).',
    needs: 'Print PDF; optional cover, extra PDFs, Word file with picture descriptions',
    gives: 'PDF/UA file, to confirm with PAC',
  },
  {
    id: 'check',
    icon: 'shield',
    label: 'Check an EPUB',
    start: 'I want to check an e-book',
    what: 'Checks any EPUB — made here or by a supplier — before it goes out.',
    needs: 'EPUB; print PDF (optional)',
    gives: 'Quality report',
  },
] as const
type Tab = 'home' | 'settings' | (typeof WORKFLOWS)[number]['id']

const TITLES: Record<Tab, [string, string]> = {
  home: ['Start', ''],
  indd: ['InDesign to EPUB', 'Turn InDesign’s EPUB export into a finished, accessible e-book.'],
  word: ['PDF or Word to EPUB', 'Rebuild the e-book from the final print PDF.'],
  pdfua: ['Accessible PDF', 'Tag the print PDF so screen readers can follow it (PDF/UA).'],
  check: ['Check an EPUB', 'A quality report for any e-book, before it goes out.'],
  settings: ['Settings', 'House rules applied to every book built on this computer.'],
}

export function App() {
  const [tab, setTab] = useState<Tab>('home')
  const nav = (id: Tab, label: string, icon: IconName) => (
    <button key={id} className={tab === id ? 'nav-item on' : 'nav-item'} onClick={() => setTab(id)} aria-current={tab === id ? 'page' : undefined}>
      <Icon name={icon} /> <span>{label}</span>
    </button>
  )
  return (
    <div className="shell">
      <aside className="side">
        <button className="brand" onClick={() => setTab('home')}>
          <span className="brand-mark" aria-hidden="true">
            <Icon name="book" size={18} />
          </span>
          <span>
            <strong>Publishing Automation</strong>
            <small>Print book to accessible e-book</small>
          </span>
        </button>
        <nav className="nav" aria-label="Workflows">
          {nav('home', 'Start', 'home')}
          <p className="nav-label">Workflows</p>
          {WORKFLOWS.map((w) => nav(w.id, w.label, w.icon))}
          <p className="nav-label">House</p>
          {nav('settings', 'Settings', 'settings')}
        </nav>
        <p className="side-foot">
          <Icon name="lock" size={15} /> Files never leave this computer
        </p>
      </aside>
      <main className="main">
        {tab !== 'home' && (
          <header className="page-head">
            <h1>{TITLES[tab][0]}</h1>
            <p>{TITLES[tab][1]}</p>
          </header>
        )}
        {/* flows stay mounted so switching workflows does not lose work */}
        <div hidden={tab !== 'home'}>
          <Home onPick={setTab} />
        </div>
        <div hidden={tab !== 'indd'}>
          <IndesignFlow />
        </div>
        <div hidden={tab !== 'word'}>
          <PdfFlow />
        </div>
        <div hidden={tab !== 'pdfua'}>
          <PdfUaFlow />
        </div>
        <div hidden={tab !== 'check'}>
          <CheckFlow />
        </div>
        <div hidden={tab !== 'settings'}>
          <SettingsFlow />
        </div>
      </main>
    </div>
  )
}

function Home({ onPick }: { onPick: (t: Tab) => void }) {
  return (
    <div className="home">
      <section className="hero">
        <h1>From the print book to an accessible e-book, checked before it leaves.</h1>
        <p>
          Blind and partially sighted readers use screen readers, which need real headings, a working contents list, the printed page numbers, picture descriptions and
          the right language. The European Accessibility Act has required this for new e-books since June 2025, and stores check it. This tool does the clean-up that
          used to be done by hand, marks what needs a person, and checks the result.
        </p>
        <ol className="how">
          <li>
            <strong>Add the files</strong> you have for the book.
          </li>
          <li>
            <strong>Review</strong> what the tool found. Anything it is unsure about is marked.
          </li>
          <li>
            <strong>Check and download.</strong> A quality report says whether the file is ready.
          </li>
        </ol>
      </section>
      <h2 className="pick">What do you have?</h2>
      <div className="choices">
        {WORKFLOWS.map((w) => (
          <button key={w.id} className="choice" onClick={() => onPick(w.id)}>
            <span className="choice-ic">
              <Icon name={w.icon} size={22} />
            </span>
            <strong>{w.start}</strong>
            <span>{w.what}</span>
            <dl>
              <dt>You need</dt>
              <dd>{w.needs}</dd>
              <dt>You get</dt>
              <dd>{w.gives}</dd>
            </dl>
            <span className="choice-go">
              Start <Icon name="right" size={16} />
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
