// =============================================================================================
// Client layers that ship with the tool: the house style a client has already asked for, so the
// same words and options apply every time that publisher's book is built. A layer saved in the
// store (the client edited it in the Spec step) always wins over the one shipped here.
// Data only: the layers are JSON files in src/clients/, listed in src/clients/index.ts.
// =============================================================================================
import { emptyLayer, type Layer, type Level } from './layers.ts'
import type { RuleValue } from './rules.ts'
import type { MarkupRole, MarkupTemplate, StyleRule } from '../settings.ts'
import { CLIENT_FILES } from '../../clients/index.ts'

export interface ClientFile {
  /** matches the publisher name with spaces, case and punctuation ignored, from the start ("BeBra Verlag GmbH") */
  match: string
  name: string
  /** where the requirement was written down */
  file: string
  /** rule ID → value */
  values?: Record<string, RuleValue>
  labels?: Record<string, Record<string, string>>
  markup?: Partial<Record<MarkupRole, MarkupTemplate>>
  styleMap?: Record<string, StyleRule>
  css?: string
}

const squash = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

/** The layer shipped for this client, or undefined. Only the client level has one today. */
export function bundledLayer(level: Level, name: string, files: ClientFile[] = CLIENT_FILES): Layer | undefined {
  if (level !== 'client' || !name.trim()) return undefined
  const key = squash(name)
  const c = files.find((x) => key.startsWith(x.match))
  if (!c) return undefined
  const layer = emptyLayer('client', name)
  layer.values = { ...(c.values ?? {}) }
  layer.labels = c.labels
  layer.markup = c.markup
  layer.styleMap = c.styleMap
  layer.css = c.css
  for (const id of Object.keys(layer.values)) layer.sources[id] = { file: c.file, where: 'client style', text: `${id} = ${String(layer.values[id])}`, by: 'person' }
  return layer
}
