import { useEffect, useState } from 'react'
import { IndesignFlow } from './ui/IndesignFlow.tsx'
import { PdfFlow } from './ui/PdfFlow.tsx'
import { PdfUaFlow } from './ui/PdfUaFlow.tsx'
import { CheckFlow } from './ui/CheckFlow.tsx'
import { SettingsFlow, loadSettings } from './ui/SettingsFlow.tsx'
import { Icon, type IconName } from './ui/icons.tsx'
import { OUTPUT_KINDS, type OutputKind } from './engine/output/standards.ts'
import { CLIENT_FILES } from './clients/index.ts'
import { store } from './engine/spec/store.ts'
import { setJobChoice } from './ui/job-choice.ts'

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
    what: 'Rebuilds the e-book from a Word manuscript’s heading styles, or from the print PDF when there is no Word file.',
    needs: 'Word manuscript (.docx) or print PDF, cover image (JPG or PNG)',
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
  word: ['PDF or Word to EPUB', 'Rebuild the e-book from a Word manuscript or the print PDF.'],
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
  const [clients, setClients] = useState<string[]>(CLIENT_FILES.map((c) => c.name))
  const [client, setClient] = useState(CLIENT_FILES[0]?.name ?? '')
  const [output, setOutput] = useState<OutputKind>('accessible-epub')
  useEffect(() => {
    store().listLayers('client').then((layers) => {
      const names = [...new Set([...CLIENT_FILES.map((c) => c.name), ...layers.map((l) => l.name)].filter(Boolean))]
      setClients(names)
      setClient((cur) => cur || names[0] || '')
    }).catch(() => { /* the list that ships with the tool is enough */ })
  }, [])
  const go = (tab: Tab) => {
    setJobChoice({ client, output })
    onPick(tab)
  }
  const cards = WORKFLOWS.filter((w) => (output === 'accessible-pdf' ? w.id === 'pdfua' : w.id === 'indd' || w.id === 'word'))
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
          <li><strong>Pick the client.</strong> Their saved settings are used. Anything they have not set falls back to the standard for the output you pick.</li>
          <li><strong>Pick the output.</strong> Standard EPUB, Accessible EPUB, or Accessible PDF. Each one has its own rules.</li>
          <li><strong>Add the files</strong> the next screen asks for. The accepted types are named on each box.</li>
          <li><strong>Read the settings in effect.</strong> Each value says whether it came from the client, the series, this book, or the standard.</li>
          <li><strong>Fix anything the check blocks.</strong> Only a real break in the standard stops you. Warnings need a person, then you can go on.</li>
          <li><strong>Read the result.</strong> It says what passed, what needs a person, and what to do next.</li>
        </ol>
      </section>
      <section className="card">
        <h2>1. Client</h2>
        <p className="muted">Whose book is this? Their house style is applied. A new name is remembered on this computer.</p>
        <label className="alt">
          <span>Client</span>
          <input list="clients" value={client} onChange={(e) => setClient(e.target.value)} />
          <datalist id="clients">
            {clients.map((n) => <option key={n} value={n} />)}
          </datalist>
        </label>
        <h2>2. Output</h2>
        <fieldset className="profiles">
          <legend>What should this book become?</legend>
          {OUTPUT_KINDS.map((k) => (
            <label key={k.id} className={`profile ${output === k.id ? 'on' : ''}`}>
              <input type="radio" name="output" checked={output === k.id} onChange={() => setOutput(k.id)} />
              <span><strong>{k.title}</strong><small>{k.line}</small></span>
            </label>
          ))}
        </fieldset>
      </section>
      <h2 className="pick">3. What files do you have?</h2>
      <div className="choices">
        {cards.map((w) => (
          <button key={w.id} className="choice" onClick={() => go(w.id)}>
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
