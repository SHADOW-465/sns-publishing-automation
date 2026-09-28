import { useState } from 'react'
import { DEFAULT_SETTINGS, setSettings, settings, type HouseSettings, VARIANT_GROUPS, type VariantGroup } from '../engine/settings.ts'
import { HOUSE_CSS } from '../engine/epub/css.ts'
import { LABEL_KEYS, builtInLabels } from '../engine/epub/locale.ts'
import { PRINT_ONLY_EXAMPLES } from '../engine/epub/imprint.ts'
import { download } from './shared.tsx'
import { Help } from './wizard.tsx'

// House settings: what used to need a developer. Applies to every book built in this browser;
// can be saved to a file and loaded on another computer so the whole team works the same way.

const KEY = 'automation:settings'

export function loadSettings() {
  try {
    const s = localStorage.getItem(KEY)
    if (s) setSettings(JSON.parse(s) as Partial<HouseSettings>)
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
const VARIANT_HELP: Record<VariantGroup, string> = {
  align: 'Alignment (a right-aligned epigraph in a left-aligned style)',
  indent: 'Indents (an indented or hanging paragraph)',
  face: 'Italic or bold set on the whole paragraph',
  size: 'Font size and family',
  spacing: 'Space above and below',
  colour: 'Text colour',
}

/** A labelled drop-down of fixed choices. */
function Choice<T extends string>({ label, value, options, onChange, help }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void; help?: string }) {
  return (
    <label>
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map(([v, t]) => (
          <option key={v} value={v}>{t}</option>
        ))}
      </select>
      {help && <small className="muted">{help}</small>}
    </label>
  )
}

const LANGS: [string, string][] = [['es', 'Spanish'], ['en', 'English'], ['de', 'German'], ['fr', 'French'], ['it', 'Italian'], ['pt', 'Portuguese'], ['ca', 'Catalan']]

