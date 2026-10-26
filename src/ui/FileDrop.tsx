import { useEffect, useId, useState } from 'react'
import { Icon } from './icons.tsx'
import { fileAllowed, rejectText } from './file-accept.ts'
import { filesOfFolder, filesOfDropped } from './folder-pick.ts'
import { packFolder, zipFiles } from '../engine/indesign/package.ts'

export interface Picked {
  name: string
  data: Uint8Array
}

const fileSize = (n: number) => {
  if (n < 1024 * 1024) {
    const kb = n / 1024
    return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`
  }
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** `folder`: the slot also takes a folder (chosen with its own button, or dropped), packed in memory into the zip the file path reads */
export function FileDrop(props: { label: string; hint: string; accept: string; value?: Picked; onPick: (f: Picked) => void; required?: boolean; folder?: boolean }) {
  const id = useId()
  const [over, setOver] = useState(false)
  const [reject, setReject] = useState('')
  // A file that landed in the wrong slot used to leave its error behind after the right file was chosen.
  useEffect(() => {
    if (props.value) setReject('')
  }, [props.value])
  const take = async (f?: File | null) => {
    if (!f) return
    if (!fileAllowed(props.accept, f)) {
      setReject(rejectText(props.accept))
      return
    }
    setReject('')
    props.onPick({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })
  }
  const takeFolder = async (read: Promise<{ name: string; entries: { path: string; data: Uint8Array }[] }>) => {
    try {
      const { name, entries } = await read
      const files = packFolder(entries)
      if (!files.size) return setReject('That folder has no files in it.')
      setReject('')
      props.onPick({ name: `${name}.zip`, data: zipFiles(files) })
    } catch (e) {
      setReject(`The folder could not be read: ${(e as Error).message}`)
    }
  }
  return (
    <div
      className={`drop ${over ? 'over' : ''} ${props.value ? 'has' : ''}`}
      onDragOver={(e) => (e.preventDefault(), setOver(true))}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const dropped = props.folder ? filesOfDropped(e.dataTransfer) : undefined
        if (dropped) void takeFolder(dropped)
        else void take(e.dataTransfer.files[0])
      }}
    >
      <input id={id} className="file-input" type="file" accept={props.accept} onChange={(e) => (take(e.target.files?.[0]), (e.target.value = ''))} />
      <label htmlFor={id} className="drop-btn">
        <span className="drop-ic">
          <Icon name={props.value ? 'check' : 'upload'} size={20} />
        </span>
        <strong>
          {props.label}
          {props.required ? <em className="req"> required</em> : <em className="opt"> optional</em>}
        </strong>
        <span>{props.value ? `${props.value.name} · ${fileSize(props.value.data.length)}` : props.hint}</span>
        <small className="drop-cta">{props.value ? 'Replace file' : 'Choose a file or drop it here'}</small>
      </label>
      {props.folder && (
        <>
          {/* webkitdirectory is not in React's typings; every current browser and the desktop shell read it */}
          <input id={`${id}-dir`} className="file-input" type="file" {...{ webkitdirectory: '' }} onChange={(e) => (e.target.files?.length && void takeFolder(filesOfFolder(e.target.files)), (e.target.value = ''))} />
          <label htmlFor={`${id}-dir`} className="drop-folder">
            <small className="drop-cta">…or choose a folder (the export unzipped)</small>
          </label>
        </>
      )}
      {reject && <p className="err small">{reject}</p>}
    </div>
  )
}
