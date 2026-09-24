import { useState } from 'react'
import { IndesignFlow } from './ui/IndesignFlow.tsx'
import { PdfFlow } from './ui/PdfFlow.tsx'
import { PdfUaFlow } from './ui/PdfUaFlow.tsx'

const WORKFLOWS = [
  { id: 'indd', label: 'InDesign → EPUB', ready: true },
  { id: 'word', label: 'Word / PDF → EPUB', ready: true },
  { id: 'pdfua', label: 'Accessible PDF (PDF/UA)', ready: true },
] as const

export function App() {
  const [tab, setTab] = useState<(typeof WORKFLOWS)[number]['id']>('indd')
  return (
    <div className="app">
      <header className="top">
        <h1>Publishing Automation</h1>
        <nav className="tabs" aria-label="Workflow">
          {WORKFLOWS.map((w) => (
            <button key={w.id} className={tab === w.id ? 'tab on' : 'tab'} onClick={() => setTab(w.id)} aria-pressed={tab === w.id}>
              {w.label}
              {!w.ready && <span className="soon">next</span>}
            </button>
          ))}
        </nav>
      </header>
      <main>
        {tab === 'indd' ? (
          <IndesignFlow />
        ) : tab === 'word' ? (
          <PdfFlow />
        ) : (
          <PdfUaFlow />
        )}
      </main>
    </div>
  )
}
