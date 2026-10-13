// Picture descriptions (alt text), filled in layers. A person who typed a description always wins.
// Otherwise the order is: the spec workbook, text already in the image file or the InDesign export,
// a decorative-image rule, then an AI draft. Placeholder words never count as a description.
// Decorative pictures get an empty alt (Börsenverein / W3C: screen readers skip them). A short
// description is about 140 characters; a chart or map can also carry a long description.

export type AltSource = 'spec' | 'file' | 'decorative' | 'ai' | 'typed'

export const ALT_SOURCE_LABEL: Record<AltSource, string> = {
  spec: 'Spec',
  file: 'Image file',
  decorative: 'Decorative rule',
  ai: 'AI draft',
  typed: 'Typed',
}

/** About 140 characters, the length Börsenverein recommends for a short description. */
export const ALT_AIM = 140

export interface SpecPicture {
  /** image file name, with or without a folder */
  file: string
  alt: string
  decorative: boolean
  longDesc: string
}

export interface AltLayers {
  /** what the reviewer typed; when set, nothing else is used */
  typed?: { alt: string; longDesc?: string; decorative?: boolean } | null
  spec?: { alt: string; longDesc?: string; decorative?: boolean } | null
  file?: { alt: string; longDesc?: string } | null
  /** a tiny image, ornament, rule, or background */
  decorative?: boolean
  ai?: { alt: string; longDesc?: string } | null
  /** caption beside the picture: a description that only repeats it is not used */
  caption?: string
}

export interface AltChoice {
  alt: string
  longDesc: string
  decorative: boolean
  source: AltSource
  /** false only for an AI draft nobody has approved */
  approved: boolean
}

