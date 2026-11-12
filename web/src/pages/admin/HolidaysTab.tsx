import { Trash2 } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { apiDelete, apiGet, apiPost } from '../../api/client.ts'
import { BUTTON_PRIMARY, ERROR_BOX, INPUT, LABEL, messageOf } from './ui.ts'

interface Holiday {
  id: number
  date: string
  name: string
}

// "2026-12-25" → "viernes, 25 de diciembre". Se interpreta como fecha local, sin desfase.
function formatDate(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })
}

export function HolidaysTab() {
  const [year, setYear] = useState(() => new Date().getFullYear())
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [date, setDate] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    apiGet<Holiday[]>(`/api/holidays?year=${year}`)
      .then((list) => {
        if (!cancelled) setHolidays(list)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(messageOf(cause))
      })
    return () => {
      cancelled = true
    }
  }, [year])

  const add = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const created = await apiPost<Holiday>('/api/holidays', { date, name })
      // Si el festivo es de otro año, se cambia a ese año para que se vea.
      const createdYear = Number(created.date.slice(0, 4))
      if (createdYear === year) {
        setHolidays((list) => [...list, created].sort((a, b) => a.date.localeCompare(b.date)))
      } else {
        setYear(createdYear)
      }
      setDate('')
      setName('')
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (holiday: Holiday) => {
    if (!window.confirm(`¿Quitar el festivo «${holiday.name}»?`)) return
    setError(null)
    try {
      await apiDelete(`/api/holidays/${holiday.id}`)
      setHolidays((list) => list.filter((item) => item.id !== holiday.id))
    } catch (cause) {
      setError(messageOf(cause))
    }
  }

  return (
    <>
      <form onSubmit={(event) => void add(event)} className="flex flex-wrap items-end gap-2">
        <div>
          <label className={LABEL} htmlFor="holiday-year">Año</label>
          <input
            id="holiday-year"
            type="number"
            min={2000}
            max={2100}
            className={`${INPUT} w-24`}
            value={year}
            onChange={(event) => {
              const value = Number(event.target.value)
              if (Number.isInteger(value) && value >= 2000 && value <= 2100) setYear(value)
            }}
          />
        </div>
        <div className="ml-auto" />
        <div>
          <label className={LABEL} htmlFor="holiday-date">Fecha</label>
          <input id="holiday-date" type="date" required className={INPUT} value={date} onChange={(event) => setDate(event.target.value)} />
        </div>
        <div className="min-w-40 flex-1">
          <label className={LABEL} htmlFor="holiday-name">Festivo</label>
          <input id="holiday-name" required maxLength={100} className={INPUT} value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <button type="submit" className={BUTTON_PRIMARY} disabled={saving}>
          Añadir festivo
        </button>
      </form>

      {error && <p role="alert" className={`${ERROR_BOX} mt-3`}>{error}</p>}

      <ul className="mt-3 rounded-xl border border-border bg-surface">
        {holidays.map((holiday) => (
          <li key={holiday.id} className="flex items-center gap-3 border-b border-border px-3 py-2 text-sm last:border-0">
            <span className="w-56 shrink-0 text-muted first-letter:uppercase">{formatDate(holiday.date)}</span>
            <span className="flex-1 font-semibold text-text">{holiday.name}</span>
            <button
              type="button"
              title={`Quitar ${holiday.name}`}
              aria-label={`Quitar ${holiday.name}`}
              className="cursor-pointer rounded-lg p-2 text-secondary hover:bg-accent-soft-strong"
              onClick={() => void remove(holiday)}
            >
              <Trash2 size={16} />
            </button>
          </li>
        ))}
        {holidays.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">Sin festivos en {year}.</li>}
      </ul>
    </>
  )
}
