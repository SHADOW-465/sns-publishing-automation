import { useRef, useState } from 'react'
import { Icon } from './icons.tsx'

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

const accepted = (accept: string, f: File) => {
  const parts = accept.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  if (!parts.length) return true
  const name = f.name.toLowerCase()
  const type = f.type.toLowerCase()
  return parts.some((a) => (a.startsWith('.') ? name.endsWith(a) : a.endsWith('/*') ? type.startsWith(a.slice(0, -1)) : type === a))
}

const rejectText = (accept: string) => {
  const parts = accept.split(',').map((s) => s.trim().toLowerCase())
  if (parts.every((p) => p === 'image/jpeg' || p === 'image/png' || p === 'image/jpg' || p === '.jpg' || p === '.jpeg' || p === '.png')) return 'Only a JPG or PNG image can go here.'
  if (parts.every((p) => p === 'application/pdf' || p === '.pdf')) return 'Only a PDF can go here.'
  return 'That file type is not accepted here.'
}

export function FileDrop(props: { label: string; hint: string; accept: string; value?: Picked; onPick: (f: Picked) => void; required?: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const [reject, setReject] = useState('')
  const take = async (f?: File | null) => {
    if (!f) return
    if (!accepted(props.accept, f)) {
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
      <button type="button" className="drop-btn" onClick={() => input.current?.click()}>
        <span className="drop-ic">
          <Icon name={props.value ? 'check' : 'upload'} size={20} />
        </span>
        <strong>
          {props.label}
          {props.required ? <em className="req"> required</em> : <em className="opt"> optional</em>}
        </strong>
        <span>{props.value ? `${props.value.name} · ${fileSize(props.value.data.length)}` : props.hint}</span>
        <small className="drop-cta">{props.value ? 'Replace file' : 'Choose a file or drop it here'}</small>
      </button>
      <input ref={input} type="file" accept={props.accept} hidden onChange={(e) => (take(e.target.files?.[0]), (e.target.value = ''))} />
      {reject && <p className="err small">{reject}</p>}
    </div>
  )
}
