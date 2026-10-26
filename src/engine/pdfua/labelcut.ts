import type { Op, Paint } from './content.ts'
import type { PLine } from '../pdfepub/analyze.ts'
import { parseOperand, literal, hexString, type PageOps, type Tok } from './tocsplit.ts'

// A list label set in the same text-showing operator as its words ("101. Suetonius, Life of…") cannot be its own marked-content
// sequence unless the operator is cut after the label (U4: every end note is Lbl + LBody). Only plain one-byte strings are cut, and only when the
// bytes spell the label; anything else is left whole.

/** The text a string shows, for matching an operator against a layout line. Not exact for fonts with their own encoding. */
export function opText(op: Op, src: string): string {
  const toks = parseOperand(op, src)
  return toks ? toks.map((t) => (t.kind === 'str' ? String.fromCharCode(...t.bytes) : '')).join('') : ''
}

const piece = (toks: Tok[]) => `[${toks.map((t) => t.raw).join(' ')}] TJ`
const str = (t: Extract<Tok, { kind: 'str' }>, bytes: number[]): Tok => ({ kind: 'str', raw: t.hex ? hexString(bytes) : literal(bytes), hex: t.hex, bytes })

/** The operator cut after \`label\`: [label part, rest]. Undefined when the operator does not start with the label or shows nothing after it. */
export function cutAfterLabel(op: Op, src: string, label: string): [string, string] | undefined {
  const toks = parseOperand(op, src)
  if (!toks || (op.op !== 'Tj' && op.op !== 'TJ')) return undefined
  const head: Tok[] = []
  const tail: Tok[] = []
  let matched = 0
  for (const t of toks) {
    if (matched >= label.length) {
      tail.push(t)
      continue
    }
    if (t.kind === 'num') {
      head.push(t)
      continue
    }
    let i = 0
    for (; i < t.bytes.length && matched < label.length; i++) {
      const ch = String.fromCharCode(t.bytes[i])
      if (ch === label[matched]) matched++
      else if (!matched && /\s/.test(ch)) continue
      else return undefined
    }
    head.push(str(t, t.bytes.slice(0, i)))
    if (i < t.bytes.length) tail.push(str(t, t.bytes.slice(i)))
  }
  if (matched < label.length || !tail.some((t) => t.kind === 'str' && t.bytes.some((b) => b > 32))) return undefined
  // a kerning number right after the label stays with it, so the rest starts on a glyph
  while (tail.length && tail[0].kind === 'num') head.push(tail.shift()!)
  return [piece(head), piece(tail)]
}

/**
 * Cut every text operator that starts with the label of the line it belongs to. \`labelAt\` names the label line of an operator (a marker line
 * that owns an Lbl) and the line its words belong to. Returns the new page and, for each new operator that is a cut piece, the line it belongs to.
 */
export function cutLabels(
  page: PageOps, labelAt: (k: number) => { label: PLine; body: PLine } | undefined, read: (src: string) => PageOps,
): (PageOps & { lines: Map<number, PLine>; cut: number }) | undefined {
  const marks: { at: number; line: PLine }[] = []
  let out = ''
  let pos = 0
  let cut = 0
  page.ops.forEach((op, k) => {
    const hit = labelAt(k)
    if (!hit || page.paints[k]?.kind !== 'text') return
    const parts = cutAfterLabel(op, page.src, hit.label.text.trim())
    if (!parts) return
    out += page.src.slice(pos, op.start)
    pos = op.end
    marks.push({ at: out.length, line: hit.label })
    out += parts[0] + '\n'
    marks.push({ at: out.length, line: hit.body })
    out += parts[1]
    cut++
  })
  if (!cut) return undefined
  out += page.src.slice(pos)
  const next = read(out)
  const lines = new Map<number, PLine>()
  for (const m of marks) {
    const k = next.ops.findIndex((o) => o.start === m.at)
    if (k >= 0) lines.set(k, m.line)
  }
  return { ...next, lines, cut }
}

export type { Paint }
