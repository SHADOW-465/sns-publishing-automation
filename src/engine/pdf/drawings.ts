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
    out.push(absorbLabels(c.box, page.lines))
  }
  return out
}

const CAPTION = /^(gr[aá]fica|grafico|gr[aá]fico|figura|cuadro|fig\.|table|graph|chart)\b/i

/** Axis numbers and pie labels sit just outside the paths. Pull those short labels into the picture; leave the caption and prose. */
function absorbLabels(box: DrawBox, lines: { x0: number; x1: number; y: number; size: number; text: string }[]): DrawBox {
  let b = box
  for (let pass = 0; pass < 4; pass++) {
    let grew = false
    for (const l of lines) {
      const t = l.text.trim()
      if (!t || t.length > 36 || CAPTION.test(t)) continue
      // a legend title ("Títulos normalizados") has no digit; a sentence does
      if (t.length > 28 && !/\d|%/.test(t)) continue
      if (t.split(/\s+/).length > 4 && !/\d|%/.test(t)) continue
      const cx = (l.x0 + l.x1) / 2
      const cy = l.y + l.size / 2
      const dx = Math.max(0, b.x0 - cx, cx - b.x1)
      const dy = Math.max(0, b.y0 - cy, cy - b.y1)
      if (dx > 96 || dy > 42) continue
      const next = union(b, { x0: l.x0 - 1, y0: l.y - 1, x1: l.x1 + 1, y1: l.y + l.size + 1 })
      if (next.x0 !== b.x0 || next.y0 !== b.y0 || next.x1 !== b.x1 || next.y1 !== b.y1) (b = next), (grew = true)
    }
    if (!grew) break
  }
  return b
}
