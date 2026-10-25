import type { Line, Rule, FillBox } from './layout.ts'

// =============================================================================================
// Tables in a print PDF are drawn as ruled grids (a line for every cell edge, sometimes one path,
// often hundreds of short strokes). Rules that meet form a grid; the grid's lines give the rows
// and columns; the text lines fall into its cells. Merged cells show as missing rules.
// =============================================================================================

export interface TableCell<L extends Line = Line> {
  r: number
  c: number
  rowspan: number
  colspan: number
  lines: L[]
  shaded: boolean
}

export interface PdfTable<L extends Line = Line> {
  x0: number
  x1: number
  y0: number // top
  y1: number // bottom
  cols: number[]
  rows: number[]
  cells: TableCell<L>[]
  lines: L[]
  /** first row is a header: its cells are shaded or all bold */
  head: boolean
}

const TOL = 2.5

/** Collinear rules that touch or overlap become one. */
function merge(rs: Rule[]): Rule[] {
  const sorted = [...rs].sort((a, b) => a.p - b.p)
  const groups: Rule[][] = []
  for (const r of sorted) {
    const g = groups[groups.length - 1]
    if (g && Math.abs(g[0].p - r.p) < 1.2) g.push(r)
    else groups.push([r])
  }
  const out: Rule[] = []
  for (const g of groups) {
    const p = g.reduce((s, r) => s + r.p, 0) / g.length
    let cur: Rule | undefined
    for (const r of g.sort((a, b) => a.a - b.a)) {
      if (cur && r.a <= cur.b + TOL) cur.b = Math.max(cur.b, r.b)
      else out.push((cur = { a: r.a, b: r.b, p }))
    }
  }
  return out
}

const cluster = (xs: number[]) => {
  const out: number[] = []
  for (const x of [...xs].sort((a, b) => a - b)) if (!out.length || x - out[out.length - 1] > TOL) out.push(x)
  return out
}