export function SettingsFlow() {
  const [s, setS] = useState<HouseSettings>(settings())
  const [lang, setLang] = useState('es')
  const [saved, setSaved] = useState('')
  const update = (patch: Partial<HouseSettings>) => {
    setSettings({ ...s, ...patch })
    const next = settings() // checked: values out of range or from an older file fall back to the default
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

  return (
    <div className="flow">
      <section className="card">
        <h2>Settings</h2>
        <p className="muted">
          House rules that apply to every book built in this browser. Defaults reproduce the reference EPUBs. Save them to a file to use the same settings on another
          computer or share them with the team.
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
        <h2>House style of the e-book</h2>
        <div className="checks">
          <label>
            <input type="checkbox" checked={s.roleHeading} onChange={(e) => update({ roleHeading: e.target.checked })} />
            <span>Mark the heading of each part with <code>role="heading"</code></span>
            <small>As in the reference. <code>aria-level</code> is always added with it, which EPUBCheck requires (the reference lacked it and fails EPUBCheck).</small>
          </label>
          <label>
            <input type="checkbox" checked={s.langWrapper} onChange={(e) => update({ langWrapper: e.target.checked })} />
            <span>Wrap the content of every page in <code>&lt;div xml:lang&gt;</code></span>
            <small>As in the reference: repeats the book language inside each section.</small>
          </label>
          <label>
            <input type="checkbox" checked={s.seriesSmallCaps} onChange={(e) => update({ seriesSmallCaps: e.target.checked })} />
            <span>Numbered heading series look alike</span>
            <small>When some headings of a series (“Hábito 1”, “Hábito 2”…) are in small caps and others aren’t, all of them get small caps.</small>
          </label>
          <label>
            <input type="checkbox" checked={s.verseLines} onChange={(e) => update({ verseLines: e.target.checked })} />
            <span>Set quoted verse as a block</span>
            <small>A quotation broken into short lines (a mantra, a poem) becomes <code>extract1</code> lines and a final <code>extract2</code> line.</small>
          </label>
        </div>
        <div className="form" style={{ marginTop: 18 }}>
          <Choice
            label="Language on each page"
            value={s.htmlLang}
            onChange={(v) => update({ htmlLang: v })}
            options={[['xml:lang', 'xml:lang only (as the reference)'], ['both', 'lang and xml:lang'], ['lang', 'lang only']]}
            help='The attribute on <html>. The reference writes xml:lang="es-ES" once; both is allowed too.'
          />
          <Choice
            label="Tables"
            value={s.tableHeaders}
            onChange={(v) => update({ tableHeaders: v })}
            options={[['reference', 'As the reference: <td> cells with their cell style'], ['th', 'First row as table headers (<thead>, <th scope="col">)']]}
            help="Header cells let screen readers announce the column names; the reference EPUB does not use them."
          />
          <Choice
            label="Line above the footnotes"
            value={s.footnoteRule}
            onChange={(v) => update({ footnoteRule: v })}
            options={[['short', 'Short line, as in print'], ['full', 'Full width'], ['none', 'No line']]}
          />
          {s.footnoteRule === 'short' && (
            <label>
              <span>Length of the short line (% of the text width)</span>
              <input type="number" min={5} max={100} step={5} value={s.footnoteRuleWidth} onChange={(e) => update({ footnoteRuleWidth: Number(e.target.value) || DEFAULT_SETTINGS.footnoteRuleWidth })} />
            </label>
          )}
        </div>
      </section>

      <section className="card">
        <h2>Paragraph classes</h2>
        <p className="muted">
          Each InDesign paragraph style becomes one CSS class. A class looks the way most of its paragraphs look in the book. When one paragraph was changed by hand in
          InDesign, it can get a class of its own — always a single class (<code>Texto1</code>, never <code>Texto Texto1</code>).
        </p>
        <div className="form">
          <Choice
            label="Paragraphs changed by hand in InDesign"
            value={s.styleVariants}
            onChange={(v) => update({ styleVariants: v })}
            options={[['own', 'Get a class of their own when the change matters'], ['ignore', 'Always keep the style’s class']]}
          />
        </div>
        {s.styleVariants === 'own' && (
          <div className="checks" style={{ marginTop: 14 }}>
            {(Object.keys(VARIANT_GROUPS) as VariantGroup[]).map((g) => (
              <label key={g}>
                <input
                  type="checkbox"
                  checked={s.variantOn.includes(g)}
                  onChange={(e) => update({ variantOn: e.target.checked ? [...s.variantOn, g] : s.variantOn.filter((x) => x !== g) })}
                />
                <span>{VARIANT_HELP[g]}</span>
              </label>
            ))}
          </div>
        )}
        <Help>
          <p>
            Typesetters often change one paragraph by hand (a slightly bigger size, a font swapped) without meaning anything by it. Ticked kinds of change are kept
            as a class of their own; unticked ones are ignored so the paragraph keeps its style’s class. Italic or bold on a whole paragraph should stay ticked, or
            the paragraph loses it.
          </p>
        </Help>
      </section>

      <section className="card">
        <h2>Lines removed from the copyright page</h2>
        <p className="muted">
          Print-only lines are left out of the e-book: printer, legal deposit, paper and forest notices. Add your own phrases, one per line — any line containing one
          of them is removed (capitals don’t matter).
        </p>
        <textarea className="big" rows={5} value={s.printOnly.join('\n')} placeholder={'e.g.\nImpreso en papel ecológico\nDistribución en América Latina'} onChange={(e) => update({ printOnly: e.target.value.split('\n') })} />
        <Help title="What is removed already?">
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
        <h2>Stylesheet</h2>
        <div className="form">
          <Choice
            label="Layout"
            value={s.cssFormat}
            onChange={(v) => update({ cssFormat: v })}
            options={[['vertical', 'One declaration per line (as the reference)'], ['compact', 'One rule per line']]}
            help="Vertical writes the margins out: margin-top, margin-bottom, margin-right, margin-left."
          />
          <label>
            <span>Largest space above or below a paragraph (em)</span>
            <input type="number" min={0} max={10} step={0.5} value={s.maxSpaceEm} onChange={(e) => update({ maxSpaceEm: Number(e.target.value) })} />
            <small className="muted">Print spacing is taken over up to this much, so gaps stay small on phone screens.</small>
          </label>
          <label>
            <span>Space around indented blocks (em)</span>
            <input type="number" min={0} max={5} step={0.5} value={s.blockSpaceEm} onChange={(e) => update({ blockSpaceEm: Number(e.target.value) })} />
            <small className="muted">Around <code>&lt;div class="top"&gt;</code> (questions and answers, exercises). It overlaps the paragraphs’ own space instead of adding to it.</small>
          </label>
        </div>
      </section>

      <section className="card">
        <h2>House stylesheet</h2>
        <p className="muted">
          The fixed classes every e-book uses (<code>indent</code>, <code>extract1</code>, <code>hang</code>, contents, copyright and title pages, footnotes, tables).
          Leave empty to use the built-in one; the rules for the book’s own styles are always added after it.
        </p>
        <textarea className="big mono" rows={s.houseCss ? 14 : 3} value={s.houseCss} placeholder="Empty: the built-in house stylesheet is used." onChange={(e) => update({ houseCss: e.target.value })} />
        <div className="row">
          <button onClick={() => update({ houseCss: HOUSE_CSS })}>Start from the built-in stylesheet</button>
          {s.houseCss && <button onClick={() => update({ houseCss: '' })}>Use the built-in stylesheet</button>}
        </div>
      </section>

      <section className="card">
        <h2>Extra CSS</h2>
        <p className="muted">
          Added at the end of every e-book’s stylesheet, so it wins over the generated styles. For house tweaks such as fonts or spacing — for example{' '}
          <code>h2 {'{'} font-size: 150%; {'}'}</code>.
        </p>
        <textarea className="big mono" rows={6} value={s.extraCss} onChange={(e) => update({ extraCss: e.target.value })} />
      </section>

      <section className="card">
        <h2>Quality check</h2>
        <div className="form">
          <label>
            <span>Smallest cover (long side, px)</span>
            <input type="number" min={500} step={100} value={s.minCoverPx} onChange={(e) => update({ minCoverPx: Number(e.target.value) || DEFAULT_SETTINGS.minCoverPx })} />
          </label>
          <label>
            <span>Missing source words that count as “must fix” (%)</span>
            <input type="number" min={0} step={0.1} value={s.lostWordsErrorPct} onChange={(e) => update({ lostWordsErrorPct: Number(e.target.value) })} />
          </label>
        </div>
      </section>
    </div>
  )
}
