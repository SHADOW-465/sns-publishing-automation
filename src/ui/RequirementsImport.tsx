import { useState } from 'react'
import { RULES, ruleById, show, coerce, type RuleValue } from '../engine/spec/rules.ts'
import { readRequirements, matchByKeywords, waiverNeeded, type Requirement, type Suggestion } from '../engine/spec/requirements.ts'
import { matchWithAi, aiConfig } from '../engine/spec/ai.ts'
import { writeXlsx } from '../engine/spec/office.ts'
import type { Level } from '../engine/spec/layers.ts'
import { download } from './shared.tsx'
import { Help } from './wizard.tsx'

// A client's requirement file → rule changes, confirmed row by row. Our own spec workbook imports
// exactly; Word, Excel, CSV or text files are matched by keywords, or by AI (Groq) on request.
// Requirements that match nothing are "open questions", downloadable to send back to the client.

type Row = Suggestion & { apply: boolean }

export function RequirementsImport({ levels, onApply }: { levels: { level: Level; label: string }[]; onApply: (level: Level, rows: { ruleId: string; value: RuleValue; req: Requirement; by: Suggestion['by']; file: string }[]) => Promise<void> }) {
  const [file, setFile] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [items, setItems] = useState<Requirement[]>([])
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [level, setLevel] = useState<Level>(levels[levels.length - 1]?.level ?? 'book')
  const ai = aiConfig()

  const load = async (f?: File) => {
    if (!f) return
    setMsg('')
    try {
      const { template, items } = readRequirements(f.name, new Uint8Array(await f.arrayBuffer()))
      setFile(f.name)
      setItems(items)
      const s = template ?? matchByKeywords(items)
      setRows(s.map((x) => ({ ...x, apply: !!x.ruleId && x.value !== undefined && x.confidence >= 0.5 && !waiverNeeded(x) })))
      setMsg(template ? `Read the spec workbook: ${s.length} rules.` : `Read ${items.length} requirements; ${s.filter((x) => x.ruleId).length} matched a rule by their words. Check each one.`)
    } catch (e) {
      setMsg((e as Error).message)
    }
  }
  const askAi = async () => {
    setBusy('Asking the AI to match the requirements…')
    try {
      const s = await matchWithAi(items, ai)
      setRows(s.map((x) => ({ ...x, apply: !!x.ruleId && x.value !== undefined && x.confidence >= 0.6 && !waiverNeeded(x) })))
      setMsg(`AI matched ${s.filter((x) => x.ruleId).length} of ${s.length}. Check each one before applying.`)
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy('')
    }
  }
  const set = (i: number, patch: Partial<Row>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)))
  const questions = rows.filter((r) => !r.ruleId)
  const chosen = rows.filter((r) => r.apply && r.ruleId && r.value !== undefined)

  return (
    <section className="card">
      <h2>Client requirements file</h2>
      <p className="muted">
        When the client sends requirements in Word or Excel, load the file here. Each requirement is matched to a rule; you confirm it, and it becomes part of the
        spec with the file name and row recorded. The spec workbook downloaded from this page comes back exactly.
      </p>
      <div className="row">
        <label className="button">
          Load a requirements file
          <input type="file" accept=".docx,.xlsx,.csv,.tsv,.txt,.md" hidden onChange={(e) => load(e.target.files?.[0])} />
        </label>
        {items.length > 0 && rows.every((r) => r.by !== 'template') && (
          <button onClick={askAi} disabled={!!busy || !ai.apiKey} title={ai.apiKey ? `Sends the requirement text to Groq (${ai.model})` : 'Add a Groq API key in Settings → AI'}>
            {busy ? busy : 'Match with AI'}
          </button>
        )}
        {msg && <span className="note small">{msg}</span>}
      </div>
      {!ai.apiKey && items.length > 0 && <p className="muted small">AI matching is off: add a free Groq API key in Settings → AI to use it.</p>}
      {rows.length > 0 && (
        <>
          <div className="table-wrap">
            <table className="styles req">
              <thead>
                <tr>
                  <th>Apply</th>
                  <th>Requirement</th>
                  <th>Rule</th>
                  <th>Value</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const rule = r.ruleId ? ruleById.get(r.ruleId) : undefined
                  const waiver = waiverNeeded(r)
                  return (
                    <tr key={i} className={!r.ruleId ? 'unsure' : ''}>
                      <td>
                        <input type="checkbox" aria-label="Apply this requirement" checked={r.apply} disabled={!rule || r.value === undefined || rule.kind === 'locked'} onChange={(e) => set(i, { apply: e.target.checked })} />
                      </td>
                      <td className="sample">
                        {r.req.text}
                        <div className="why">{r.req.where}</div>
                      </td>
                      <td>
                        <select value={r.ruleId ?? ''} onChange={(e) => set(i, { ruleId: e.target.value || undefined, value: undefined, apply: false })}>
                          <option value="">No rule (open question)</option>
                          {RULES.map((x) => (
                            <option key={x.id} value={x.id}>{x.id} {x.title}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        {rule && rule.key && rule.kind !== 'locked' ? (
                          rule.choices || rule.type === 'bool' ? (
                            <select value={r.value === undefined ? '' : String(r.value)} onChange={(e) => set(i, { value: e.target.value === '' ? undefined : coerce(rule, e.target.value) })}>
                              <option value="">choose…</option>
                              {(rule.type === 'bool' ? [['true', 'Yes'], ['false', 'No']] : rule.choices!).map(([v, l]) => (
                                <option key={v} value={v}>{l}</option>
                              ))}
                            </select>
                          ) : (
                            <input className="cls" value={r.value === undefined ? '' : show(rule, r.value)} onChange={(e) => set(i, { value: coerce(rule, e.target.value) })} />
                          )
                        ) : (
                          <span className="muted small">{rule ? 'fixed — already done' : '—'}</span>
                        )}
                        {waiver && <div className="warn-text small">Needs the accessibility waiver in the spec after applying.</div>}
                      </td>
                      <td className="why">
                        {r.by === 'ai' ? 'AI: ' : r.by === 'template' ? '' : 'Keywords: '}
                        {r.reason}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="row">
            <label className="small">
              Apply to{' '}
              <select value={level} onChange={(e) => setLevel(e.target.value as Level)}>
                {levels.map((l) => (
                  <option key={l.level} value={l.level}>{l.label}</option>
                ))}
              </select>
            </label>
            <button
              className="primary"
              disabled={!chosen.length || !!busy}
              onClick={async () => {
                await onApply(level, chosen.map((r) => ({ ruleId: r.ruleId!, value: r.value!, req: r.req, by: r.by, file })))
                setMsg(`Applied ${chosen.length} requirement(s).`)
                setRows(rows.map((r) => ({ ...r, apply: false })))
              }}
            >
              Apply {chosen.length} to the spec
            </button>
            {questions.length > 0 && (
              <button
                onClick={() =>
                  download(
                    writeXlsx([{ name: 'Open questions', rows: [['Requirement', 'Where', 'Answer: which rule (see the spec workbook) and which value'], ...questions.map((q) => [q.req.text, q.req.where, ''])], widths: [80, 20, 50] }]),
                    `open-questions-${file.replace(/\.\w+$/, '')}.xlsx`,
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                  )
                }
              >
                Download {questions.length} open question(s)
              </button>
            )}
          </div>
        </>
      )}
      <Help title="What happens to requirements that match no rule?">
        They are open questions: either the client must say more precisely what he wants, or it is a new kind of rule. Download them and send them back; a new kind of
        rule is added to the tool with its own ID, so it is never handled as a one-off again.
      </Help>
    </section>
  )
}
