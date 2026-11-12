import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { formatTime, parseDateKey, teamApi, type HistoryItem } from '../api.ts'

interface Props {
  employeeId: number
  weekStart: string
}

const ACTIONS: Record<HistoryItem['kind'], string> = {
  approved: 'Aprobó la semana',
  rejected: 'Rechazó la semana',
  resubmitted: 'Envió la corrección',
  corrected_supervisor: 'Corrigió (supervisión)',
  corrected_employee: 'Corrigió (colaborador)',
}

const FIELDS: Record<string, string> = {
  project: 'Analítica',
  shiftType: 'Tipo de jornada',
  perDiem: 'Dieta',
  clockIn: 'Entrada',
  clockOut: 'Salida',
}

function formatValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (field === 'perDiem') return value ? 'Sí' : 'No'
  if (field === 'shiftType') return value === 'activa' ? 'Activa' : 'Inactiva'
  if (field === 'clockIn' || field === 'clockOut') return formatTime(String(value))
  return String(value)
}

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('es-MX', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })

const formatDay = (date: string) =>
  parseDateKey(date).toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' })

// Historial de validación de la semana. Se carga al abrirlo.
// Para que se recargue tras un cambio, quien lo usa le cambia la `key`.
export function WeekHistory({ employeeId, weekStart }: Props) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<HistoryItem[] | null>(null)
  const [failed, setFailed] = useState(false)

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next && items === null) {
      teamApi.history(employeeId, weekStart).then(setItems, () => setFailed(true))
    }
  }

  return (
    <section className="mt-5">
      <button
        type="button"
        aria-expanded={open}
        onClick={toggle}
        className="flex cursor-pointer items-center gap-1 font-bold text-text hover:text-accent"
      >
        {open ? <ChevronDown size={18} aria-hidden="true" /> : <ChevronRight size={18} aria-hidden="true" />}
        Historial de validación
      </button>

      {open && (
        <div className="mt-2 rounded-xl border border-border bg-surface px-3 py-2 text-sm">
          {failed && <p className="py-2 text-red-700">No se pudo cargar el historial.</p>}
          {!failed && items === null && <p className="py-2 text-muted">Cargando historial…</p>}
          {items?.length === 0 && <p className="py-2 text-muted">Sin movimientos registrados para esta semana.</p>}

          <ol className="divide-y divide-border">
            {items?.map((item, index) => (
              <li key={index} className="py-2">
                <p>
                  <strong>{ACTIONS[item.kind]}</strong>
                  {item.workDate && <span className="text-muted"> · {formatDay(item.workDate)}</span>}
                  <span className="text-muted"> · {item.actorName} · {formatDateTime(item.at)}</span>
                </p>
                {item.reason && <p className="mt-0.5 text-muted">«{item.reason}»</p>}
                {item.changes && (
                  <ul className="mt-0.5 text-muted">
                    {Object.entries(item.changes).map(([field, change]) => (
                      <li key={field}>
                        {FIELDS[field] ?? field}: <s>{formatValue(field, change.from)}</s> →{' '}
                        <strong className="text-text">{formatValue(field, change.to)}</strong>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  )
}
