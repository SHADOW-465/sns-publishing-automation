// Which file may go in a slot. Windows often leaves file.type empty, so the name's extension counts too.

const EXT: Record<string, string[]> = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/jpg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/gif': ['.gif'],
  'image/webp': ['.webp'],
  'application/pdf': ['.pdf'],
  'application/epub+zip': ['.epub'],
  'application/zip': ['.zip'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
}

export function fileAllowed(accept: string, file: { name: string; type: string }): boolean {
  const parts = accept.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  if (!parts.length) return true
  const name = file.name.toLowerCase()
  const type = file.type.toLowerCase()
  return parts.some((a) => {
    if (a.startsWith('.')) return name.endsWith(a)
    if (a.endsWith('/*')) return !!type && type.startsWith(a.slice(0, -1))
    if (type && type !== 'application/octet-stream' && type === a) return true
    return (EXT[a] ?? []).some((e) => name.endsWith(e))
  })
}

export function rejectText(accept: string): string {
  const parts = accept.split(',').map((s) => s.trim().toLowerCase())
  if (parts.every((p) => p === 'image/jpeg' || p === 'image/png' || p === 'image/jpg' || p === '.jpg' || p === '.jpeg' || p === '.png')) return 'Only a JPG or PNG image can go here.'
  if (parts.every((p) => p === 'application/pdf' || p === '.pdf')) return 'Only a PDF can go here.'
  return 'That file type is not accepted here.'
}
