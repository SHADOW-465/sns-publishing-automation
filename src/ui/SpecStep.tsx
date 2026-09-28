import { useEffect, useState } from 'react'
import { RuleList } from './SpecEditor.tsx'
import { RequirementsImport } from './RequirementsImport.tsx'
import { Help } from './wizard.tsx'
import { download } from './shared.tsx'
import { openSpec, setRule, giveWaiver, decide, type Spec, type SpecContext } from '../engine/spec/session.ts'
import { LEVEL_LABEL, type Level } from '../engine/spec/layers.ts'
import { specWorkbook } from '../engine/spec/requirements.ts'
import { store, type Decision } from '../engine/spec/store.ts'
import { specHash } from '../engine/spec/layers.ts'

// The client's own step: he sets how his e-books are made — every rule, with an example of what it
// produces — and accepts the spec (or continues without accepting). Either way the decision, the
// full spec and any accessibility waivers are recorded with his name and the time.

const NAME_KEY = 'automation:actor'
export const actorName = () => {
  try {
    return localStorage.getItem(NAME_KEY) ?? ''
  } catch {
    return ''
  }
}

export function SpecStep({ ctx, spec, onSpec, onDecided, onBack }: { ctx: SpecContext; spec?: Spec; onSpec: (s: Spec) => void; onDecided: (d: Decision) => void; onBack: () => void }) {
  const [actor, setActor] = useState(actorName())
  const [series, setSeries] = useState(ctx.series)
  const [level, setLevel] = useState<Level>('client')
  const [filter, setFilter] = useState('')
  const [err, setErr] = useState('')
  const [log, setLog] = useState<Decision[]>([])

  useEffect(() => {
    if (!spec || spec.ctx.client !== ctx.client || spec.ctx.book !== ctx.book || spec.ctx.series !== series) openSpec({ ...ctx, series }).then(onSpec)
  }, [ctx.client, ctx.book, series]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    store().listDecisions({ client: ctx.client, book: ctx.book }).then(setLog)
  }, [spec, ctx.client, ctx.book])

  const saveName = (v: string) => {
    setActor(v)
    try {
      localStorage.setItem(NAME_KEY, v)
    } catch {
      /* not remembered */
    }
  }
  const guard = async (fn: () => Promise<void>) => {
    setErr('')
    try {
      await fn()
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  if (!spec) return <section className="card"><p className="muted">Loading the spec…</p></section>

  const active = spec.layers.some((l) => l.level === level) ? level : (spec.layers[0]?.level ?? 'book')
  const layer = spec.layers.find((l) => l.level === active)
  const levels = spec.layers.map((l) => ({ level: l.level, label: `${LEVEL_LABEL[l.level]} (${l.name})` }))
  const own = (lv: Level) => Object.keys(spec.layers.find((l) => l.level === lv)?.values ?? {}).length
  const pending = spec.resolved.pendingWaivers
  const last = log.find((d) => d.action === 'accepted' || d.action === 'proceeded')
  const current = specHash(spec.resolved.settings)

  return (
    <>
      <section className="card">
        <h2>3. House style of this e-book</h2>
        <p className="muted">
          Every rule the e-book follows, in one place. Set them the way you want your books: your choices are saved for all books of <strong>{ctx.client || 'this publisher'}</strong>,
          or for this book only. Each rule shows an example of what it produces. When everything is as you want it, accept the spec: the book is built with exactly
          these rules, and the accepted spec is kept on record.
        </p>
        <div className="form">
          <label>
            <span>Your name</span>
            <input value={actor} placeholder="Recorded with your decisions" onChange={(e) => saveName(e.target.value)} />
          </label>
          <label>
            <span>Series or imprint (optional)</span>
            <input value={series} placeholder="Only if a series is set differently" onChange={(e) => setSeries(e.target.value)} />
          </label>
          <label>
            <span>Find a rule</span>
            <input value={filter} placeholder="e.g. table, footnote, font size" onChange={(e) => setFilter(e.target.value)} />
          </label>
        </div>
        <div className="row" role="tablist" aria-label="Which books the changes apply to">
          {spec.layers.map((l) => (
            <button key={l.level} role="tab" aria-selected={active === l.level} className={active === l.level ? 'chip on' : 'chip'} onClick={() => setLevel(l.level)}>
              {l.level === 'client' ? `All books of ${l.name}` : l.level === 'series' ? `Series: ${l.name}` : 'This book only'} ({own(l.level)})
            </button>
          ))}
        </div>
        {err && <p className="err small">{err}</p>}
        {pending.length > 0 && (
          <p className="note warnbox">
            {pending.length} accessibility change(s) wait for the waiver box to be ticked: {pending.map((p) => p.ruleId).join(', ')}. Until then the accessible value is used.
          </p>
        )}
        <RuleList
          resolved={spec.resolved}
          layer={layer}
          filter={filter}
          onSet={(r, v) => guard(async () => onSpec(await setRule(spec, active, r.id, v, actor)))}
          onWaiver={(r) => guard(async () => onSpec(await giveWaiver(spec, pending.find((p) => p.ruleId === r.id)?.level ?? active, r.id, actor)))}
        />
        <div className="row">
          <button
            onClick={() =>
              download(
                specWorkbook({ client: ctx.client, book: ctx.book, resolved: spec.resolved, decisions: log }),
                `spec-${(ctx.client || 'client').replace(/\W+/g, '-')}-${ctx.book.replace(/\W+/g, '-')}.xlsx`,
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              )
            }
          >
            Download the spec (Excel)
          </button>
        </div>
        <Help title="Which value wins?">
          This book’s own choices win over the series, the series over your publisher’s style, and your style over the house defaults. Rules marked “fixed” are
          needed for a valid e-book and cannot change. Rules marked “accessibility” can change only after you tick “{'Yes, I know this reduces accessibility, do it anyway.'}”;
          your name and the time are recorded.
        </Help>
      </section>

      <RequirementsImport
        levels={levels}
        onApply={async (lv, rows) => {
          let s = spec
          for (const r of rows) s = await setRule(s, lv, r.ruleId, r.value, actor, { file: r.file, where: r.req.where, text: r.req.text, by: r.by })
          onSpec(s)
        }}
      />

      <section className="card">
        <h2>Accept the spec</h2>
        {last && (
          <p className="muted small">
            Last decision: <strong>{last.action === 'accepted' ? 'accepted' : 'continued without accepting'}</strong> by {last.actor} on {new Date(last.at).toLocaleString()}
            {last.specHash !== current ? ' — the rules changed since then.' : '.'}
          </p>
        )}
        <div className="stepnav">
          <button className="ghost" onClick={onBack}>Back</button>
          <span className="muted small">Spec {current}</span>
          <span className="row" style={{ marginTop: 0 }}>
            <button onClick={() => guard(async () => onDecided(await decide(spec, actor, false)))} disabled={!actor.trim()} title={actor.trim() ? '' : 'Type your name first'}>
              Continue without accepting
            </button>
            <button className="primary" onClick={() => guard(async () => onDecided(await decide(spec, actor, true)))} disabled={!actor.trim()} title={actor.trim() ? '' : 'Type your name first'}>
              Accept this spec and continue
            </button>
          </span>
        </div>
        {!actor.trim() && <p className="err small">Type your name at the top: it is recorded with the decision.</p>}
        {log.length > 0 && (
          <details className="advanced">
            <summary>Record of decisions for this book ({log.length})</summary>
            <ul className="log">
              {log.slice(0, 40).map((d) => (
                <li key={d.id}>
                  <span className="muted small">{new Date(d.at).toLocaleString()} · {d.actor} · {d.action}</span> {d.detail}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </>
  )
}
