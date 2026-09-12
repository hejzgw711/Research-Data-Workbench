import { useEffect, useState } from 'react'

export function NumericInput({ value, onChange, min, max, step = 1, label, disabled = false }: {
  value: number; onChange: (value: number) => void; min?: number; max?: number;
  step?: number | 'any'; label: string; disabled?: boolean
}) {
  const displayValue = Number.isFinite(value) ? String(value) : ''
  const [draft, setDraft] = useState(displayValue)
  const [editing, setEditing] = useState(false)
  useEffect(() => { if (!editing) setDraft(displayValue) }, [displayValue, editing])
  const commit = (raw: string) => {
    if (raw.trim() === '') return
    const next = Number(raw)
    if (Number.isFinite(next) && (min === undefined || next >= min) && (max === undefined || next <= max)) onChange(next)
  }
  const adjust = (direction: number) => {
    const current = editing && draft.trim() !== '' && Number.isFinite(Number(draft)) ? Number(draft) : Number.isFinite(value) ? value : 0
    const increment = typeof step === 'number' ? step : 1
    const next = Number(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, current + direction * increment)).toPrecision(12))
    setDraft(String(next)); onChange(next)
  }
  return <span className="numeric-field"><input type="number" aria-label={label} value={editing ? draft : displayValue} min={min} max={max} step="any" disabled={disabled}
    onFocus={() => { setDraft(displayValue); setEditing(true) }}
    onChange={event => { setDraft(event.target.value); commit(event.target.value) }}
    onKeyDown={event => { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); adjust(event.key === 'ArrowUp' ? 1 : -1) } }}
    onBlur={() => { commit(draft); setEditing(false) }} /><span className="numeric-arrows"><button type="button" disabled={disabled} tabIndex={-1} aria-label={`${label} 增加`} onMouseDown={e => e.preventDefault()} onClick={() => adjust(1)}>▴</button><button type="button" disabled={disabled} tabIndex={-1} aria-label={`${label} 减少`} onMouseDown={e => e.preventDefault()} onClick={() => adjust(-1)}>▾</button></span></span>
}
