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
  if (H.length < 2 || V.length < 2) return []
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

  const out: PdfTable<L>[] = []
  for (const { h, v } of comps.values()) {
    const rows = cluster(h.map((r) => r.p))
    const cols = cluster(v.map((r) => r.p))
    if (rows.length < 3 || cols.length < 3) continue // at least two rows and two columns
    const x0 = cols[0]
    const x1 = cols[cols.length - 1]
    const y0 = rows[0]
    const y1 = rows[rows.length - 1]
    if ((x1 - x0) * (y1 - y0) > page.width * page.height * 0.85 || x1 - x0 < 40) continue // a page frame, not a table
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
    const first = cells.filter((k) => k.r === 0)
    const head = first.length > 1 && first.some((k) => k.lines.length) && (first.every((k) => k.shaded) || first.filter((k) => k.lines.length).every((k) => k.lines.every((l) => l.runs.every((r) => r.bold))))
    if (lines.length < 2) continue
    out.push({ x0, x1, y0, y1, cols, rows, cells, lines, head })
  }
  return out.sort((a, b) => a.y0 - b.y0)
}
