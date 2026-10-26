// A folder from the browser, as the files in it: the folder button (webkitRelativePath) and a folder dropped on a slot
// (DataTransferItem.webkitGetAsEntry). Both come back as { name, entries } with paths relative to the folder's parent.

export interface FolderFiles {
  name: string
  entries: { path: string; data: Uint8Array }[]
}

const bytesOf = async (f: File) => new Uint8Array(await f.arrayBuffer())

/** The folder button: every file knows its path from the folder's parent ("Export/OEBPS/book.xhtml"). */
export async function filesOfFolder(list: FileList): Promise<FolderFiles> {
  const files = [...list]
  const path = (f: File) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name
  return { name: path(files[0]).split('/')[0], entries: await Promise.all(files.map(async (f) => ({ path: path(f), data: await bytesOf(f) }))) }
}

/** A dropped folder, when the drop is one: undefined for a plain file. */
export function filesOfDropped(dt: DataTransfer): Promise<FolderFiles> | undefined {
  const entry = dt.items?.[0]?.webkitGetAsEntry?.()
  if (!entry?.isDirectory) return undefined
  const dir = entry as FileSystemDirectoryEntry
  const walk = async (d: FileSystemDirectoryEntry, at: string): Promise<{ path: string; data: Uint8Array }[]> => {
    const reader = d.createReader()
    const kids: FileSystemEntry[] = []
    // readEntries returns a batch (100 in Chrome) at a time, until an empty one
    for (let batch = await new Promise<FileSystemEntry[]>((ok, no) => reader.readEntries(ok, no)); batch.length; batch = await new Promise<FileSystemEntry[]>((ok, no) => reader.readEntries(ok, no))) kids.push(...batch)
    const out: { path: string; data: Uint8Array }[] = []
    for (const k of kids) {
      if (k.isDirectory) out.push(...(await walk(k as FileSystemDirectoryEntry, `${at}${k.name}/`)))
      else out.push({ path: `${at}${k.name}`, data: await bytesOf(await new Promise<File>((ok, no) => (k as FileSystemFileEntry).file(ok, no))) })
    }
    return out
  }
  return walk(dir, `${dir.name}/`).then((entries) => ({ name: dir.name, entries }))
}
