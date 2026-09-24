import { useMemo } from 'react'
import { text, type Files } from '../engine/zip.ts'
import { useObjectUrls } from './shared.tsx'

/** Renders one XHTML file of the built EPUB with its stylesheet and images (sandboxed, no scripts). */
export function Preview({ files, file }: { files: Files; file?: string }) {
  const images = useMemo(() => [...files].filter(([p]) => p.startsWith('OEBPS/images/')).map(([p, d]) => [p.slice(6), d] as [string, Uint8Array]), [files])
  const urls = useObjectUrls(images)

  const doc = useMemo(() => {
    const src = file ? files.get(`OEBPS/${file}`) : undefined
    if (!src) return ''
    const css = text(files.get('OEBPS/css/style.css')!)
    return text(src)
      .replace(/<\?xml[^>]*>/, '')
      .replace(/<link[^>]*style\.css"[^>]*\/>/, `<style>${css} body{max-width:40em;margin:auto} .pb{color:#b45309;font:11px sans-serif;border:1px dashed;padding:0 3px;margin:0 2px}</style>`)
      .replace(/src="(images\/[^"]+)"/g, (_, p: string) => `src="${urls.get(p) ?? p}"`)
      // show page markers so the reviewer can check them against the print book
      .replace(/<span([^>]*)id="page-([^"]+)"([^>]*)\/>/g, (_, a: string, n: string, b: string) => `<span${a}id="page-${n}"${b} class="pb">${n}</span>`)
  }, [files, file, urls])

  return <iframe className="preview" title={`Preview of ${file}`} sandbox="allow-same-origin" srcDoc={doc} />
}
