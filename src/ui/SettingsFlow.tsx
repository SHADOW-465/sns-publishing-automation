import { useEffect, useState } from 'react'
import { DEFAULT_SETTINGS, setHouseSettings, houseSettings, type HouseSettings } from '../engine/settings.ts'
import { LABEL_KEYS, builtInLabels } from '../engine/epub/locale.ts'
import { PRINT_ONLY_EXAMPLES } from '../engine/epub/imprint.ts'
import { HOUSE_CSS } from '../engine/epub/css.ts'
import { RULES } from '../engine/spec/rules.ts'
import { resolve, layerFromSettings, LEVEL_LABEL, type Layer } from '../engine/spec/layers.ts'
import { store, BrowserStore, type Decision } from '../engine/spec/store.ts'
import { specWorkbook } from '../engine/spec/requirements.ts'
import { resolveSpec } from '../engine/spec/session.ts'
import { GROQ_MODELS, aiConfig, saveAiConfig } from '../engine/spec/ai.ts'
import { RuleList } from './SpecEditor.tsx'
import { download } from './shared.tsx'
import { Help } from './wizard.tsx'

// House settings: the defaults under every client's spec. The rules come from the registry
// (src/engine/spec/rules.ts), so this screen, the Spec step and the Excel workbook always agree.
// Also here: reader-facing words, the AI key, and the record of every client decision.

const KEY = 'automation:settings'

export function loadSettings() {
  try {
    const s = localStorage.getItem(KEY)
    if (s) setHouseSettings(JSON.parse(s) as Partial<HouseSettings>)
  } catch {
    /* storage unavailable or damaged: defaults apply */
  }
}

