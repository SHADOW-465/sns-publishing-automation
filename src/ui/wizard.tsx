import { useState, type ReactNode } from 'react'
import type { CheckReport, Finding } from '../engine/check/epub.ts'
import type { ReviewItem, Section } from '../engine/epub/package.ts'
import { text, type Files } from '../engine/zip.ts'
import { Preview } from './Preview.tsx'
import { download } from './shared.tsx'

// Building blocks of the step-by-step screens: the step bar, inline help, the book outline and
// the quality report. Plain words first; the technical term in brackets where it helps.

export interface Step {
  title: string
  hint: string
  enabled: boolean
  done: boolean
}

export function Steps({ steps, at, onGo }: { steps: Step[]; at: number; onGo: (i: number) => void }) {
  return (
    <ol className="steps" aria-label="Steps">
      {steps.map((s, i) => (
        <li key={s.title} className={`${i === at ? 'on' : ''} ${s.done ? 'done' : ''}`}>
          <button disabled={!s.enabled} onClick={() => onGo(i)} aria-current={i === at ? 'step' : undefined}>
            <span className="n" aria-hidden="true">{s.done && i !== at ? '✓' : i + 1}</span>
            <span>
              <strong>{s.title}</strong>
              <small>{s.hint}</small>
            </span>
          </button>
        </li>
      ))}
    </ol>
  )
}

export function StepNav({ onBack, onNext, next = 'Next', nextDisabled, children }: { onBack?: () => void; onNext?: () => void; next?: string; nextDisabled?: boolean; children?: ReactNode }) {
  return (
    <div className="stepnav">
      {onBack ? <button onClick={onBack}>← Back</button> : <span />}
      <span className="muted small">{children}</span>
      {onNext && (
        <button className="primary" onClick={onNext} disabled={nextDisabled}>
          {next} →
        </button>
      )}
    </div>
  )
}

/** "What is this?" — a short explanation that stays out of the way until asked for. */
export function Help({ title = 'What is this?', children }: { title?: string; children: ReactNode }) {
  return (
    <details className="help">
      <summary>{title}</summary>
      <div>{children}</div>
    </details>
  )
}

