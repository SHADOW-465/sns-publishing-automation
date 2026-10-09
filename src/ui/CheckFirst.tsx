import { useState } from 'react'
import { ROLES, ROLE_HELP, type Role, type StyleInfo } from '../engine/indesign/read.ts'
import { reviewList, rulesForTopic, type CheckItem, type ReviewInput } from '../engine/review/confidence.ts'
import type { Spec } from '../engine/spec/session.ts'
import type { Rule, RuleValue } from '../engine/spec/rules.ts'
import { KIND } from './wizard.tsx'

// "Check these first": what the tool decided by itself and was not sure of, lowest confidence first. Each line
// carries the control that changes it, and — for a part of the book — the house rules that shape it, as a
// drop-down that can apply to this book only or to every book of the publisher.

const valueOf = (spec: Spec | undefined, r: Rule) => String((spec?.resolved.settings as unknown as Record<string, unknown> | undefined)?.[r.key as string] ?? '')

function RuleSelect({ rule, spec, onRule }: { rule: Rule; spec?: Spec; onRule: (id: string, level: 'book' | 'client', v: RuleValue) => void }) {
  const [scope, setScope] = useState<'book' | 'client'>('book')
  if (!rule.choices?.length) return null
  const from = spec?.resolved.from[rule.id]
  return (
    <div className="row small">
      <label title={rule.help}>
        <strong>{rule.id}</strong> {rule.title}{' '}
        <select value={valueOf(spec, rule)} onChange={(e) => onRule(rule.id, scope, rule.type === 'bool' ? e.target.value === 'true' : e.target.value)} aria-label={`${rule.id} ${rule.title}`}>
          {rule.choices.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
      </label>
      <select value={scope} onChange={(e) => setScope(e.target.value as 'book' | 'client')} aria-label="Applies to">
        <option value="book">this book only</option>
        <option value="client" disabled={!spec?.layers.some((l) => l.level === 'client')}>every book of this publisher</option>
      </select>
      <span className="muted">{from && from.level !== 'default' ? `set by: ${from.level}${from.name ? ` (${from.name})` : ''}` : 'default'}</span>
    </div>
  )
}

export function CheckFirst({ input, setStyle, onType, onMeta, spec, onRule, standard }: {
  input: ReviewInput
  setStyle: (key: string, patch: Partial<StyleInfo>) => void
  onType: (index: number, type: string) => void
  onMeta: () => void
  spec?: Spec
  onRule: (id: string, level: 'book' | 'client', v: RuleValue) => void
  standard: boolean
}) {
  const { items, sure } = reviewList(input)
  const style = (k: string) => input.styles.find((s) => s.key === k)
  const control = (it: CheckItem) => {
    if (it.area === 'style') {
      const s = style(String(it.ref))!
      return (
        <select value={s.role} onChange={(e) => setStyle(s.key, { role: e.target.value as Role, reason: 'chosen by the reviewer' })} aria-label={`Meaning of ${s.key}`}>
          {ROLES.map((r) => <option key={r} value={r}>{ROLE_HELP[r]}</option>)}
        </select>
      )
    }
    if (it.area === 'section') {
      return (
        <select value={String(input.sections[Number(it.ref)].type)} onChange={(e) => onType(Number(it.ref), e.target.value)} aria-label="Kind of section">
          {Object.entries(KIND).filter(([k]) => k !== 'cover').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      )
    }
    if (it.area === 'meta') return <button onClick={onMeta}>Open Book details</button>
    return null
  }
  return (
    <section className="check-first" aria-label="Check these first">
      <h3>Check these first</h3>
      <p className="muted small">
        {items.length ? `${items.length} thing${items.length === 1 ? '' : 's'} the tool was not sure about, least sure first.` : 'Nothing to check: the tool was sure of every decision.'} {sure} decision{sure === 1 ? '' : 's'} were clear-cut and are not listed.
      </p>
      <ol>
        {items.map((it) => (
          <li key={it.id}>
            <span className={`flag ${it.confidence}`}>{it.confidence === 'low' ? 'not sure' : 'please look'}</span> <strong>{it.title}</strong>
            <div className="muted small">{it.why}</div>
            <div className="row">{control(it)}</div>
            {it.topic && (
              <details>
                <summary className="small">House rules for this part</summary>
                {rulesForTopic(it.topic, standard).map((r) => <RuleSelect key={r.id} rule={r} spec={spec} onRule={onRule} />)}
              </details>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}
