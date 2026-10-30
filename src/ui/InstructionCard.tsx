import { useState } from 'react'
import { compileInstruction, type AppliedInstruction, type Compile, type InstructionCache } from '../engine/spec/instruction.ts'
import { ruleById, show } from '../engine/spec/rules.ts'
import { aiConfig } from '../engine/spec/ai.ts'

// The book's typed instruction (OPUS_DESIGN2 a.4, T21): a text box, then one "What I understood" card the operator ticks once.
// The text is compiled by the text model (the same key as AI matching in Settings → AI); the same text is compiled once and kept in this browser.

const KEY = 'automation:instruction'
const cache: InstructionCache = {
  get: (k) => {
    try {
      return JSON.parse(localStorage.getItem(`${KEY}:cache:${k}`) ?? 'null') ?? undefined
    } catch {
      return undefined
    }
  },
  put: (k, e) => {
    try {
      localStorage.setItem(`${KEY}:cache:${k}`, JSON.stringify(e))
    } catch {
      /* not remembered */
    }
  },
}
/** the instruction the operator accepted for this book, kept in this browser so the next open of the book has it */
export const loadApplied = (book: string): AppliedInstruction | undefined => {
  try {
    return JSON.parse(localStorage.getItem(`${KEY}:${book}`) ?? 'null') ?? undefined
  } catch {
    return undefined
  }
}
const saveApplied = (book: string, a: AppliedInstruction | undefined) => {
  try {
    if (a) localStorage.setItem(`${KEY}:${book}`, JSON.stringify(a))
    else localStorage.removeItem(`${KEY}:${book}`)
  } catch {
    /* not remembered */
  }
}
const pagesText = (p: unknown) => (Array.isArray(p) ? p.map(([a, b]: [number, number]) => (a === b ? a : `${a}–${b}`)).join(', ') : String(p))

export function InstructionCard({ book, pages, actor, applied, onApplied }: {
  book: string
  /** pages in the book, when known (a page range outside it is not accepted) */
  pages?: number
  actor: string
  applied?: AppliedInstruction
  onApplied: (a: AppliedInstruction | undefined) => void
}) {
  const [text, setText] = useState(applied?.text ?? '')
  const [res, setRes] = useState<Compile>()
  const [busy, setBusy] = useState(false)

  const read = async () => {
    const ai = aiConfig()
    if (!ai.apiKey.trim()) return setRes({ ok: false, why: 'Enter a Groq API key in Settings → AI to read an instruction.' })
    setBusy(true)
    setRes(await compileInstruction(text, { apiKey: ai.apiKey, baseUrl: 'https://api.groq.com/openai/v1', model: ai.model }, { pages, cache }))
    setBusy(false)
  }
  const accept = () => {
    if (!res?.ok) return
    const a: AppliedInstruction = { compiled: res.compiled, refused: res.refused, actor: actor.trim() || 'reviewer', at: new Date().toISOString(), text: text.trim() }
    saveApplied(book, a)
    onApplied(a)
  }
  const clear = () => {
    saveApplied(book, undefined)
    setRes(undefined)
    setText('')
    onApplied(undefined)
  }

  return (
    <section className="card">
      <h2>Instruction for this book (optional)</h2>
      <p className="muted small">
        Say in your own words, in any language, what is special about this book: “Chapters are H1; pages 3–6 are plates; the captions are the small italic lines.” It
        applies to this book only and wins over the spec file.
      </p>
      <textarea rows={3} style={{ width: '100%' }} value={text} onChange={(e) => setText(e.target.value)} aria-label="Instruction for this book" />
      <div className="row">
        <button onClick={read} disabled={busy || !text.trim()}>{busy ? 'Reading…' : 'Read my instruction'}</button>
        {applied && <button className="ghost" onClick={clear}>Remove the instruction</button>}
      </div>
      {res && !res.ok && <p className="err small">The instruction could not be read: {res.why}</p>}
      {res?.ok && (
        <div>
          <h3>What I understood</h3>
          <ul>
            {res.compiled.rules.map((r) => (
              <li key={r.ruleId}><strong>{ruleById.get(r.ruleId)?.title}</strong> ({r.ruleId}) = {show(ruleById.get(r.ruleId)!, r.value)} <span className="muted small">“{r.quote}”</span></li>
            ))}
            {res.compiled.directives.map((d, i) => (
              <li key={`d${i}`}>
                {d.op.replace('_', ' ')}{'pages' in d ? `: pages ${pagesText(d.pages)}` : ''} <span className="muted small">“{d.quote}”</span>
              </li>
            ))}
            {res.compiled.hints.map((h, i) => (
              <li key={`h${i}`}>Note for the page reader{h.scope === 'book' ? '' : ` (pages ${pagesText(h.scope)})`}: {h.text}</li>
            ))}
          </ul>
          {res.refused.map((f) => (
            <p key={f.ruleId} className="note warnbox">Not applied: “{f.quote}” breaks {f.breaks}.</p>
          ))}
          {res.compiled.unmapped.map((u, i) => (
            <p key={i} className="note warnbox">Not understood: “{u.quote}” — {u.why}</p>
          ))}
          <button className="primary" onClick={accept}>Yes, that is what I meant</button>
        </div>
      )}
      {applied && !res && <p className="muted small">Applied: {applied.compiled.rules.length} rule(s), {applied.compiled.directives.length} directive(s), {applied.compiled.hints.length} note(s).</p>}
    </section>
  )
}
