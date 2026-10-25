// Vector drawings (a pie chart, a map) are pictures even when the PDF has no image XObject.
// Hairlines and page-sized tints are not. Boxes are top-down page points, same as layout images.

export interface DrawBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

const area = (b: DrawBox) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0)
const grow = (b: DrawBox, d: number): DrawBox => ({ x0: b.x0 - d, y0: b.y0 - d, x1: b.x1 + d, y1: b.y1 + d })
const meets = (a: DrawBox, b: DrawBox) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1
const union = (a: DrawBox, b: DrawBox): DrawBox => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) })

/**
 * Cluster path boxes into charts. A box that holds a long prose line is a panel or a table, not a picture.
 * `bodySize` is unused on purpose: chart labels are often the most common size on the page.
 */
export function clusterDrawings(
  page: { width: number; height: number; drawings?: DrawBox[]; lines: { x0: number; x1: number; y: number; size: number; text: string }[] },
): DrawBox[] {
  const pageArea = page.width * page.height
  const boxes = (page.drawings ?? []).filter((b) => {
    const w = b.x1 - b.x0
    const h = b.y1 - b.y0
    return area(b) > 0 && area(b) < pageArea * 0.5 && !(w > page.width * 0.6 && h < 3) && !(h > page.height * 0.6 && w < 3)
  })
  const clusters: { box: DrawBox; n: number }[] = []
  for (const b of boxes) {
    let c = { box: b, n: 1 }
    for (let i = clusters.length - 1; i >= 0; i--) {
      if (meets(grow(clusters[i].box, 8), c.box)) {
        c = { box: union(clusters[i].box, c.box), n: clusters[i].n + c.n }
        clusters.splice(i, 1)
      }
    }
    clusters.push(c)
  }
  const out: DrawBox[] = []
  for (const c of clusters) {
    const w = c.box.x1 - c.box.x0
    const h = c.box.y1 - c.box.y0
    if (c.n < 4 || w < 70 || h < 50) continue
    const prose = page.lines.filter((l) => {
      const cx = (l.x0 + l.x1) / 2
      const cy = l.y + l.size / 2
      return cx > c.box.x0 && cx < c.box.x1 && cy > c.box.y0 && cy < c.box.y1 && l.text.trim().length > 45
    })
    if (prose.length) continue
    out.push(c.box)
  }
  return out
}
