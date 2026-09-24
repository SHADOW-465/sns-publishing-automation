import { useRef, useState } from 'react'

export interface Picked {
  name: string
  data: Uint8Array
}

export function FileDrop(props: { label: string; hint: string; accept: string; value?: Picked; onPick: (f: Picked) => void; required?: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const take = async (f?: File | null) => {
    if (f) props.onPick({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })
  }
  return (
    <div
      className={`drop ${over ? 'over' : ''} ${props.value ? 'has' : ''}`}
      onDragOver={(e) => (e.preventDefault(), setOver(true))}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => (e.preventDefault(), setOver(false), take(e.dataTransfer.files[0]))}
    >
      <button type="button" className="drop-btn" onClick={() => input.current?.click()}>
        <strong>
          {props.label}
          {props.required ? ' *' : ''}
        </strong>
        <span>{props.value ? `✓ ${props.value.name} (${(props.value.data.length / 1024 / 1024).toFixed(1)} MB)` : props.hint}</span>
      </button>
      <input ref={input} type="file" accept={props.accept} hidden onChange={(e) => take(e.target.files?.[0])} />
    </div>
  )
}
