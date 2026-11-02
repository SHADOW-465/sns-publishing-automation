import { useMemo, useRef, useState } from 'react'
import type { Files } from '../engine/zip.ts'
import type { CheckReport } from '../engine/check/epub.ts'
import type { ReviewItem } from '../engine/epub/package.ts'
import type { ValidatorResult } from '../engine/check/gate.ts'
import type { DecisionNote } from '../engine/review/decisions.ts'
import { buildQc, stateOf, type QcItem, type QcSection } from '../engine/review/qc.ts'
import { Icon } from './icons.tsx'
import { Preview } from './Preview.tsx'

// The Review page: seven headings in the order a QC checker works through them. Each leads with Passed or the count that needs
// action, and lists only those items. "Show in preview" opens the file at the item's page marker. Nothing here edits the book.

const SHOWN = 25 // per sub-group; a book with 1,500 index links does not paint them all at once

export function ReviewBoard({ files, base = 'OEBPS/', report, review, ec, a11y, left }: {
  files: Files
  base?: string
  report: CheckReport
  review?: ReviewItem[]
  ec?: ValidatorResult | null
  a11y?: (ValidatorResult & { by: string }) | null
  left?: DecisionNote[]
}) {
  const sections = useMemo(() => buildQc({ files, base, report, review, ec, a11y, left }), [files, base, report, review, ec, a11y, left])
  const [at, setAt] = useState<QcItem>()
  const pane = useRef<HTMLElement>(null)
  const open = sections.reduce((n, s) => n + s.items.length + s.notRun.length, 0)
  const errors = sections.reduce((n, s) => n + s.errors, 0)
  const done = (review ?? []).filter((r) => r.level === 'info')
  const jump = (key: string) => {
    const h = document.getElementById(`qc-${key}`)
    h?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    h?.focus({ preventScroll: true })
  }
  const show = (i: QcItem) => {
    setAt(i)
    const r = pane.current?.getBoundingClientRect()
    if (r && (r.top < 0 || r.top > window.innerHeight * 0.6)) pane.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }
  return (
    <div className="qc">
      <div className={`verdict ${errors ? 'bad' : open ? 'meh' : 'good'}`} role="status">
        <strong>{errors ? `${errors} problem${errors > 1 ? 's' : ''} to fix before delivery` : open ? `Ready — ${open} thing${open > 1 ? 's' : ''} to look at` : 'Ready to deliver'}</strong>
        <span>
          {report.stats.documents} files · {report.stats.words.toLocaleString()} words · {report.stats.pages} page markers · {report.stats.images} pictures
          {report.stats.notes ? ` · ${report.stats.notes} note links` : ''}
        </span>
      </div>
      <nav aria-label="Review checks" className="qc-tabs">
        <ol>
          {sections.map((s) => {
            const st = stateOf(s)
            return (
              <li key={s.key}>
                <button onClick={() => jump(s.key)}>
                  <span className={`badge ${st.tone}`}>{st.label}</span>
                  <span>{s.title}</span>
                </button>
              </li>
            )
          })}
        </ol>
      </nav>
      <div className="qc-grid">
        <div className="qc-sections">
          {sections.map((s) => <Heading key={s.key} s={s} at={at} onShow={show} />)}
          {done.length > 0 && (
            <details className="group">
              <summary>
                <span className="badge info">{done.length}</span>
                <strong>Changes made automatically</strong> <span className="muted small">— what the tool fixed or removed, for your records</span>
              </summary>
              <ul className="findings">
                {done.map((r, i) => (
                  <li key={i} className="pass">
                    <span className="ic"><Icon name="check" size={15} /></span> {r.msg} {r.where && <code>{r.where}</code>}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
        <aside className="qc-pane" ref={pane} aria-label="Preview of the spot">
          <p className="small" role="status">
            {at?.file ? <>Showing <code>{at.file}</code>{at.page ? `, page ${at.page}` : ''}</> : <span className="muted">Choose “Show in preview” on an item to see its spot in the book.</span>}
          </p>
          {at?.file && <Preview files={files} base={base} file={at.file} anchor={at.anchor} />}
        </aside>
      </div>
    </div>
  )
}

function Heading({ s, at, onShow }: { s: QcSection; at?: QcItem; onShow: (i: QcItem) => void }) {
  const st = stateOf(s)
  const [all, setAll] = useState<Set<string>>(new Set())
  const kinds = useMemo(() => {
    const m = new Map<string, QcItem[]>()
    for (const i of s.items) m.set(i.kind, [...(m.get(i.kind) ?? []), i])
    return [...m]
  }, [s.items])
  return (
    <section className="group qc-heading" aria-labelledby={`qc-${s.key}`}>
      <h3 id={`qc-${s.key}`} tabIndex={-1}>
        <span className={`badge ${st.tone}`}>{st.label}</span> {s.title}
      </h3>
      {st.tone === 'good' && <p className="muted small">Nothing needs you here. Checked: {s.checks}.</p>}
      {s.notRun.map((m) => <p key={m} className="note warnbox small">{m}</p>)}
      {kinds.map(([kind, list]) => {
        const more = list.length > SHOWN && !all.has(kind)
        return (
          <div key={kind} className="qc-kind">
            <h4>{kind} <span className="muted small">({list.length})</span></h4>
            <ul className="findings qc-items">
              {(more ? list.slice(0, SHOWN) : list).map((i) => (
                <li key={i.id} className={`${i.level === 'error' ? 'error' : 'warn'}${at?.id === i.id ? ' on' : ''}`}>
                  <span className="ic"><Icon name={i.level === 'error' ? 'x' : 'alert'} size={15} /></span>
                  <span className="lvl">{i.level === 'error' ? 'Must fix' : 'Check'}</span>
                  <span>
                    {i.msg} {i.rule && <code>{i.rule}</code>}
                    <span className="qc-at small muted">
                      {i.file ? <>{i.file}{i.page ? ` · page ${i.page}` : ''} </> : <>{i.source} </>}
                      {i.file && (
                        <button className="chip" onClick={() => onShow(i)} aria-label={`Show in preview: ${i.msg.slice(0, 60)}`}>
                          Show in preview
                        </button>
                      )}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            {more && <button className="link" aria-expanded="false" onClick={() => setAll(new Set(all).add(kind))}>Show all {list.length}</button>}
          </div>
        )
      })}
    </section>
  )
}
