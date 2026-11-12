import { useState } from 'react'
import { parseDateKey, type WeekDay } from '../api.ts'

interface Props {
  days: WeekDay[]
  saving: boolean
  error: string | null
  onConfirm: (rejectedEntryIds: number[], reason: string) => void
  onClose: () => void
}

const dayLabel = (date: string) =>
  parseDateKey(date).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })

// Rechazo de la semana: el supervisor marca los días con el problema e indica el motivo.
// Solo esos días podrá corregirlos el colaborador.
export function RejectDialog({ days, saving, error, onConfirm, onClose }: Props) {
  // Lo habitual es que el problema esté en los días sin salida: vienen marcados.
  const [selected, setSelected] = useState<number[]>(() => days.filter((day) => !day.complete).map((day) => day.id))
  const [reason, setReason] = useState('')
  const canConfirm = selected.length > 0 && reason.trim().length > 0 && !saving

  const toggle = (id: number) =>
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 min-[520px]:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reject-title"
        className="w-full max-w-md rounded-2xl border border-border bg-surface p-4 text-text shadow-xl"
      >
        <h2 id="reject-title" className="text-lg font-bold">Rechazar semana</h2>
        <p className="text-sm text-muted">Marca los días que el colaborador debe corregir.</p>

        <ul className="mt-3 flex flex-col gap-1">
          {days.map((day) => (
            <li key={day.id}>
              <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-accent-soft-strong">
                <input
                  type="checkbox"
                  className="size-4"
                  checked={selected.includes(day.id)}
                  onChange={() => toggle(day.id)}
                />
                <span className="flex-1 text-sm first-letter:uppercase">{dayLabel(day.workDate)}</span>
                {!day.complete && <span className="text-xs font-semibold text-red-700">Sin salida</span>}
              </label>
            </li>
          ))}
        </ul>

        <label className="mt-3 mb-1 block text-xs font-semibold text-secondary" htmlFor="reject-reason">
          Motivo del rechazo
        </label>
        <textarea
          id="reject-reason"
          rows={3}
          maxLength={1000}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Explica qué debe corregirse"
          className="w-full rounded-lg border border-border bg-surface p-3 text-sm text-text placeholder:text-faint focus-visible:outline-2 focus-visible:outline-accent"
        />

        {error && (
          <p role="alert" className="mt-2 rounded-lg bg-red-100 px-3 py-2 text-sm font-medium text-red-800">
            {error}
          </p>
        )}

        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            className="h-10 cursor-pointer rounded-lg border border-border px-4 text-sm font-semibold text-text"
            onClick={onClose}
            disabled={saving}
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={!canConfirm}
            className="h-10 cursor-pointer rounded-lg bg-red-600 px-4 text-sm font-semibold text-white disabled:cursor-default disabled:opacity-50"
            onClick={() => onConfirm(selected, reason.trim())}
          >
            {saving ? 'Rechazando…' : 'Confirmar rechazo'}
          </button>
        </div>
      </div>
    </div>
  )
}
