import { useEffect, useState } from 'react'
import { download } from './shared.tsx'
import { Icon } from './icons.tsx'
import { actorName } from './SpecStep.tsx'
import { gateGuards, gateReport, mayExport, MIN_REASON, overrideGate, type ExportGate, type GateOverride } from '../engine/check/exportgate.ts'

// The only way a finished file leaves the screen (VAL-001, VAL-004). The checks have already run: while one "fix" problem
// remains the download is off, the list is shown, and the one way past is a typed reason, which is written to the decision
// log and into the report that goes with the file. A "check" item never blocks.

export function GatedDownload({ gate, data, name, type, label, ctx }: {
  /** undefined while the checks are still running */
  gate: ExportGate | undefined
  data: Uint8Array
  name: string
  type: string
  label: string
  ctx: { client: string; book: string; specHash?: string }
}) {
  const [actor, setActor] = useState(actorName())
  const [reason, setReason] = useState('')
  const [override, setOverride] = useState<GateOverride>()
  const [err, setErr] = useState('')
  useEffect(() => { setOverride(undefined); setErr('') }, [gate]) // a new check starts again: an old override does not carry over

  if (!gate) return <span className="muted small">Every check runs on the file before it can be downloaded. Build and check it to enable the download.</span>
  const ok = mayExport(gate, override)
  const reportName = name.replace(/\.[^.]+$/, '') + '.report.md'
  const report = () => download(gateReport(gate, override, name), reportName, 'text/markdown')
  const record = async () => {
    setErr('')
    try {
      setOverride(await overrideGate(gate, { actor, reason, client: ctx.client, book: ctx.book, specHash: ctx.specHash }))
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  return (
    <div className="stack">
      {gate.blocked && !override && (
        <div className="box err" role="alert">
          <strong>{gateGuards(gate)[0].msg.replace(/^VAL-001: /, '')}</strong>
          <ul>
            {gate.fixes.slice(0, 12).map((f, i) => <li key={i}><strong>{f.source}:</strong> {f.msg}{f.where ? <> <code>{f.where}</code></> : null}</li>)}
          </ul>
          {gate.fixes.length > 12 && <p className="muted small">…and {gate.fixes.length - 12} more. They are all in the report.</p>}
        </div>
      )}
      {gate.skipped.length > 0 && <p className="note warnbox small">{gate.skipped.join(' ')}</p>}
      <span className="row" style={{ marginTop: 0 }}>
        <button className="primary big" disabled={!ok} onClick={() => download(data, name, type)} title={ok ? '' : 'Fix the problems above, or export with a reason'}>
          <Icon name="download" size={17} /> {label}
        </button>
        <button onClick={report}>Download the check report</button>
        {ok && gate.blocked && <span className="err small">Overridden by {override!.actor}: the reason is in the log and in the report.</span>}
        {!gate.blocked && <span className="muted small">{gate.checks.length ? `${gate.checks.length} to check, none blocking.` : 'Nothing to fix or check.'}</span>}
      </span>
      {gate.blocked && !override && (
        <details className="advanced">
          <summary>Export anyway, with a reason</summary>
          <p className="muted small">The file is not ready to publish. If it must go out now, say why. Your name and the reason are written to the decision log and into the report.</p>
          <div className="form">
            <label><span>Your name</span><input value={actor} onChange={(e) => setActor(e.target.value)} /></label>
            <label><span>Reason (at least {MIN_REASON} characters)</span><textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
          </div>
          {err && <p className="err small" role="alert">{err}</p>}
          <button onClick={record} disabled={!actor.trim() || reason.trim().length < MIN_REASON}>Record the override</button>
        </details>
      )}
    </div>
  )
}