export function Status({ busy, error, notice }: { busy?: string; error?: string; notice?: string }) {
  return (
    <>
      {busy && (
        <p className="busy" role="status">
          <span className="spinner" aria-hidden="true" /> {busy}
        </p>
      )}
      {error && (
        <p className="err box" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="note">{notice}</p>}
    </>
  )
}

// ---------------------------------------------------------------------------------------------
// book outline: what the reader will get, in order
// ---------------------------------------------------------------------------------------------

const KIND: Record<string, string> = {
  cover: 'Cover', halftitle: 'Half title', title: 'Title page', copyright: 'Copyright page', dedication: 'Dedication', epigraph: 'Epigraph',
  toc: 'Contents', list: 'List', introduction: 'Introduction', preface: 'Preface', foreword: 'Foreword', prologue: 'Prologue', part: 'Part',
  chapter: 'Chapter', conclusion: 'Conclusion', epilogue: 'Epilogue', afterword: 'Afterword', glossary: 'Glossary', appendix: 'Appendix',
  bibliography: 'Bibliography', notes: 'Notes', index: 'Index', about: 'About the author', contributors: 'Contributors', acknowledgments: 'Acknowledgements',
  other: 'Other',
}

export function Outline({ sections, files, base = 'OEBPS/', onType }: { sections: Pick<Section, 'file' | 'type' | 'nav'>[]; files: Files; base?: string; onType?: (index: number, type: string) => void }) {
  const [open, setOpen] = useState(sections.find((s) => s.type === 'chapter')?.file ?? sections[0]?.file)
  const info = (s: Pick<Section, 'file'>) => {
    const html = text(files.get(base + s.file) ?? new Uint8Array())
    const pages = [...html.matchAll(/id="page-([^"]+)"/g)].map((m) => m[1])
    const words = html.replace(/<[^>]+>/g, ' ').split(/\s+/).filter((w) => /\p{L}/u.test(w)).length
    return { pages, words, notes: (html.match(/doc-noteref/g) ?? []).length, imgs: (html.match(/<img /g) ?? []).length }
  }
  return (
    <div className="preview-grid">
      <nav aria-label="Book outline">
        <ol>
          {sections.map((s, idx) => {
            const i = info(s)
            const tiny = s.type === 'chapter' && i.words < 40
            return (
              <li key={s.file}>
                {onType && (
                  <select className="kindsel" aria-label={`Type of “${s.nav || s.file}”`} value={s.type} onChange={(e) => onType(idx, e.target.value)}>
                    {Object.entries(KIND).filter(([k]) => k !== 'cover').map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                )}
                <button className={open === s.file ? 'on' : ''} onClick={() => setOpen(s.file)}>
                  {!onType && <span className={`kind k-${s.type}`}>{KIND[s.type] ?? s.type}</span>} {s.nav || <em className="muted">(no title)</em>}
                  <small>
                    {i.pages.length ? `p. ${i.pages[0]}${i.pages.length > 1 ? `–${i.pages[i.pages.length - 1]}` : ''} · ` : ''}
                    {i.words.toLocaleString()} words{i.imgs ? ` · ${i.imgs} picture${i.imgs > 1 ? 's' : ''}` : ''}{i.notes ? ` · ${i.notes} notes` : ''}
                    {tiny && <span className="flag">very short</span>}
                  </small>
                </button>
              </li>
            )
          })}
        </ol>
      </nav>
      <Preview files={files} file={open} base={base} />
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// quality report
// ---------------------------------------------------------------------------------------------

const ICON: Record<Finding['level'], string> = { error: '✕', warn: '!', pass: '✓' }
const WORD: Record<Finding['level'], string> = { error: 'Must fix', warn: 'Check', pass: 'OK' }

export function CheckReportView({ report, review = [] }: { report: CheckReport; review?: ReviewItem[] }) {
  const buildErr = review.filter((r) => r.level === 'error')
  const buildWarn = review.filter((r) => r.level === 'warn')
  const done = review.filter((r) => r.level === 'info')
  const errors = report.errors + buildErr.length
  const warnings = report.warnings + buildWarn.length
  return (
    <div className="report">
      <div className={`verdict ${errors ? 'bad' : warnings ? 'meh' : 'good'}`} role="status">
        <strong>{errors ? `${errors} problem${errors > 1 ? 's' : ''} to fix before delivery` : warnings ? 'Ready — with a few things to look at' : 'Ready to deliver'}</strong>
        <span>
          {report.stats.documents} files · {report.stats.words.toLocaleString()} words · {report.stats.pages} page markers · {report.stats.images} pictures
          {report.stats.notes ? ` · ${report.stats.notes} note links` : ''}
        </span>
      </div>
      {(buildErr.length > 0 || buildWarn.length > 0) && (
        <section className="group">
          <h3>From the conversion</h3>
          <ul className="findings">
            {[...buildErr, ...buildWarn].map((r, i) => (
              <li key={i} className={r.level === 'error' ? 'error' : 'warn'}>
                <span className="ic" aria-hidden="true">{r.level === 'error' ? '✕' : '!'}</span>
                <span className="lvl">{r.level === 'error' ? 'Must fix' : 'Check'}</span> {r.msg} {r.where && <code>{r.where}</code>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {report.groups.map((g) => {
        const bad = g.findings.filter((f) => f.level === 'error').length
        const meh = g.findings.filter((f) => f.level === 'warn').length
        return (
          <details key={g.id} className="group" open={bad + meh > 0}>
            <summary>
              <span className={`badge ${bad ? 'bad' : meh ? 'meh' : 'good'}`}>{bad ? `${bad} to fix` : meh ? `${meh} to check` : 'passed'}</span>
              <strong>{g.title}</strong> <span className="muted small">— {g.explain}</span>
            </summary>
            <ul className="findings">
              {[...g.findings].sort((a, b) => order(a) - order(b)).map((f, i) => (
                <li key={i} className={f.level}>
                  <span className="ic" aria-hidden="true">{ICON[f.level]}</span>
                  <span className="lvl">{WORD[f.level]}</span> {f.msg} {f.where && <code>{f.where}</code>}
                </li>
              ))}
            </ul>
          </details>
        )
      })}
      {done.length > 0 && (
        <details className="group">
          <summary>
            <span className="badge info">{done.length}</span>
            <strong>Changes made automatically</strong> <span className="muted small">— what the tool fixed or removed, for your records</span>
          </summary>
          <ul className="findings">
            {done.map((r, i) => (
              <li key={i} className="pass">
                <span className="ic" aria-hidden="true">✓</span> {r.msg} {r.where && <code>{r.where}</code>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
const order = (f: Finding) => (f.level === 'error' ? 0 : f.level === 'warn' ? 1 : 2)

/** Download with a safety catch: files with problems need a second, deliberate click. */
export function DeliverButton({ data, name, type, errors, label }: { data: Uint8Array; name: string; type: string; errors: number; label: string }) {
  const [sure, setSure] = useState(false)
  if (!errors || sure)
    return (
      <button className="primary big" onClick={() => download(data, name, type)}>
        ⬇ {label}
      </button>
    )
  return (
    <span className="row" style={{ marginTop: 0 }}>
      <button className="primary big" disabled>
        ⬇ {label}
      </button>
      <button className="link" onClick={() => setSure(true)}>
        Fix the problems first — or download anyway for testing
      </button>
    </span>
  )
}
