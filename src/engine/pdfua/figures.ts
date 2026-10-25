import type { Box, Paint } from './content.ts'
import type { PLine } from '../pdfepub/analyze.ts'
import type { Figure } from './structure.ts'
import { insideBox } from './pages.ts'

// Figures on a page: placed images, and charts/diagrams drawn as vector paths (the Medium sample
// has 13 such charts and no images at all). Text boxes with a tinted background are not figures.

/** What a page paints, with the content of its forms folded in: forms that draw pictures hide them from a flat list. */
export const leaves = (ps: (Paint | null)[]): Paint[] => ps.flatMap((p) => (!p ? [] : p.kind === 'form' ? [p, ...leaves(p.inner ?? [])] : [p]))

/** Smallest side of a painted picture that counts: below this it is a hairline or a spacer, not a picture. */
export const MIN_PICTURE = 6
/** A drawn mark smaller than this on a side is a bullet or a dot of the text, not an ornament. */
export const MIN_ORNAMENT = 12

const area = (b: Box) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0)
const grow = (b: Box, d: number): Box => ({ x0: b.x0 - d, y0: b.y0 - d, x1: b.x1 + d, y1: b.y1 + d })
const meets = (a: Box, b: Box) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1
const union = (a: Box, b: Box): Box => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) })

export function detectFigures(
  page: { index: number; width: number; height: number; lines: PLine[]; images: { x0: number; y0: number; x1: number; y1: number; jpeg?: Uint8Array | null }[] },
  paints: (Paint | null)[], bodySize: number, opts: { logos?: 'artifact' | 'figure'; /** the trim box in user space: what lies outside it is slug */ trim?: Box } = {},
): Figure[] {
  const H = page.height
  const W = page.width
  const pageArea = W * H
  const figs: Figure[] = []
  // printer's slug, colour bars and bleed marks lie outside the trim: they are furniture, not pictures (PAR-002)
  const onPage = (b: Box) => !opts.trim || insideBox(b, opts.trim)
  const flat = leaves(paints)
  const add = (box: Box, image?: Uint8Array | null) => {
    if (box.x1 - box.x0 < MIN_PICTURE || box.y1 - box.y0 < MIN_PICTURE || !onPage(box)) return
    const hit = figs.find((f) => !f.vector && meets(f.box, box) && area(box) > 0)
    if (hit) (hit.box = union(hit.box, box)), (hit.image ??= image)
    else figs.push({ page: page.index, box, lines: [], caption: '', image, vector: false })
  }
  // placed images (layout boxes are top-down: flip to PDF space). The text layer misses masks and inline images, so the painted ones are read from the content stream too (PFG-001).
  for (const im of page.images) add({ x0: im.x0, x1: im.x1, y0: H - im.y1, y1: H - im.y0 }, im.jpeg)
  for (const p of flat) if (p.kind === 'image') add(p.box)
  // vector drawings: cluster path boxes that touch (with a small margin)
  const boxes = flat
    .filter((p): p is Extract<Paint, { kind: 'path' }> => p.kind === 'path')
    .map((p) => p.box)
    .filter((b) => onPage(b) && area(b) < pageArea * 0.5 && !(b.x1 - b.x0 > W * 0.6 && b.y1 - b.y0 < 3)) // not slug, page tints, rules
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
  // drawn ornaments and dividers: shapes (curves, polygons) with no text in them and no picture already there. A box, a rule or a plain
  // frame is furniture; a mark that is small enough to be an ornament is a picture of its own (PFG-001, PAR-004).
  const shapes: Box[] = []
  for (const p of flat) if (p.kind === 'path' && p.mark && onPage(p.box)) shapes.push(p.box)
  for (const c of ornamentMarks(shapes, page)) if (!figs.some((f) => meets(f.box, c))) figs.push({ page: page.index, box: c, lines: [], caption: '', vector: true })
  return figs
}

/** Drawn marks (curves, polygons) that group into an ornament: small enough, and with no text in them (a panel or a speech bubble is not one). */
export function ornamentMarks(shapes: Box[], page: { width: number; height: number; lines: PLine[] }): Box[] {
  const H = page.height
  return clusterBoxes(shapes.filter((b) => area(b) < page.width * H * 0.2), 4).filter((c) => {
    const w = c.x1 - c.x0
    const h = c.y1 - c.y0
    if (w < MIN_ORNAMENT || h < MIN_ORNAMENT || w > page.width * 0.4 || h > H * 0.4) return false
    return !page.lines.some((l) => l.x1 > c.x0 && l.x0 < c.x1 && l.y + l.size > H - c.y1 && l.y < H - c.y0)
  })
}

/** Boxes that touch (within `gap`) are one group. */
export function clusterBoxes(boxes: Box[], gap: number): Box[] {
  const out: Box[] = []
  for (const b of boxes) {
    let c = b
    for (let i = out.length - 1; i >= 0; i--) {
      if (meets(grow(out[i], gap), c)) {
        c = union(out[i], c)
        out.splice(i, 1)
      }
    }
    out.push(c)
  }
  return out
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
