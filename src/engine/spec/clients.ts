// =============================================================================================
// Client layers that ship with the tool: the house style a client has already asked for, so the
// same words and options apply every time that publisher's book is built. A layer saved in the
// store (the client edited it in the Spec step) always wins over the one shipped here.
// Data only: add a client by adding an entry, never by branching in the engine.
// =============================================================================================
import { emptyLayer, type Layer, type Level } from './layers.ts'
import type { RuleValue } from './rules.ts'

interface ClientStyle {
  /** matches the publisher name with spaces, case and punctuation ignored, from the start ("BeBra Verlag GmbH") */
  match: string
  name: string
  /** rule ID → value */
  values: Record<string, RuleValue>
  labels?: Record<string, Record<string, string>>
  /** where the requirement was written down */
  file: string
}

const CLIENT_STYLES: ClientStyle[] = [
  {
    // EPUB-Automation-Report, 15-10-26, review of Das Tempelhofer Feld
    match: 'bebraverlag',
    name: 'BeBra Verlag',
    file: 'EPUB-Automation-Report (15-10-26)',
    values: {
      'HD-07': 'h2', // a chapter title is an h2, never a classed paragraph
      'HD-08': 'chapter-b', // a chapter that has only a title takes class chapter-b
      'NAV-02': 'show', // the printed contents page keeps its page numbers, right-aligned
      'NAV-03': true, // the menu shows the subtitle the contents page lists under the chapter
      'NAV-01': 0, // entries start flush left, as in print
      'PKG-01': 'reserved', // the package declares the text-and-data-mining reservation
    },
    labels: { de: { coverTitle: 'Abdeckung' } }, // "Wrong title name in cover": the cover page is titled Abdeckung, the menu still says Umschlag
  },
]

const squash = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

/** The layer shipped for this client, or undefined. Only the client level has one today. */
export function bundledLayer(level: Level, name: string): Layer | undefined {
  if (level !== 'client' || !name.trim()) return undefined
  const key = squash(name)
  const c = CLIENT_STYLES.find((x) => key.startsWith(x.match))
  if (!c) return undefined
  const layer = emptyLayer('client', name)
  layer.values = { ...c.values }
  layer.labels = c.labels
  for (const id of Object.keys(c.values)) layer.sources[id] = { file: c.file, where: 'client style', text: `${id} = ${String(c.values[id])}`, by: 'person' }
  return layer
}
