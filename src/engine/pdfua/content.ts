// PDF content streams: tokenise, find where every painting operator draws, and rewrite the
// stream so each one sits inside marked content — /Tag <</MCID n>> BDC … EMC for real content,
// /Artifact BMC … EMC for page furniture. That is what "tagged" means to PAC / PDF/UA.
// Works on latin1 strings (1 char = 1 byte) so binary data survives untouched.

export type Op = {
  op: string
  args: string[] // raw operand tokens
  start: number // source offset of the first operand (or operator)
  end: number // offset after the operator
  /** written with the operator before it and no space (`lS`): a space must be put between them again */
  glued?: boolean
}

const OPERATORS = new Set(('b B b* B* BDC BI BMC BT BX c cm CS cs d d0 d1 Do DP EI EMC ET EX f F f* G g gs h i ID j J K k l m M MP n q Q re RG rg ri s S SC sc SCN scn sh T* Tc Td TD Tf Tj TJ TL Tm Tr Ts Tw Tz u v w W W* y \' "').split(' '))

/** Some producers write operators without a space between them ("lS", "ref"); readers take them apart, so do we. */
function unglue(tok: string): string[] | null {
  if (OPERATORS.has(tok)) return null
  const out: string[] = []
  for (let i = 0; i < tok.length; ) {
    let len = 0
    for (let l = Math.min(3, tok.length - i); l >= 1 && !len; l--) if (OPERATORS.has(tok.slice(i, i + l))) len = l
    if (!len) return null
    out.push(tok.slice(i, i + len))
    i += len
  }
  return out
}

const WS = /[\0\t\n\f\r ]/
const DELIM = /[()<>[\]{}/%]/

export function tokenize(src: string): Op[] {
  const ops: Op[] = []
  let args: string[] = []
  let argStart = -1
  let i = 0
  const n = src.length
  const push = (tok: string, at: number) => {
    if (argStart < 0) argStart = at
    args.push(tok)
  }
  while (i < n) {
    const c = src[i]
    if (WS.test(c)) {
      i++
      continue
    }
    if (c === '%') {
      while (i < n && src[i] !== '\n' && src[i] !== '\r') i++
      continue
    }
    const at = i
    if (c === '(') {
      let depth = 1
      i++
      while (i < n && depth) {
        if (src[i] === '\\') i += 2
        else {
          if (src[i] === '(') depth++
          else if (src[i] === ')') depth--
          i++
        }
      }
      push(src.slice(at, i), at)
      continue
    }
    if (c === '<' && src[i + 1] === '<') {
      // dictionary: keep raw, nesting aware
      let depth = 0
      while (i < n) {
        if (src[i] === '<' && src[i + 1] === '<') (depth++, (i += 2))
        else if (src[i] === '>' && src[i + 1] === '>') {
          depth--
          i += 2
          if (!depth) break
        } else if (src[i] === '(') {
          let d = 1
          i++
          while (i < n && d) {
            if (src[i] === '\\') i += 2
            else (src[i] === '(' ? d++ : src[i] === ')' ? d-- : 0), i++
          }
        } else i++
      }
      push(src.slice(at, i), at)
      continue
    }
    if (c === '<') {
      i = src.indexOf('>', i) + 1 || n
      push(src.slice(at, i), at)
      continue
    }
    if (c === '[') {
      // array (TJ operand): raw, strings may contain brackets
      let depth = 0
      while (i < n) {
        const ch = src[i]
        if (ch === '(') {
          let d = 1
          i++
          while (i < n && d) {
            if (src[i] === '\\') i += 2
            else (src[i] === '(' ? d++ : src[i] === ')' ? d-- : 0), i++
          }
          continue
        }
        if (ch === '[') depth++
        if (ch === ']') {
          depth--
          if (!depth) {
            i++
            break
          }
        }
        i++
      }
      push(src.slice(at, i), at)
      continue
    }
    if (c === '/') {
      i++
      while (i < n && !WS.test(src[i]) && !DELIM.test(src[i])) i++
      push(src.slice(at, i), at)
      continue
    }
    // number or operator keyword
    while (i < n && !WS.test(src[i]) && !DELIM.test(src[i])) i++
    if (i === at) {
      i++ // stray delimiter (")", "]", "{", …): skip it
      continue
    }
    const tok = src.slice(at, i)
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(tok)) {
      push(tok, at)
      continue
    }
    if (tok === 'BI') {
      // inline image: BI <dict> ID <binary> EI — find EI surrounded by whitespace
      const id = src.indexOf('ID', i)
      let e = id + 2
      for (;;) {
        e = src.indexOf('EI', e + 1)
        if (e < 0) {
          e = n - 2
          break
        }
        if (WS.test(src[e - 1]) && (e + 2 >= n || WS.test(src[e + 2]))) break
      }
      ops.push({ op: 'BI', args: [], start: argStart >= 0 ? argStart : at, end: e + 2 })
      i = e + 2
      args = []
      argStart = -1
      continue
    }
    const parts = unglue(tok)
    if (parts) {
      let from = at
      parts.forEach((op, k) => {
        ops.push({ op, args: k ? [] : args, start: k ? from : argStart >= 0 ? argStart : at, end: from + op.length, glued: k > 0 })
        from += op.length
      })
    } else ops.push({ op: tok, args, start: argStart >= 0 ? argStart : at, end: i })
    args = []
    argStart = -1
  }
  return ops
}

