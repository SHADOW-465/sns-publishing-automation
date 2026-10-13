import { useEffect, useId, useState } from 'react'
import { Icon } from './icons.tsx'
import { fileAllowed, rejectText } from './file-accept.ts'

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

export function FileDrop(props: { label: string; hint: string; accept: string; value?: Picked; onPick: (f: Picked) => void; required?: boolean }) {
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
  return (
    <div
      className={`drop ${over ? 'over' : ''} ${props.value ? 'has' : ''}`}
      onDragOver={(e) => (e.preventDefault(), setOver(true))}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => (e.preventDefault(), setOver(false), take(e.dataTransfer.files[0]))}
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
      {reject && <p className="err small">{reject}</p>}
    </div>
  )
}