export function detectTables<L extends Line>(page: { width: number; height: number; lines: L[]; rules?: { h: Rule[]; v: Rule[] }; shades?: FillBox[] }): PdfTable<L>[] {
  const H = merge(page.rules?.h ?? [])
  const V = merge(page.rules?.v ?? [])
  const out: PdfTable<L>[] = []
  if (H.length >= 2 && V.length >= 2) {
  // components of rules that touch each other
  const n = H.length + V.length
  const parent = Array.from({ length: n }, (_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  for (let i = 0; i < H.length; i++)
    for (let j = 0; j < V.length; j++)
      if (V[j].p >= H[i].a - TOL && V[j].p <= H[i].b + TOL && H[i].p >= V[j].a - TOL && H[i].p <= V[j].b + TOL) parent[find(i)] = find(H.length + j)
  const comps = new Map<number, { h: Rule[]; v: Rule[] }>()
  H.forEach((r, i) => (comps.get(find(i)) ?? comps.set(find(i), { h: [], v: [] }).get(find(i))!).h.push(r))
  V.forEach((r, j) => (comps.get(find(H.length + j)) ?? comps.set(find(H.length + j), { h: [], v: [] }).get(find(H.length + j))!).v.push(r))

  for (const { h, v } of comps.values()) {
    const rows = cluster(h.map((r) => r.p))
    const cols = cluster(v.map((r) => r.p))
    if (rows.length < 3 || cols.length < 3) continue // at least two rows and two columns
    const x0 = cols[0]
    const x1 = cols[cols.length - 1]
    const y0 = rows[0]
    const y1 = rows[rows.length - 1]
    if (x1 - x0 < 40) continue
    const nR = rows.length - 1
    const nC = cols.length - 1
    // is there a rule along this boundary, across the middle of this cell edge?
    const vAt = (c: number, r: number) => v.some((s) => Math.abs(s.p - cols[c]) < TOL && s.a <= (rows[r] + rows[r + 1]) / 2 && s.b >= (rows[r] + rows[r + 1]) / 2)
    const hAt = (r: number, c: number) => h.some((s) => Math.abs(s.p - rows[r]) < TOL && s.a <= (cols[c] + cols[c + 1]) / 2 && s.b >= (cols[c] + cols[c + 1]) / 2)
    const covered = Array.from({ length: nR }, () => new Array<boolean>(nC).fill(false))
    const cells: TableCell<L>[] = []
    for (let r = 0; r < nR; r++)
      for (let c = 0; c < nC; c++) {
        if (covered[r][c]) continue
        let cs = 1
        while (c + cs < nC && !vAt(c + cs, r)) cs++
        let rs = 1
        while (r + rs < nR && Array.from({ length: cs }, (_, k) => c + k).some((cc) => !hAt(r + rs, cc))) rs++
        for (let i = 0; i < rs; i++) for (let j = 0; j < cs; j++) covered[r + i][c + j] = true
        cells.push({ r, c, rowspan: rs, colspan: cs, lines: [], shaded: false })
      }
    // text lines into cells
    const lines: L[] = []
    for (const l of page.lines) {
      const cx = (l.x0 + l.x1) / 2
      const cy = l.y + l.size / 2
      if (cx < x0 - 1 || cx > x1 + 1 || cy < y0 - 1 || cy > y1 + 1) continue
      const c = Math.max(0, cols.findIndex((x, i) => i < nC && cx >= x - 0.5 && cx < cols[i + 1] + 0.5))
      const r = Math.max(0, rows.findIndex((y, i) => i < nR && cy >= y - 0.5 && cy < rows[i + 1] + 0.5))
      const cell = cells.find((k) => r >= k.r && r < k.r + k.rowspan && c >= k.c && c < k.c + k.colspan)
      if (cell) (cell.lines.push(l), lines.push(l))
    }
    for (const k of cells) k.lines.sort((a, b) => a.y - b.y || a.x0 - b.x0)
    // shaded cells: a tint over most of the cell
    for (const k of cells) {
      const cx0 = cols[k.c]
      const cx1 = cols[k.c + k.colspan]
      const cy0 = rows[k.r]
      const cy1 = rows[k.r + k.rowspan]
      const area = (cx1 - cx0) * (cy1 - cy0)
      k.shaded = (page.shades ?? []).some((s) => Math.max(0, Math.min(s.x1, cx1) - Math.max(s.x0, cx0)) * Math.max(0, Math.min(s.y1, cy1) - Math.max(s.y0, cy0)) > area * 0.6)
    }
    // a ruled page frame is not a table. A real table that fills the page and has no column strokes is the row-ruled pass below.
    if ((x1 - x0) * (y1 - y0) > page.width * page.height * 0.85 || x1 - x0 < 40 || lines.length < 2) continue
    const first = cells.filter((k) => k.r === 0)
    const head = first.length > 1 && first.some((k) => k.lines.length) && (first.every((k) => k.shaded) || first.filter((k) => k.lines.length).every((k) => k.lines.every((l) => l.runs.every((r) => r.bold))))
    out.push({ x0, x1, y0, y1, cols, rows, cells, lines, head })
  }
  }
  // row rules without column rules (a landscape table whose verticals are gaps, not strokes)
  const taken = new Set(out.flatMap((t) => t.lines))
  const longH = H.filter((r) => r.b - r.a > 40).sort((a, b) => a.p - b.p)
  const stacks: Rule[][] = []
  for (const r of longH) {
    const s = stacks.find((g) => Math.abs(g[0].a - r.a) < 30 && Math.abs(g[0].b - r.b) < 30 && r.p - g[g.length - 1].p > 6)
    if (s) s.push(r)
    else stacks.push([r])
  }
  for (const stack of stacks) {
    if (stack.length < 3) continue
    const x0 = Math.min(...stack.map((r) => r.a))
    const x1 = Math.max(...stack.map((r) => r.b))
    const rows = cluster(stack.map((r) => r.p))
    if (rows.length < 3 || x1 - x0 < 40) continue
    const y0 = rows[0]
    const y1 = rows[rows.length - 1]
    const lines = page.lines.filter((l) => {
      if (taken.has(l)) return false
      const cx = (l.x0 + l.x1) / 2
      const cy = l.y + l.size / 2
      return cx >= x0 - 2 && cx <= x1 + 2 && cy >= y0 - l.size && cy <= y1 + 2 && l.x1 - l.x0 < (x1 - x0) * 0.75
    })
    if (lines.length < 4) continue
    // column starts are left edges. A word's centre falls into the next column when the label is wider than the gap, so keep the starts and assign by x0.
    const starts: number[] = []
    // right-aligned numbers start a few points after their left-aligned heading; real columns on this grid sit ~40pt apart
    for (const x of lines.map((l) => l.x0).sort((a, b) => a - b)) if (!starts.length || x - starts[starts.length - 1] > 24) starts.push(x)
    const cols = [...starts, x1]
    if (cols.length < 4) continue // two columns is a contents entry and its page number, not this kind of table
    const nR = rows.length - 1
    const nC = cols.length - 1
    const cells: TableCell<L>[] = []
    for (let r = 0; r < nR; r++) for (let c = 0; c < nC; c++) cells.push({ r, c, rowspan: 1, colspan: 1, lines: [], shaded: false })
    for (const l of lines) {
      const cx = (l.x0 + l.x1) / 2
      const cy = l.y + l.size / 2
      const c = Math.max(0, cols.findIndex((x, i) => i < nC && l.x0 >= x - 4 && l.x0 < cols[i + 1] - 4))
      const r = Math.max(0, rows.findIndex((y, i) => i < nR && cy >= y - l.size && cy < rows[i + 1] + 2))
      cells.find((k) => k.r === r && k.c === c)?.lines.push(l)
    }
    for (const k of cells) k.lines.sort((a, b) => a.y - b.y || a.x0 - b.x0)
    const textOf = (c: number) => cells.filter((k) => k.c === c).flatMap((k) => k.lines.map((l) => l.text.trim())).filter(Boolean)
    const pageCols = Array.from({ length: nC }, (_, c) => c).filter((c) => {
      const ts = textOf(c)
      return ts.length >= 2 && ts.every((t) => /^\d{1,4}$/.test(t))
    })
    const prose = Array.from({ length: nC }, (_, c) => textOf(c).some((t) => t.length > 25))
    // a contents page: one column of bare page numbers beside the entry titles
    if (pageCols.length === 1 && prose.some(Boolean)) continue
    const first = cells.filter((k) => k.r === 0)
    const head = first.length > 1 && first.some((k) => k.lines.length) && first.filter((k) => k.lines.length).every((k) => k.lines.every((l) => l.runs.every((r) => r.bold)))
    out.push({ x0, x1, y0, y1, cols, rows, cells, lines, head })
  }
  return out.sort((a, b) => a.y0 - b.y0)
}
