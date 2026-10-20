import type { Box, Paint } from './content.ts'
import type { PLine } from '../pdfepub/analyze.ts'
import type { Figure } from './structure.ts'

// Figures on a page: placed images, and charts/diagrams drawn as vector paths (the Medium sample
// has 13 such charts and no images at all). Text boxes with a tinted background are not figures.

const area = (b: Box) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0)
const grow = (b: Box, d: number): Box => ({ x0: b.x0 - d, y0: b.y0 - d, x1: b.x1 + d, y1: b.y1 + d })
const meets = (a: Box, b: Box) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1
const union = (a: Box, b: Box): Box => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) })

export function detectFigures(
  page: { index: number; width: number; height: number; lines: PLine[]; images: { x0: number; y0: number; x1: number; y1: number; jpeg?: Uint8Array | null }[] },
  paints: (Paint | null)[], bodySize: number, opts: { logos?: 'artifact' | 'figure' } = {},
): Figure[] {
  const H = page.height
  const W = page.width
  const pageArea = W * H
  const figs: Figure[] = []
  // placed images (layout boxes are top-down: flip to PDF space)
  for (const im of page.images) {
    const box = { x0: im.x0, x1: im.x1, y0: H - im.y1, y1: H - im.y0 }
    if (box.x1 - box.x0 < 30 || box.y1 - box.y0 < 30) continue
    const hit = figs.find((f) => meets(f.box, box) && area(box) > 0)
    if (hit) hit.box = union(hit.box, box)
    else figs.push({ page: page.index, box, lines: [], caption: '', image: im.jpeg, vector: false })
  }
  // vector drawings: cluster path boxes that touch (with a small margin)
  const boxes = paints
    .filter((p): p is Extract<Paint, { kind: 'path' }> => p?.kind === 'path')
    .map((p) => p.box)
    .filter((b) => area(b) < pageArea * 0.5 && !(b.x1 - b.x0 > W * 0.6 && b.y1 - b.y0 < 3)) // not page tints, not rules
  const clusters: { box: Box; n: number }[] = []
  for (const b of boxes) {
    let c = { box: b, n: 1 }
    for (let i = clusters.length - 1; i >= 0; i--) {
      if (meets(grow(clusters[i].box, 10), c.box)) {
        c = { box: union(clusters[i].box, c.box), n: clusters[i].n + c.n }
        clusters.splice(i, 1)
      }
    }
    clusters.push(c)
  }
  for (const c of clusters) {
    const w = c.box.x1 - c.box.x0
    const h = c.box.y1 - c.box.y0
    // a mark drawn from many small paths (FSC, a publisher's device): a figure unless the client asks for artifacts; a chart big enough to be one stays a chart
    const chart = c.n >= 4 && w >= 60 && h >= 40
    const logo = !chart && opts.logos !== 'artifact' && c.n >= 8 && w >= 12 && h >= 12 && w <= W * 0.4 && h <= H * 0.4
    if (!chart && !logo) continue
    // a panel behind body text (tip box, table) is not a figure
    const inside = page.lines.filter((l) => l.x0 >= c.box.x0 - 2 && l.x1 <= c.box.x1 + 2 && H - l.base >= c.box.y0 - 2 && H - l.base <= c.box.y1 + 2)
    if (inside.filter((l) => Math.abs(l.size - bodySize) < 0.6).length >= 3) continue
    if (logo && inside.length) continue
    const hit = figs.find((f) => meets(f.box, c.box))
    if (hit) hit.box = union(hit.box, c.box)
    else figs.push({ page: page.index, box: c.box, lines: [], caption: '', vector: true, logo: logo || undefined })
  }
  return figs
}

/**
 * A path inside a figure that is furniture, not picture: a hairline rule, a stroke or fill that encloses the whole figure
 * (frame, border, backdrop), or a page-edge frame. Drawn art (a map, a chart) is not matched, so it stays in the figure.
 */
export function isFrameOrRule(path: Box, fig: Box, vector: boolean, page: { width: number; height: number }): boolean {
  const w = path.x1 - path.x0
  const h = path.y1 - path.y0
  const tol = 4
  const encloses = path.x0 <= fig.x0 + tol && path.x1 >= fig.x1 - tol && path.y0 <= fig.y0 + tol && path.y1 >= fig.y1 - tol
  const edge = (w >= page.width * 0.9 && h >= page.height * 0.5) || (h >= page.height * 0.9 && w >= page.width * 0.5)
  const rule = !vector && Math.min(w, h) <= 2.5 && Math.max(w, h) >= 20
  return encloses || edge || rule
}
