import { useState } from 'react'
import { IndesignFlow } from './ui/IndesignFlow.tsx'
import { PdfFlow } from './ui/PdfFlow.tsx'
import { PdfUaFlow } from './ui/PdfUaFlow.tsx'
import { CheckFlow } from './ui/CheckFlow.tsx'

const WORKFLOWS = [
  {
    id: 'indd',
    label: 'InDesign → EPUB',
    start: 'I have the InDesign EPUB export',
    what: 'Cleans up InDesign’s EPUB export and turns it into a finished, accessible e-book.',
    needs: 'InDesign EPUB export · cover image · print PDF (recommended)',
    gives: 'EPUB 3 ready for the stores',
  },
  {
    id: 'word',
    label: 'PDF / Word → EPUB',
    start: 'I only have the print PDF (or Word)',
    what: 'Rebuilds the e-book from the final print PDF when there is no InDesign file.',
    needs: 'print PDF · cover image or cover PDF',
    gives: 'EPUB 3 ready for the stores',
  },
  {
    id: 'pdfua',
    label: 'Accessible PDF',
    start: 'I need an accessible PDF',
    what: 'Tags the print PDF so screen readers can read it in order (PDF/UA).',
    needs: 'print PDF · optional cover, extra PDFs, Word file with picture descriptions',
    gives: 'PDF/UA file, to confirm with PAC',
  },
  {
    id: 'check',
    label: 'Check an EPUB',
    start: 'I want to check an e-book',
    what: 'Checks any EPUB — made here or by a supplier — before it goes out.',
    needs: 'EPUB · print PDF (optional)',
    gives: 'quality report',
  },
] as const
type Tab = 'home' | (typeof WORKFLOWS)[number]['id']

export function App() {
  const [tab, setTab] = useState<Tab>('home')
  return (
    <div className="app">
      <header className="top">
        <button className="brand" onClick={() => setTab('home')}>
          <h1>Publishing Automation</h1>
          <span className="muted small">print book → accessible e-book</span>
        </button>
        <nav className="tabs" aria-label="Workflow">
          <button className={tab === 'home' ? 'tab on' : 'tab'} onClick={() => setTab('home')} aria-pressed={tab === 'home'}>
            Start
          </button>
          {WORKFLOWS.map((w) => (
            <button key={w.id} className={tab === w.id ? 'tab on' : 'tab'} onClick={() => setTab(w.id)} aria-pressed={tab === w.id}>
              {w.label}
            </button>
          ))}
        </nav>
      </header>
      <main>
        {/* flows stay mounted so switching tabs does not lose work */}
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
      </main>
      <footer className="foot muted small">Everything runs in this browser — files never leave this computer.</footer>
    </div>
  )
}

function Home({ onPick }: { onPick: (t: Tab) => void }) {
  return (
    <div className="flow">
      <section className="card intro">
        <h2>What this tool does</h2>
        <p>
          Every printed book also has to be sold as an <strong>e-book</strong>, and more and more as an <strong>accessible</strong> one. Blind and partially sighted
          readers use screen readers that read the book aloud. That only works when the file has real headings, a clickable contents list, the printed page numbers,
          descriptions of the pictures, and the right language and title. In the EU this is required by law for new e-books since June 2025 (European Accessibility
          Act), and stores check it.
        </p>
        <p>
          Typesetting programs do not produce such files on their own. InDesign’s export, for example, leaves file names as titles, broken contents links, needless
          bold and italic, missing page numbers and pictures without descriptions — which people used to fix by hand, book by book. This tool does that work
          automatically and shows you the result to review before anything is delivered.
        </p>
        <ol className="how">
          <li><strong>Add the files</strong> you have for the book.</li>
          <li><strong>Review</strong> what the tool found: book details, the structure of the book, picture descriptions. Anything it is unsure about is marked.</li>
          <li><strong>Check and download</strong>: a built-in quality check (the same kinds of rules as the stores’ validators) says whether the file is ready.</li>
        </ol>
      </section>
      <h2 className="pick">What do you have?</h2>
      <div className="choices">
        {WORKFLOWS.map((w) => (
          <button key={w.id} className="choice" onClick={() => onPick(w.id)}>
            <strong>{w.start}</strong>
            <span>{w.what}</span>
            <small>
              <b>You need:</b> {w.needs}
            </small>
            <small>
              <b>You get:</b> {w.gives}
            </small>
          </button>
        ))}
      </div>
    </div>
  )
}
