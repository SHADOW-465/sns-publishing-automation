import { useMemo } from 'react'
import { text, type Files } from '../engine/zip.ts'
import { resolvePath } from '../engine/xml.ts'
import { useObjectUrls } from './shared.tsx'

/** Renders one XHTML file of an EPUB with its own stylesheets and images (sandboxed, no scripts).
 *  `file` is relative to `base` (our EPUBs keep everything in OEBPS/; others may not). */
export function Preview({ files, file, base = 'OEBPS/' }: { files: Files; file?: string; base?: string }) {
  const images = useMemo(() => [...files].filter(([p]) => /\.(jpe?g|png|gif|svg|webp)$/i.test(p)), [files])
  const urls = useObjectUrls(images)

  const doc = useMemo(() => {
    const path = file ? base + file : ''
    const src = path ? files.get(path) : undefined
    if (!src) return ''
    const at = (href: string) => resolvePath(path, href)
    return text(src)
      .replace(/<\?xml[^>]*>/, '')
      .replace(/<link[^>]*href="([^"]+\.css)"[^>]*\/?>/g, (_, href: string) => `<style>${files.has(at(href)) ? text(files.get(at(href))!) : ''}</style>`)
      .replace('</head>', '<style>body{max-width:40em;margin:auto} .pb{color:#b45309;font:11px sans-serif;border:1px dashed;padding:0 3px;margin:0 2px}</style></head>')
      .replace(/(src|xlink:href)="([^"]+)"/g, (m, a: string, p: string) => (/^[a-z]+:/i.test(p) ? m : `${a}="${urls.get(at(p)) ?? p}"`))
      // show page markers so the reviewer can check them against the print book
      .replace(/<span([^>]*)id="page-([^"]+)"([^>]*)\/>/g, (_, a: string, n: string, b: string) => `<span${a}id="page-${n}"${b} class="pb">${n}</span>`)
  }, [files, file, base, urls])

  return <iframe className="preview" title={`Preview of ${file}`} sandbox="allow-same-origin" srcDoc={doc} />
}
