import { useEffect, useState } from 'react'
import { download } from './shared.tsx'
import { Icon } from './icons.tsx'
import { actorName } from './SpecStep.tsx'
import { NeedsDialog, highlightNeeds } from './NeedsDialog.ts'
import { reviewNotesName } from '../engine/review/decisions.ts'
import { continueAnyway, gateReport, mayExport, MIN_REASON, type ExportGate, type GateOverride } from '../engine/check/exportgate.ts'
import type { Need } from './needs.ts'

// The only way a finished file leaves the screen (VAL-001, VAL-004). The checks have already run. The download is never off:
// while one "fix" problem remains, Download opens three choices (Fix with AI, I'll fix it myself, Continue anyway). Continuing
// writes the open problems to the decision log and into the report and review notes that go with the file. A "check" item never asks.

export const GATE_TARGET = 'gate-problems'

export function GatedDownload({ gate, data, name, type, label, ctx, notes, onFix, busy }: {
  /** undefined while the checks are still running */
  gate: ExportGate | undefined
  data: Uint8Array
  name: string
  type: string
  label: string
  ctx: { client: string; book: string; specHash?: string }
  /** the review notes for this file (what the tool decided or left unsure); they are downloaded with the file and by their own button */
  notes?: (override?: GateOverride) => string
  /** "Fix with AI" for the problems the checks found: decide what can be decided, build and check again */
  onFix?: () => Promise<void> | void
  busy?: boolean
}) {
  const [actor, setActor] = useState(actorName())
  const [reason, setReason] = useState('')
  const [override, setOverride] = useState<GateOverride>()
  const [asking, setAsking] = useState(false)
  const [afterFix, setAfterFix] = useState(false)
  useEffect(() => { setOverride(undefined); setAsking(false) }, [gate]) // a new check starts again: an old override does not carry over
  // Fix with AI ends in a download: once the fixed file is built and checked again, it goes out, and whatever is still open
  // is written to the review notes as left unsure (Fix with AI never sends the person round in a loop)
  useEffect(() => {
    if (!afterFix || busy || !gate) return
    setAfterFix(false)
    void (async () => {
      const o = gate.blocked ? await continueAnyway(gate, { actor, reason: reason.trim().length >= MIN_REASON ? reason : 'Fix with AI: the tool fixed what it could; the problems still open are listed in the review notes.', client: ctx.client, book: ctx.book, specHash: ctx.specHash }) : undefined
      if (o) setOverride(o)
      out(o)
    })()
  }, [afterFix, busy, gate])

  if (!gate) return <span className="muted small">The checks run on the file before it is downloaded. Build and check it to download.</span>
  const open = gate.blocked && !override
  const reportName = name.replace(/\.[^.]+$/, '') + '.report.md'
  const notesName = reviewNotesName(name)
  const needs: Need[] = gate.fixes.slice(0, 12).map((f, i) => ({ id: `gate:${i}`, label: `${f.source}: ${f.msg}`, group: 'problem', kind: 'choice', target: GATE_TARGET, where: f.where }))
  const out = (o?: GateOverride) => {
    download(data, name, type)
    if (notes) setTimeout(() => download(notes(o), notesName, 'text/plain'), 400) // the notes ride along as a second file; the button beside Download gives them again
  }
  const proceed = async () => {
    setAsking(false)
    const o = gate.blocked ? override ?? (await continueAnyway(gate, { actor, reason, client: ctx.client, book: ctx.book, specHash: ctx.specHash })) : undefined
    if (o) setOverride(o)
    out(o)
  }
  const report = () => download(gateReport(gate, override, name), reportName, 'text/markdown')
  const fix = onFix ? () => { setAsking(false); void Promise.resolve(onFix()).finally(() => setAfterFix(true)) } : undefined
  const myself = () => highlightNeeds([{ id: 'gate', label: '', group: 'problem', kind: 'choice', target: GATE_TARGET }])
  return (
    <div className="stack">
      {open && (
        <div className="box err" role="alert" id={GATE_TARGET}>
          <strong>{gate.fixes.length} problem{gate.fixes.length === 1 ? '' : 's'} found. You can still download the file.</strong>
          <ul>
            {gate.fixes.slice(0, 12).map((f, i) => <li key={i}><strong>{f.source}:</strong> {f.msg}{f.where ? <> <code>{f.where}</code></> : null}</li>)}
          </ul>
          {gate.fixes.length > 12 && <p className="muted small">…and {gate.fixes.length - 12} more. They are all in the report.</p>}
          <div className="row">
            {fix && <button className="primary" onClick={fix} disabled={busy}>Fix with AI</button>}
            <button onClick={myself}>I’ll fix it myself</button>
            <button onClick={proceed}>Continue anyway</button>
          </div>
          <p className="muted small">Fix with AI decides what can be decided (picture descriptions, the tool’s best guesses) and checks the file again. Continue anyway downloads the file as it is and lists the open problems in the review notes.</p>
        </div>
      )}
      {gate.skipped.length > 0 && <p className="note warnbox small">{gate.skipped.join(' ')}</p>}
      <span className="row" style={{ marginTop: 0 }}>
        <button className="primary big" onClick={() => (open ? setAsking(true) : proceed())} disabled={busy} aria-haspopup={open ? 'dialog' : undefined}>
          <Icon name="download" size={17} /> {label}
        </button>
        {notes && <button onClick={() => download(notes(override), notesName, 'text/plain')} title="What the tool decided on its own and what it left unsure">Download the review notes</button>}
        <button onClick={report}>Download the check report</button>
        {mayExport(gate, override) && gate.blocked && <span className="err small">Downloaded anyway{override ? ` (${override.actor})` : ''}: the open problems are in the log, the report and the review notes.</span>}
        {!gate.blocked && <span className="muted small">{gate.checks.length ? `${gate.checks.length} to check, none blocking.` : 'Nothing to fix or check.'}</span>}
      </span>
      {open && (
        <details className="advanced">
          <summary>Add your name and a reason (optional)</summary>
          <p className="muted small">Not needed to download. If you add them, they are written to the decision log, the report and the review notes with “Continue anyway”.</p>
          <div className="form">
            <label><span>Your name</span><input value={actor} onChange={(e) => setActor(e.target.value)} /></label>
            <label><span>Reason (at least {MIN_REASON} characters, or leave empty)</span><textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
          </div>
        </details>
      )}
      {asking && open && (
        <NeedsDialog
          needs={needs}
          headline={`The checks found ${gate.fixes.length} problem${gate.fixes.length === 1 ? '' : 's'}. How do you want to go on?`}
          intro="You can still download the file. Nothing here stops you."
          onClose={() => setAsking(false)}
          onFix={fix}
          onMyself={myself}
          onContinueAnyway={proceed}
        />
      )}
    </div>
  )
}
