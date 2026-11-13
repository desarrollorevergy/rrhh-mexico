import { Download } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  addDaysKey,
  formatMinutes,
  payrollApi,
  weekLabel,
  weekStartKey,
  type PayrollWeek,
  type TeamWeekDetail as Detail,
} from '../api.ts'
import { TeamWeekDetail } from '../team/TeamWeekDetail.tsx'

const SELECT =
  'h-10 rounded-lg border border-border bg-surface px-2 text-sm text-text focus-visible:outline-2 focus-visible:outline-accent'
const ALL = 'all'

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Ha ocurrido un error'
}

/** Hoy como AAAA-MM-DD, en la fecha local del dispositivo. */
function todayKey(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/** Entrega el archivo al navegador como una descarga. */
function saveFile(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

// Panel de RRHH: semanas ya aprobadas por el supervisor, listas para nómina. Solo lectura.
// Por defecto, la última semana cerrada.
export default function PayrollPage() {
  const lastClosedWeek = addDaysKey(weekStartKey(todayKey()), -7)

  const [rows, setRows] = useState<PayrollWeek[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [period, setPeriod] = useState(lastClosedWeek)
  const [department, setDepartment] = useState(ALL)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    payrollApi
      .summary()
      .then((list) => {
        if (!cancelled) setRows(list)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(messageOf(cause))
      })
    return () => {
      cancelled = true
    }
  }, [])

  const periods = useMemo(() => {
    const set = new Set([lastClosedWeek, ...(rows ?? []).map((row) => row.weekStart)])
    return [...set].sort().reverse()
  }, [rows, lastClosedWeek])

  const departments = useMemo(
    () => [...new Set((rows ?? []).flatMap((row) => (row.departmentName ? [row.departmentName] : [])))].sort(),
    [rows],
  )

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    return (rows ?? []).filter(
      (row) =>
        (period === ALL || row.weekStart === period) &&
        (department === ALL || row.departmentName === department) &&
        (!term ||
          `${row.employeeName} ${row.employeeNumber} ${row.email} ${row.projects.join(' ')}`.toLowerCase().includes(term)),
    )
  }, [rows, search, period, department])

  const filtered = search !== '' || period !== lastClosedWeek || department !== ALL
  const showPeriod = period === ALL
  const columns = showPeriod ? 10 : 9

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }

  const exportCsv = () =>
    run(async () => {
      // Se exporta exactamente lo que hay a la vista tras filtrar.
      const blob = await payrollApi.exportCsv(visible.map(({ employeeId, weekStart }) => ({ employeeId, weekStart })))
      const suffix = period === ALL ? todayKey() : `semana_${period}`
      saveFile(blob, `reporte_nomina_${suffix}.csv`)
    })

  if (detail) {
    return <TeamWeekDetail week={detail} readOnly backLabel="Volver al reporte de nómina" onBack={() => setDetail(null)} />
  }

  return (
    <div className="mx-auto max-w-6xl px-3 py-4 text-text min-[700px]:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[13px] font-bold text-accent">RECURSOS HUMANOS</p>
          <h1 className="text-2xl font-bold">Reporte de nómina semanal</h1>
          <p className="text-sm text-muted">Semanas aprobadas por el supervisor, listas para nómina.</p>
        </div>
        <button
          type="button"
          disabled={busy || visible.length === 0}
          onClick={() => void exportCsv()}
          className="flex h-10 cursor-pointer items-center gap-2 rounded-lg bg-brand-blue px-4 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Download size={16} aria-hidden="true" /> Exportar CSV
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar por empleado, número, correo o analítica"
          aria-label="Buscar"
          className={`${SELECT} min-w-52 flex-1 px-3 placeholder:text-faint`}
        />
        <select
          aria-label="Departamento"
          className={SELECT}
          value={department}
          onChange={(event) => setDepartment(event.target.value)}
        >
          <option value={ALL}>Todos los departamentos</option>
          {departments.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <select aria-label="Período" className={SELECT} value={period} onChange={(event) => setPeriod(event.target.value)}>
          <option value={ALL}>Todas las semanas</option>
          {periods.map((weekStart) => (
            <option key={weekStart} value={weekStart}>
              {weekLabel(weekStart)}
              {weekStart === lastClosedWeek ? ' (última cerrada)' : ''}
            </option>
          ))}
        </select>
        {filtered && (
          <button
            type="button"
            className="h-10 cursor-pointer px-2 text-sm font-semibold text-accent hover:underline"
            onClick={() => {
              setSearch('')
              setPeriod(lastClosedWeek)
              setDepartment(ALL)
            }}
          >
            Restablecer filtros
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-red-100 px-3 py-2 text-sm font-medium text-red-800">
          {error}
        </p>
      )}

      <div className="mt-3 overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="border-b border-border text-xs text-muted">
            <tr>
              {showPeriod && <th className="px-3 py-2 font-semibold">Período</th>}
              <th className="px-3 py-2 font-semibold">Empleado</th>
              <th className="px-3 py-2 font-semibold">Departamento</th>
              <th className="px-3 py-2 font-semibold">Analítica</th>
              <th className="px-3 py-2 text-right font-semibold">H. Normal</th>
              <th className="px-3 py-2 text-right font-semibold">H. Extra</th>
              <th className="px-3 py-2 text-right font-semibold">H. Domingo</th>
              <th className="px-3 py-2 text-right font-semibold">Festivo</th>
              <th className="px-3 py-2 text-center font-semibold">Dietas</th>
              <th className="px-3 py-2 text-right font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr
                key={`${row.employeeId}:${row.weekStart}`}
                className="cursor-pointer border-b border-border last:border-0 hover:bg-accent-soft"
                onClick={() => void run(async () => setDetail(await payrollApi.week(row.employeeId, row.weekStart)))}
              >
                {showPeriod && <td className="px-3 py-2 whitespace-nowrap text-muted">{weekLabel(row.weekStart)}</td>}
                <td className="px-3 py-2">
                  <button
                    type="button"
                    disabled={busy}
                    className="cursor-pointer text-left font-semibold text-text hover:underline focus-visible:outline-2 focus-visible:outline-accent"
                    aria-label={`Ver la semana de ${row.employeeName}`}
                  >
                    {row.employeeName}
                  </button>
                  <div className="text-xs text-muted">{row.employeeNumber}</div>
                </td>
                <td className="px-3 py-2 text-muted">{row.departmentName ?? '—'}</td>
                <td className="px-3 py-2 text-muted">{row.projects.join(', ')}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMinutes(row.totals.normal)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMinutes(row.totals.extra)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMinutes(row.totals.sunday)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMinutes(row.totals.holiday)}</td>
                <td className="px-3 py-2 text-center tabular-nums">{row.totals.perDiems}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatMinutes(row.totals.total)}</td>
              </tr>
            ))}
            {rows !== null && visible.length === 0 && (
              <tr>
                <td colSpan={columns} className="px-3 py-6 text-center text-muted">
                  No hay semanas aprobadas para los filtros seleccionados.
                  {filtered || rows.length === 0 ? '' : ' Prueba con «Todas las semanas».'}
                </td>
              </tr>
            )}
            {rows === null && !error && (
              <tr>
                <td colSpan={columns} className="px-3 py-6 text-center text-muted">
                  Cargando…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
