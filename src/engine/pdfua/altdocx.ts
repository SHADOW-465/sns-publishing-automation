import { unzip, text } from '../zip.ts'
import { parseXml } from '../xml.ts'
import type { Figure } from './structure.ts'

// Alt texts supplied as a Word file. Two layouts in the samples:
//  * "Cover image: …", "Map 1: …", then one description per paragraph (Simple)
//  * "Abb. II.1 <title>" followed by "Alt-Text: „…“" (Medium) — matched to the figure caption

export interface AltEntry {
  label?: string
  text: string
}

export function readAltDocx(data: Uint8Array): AltEntry[] {
  const files = unzip(data)
  const xml = files.get('word/document.xml')
  if (!xml) throw new Error('The alt-text file is not a .docx Word document.')
  const doc = parseXml(text(xml), 'word/document.xml')
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
  const paras = Array.from(doc.getElementsByTagNameNS(W, 'p'))
    .map((p) => Array.from(p.getElementsByTagNameNS(W, 't')).map((t) => t.textContent ?? '').join('').replace(/\s+/g, ' ').trim())
    .filter((t) => t && !/^[.…\s]+$/.test(t))
  const out: AltEntry[] = []
  for (let i = 0; i < paras.length; i++) {
    const t = paras[i]
    const alt = t.match(/^alt[- ]?te(xt|xto)\s*:\s*(.*)$/i)
    if (alt) {
      const prev = out[out.length - 1]
      const body = alt[2].replace(/^[„“"«]|[“”"»]$/g, '').trim()
      if (prev && !prev.text) prev.text = body
      else out.push({ text: body })
      continue
    }
    if (/^(abb\.|abbildung|fig\.|figure|tab\.|tabelle|table|plate|lámina)\s*[\divxlc]/i.test(t) && !/:\s*\S{20,}/.test(t)) {
      out.push({ label: t, text: '' }) // caption line; its alt text follows
      continue
    }
    if (i === 0 && /alt[- ]?te(xt|xte)/i.test(t) && t.length < 120 && !t.includes(':')) continue // document title
    const m = t.match(/^([^:]{2,40}):\s*(.+)$/)
    if (m && !/[.!?]/.test(m[1])) out.push({ label: m[1].trim(), text: m[2].trim() })
    else out.push({ text: t })
  }
  return out.filter((e) => e.text)
}

const key = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '')

/**
 * Give figures their alt text: first by label (caption "Abb. II.1", "Map 2", cover), then the
 * remaining descriptions in order to the remaining full-size figures. Returns the unused entries.
 */
export function matchAlt(figures: Figure[], entries: AltEntry[], pageArea: number): { unused: AltEntry[] } {
  const left = [...entries]
  const take = (e: AltEntry) => left.splice(left.indexOf(e), 1)
  for (const f of figures) {
    const cap = key(f.caption)
    const e = left.find((x) => x.label && ((cap && key(x.label).length >= 3 && (cap.startsWith(key(x.label)) || cap.startsWith(key(x.label.split(/\s+/).slice(0, 2).join(' '))))) || (f.page === 0 && /cover|cubierta|umschlag|couverture/i.test(x.label))))
    if (e && f.node) {
      f.node.alt = e.text
      take(e)
    }
  }
  const big = (f: Figure) => (f.box.x1 - f.box.x0) * (f.box.y1 - f.box.y0) > pageArea * 0.04
  for (const f of figures) {
    if (!f.node || f.node.alt || !big(f)) continue
    const e = left.find((x) => !x.label || !/^(abb\.|fig|tab)/i.test(x.label))
    if (!e) break
    f.node.alt = e.text
    take(e)
  }
  return { unused: left }
}
