// Parses InDesign's idGeneratedStyles.css and answers "what does this element really look like".
//
// InDesign exports every local formatting change as a *Override-N class carrying the full font
// description (family + style + weight). Plain cascade gets this wrong: `Italic CharOverride-6`
// renders upright in a browser (the override repeats font-style:normal) although the print PDF
// shows italic. Rule deduced from the print PDF: an override only changes the face when it asks
// for a non-regular face (bold / italic); a "regular" override leaves named styles alone.

export type Decls = Record<string, string>

export interface Face {
  italic: boolean
  bold: boolean
  smallCaps: boolean
  upper: boolean
  sup: boolean
  sub: boolean
  underline: boolean
  strike: boolean
  dropcap: boolean
}

export const REGULAR: Face = {
  italic: false, bold: false, smallCaps: false, upper: false,
  sup: false, sub: false, underline: false, strike: false, dropcap: false,
}

export const isOverride = (cls: string) => /^(_idGen|ParaOverride|CharOverride|CellOverride|TableOverride|ObjectOverride)/.test(cls) || /^_id/.test(cls)

export class StyleSheet {
  /** class name -> declarations, merged in source order per element kind */
  private rules = new Map<string, { kind: string; decls: Decls; order: number }[]>()
  private n = 0

  constructor(css: string) {
    css = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@font-face\s*\{[^}]*\}/g, '').replace(/@page\s*\{[^}]*\}/g, '')
    for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const decls: Decls = {}
      for (const d of m[2].split(';')) {
        const i = d.indexOf(':')
        if (i > 0) decls[d.slice(0, i).trim().toLowerCase()] = d.slice(i + 1).trim()
      }
      for (const sel of m[1].split(',')) {
        const mm = sel.trim().match(/^([a-z0-9]*)\.([\w-]+)$/i)
        if (!mm) continue
        const list = this.rules.get(mm[2]) ?? []
        list.push({ kind: mm[1].toLowerCase(), decls, order: this.n++ })
        this.rules.set(mm[2], list)
      }
    }
  }

  /** Cascaded declarations for an element of `kind` with `classes` (later CSS rule wins). */
  decls(kind: string, classes: string[]): Decls {
    const hits = classes
      .flatMap((c) => this.rules.get(c) ?? [])
      .filter((r) => !r.kind || r.kind === kind)
      .sort((a, b) => a.order - b.order)
    return Object.assign({}, ...hits.map((h) => h.decls))
  }

  has(cls: string) {
    return this.rules.has(cls)
  }

  /** Face of a span, given the face it inherits. */
  spanFace(classes: string[], inherited: Face): Face {
    const f = { ...inherited }
    const named = classes.filter((c) => !isOverride(c))
    const over = classes.filter(isOverride)
    applyFace(f, this.decls('span', named), true)
    applyFace(f, this.decls('span', over), false)
    if (classes.some((c) => /dropcap/i.test(c))) f.dropcap = true
    return f
  }

  paragraphFace(classes: string[]): Face {
    const f = { ...REGULAR }
    applyFace(f, this.decls('p', classes), true)
    return f
  }
}

const isBold = (w?: string) => !!w && (w === 'bold' || w === 'bolder' || parseInt(w) >= 600)
const isItalic = (s?: string) => s === 'italic' || s === 'oblique'

function applyFace(f: Face, d: Decls, named: boolean) {
  const family = d['font-family'] ?? ''
  const famItalic = /\b(italic|oblique)\b/i.test(family)
  const famBold = /\b(bold|heavy|black)\b/i.test(family)
  const wantsItalic = isItalic(d['font-style']) || famItalic
  const wantsBold = isBold(d['font-weight']) || famBold
  if (named) {
    if ('font-style' in d || famItalic) f.italic = wantsItalic
    if ('font-weight' in d || famBold) f.bold = wantsBold
    if ('font-variant' in d) f.smallCaps = d['font-variant'] === 'small-caps'
    if ('text-transform' in d) f.upper = d['text-transform'] === 'uppercase'
  } else {
    // override: only a non-regular face replaces what named styles said
    if (wantsItalic || wantsBold) {
      f.italic = wantsItalic
      f.bold = wantsBold
    }
    if (d['font-variant'] === 'small-caps') f.smallCaps = true
    if (d['text-transform'] === 'uppercase') f.upper = true
  }
  const va = d['vertical-align']
  if (va === 'super') f.sup = true
  if (va === 'sub') f.sub = true
  const td = d['text-decoration'] ?? ''
  if (td.includes('underline')) f.underline = true
  if (td.includes('line-through')) f.strike = true
}

/** Numeric reading of a length in px (em converted at 12px, InDesign's default body size). */
export function px(v: string | undefined): number {
  if (!v) return 0
  const n = parseFloat(v)
  if (isNaN(n)) return 0
  return v.endsWith('em') ? n * 12 : n
}

export function em(v: string | undefined): number {
  if (!v) return 1
  const n = parseFloat(v)
  return isNaN(n) ? 1 : v.endsWith('px') ? n / 12 : v.endsWith('%') ? n / 100 : n
}