// ---------------------------------------------------------------------------------------------
// Geometry: where each painting operator draws (user space, y up)
// ---------------------------------------------------------------------------------------------

type M = [number, number, number, number, number, number]
const I: M = [1, 0, 0, 1, 0, 0]
export const mul = (m: M, n: M): M => [
  m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
]
const pt = (m: M, x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]

export type Paint =
  | { kind: 'text'; x: number; y: number; size: number }
  | { kind: 'path'; box: Box }
  | { kind: 'image'; box: Box; name: string }
  | { kind: 'form'; box: Box; name: string; text: boolean }
  | { kind: 'shading'; box: Box | null }
export type Box = { x0: number; y0: number; x1: number; y1: number }

const PATH_PAINT = new Set(['S', 's', 'f', 'F', 'f*', 'B', 'B*', 'b', 'b*'])
const PATH_BUILD = new Set(['m', 'l', 'c', 'v', 'y', 'h', 're'])
const TEXT_SHOW = new Set(['Tj', 'TJ', "'", '"'])
const num = (s: string) => parseFloat(s)

export interface Resources {
  /** XObject name → kind and, for forms, their /BBox and /Matrix */
  xobject: (name: string) => { kind: 'image' | 'form'; bbox?: number[]; matrix?: number[]; text?: boolean } | undefined
}

/** Geometry of every painting operator, indexed like `ops`. */
export function paints(ops: Op[], res: Resources): (Paint | null)[] {
  const out: (Paint | null)[] = new Array(ops.length).fill(null)
  let ctm: M = [...I]
  const stack: { ctm: M; tl: number }[] = []
  let tm: M = [...I]
  let tlm: M = [...I]
  let fontSize = 0
  let tl = 0
  let path: Box | null = null
  const addPt = (x: number, y: number) => {
    const [px, py] = pt(ctm, x, y)
    path = path ? { x0: Math.min(path.x0, px), y0: Math.min(path.y0, py), x1: Math.max(path.x1, px), y1: Math.max(path.y1, py) } : { x0: px, y0: py, x1: px, y1: py }
  }
  const unit = (m: M): Box => {
    const ps = [pt(m, 0, 0), pt(m, 1, 0), pt(m, 0, 1), pt(m, 1, 1)]
    return { x0: Math.min(...ps.map((p) => p[0])), y0: Math.min(...ps.map((p) => p[1])), x1: Math.max(...ps.map((p) => p[0])), y1: Math.max(...ps.map((p) => p[1])) }
  }
  for (let i = 0; i < ops.length; i++) {
    const { op, args } = ops[i]
    const a = args.map(num)
    switch (op) {
      case 'q':
        stack.push({ ctm: [...ctm] as M, tl })
        break
      case 'Q':
        ;({ ctm, tl } = stack.pop() ?? { ctm, tl })
        break
      case 'cm':
        if (a.length === 6) ctm = mul(a as M, ctm)
        break
      case 'BT':
        tm = [...I]
        tlm = [...I]
        break
      case 'Tf':
        fontSize = a[1] ?? fontSize
        break
      case 'TL':
        tl = a[0]
        break
      case 'Tm':
        tm = tlm = a as M
        break
      case 'Td':
      case 'TD':
        if (op === 'TD') tl = -a[1]
        tlm = mul([1, 0, 0, 1, a[0], a[1]], tlm)
        tm = [...tlm] as M
        break
      case 'T*':
        tlm = mul([1, 0, 0, 1, 0, -tl], tlm)
        tm = [...tlm] as M
        break
      case "'":
      case '"':
        tlm = mul([1, 0, 0, 1, 0, -tl], tlm)
        tm = [...tlm] as M
      // fall through
      case 'Tj':
      case 'TJ': {
        const m = mul(tm, ctm)
        const [x, y] = pt(m, 0, 0)
        out[i] = { kind: 'text', x, y, size: Math.abs(fontSize * Math.hypot(m[2], m[3])) }
        break
      }
      case 'm':
      case 'l':
        addPt(a[0], a[1])
        break
      case 'c':
        addPt(a[0], a[1]), addPt(a[2], a[3]), addPt(a[4], a[5])
        break
      case 'v':
      case 'y':
        addPt(a[0], a[1]), addPt(a[2], a[3])
        break
      case 're':
        addPt(a[0], a[1]), addPt(a[0] + a[2], a[1] + a[3])
        break
      case 'n':
        path = null
        break
      case 'Do': {
        const name = args[0]?.slice(1) ?? ''
        const x = res.xobject(name)
        if (x?.kind === 'form') {
          const [bx0, by0, bx1, by1] = x.bbox ?? [0, 0, 0, 0]
          const m = mul((x.matrix ?? [...I]) as M, ctm)
          const ps = [pt(m, bx0, by0), pt(m, bx1, by0), pt(m, bx0, by1), pt(m, bx1, by1)]
          out[i] = { kind: 'form', name, text: !!x.text, box: { x0: Math.min(...ps.map((p) => p[0])), y0: Math.min(...ps.map((p) => p[1])), x1: Math.max(...ps.map((p) => p[0])), y1: Math.max(...ps.map((p) => p[1])) } }
        } else out[i] = { kind: 'image', name, box: unit(ctm) }
        break
      }
      case 'BI':
        out[i] = { kind: 'image', name: 'inline', box: unit(ctm) }
        break
      case 'sh':
        out[i] = { kind: 'shading', box: null }
        break
      default:
        if (PATH_PAINT.has(op)) {
          out[i] = { kind: 'path', box: path ?? { x0: 0, y0: 0, x1: 0, y1: 0 } }
          path = null
        }
    }
  }
  return out
}

