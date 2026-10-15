// Where a block (a picture with its caption) can be put in a page's markup without breaking the text:
// never inside a paragraph, list item, table cell or heading. A page marker is often a <span> in the
// middle of a paragraph, so "right after the marker" has to move to the edge of that paragraph.

const TAG = /<(\/?)([a-z][a-z0-9]*)\b[^>]*?(\/?)>/gi
const STRUCTURE = new Set(['p', 'li', 'td', 'th', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'table', 'ul', 'ol', 'figure', 'div', 'section', 'nav', 'aside'])
const UNSAFE = new Set(['p', 'li', 'td', 'th', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'table', 'ul', 'ol', 'figure'])

interface Open {
  name: string
  start: number // index of "<"
  end: number // index after ">"
}

/** Elements open at `pos`, outermost first, and where the scan stopped. */
function openAt(html: string, pos: number): Open[] {
  const stack: Open[] = []
  TAG.lastIndex = 0
  for (let m = TAG.exec(html); m && m.index < pos; m = TAG.exec(html)) {
    const name = m[2].toLowerCase()
    if (!STRUCTURE.has(name) || m[3]) continue
    if (m[1]) {
      const at = stack.findLastIndex((o) => o.name === name)
      if (at >= 0) stack.length = at
    } else stack.push({ name, start: m.index, end: m.index + m[0].length })
  }
  return stack
}

/**
 * The index where a block belonging to the marker at `pos` can be inserted.
 * Outside text blocks that is `pos` itself. Inside one, it is the start of the outermost such block
 * when the marker opens it (the page starts with that paragraph), otherwise the end of it.
 * `side: 'before'` always means the start: the block closes the page that ended just before the marker.
 */
export function blockBoundary(html: string, pos: number, side: 'before' | 'after'): number {
  const stack = openAt(html, pos)
  const outer = stack.findIndex((o) => UNSAFE.has(o.name))
  if (outer < 0) return pos
  const el = stack[outer]
  if (side === 'before') return el.start
  // the marker is the first thing inside the block (only tags and other markers before it)
  const lead = html.slice(el.end, pos).replace(/<[^>]*>/g, '')
  if (!lead.trim()) return el.start
  // otherwise: after the closing tag of that block
  TAG.lastIndex = pos
  let depth = 1
  for (let m = TAG.exec(html); m; m = TAG.exec(html)) {
    if (m[2].toLowerCase() !== el.name || m[3]) continue
    depth += m[1] ? -1 : 1
    if (!depth) return m.index + m[0].length
  }
  return html.length
}

/** `html` with `chunk` inserted next to the marker matched by `re` (see blockBoundary); undefined when there is no such marker. */
export function insertAtMarker(html: string, re: RegExp, chunk: string, side: 'before' | 'after'): string | undefined {
  const m = re.exec(html)
  if (!m) return undefined
  const at = blockBoundary(html, side === 'before' ? m.index : m.index + m[0].length, side)
  return `${html.slice(0, at)}${at > 0 && html[at - 1] !== '\n' ? '\n' : ''}${chunk}\n${html.slice(at).replace(/^\n/, '')}`
}