const GENERIC_ALT = /^(image|imagen|picture|foto|photo|img|bild)\s*\d*$/i
const BAD_ALT = /\[Fehler\s*:|beschreibung von ki generiert|von ki generiert|ki[- ]generiert|alternativtext wurde nicht generiert|\bno alt(ernative)? text\b/i
const AI_TAIL = /(?:\s|\n)+beschreibung von ki generiert\.?\s*$/i

/** A file name, the word "Bild", or an AI boilerplate note is not a description. */
export function isPlaceholderAlt(alt: string): boolean {
  const t = alt.replace(/\u00a0/g, ' ').trim()
  if (!t) return true
  return BAD_ALT.test(t) || GENERIC_ALT.test(t) || /\.(jpe?g|png|gif|svg|webp|tiff?)$/i.test(t)
}

/**
 * Alt text already written on the picture in the InDesign export.
 * A real sentence followed by "Beschreibung von KI generiert" is an AI draft, not a finished description.
 */
export function classifyGivenAlt(raw: string): { kind: 'empty' | 'placeholder' | 'file' | 'ai'; text: string } {
  const t = raw.replace(/\u00a0/g, ' ').trim()
  if (!t) return { kind: 'empty', text: '' }
  const stripped = t.replace(AI_TAIL, '').trim()
  if (AI_TAIL.test(t) || /beschreibung von ki generiert/i.test(t)) {
    if (!stripped || isPlaceholderAlt(stripped)) return { kind: 'placeholder', text: '' }
    return { kind: 'ai', text: stripped }
  }
  if (isPlaceholderAlt(t)) return { kind: 'placeholder', text: '' }
  return { kind: 'file', text: t }
}

const norm = (s: string) => s.toLocaleLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim()

/** The description says the same thing as the caption, so a screen reader would hear it twice. */
export function repeatsCaption(alt: string, caption: string): boolean {
  const a = norm(alt)
  const c = norm(caption)
  if (a.length < 12 || c.length < 12) return false
  if (a === c) return true
  const short = a.length < c.length ? a : c
  const long = a.length < c.length ? c : a
  return short.length > 24 && long.includes(short)
}

const clean = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()

function usable(s: string | undefined, caption?: string): string {
  const t = clean(s)
  if (!t || isPlaceholderAlt(t)) return ''
  if (caption && repeatsCaption(t, caption)) return ''
  return t
}

/** Spec, then the image file, then a decorative rule, then an AI draft. Typed text wins over all of them. */
export function resolveAlt(layers: AltLayers): AltChoice {
  const caption = layers.caption
  if (layers.typed) {
    const decorative = !!layers.typed.decorative
    return {
      alt: decorative ? '' : clean(layers.typed.alt),
      longDesc: decorative ? '' : clean(layers.typed.longDesc),
      decorative,
      source: 'typed',
      approved: true,
    }
  }
  const specAlt = usable(layers.spec?.alt, caption)
  if (layers.spec && (specAlt || layers.spec.decorative)) {
    const decorative = !!layers.spec.decorative && !specAlt
    return {
      alt: decorative ? '' : specAlt,
      longDesc: decorative ? '' : clean(layers.spec.longDesc),
      decorative,
      source: 'spec',
      approved: true,
    }
  }
  const fileAlt = usable(layers.file?.alt, caption)
  if (fileAlt) {
    return { alt: fileAlt, longDesc: clean(layers.file?.longDesc), decorative: false, source: 'file', approved: true }
  }
  if (layers.decorative) {
    return { alt: '', longDesc: '', decorative: true, source: 'decorative', approved: true }
  }
  const aiAlt = usable(layers.ai?.alt, caption)
  if (aiAlt) {
    return { alt: aiAlt, longDesc: clean(layers.ai?.longDesc), decorative: false, source: 'ai', approved: false }
  }
  return { alt: '', longDesc: '', decorative: false, source: 'file', approved: true }
}

/** Trim a draft to about 140 characters, on a word boundary. */
export function fitAlt(s: string, max = ALT_AIM): string {
  const t = clean(s).replace(/^["“„]+|["”]+$/g, '').replace(/^(alternativtext|alt text|beschreibung)\s*:\s*/i, '')
  if (t.length <= max) return t
  const cut = t.slice(0, max + 1)
  const sp = cut.lastIndexOf(' ')
  return (sp > 60 ? cut.slice(0, sp) : t.slice(0, max)).replace(/[,:;.\s]+$/, '')
}

const fileBase = (s: string) => s.split(/[/\\]/).pop()!.trim().toLowerCase()
const fileStem = (s: string) => fileBase(s).replace(/\.[a-z0-9]+$/, '')

/** The spec row for this image: exact file name, or the same name without the extension. */
export function matchSpecPicture(src: string, specs: SpecPicture[]): SpecPicture | undefined {
  const base = fileBase(src)
  const stem = fileStem(src)
  return specs.find((s) => fileBase(s.file) === base) ?? specs.find((s) => fileStem(s.file) === stem && stem.length > 0)
}

export function yesNo(raw: string): boolean {
  return /^(y|yes|ja|j|true|1|dekorativ|decorative)$/i.test(raw.trim())
}

/** Stored answers from each layer, so a later spec import can be applied without losing the file text. */
export interface AltMemory {
  fileAlt: string
  fileLong: string
  decorativeHint: boolean
  aiAlt: string
  aiLong: string
}

export interface AltState {
  alt: string
  longDesc: string
  decorative: boolean
  source: AltSource
  approved: boolean
  /** the reviewer edited this picture; their text is kept */
  userSet: boolean
  caption: string
  layers: AltMemory
  spec: SpecPicture | null
}

/** Apply the layers to one picture. An approved AI draft stays approved when the text does not change. */
export function settleAlt<T extends AltState>(p: T): T {
  const choice = resolveAlt({
    typed: p.userSet ? { alt: p.alt, longDesc: p.longDesc, decorative: p.decorative } : null,
    spec: p.spec,
    file: p.layers.fileAlt ? { alt: p.layers.fileAlt, longDesc: p.layers.fileLong } : null,
    decorative: p.layers.decorativeHint,
    ai: p.layers.aiAlt ? { alt: p.layers.aiAlt, longDesc: p.layers.aiLong } : null,
    caption: p.caption,
  })
  const sameAi = choice.source === 'ai' && p.source === 'ai' && p.approved && choice.alt === p.alt
  return {
    ...p,
    alt: choice.alt,
    longDesc: choice.longDesc,
    decorative: choice.decorative,
    source: choice.source,
    approved: choice.source === 'ai' ? sameAi : choice.approved,
  }
}

export function altTally(images: Pick<AltState, 'alt' | 'decorative' | 'source'>[]): Record<AltSource | 'missing', number> {
  const count: Record<AltSource | 'missing', number> = { spec: 0, file: 0, decorative: 0, ai: 0, typed: 0, missing: 0 }
  for (const i of images) {
    const filled = i.decorative || (!!i.alt.trim() && !isPlaceholderAlt(i.alt))
    if (!filled) count.missing++
    else count[i.source]++
  }
  return count
}

const LONG_DESC = new Set(['karte', 'landkarte', 'stadtplan', 'lageplan', 'diagramm', 'grafik', 'chart', 'map', 'graph', 'schema', 'zeitstrahl', 'infografik', 'grundriss'])

/** A chart, map, or diagram needs a long description as well as the short one. */
export function needsLongDescription(name: string, caption: string, alt: string): boolean {
  const tokens = `${name} ${caption} ${alt}`.toLowerCase().split(/[^a-z0-9äöüß]+/).filter(Boolean)
  return tokens.some((t) => LONG_DESC.has(t))
}

const ORNAMENT = new Set(['ornament', 'fleuron', 'dingbat', 'flourish', 'vignette', 'separator', 'divider', 'schmuck', 'zier', 'zierleiste', 'bullet'])
const BACKGROUND = new Set(['background', 'bg', 'hintergrund', 'watermark', 'wasserzeichen'])
const RULE = new Set(['rule', 'hline', 'linie', 'trenner', 'line'])

/** Tiny images, ornaments, rules, and backgrounds are suggested as decorative. The reviewer can untick that. */
export function decorativeReason(img: { name: string; width: number; height: number }): string | undefined {
  const tokens = img.name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  const has = (set: Set<string>) => tokens.some((t) => set.has(t))
  if (has(ORNAMENT)) return 'The file name looks like an ornament.'
  if (has(BACKGROUND)) return 'The file name looks like a background.'
  const { width: w, height: h } = img
  if (w > 0 && h > 0 && ((h <= 12 && w >= h * 8) || (w <= 12 && h >= w * 8))) return 'This image is a thin line or rule.'
  if (has(RULE) && (h <= 24 || w <= 24)) return 'The file name looks like a rule or line.'
  if (w > 0 && h > 0 && w <= 32 && h <= 32) return 'This image is tiny, so it is probably decorative.'
  return undefined
}

function findAscii(bytes: Uint8Array, needle: string): number {
  const n = new TextEncoder().encode(needle)
  outer: for (let i = 0; i + n.length <= bytes.length; i++) {
    for (let j = 0; j < n.length; j++) if (bytes[i + j] !== n[j]) continue outer
    return i
  }
  return -1
}

function xmpValue(xml: string, local: string): string {
  // Case-sensitive: dc:description must not match the rdf:Description wrapper.
  const re = new RegExp(`<(?:(?!rdf:)[\\w.-]+:)?${local}\\b[^>]*>([\\s\\S]*?)</(?:(?!rdf:)[\\w.-]+:)?${local}>`)
  const m = xml.match(re)
  if (!m) return ''
  const li = m[1].match(/<rdf:li\b[^>]*>([\s\S]*?)<\/rdf:li>/i)
  return (li?.[1] ?? m[1])
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/** IPTC IIM dataset inside a JPEG APP13 segment. 120 = caption, 105 = headline, 5 = object name. */
function iptcDataset(segment: Uint8Array, dataset: number): string {
  for (let i = 0; i + 5 < segment.length; i++) {
    if (segment[i] !== 0x1c || segment[i + 1] !== 2 || segment[i + 2] !== dataset) continue
    const len = (segment[i + 3] << 8) | segment[i + 4]
    if (len <= 0 || len > 4000 || i + 5 + len > segment.length) continue
    const text = new TextDecoder('utf-8', { fatal: false }).decode(segment.subarray(i + 5, i + 5 + len)).replace(/\0/g, '').trim()
    if (/\p{L}/u.test(text)) return text
  }
  return ''
}

function jpegApp(bytes: Uint8Array, marker: number): Uint8Array[] {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return []
  const out: Uint8Array[] = []
  let i = 2
  while (i + 4 < bytes.length && bytes[i] === 0xff) {
    const m = bytes[i + 1]
    if (m === 0xda || m === 0xd9) break
    const len = (bytes[i + 2] << 8) | bytes[i + 3]
    if (len < 2 || i + 2 + len > bytes.length) break
    if (m === marker) out.push(bytes.subarray(i + 4, i + 2 + len))
    i += 2 + len
  }
  return out
}

export interface ImageMetaAlt {
  alt: string
  longDesc: string
  /** which field the short text came from */
  from: 'accessibility' | 'description' | 'title'
}

/**
 * Alt text already stored in the image: XMP Alt Text (Accessibility), then Description, then Title.
 * IPTC caption and object name are the same two fields when the file has no XMP.
 */
export function readImageMetadata(bytes: Uint8Array): ImageMetaAlt | undefined {
  const start = findAscii(bytes, '<x:xmpmeta')
  const end = start >= 0 ? findAscii(bytes.subarray(start), '</x:xmpmeta>') : -1
  const xml = start >= 0 && end > 0 ? new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(start, start + end + '</x:xmpmeta>'.length)) : ''
  const accessibility = xml ? xmpValue(xml, 'AltTextAccessibility') : ''
  const ext = xml ? xmpValue(xml, 'ExtDescrAccessibility') : ''
  const description = (xml ? xmpValue(xml, 'description') : '') || jpegApp(bytes, 0xed).map((s) => iptcDataset(s, 120)).find(Boolean) || ''
  const title = (xml ? xmpValue(xml, 'title') : '') || jpegApp(bytes, 0xed).map((s) => iptcDataset(s, 105) || iptcDataset(s, 5)).find(Boolean) || ''
  const pick = (alt: string, from: ImageMetaAlt['from']): ImageMetaAlt | undefined => {
    const text = clean(alt)
    if (!text || isPlaceholderAlt(text)) return undefined
    return { alt: text, longDesc: clean(ext), from }
  }
  return pick(accessibility, 'accessibility') ?? pick(description, 'description') ?? pick(title, 'title')
}