export const isPaint = (op: string) => PATH_PAINT.has(op) || TEXT_SHOW.has(op) || op === 'Do' || op === 'BI' || op === 'sh'

// ---------------------------------------------------------------------------------------------
// Rewrite: wrap painting operators in marked content
// ---------------------------------------------------------------------------------------------

/** Owner of a painting operator: a structure element id (tag + element), or null = artifact. */
export type Owner = { el: number; tag: string } | null

/**
 * Rebuild the stream. Existing marked-content operators are dropped (the document is re-tagged
 * from scratch) except optional-content ones (/OC). A marked-content sequence never crosses
 * q/Q or BT/ET, so nesting is always valid; each sequence gets its own MCID.
 * Returns the new stream and, per MCID, the element that owns it.
 */
export function rewrite(src: string, ops: Op[], owners: (Owner | undefined)[]): { stream: string; mcids: number[] } {
  let out = ''
  let pos = 0
  let open: { key: string } | null = null
  const mcids: number[] = []
  const ocDepth: boolean[] = [] // stack of BDC/BMC in the source: true = kept (/OC)
  // A path object runs from its first construction operator to its painting operator; marked content may only start
  // or end outside it (PDF 32000 §14.6, and PAC's content check). The path is held back and written with its paint.
  let path: string | null = null
  const close = () => {
    if (open) out += '\nEMC\n'
    open = null
  }
  const flushPath = () => {
    if (path !== null) out += path
    path = null
  }
  for (let i = 0; i < ops.length; i++) {
    const o = ops[i]
    // copy anything between operators (whitespace, comments) verbatim
    const gap = src.slice(pos, o.start) || (o.glued ? ' ' : '')
    pos = o.end
    const raw = src.slice(o.start, o.end)
    if (PATH_BUILD.has(o.op)) {
      path = (path ?? '') + gap + raw
      continue
    }
    if (path !== null && (o.op === 'W' || o.op === 'W*')) {
      path += gap + raw
      continue
    }
    if (path !== null && o.op === 'n') {
      // a clipping path: no paint, stays inside whatever sequence is open
      out += path + gap + raw
      path = null
      continue
    }
    const held = path !== null && PATH_PAINT.has(o.op)
    if (!held) {
      flushPath()
      out += gap
    }
    if (o.op === 'BDC' || o.op === 'BMC') {
      const keep = o.op === 'BDC' && o.args[0] === '/OC'
      ocDepth.push(keep)
      if (keep) (close(), (out += raw))
      continue
    }
    if (o.op === 'EMC') {
      if (ocDepth.pop()) (close(), (out += raw))
      continue
    }
    if (o.op === 'q' || o.op === 'Q' || o.op === 'BT' || o.op === 'ET') {
      close()
      out += raw
      continue
    }
    if (isPaint(o.op)) {
      const w = owners[i]
      const key = w ? `${w.el}` : 'artifact'
      if (!open || open.key !== key) {
        close()
        if (w) {
          out += `\n/${w.tag} <</MCID ${mcids.length}>> BDC\n`
          mcids.push(w.el)
        } else out += '\n/Artifact BMC\n'
        open = { key }
      }
      if (held) (out += path + gap), (path = null)
      out += raw
      continue
    }
    out += raw
  }
  flushPath()
  close()
  out += src.slice(pos)
  return { stream: out, mcids }
}

/** Remove marked-content operators (except optional content) — used for form XObjects. */
export function stripMarked(src: string, ops: Op[]): string {
  let out = ''
  let pos = 0
  const keep: boolean[] = []
  for (const o of ops) {
    if (o.op === 'BDC' || o.op === 'BMC') {
      const k = o.op === 'BDC' && o.args[0] === '/OC'
      keep.push(k)
      out += src.slice(pos, o.start) + (k ? src.slice(o.start, o.end) : '')
      pos = o.end
    } else if (o.op === 'EMC') {
      const k = keep.pop()
      out += src.slice(pos, o.start) + (k ? src.slice(o.start, o.end) : '')
      pos = o.end
    }
  }
  return out + src.slice(pos)
}
