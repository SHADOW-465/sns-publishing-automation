import { useState } from 'react'
import { RULES, GROUPS, show, needsWaiver, houseDefault, WAIVER_TEXT, type Rule, type RuleValue } from '../engine/spec/rules.ts'
import { LEVEL_LABEL, type Level, type Resolved, type Layer } from '../engine/spec/layers.ts'
import type { HouseSettings } from '../engine/settings.ts'

// Every rule of the registry, grouped, with its value, who set it, an example of the markup it
// produces, and — for accessibility rules — the waiver box that must be ticked before a change applies.
// Used by the Spec step (client / series / book layers) and by Settings (house defaults).

const KIND_LABEL = { locked: 'fixed', advisory: 'accessibility', free: 'your choice' } as const

export interface RuleListProps {
  resolved: Resolved
  /** layer being edited; undefined = house settings (Settings screen) */
  layer?: Layer
  /** set or clear (undefined) a value on the edited layer */
  onSet: (r: Rule, v: RuleValue | undefined) => void
  onWaiver?: (r: Rule) => void
  /** only these groups (all when omitted) */
  groups?: readonly string[]
  filter?: string
}

export function RuleList({ resolved, layer, onSet, onWaiver, groups = GROUPS, filter = '' }: RuleListProps) {
  const q = filter.trim().toLowerCase()
  return (
    <div className="rules">
      {groups.map((g) => {
        const rules = RULES.filter((r) => r.group === g && (!q || `${r.id} ${r.title} ${r.help} ${r.keywords.join(' ')}`.toLowerCase().includes(q)))
        if (!rules.length) return null
        return (
          <fieldset key={g} className="rule-group">
            <legend>{g}</legend>
            {rules.map((r) => (
              <RuleRow key={r.id} r={r} resolved={resolved} layer={layer} onSet={onSet} onWaiver={onWaiver} />
            ))}
          </fieldset>
        )
      })}
    </div>
  )
}

function RuleRow({ r, resolved, layer, onSet, onWaiver }: { r: Rule } & Omit<RuleListProps, 'groups' | 'filter'>) {
  const value = r.key ? (resolved.settings[r.key as keyof HouseSettings] as RuleValue) : undefined
  const own = layer && Object.prototype.hasOwnProperty.call(layer.values, r.id) ? layer.values[r.id] : undefined
  const pending = resolved.pendingWaivers.find((p) => p.ruleId === r.id && (!layer || p.level === layer.level))
  const shown = pending ? pending.value : value
  const from = resolved.from[r.id]
  const locked = r.kind === 'locked' || !r.key
  const [open, setOpen] = useState(false)
  const fromText = from ? (from.level === 'default' ? 'built-in default' : `${LEVEL_LABEL[from.level]}${from.name ? ` · ${from.name}` : ''}`) : ''
  return (
    <div className={`rule ${pending ? 'needs' : ''} ${own !== undefined ? 'own' : ''}`}>
      <div className="rule-head">
        <code className="rule-id">{r.id}</code>
        <strong>{r.title}</strong>
        <span className={`kind ${r.kind}`}>{KIND_LABEL[r.kind]}</span>
      </div>
      <p className="muted small">{r.help}</p>
      {locked ? (
        <p className="small">Always applied.</p>
      ) : (
        <div className="rule-ctl">
          <Control r={r} value={shown} onChange={(v) => onSet(r, v)} />
          {layer && own !== undefined && (
            <button className="link" onClick={() => onSet(r, undefined)} title="Use the value from the client style or the house default">
              Reset
            </button>
          )}
          <span className="src">
            {pending ? `asked for by ${LEVEL_LABEL[pending.level]}, not applied until the box below is ticked` : `set by ${fromText}`}
            {from?.source && ` — ${from.source.file}, ${from.source.where}`}
            {from?.waiver && ` — waiver by ${from.waiver.by}, ${from.waiver.at.slice(0, 10)}`}
          </span>
        </div>
      )}
      {r.kind === 'advisory' && pending && onWaiver && (
        <label className="waiver">
          <input type="checkbox" onChange={(e) => e.target.checked && onWaiver(r)} /> <span>{WAIVER_TEXT}</span>
          <small>{r.id} would be {show(r, pending.value)} instead of {show(r, r.safe)}. Your name and the time are recorded.</small>
        </label>
      )}
      {r.kind === 'advisory' && !pending && needsWaiver(r, value) && <p className="small warn-text">Accessibility reduced with a recorded waiver.</p>}
      {r.example && r.key && (
        <>
          <button className="link small" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? 'Hide example' : 'Show example'}
          </button>
          {open && <pre className="example">{r.example(shown ?? houseDefault(r) ?? '')}</pre>}
        </>
      )}
    </div>
  )
}

function Control({ r, value, onChange }: { r: Rule; value: RuleValue | undefined; onChange: (v: RuleValue) => void }) {
  const id = `rule-${r.id}`
  switch (r.type) {
    case 'bool':
      return (
        <select id={id} value={value ? 'true' : 'false'} onChange={(e) => onChange(e.target.value === 'true')}>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      )
    case 'choice':
      return (
        <select id={id} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          {r.choices!.map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
      )
    case 'number':
      return (
        <span className="num-in">
          <input id={id} type="number" min={r.min} max={r.max} step={r.unit === 'px' ? 100 : r.unit === '%' ? 5 : 0.25} value={Number(value ?? 0)} onChange={(e) => e.target.value !== '' && onChange(Number(e.target.value))} />
          {r.unit}
        </span>
      )
    case 'multi': {
      const set = new Set((value as string[] | undefined) ?? [])
      return (
        <span className="multi">
          {r.choices!.map(([v, l]) => (
            <label key={v} className="small">
              <input type="checkbox" checked={set.has(v)} onChange={(e) => onChange(e.target.checked ? [...set, v] : [...set].filter((x) => x !== v))} /> {l}
            </label>
          ))}
        </span>
      )
    }
    case 'list':
      return <textarea id={id} className="big" rows={3} value={((value as string[] | undefined) ?? []).join('\n')} placeholder="One phrase per line" onChange={(e) => onChange(e.target.value.split('\n'))} />
    case 'css':
      return <textarea id={id} className="big mono" rows={4} value={String(value ?? '')} placeholder="Empty: built-in" onChange={(e) => onChange(e.target.value)} />
    default:
      return null
  }
}