const LABEL_HELP: Record<string, string> = {
  cover: 'Cover (menu entry and page name)', halftitle: 'Half title', title: 'Title page', copyright: 'Copyright page', navTitle: 'Title of the navigation menu',
  landmarks: 'Landmarks list (hidden)', pageList: 'Page list (hidden)', startReading: '“Start reading” landmark', page: 'Word before page numbers (“página 12”)',
  eisbn: 'E-book ISBN label on the copyright page', logoAlt: 'Description of the publisher logo', a11ySummary: 'Accessibility summary (store listing)',
  dedication: 'Dedication page name', epigraph: 'Epigraph page name', front: 'Other front pages',
}
const LANGS: [string, string][] = [['es', 'Spanish'], ['en', 'English'], ['de', 'German'], ['fr', 'French'], ['it', 'Italian'], ['pt', 'Portuguese'], ['ca', 'Catalan']]
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export function SettingsFlow() {
  const [s, setS] = useState<HouseSettings>(houseSettings())
  const [lang, setLang] = useState('es')
  const [saved, setSaved] = useState('')
  const [filter, setFilter] = useState('')
  const [ai, setAi] = useState(aiConfig())
  const [clients, setClients] = useState<Layer[]>([])
  const [log, setLog] = useState<Decision[]>([])
  useEffect(() => {
    store().listLayers().then((ls) => setClients(ls.filter((l) => l.level !== 'house')))
    store().listDecisions().then(setLog)
  }, [])

  const update = (patch: Partial<HouseSettings>) => {
    setHouseSettings({ ...s, ...patch })
    const next = houseSettings() // checked: values out of range or from an older file fall back to the default
    setS(next)
    try {
      localStorage.setItem(KEY, JSON.stringify(next))
      setSaved('Saved — applies to the next build.')
    } catch {
      setSaved('Could not save in this browser: settings apply until the page is closed. Use “Save to a file”.')
    }
  }
  const setLabel = (k: string, v: string) => {
    const mine = { ...(s.labels[lang] ?? {}) }
    if (v.trim() && v !== (builtInLabels(lang) as unknown as Record<string, string>)[k]) mine[k] = v
    else delete mine[k]
    update({ labels: { ...s.labels, [lang]: mine } })
  }
  const loadFile = async (f?: File) => {
    if (!f) return
    try {
      update({ ...DEFAULT_SETTINGS, ...(JSON.parse(await f.text()) as Partial<HouseSettings>) })
      setSaved(`Loaded settings from ${f.name}.`)
    } catch {
      setSaved(`${f.name} is not a settings file.`)
    }
  }
  const built = builtInLabels(lang) as unknown as Record<string, string>
  // house settings shown as the house layer over the built-in defaults
  const resolved = resolve([layerFromSettings('house', '', s)])

  return (
    <div className="flow">
      <section className="card">
        <h2>Settings</h2>
        <p className="muted">
          The house defaults under every client’s spec. Clients set their own rules in the <strong>House style</strong> step of each book; what they set there wins
          over these. Save the settings to a file to use them on another computer.
        </p>
        <div className="row">
          <button onClick={() => download(JSON.stringify(s, null, 2), 'house-settings.json', 'application/json')}>Save to a file</button>
          <label className="button">
            Load from a file
            <input type="file" accept=".json" hidden onChange={(e) => loadFile(e.target.files?.[0])} />
          </label>
          <button onClick={() => update(DEFAULT_SETTINGS)}>Reset to defaults</button>
          {saved && <span className="note small">{saved}</span>}
        </div>
      </section>

      <section className="card">
        <h2>House rules ({RULES.length})</h2>
        <div className="form">
          <label>
            <span>Find a rule</span>
            <input value={filter} placeholder="e.g. table, footnote, CSS" onChange={(e) => setFilter(e.target.value)} />
          </label>
        </div>
        <RuleList
          resolved={resolved}
          filter={filter}
          onSet={(r, v) => r.key && update({ [r.key]: v ?? DEFAULT_SETTINGS[r.key] } as Partial<HouseSettings>)}
        />
        {!s.houseCss && (
          <div className="row">
            <button onClick={() => update({ houseCss: HOUSE_CSS })}>Edit the built-in house stylesheet (CSS-02)</button>
          </div>
        )}
        <Help title="Accessibility rules in the house defaults">
          Accessibility rules (TBL-01, A11Y-01) default to the accessible choice. A client who wants otherwise changes them in his own spec and ticks the waiver there,
          so the record shows it was his decision.
        </Help>
      </section>

      <section className="card">
        <h2>Lines removed from the copyright page</h2>
        <p className="muted">Removed already, before the phrases of rule FM-01:</p>
        <Help title="Built-in list">
          <ul>
            {PRINT_ONLY_EXAMPLES.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </Help>
      </section>

      <section className="card">
        <h2>Words shown to readers</h2>
        <p className="muted">Names of pages and menus that readers and screen readers see. Leave a field empty to use the default.</p>
        <label className="row small">
          Language
          <select value={lang} onChange={(e) => setLang(e.target.value)}>
            {LANGS.map(([c, n]) => (
              <option key={c} value={c}>{n}</option>
            ))}
          </select>
        </label>
        <div className="form">
          {LABEL_KEYS.map((k) => (
            <label key={k}>
              <span>{LABEL_HELP[k] ?? k}</span>
              <input value={s.labels[lang]?.[k] ?? ''} placeholder={built[k]} onChange={(e) => setLabel(k, e.target.value)} />
            </label>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>AI (Groq)</h2>
        <p className="muted">
          Optional. Matches a client’s free-form requirement file (Word, Excel) to the rules when keyword matching is not enough. Only the requirement text is sent to
          Groq, never the book. Get a free key at <code>console.groq.com/keys</code>. The key stays in this browser and is not saved in settings or spec files.
        </p>
        <div className="form">
          <label>
            <span>Groq API key</span>
            <input type="password" autoComplete="off" value={ai.apiKey} placeholder="gsk_…" onChange={(e) => (setAi({ ...ai, apiKey: e.target.value }), saveAiConfig({ ...ai, apiKey: e.target.value }))} />
          </label>
          <label>
            <span>Model</span>
            <select value={ai.model} onChange={(e) => (setAi({ ...ai, model: e.target.value }), saveAiConfig({ ...ai, model: e.target.value }))}>
              {GROQ_MODELS.map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="card">
        <h2>Client styles and decisions</h2>
        <p className="muted">
          Each client’s own rules, and the record of every change, waiver and acceptance (who, when, and the exact spec). Records are never changed or deleted.
        </p>
        {clients.length === 0 ? (
          <p className="muted small">No client has set a spec yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="styles">
              <thead>
                <tr>
                  <th>Applies to</th>
                  <th>Rules set</th>
                  <th>Waivers</th>
                  <th>Updated</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {clients.map((c) => (
                  <tr key={`${c.level}|${c.name}`}>
                    <td>{LEVEL_LABEL[c.level]}: <strong>{c.name}</strong></td>
                    <td className="num">{Object.keys(c.values).length}</td>
                    <td>{Object.keys(c.waivers).join(', ') || '—'}</td>
                    <td className="small">{new Date(c.updatedAt).toLocaleString()}</td>
                    <td>
                      <button
                        className="link"
                        onClick={() => download(specWorkbook({ client: c.level === 'client' ? c.name : '', book: c.level === 'book' ? c.name : '', resolved: resolveSpec(s, [c]), decisions: log.filter((d) => d.client === c.name || d.book === c.name) }), `spec-${c.name.replace(/\W+/g, '-')}.xlsx`, XLSX)}
                      >
                        Excel
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="row">
          {store() instanceof BrowserStore && <button onClick={() => download((store() as BrowserStore).exportAll(), 'spec-records-backup.json', 'application/json')}>Back up all specs and records</button>}
        </div>
        {log.length > 0 && (
          <details className="advanced">
            <summary>Decision record ({log.length})</summary>
            <ul className="log">
              {log.slice(0, 200).map((d) => (
                <li key={d.id}>
                  <span className="muted small">{new Date(d.at).toLocaleString()} · {d.actor} · {d.action} · {d.client || '—'} / {d.book || '—'} · spec {d.specHash}</span> {d.detail}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </div>
  )
}
