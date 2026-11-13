import { useEffect, useMemo, useState } from 'react'
import {
  addDaysKey,
  formatMinutes,
  STATUS_LABELS,
  STATUS_STYLES,
  teamApi,
  weekLabel,
  weekStartKey,
  type EntryStatus,
  type TeamWeekDetail as Detail,
  type TeamWeekSummary,
} from '../api.ts'
import { TeamWeekDetail } from './TeamWeekDetail.tsx'

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

// Supervisión: consolidado semanal del equipo. Por defecto, lo pendiente de la última semana cerrada.
export default function TeamPage() {
  const currentWeek = weekStartKey(todayKey())
  const lastClosedWeek = addDaysKey(currentWeek, -7)

  const [rows, setRows] = useState<TeamWeekSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [period, setPeriod] = useState(lastClosedWeek)
  const [status, setStatus] = useState<EntryStatus | typeof ALL>('pending')
  const [detail, setDetail] = useState<Detail | null>(null)
  const [opening, setOpening] = useState(false)

  useEffect(() => {
    let cancelled = false
    teamApi
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
    const set = new Set([currentWeek, lastClosedWeek, ...(rows ?? []).map((row) => row.weekStart)])
    return [...set].sort().reverse()
  }, [rows, currentWeek, lastClosedWeek])

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    return (rows ?? []).filter(
      (row) =>
        (period === ALL || row.weekStart === period) &&
        (status === ALL || row.status === status) &&
        (!term || `${row.employeeName} ${row.departmentName ?? ''} ${row.projects.join(' ')}`.toLowerCase().includes(term)),
    )
  }, [rows, search, period, status])

  const pendingCount = (rows ?? []).filter((row) => row.status === 'pending').length
  const correctedCount = (rows ?? []).filter((row) => row.corrected).length
  const filtered = search !== '' || period !== lastClosedWeek || status !== 'pending'
  const showPeriod = period === ALL

  const open = async (row: TeamWeekSummary) => {
    setOpening(true)
    setError(null)
    try {
      setDetail(await teamApi.week(row.employeeId, row.weekStart))
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setOpening(false)
    }
  }

  if (detail) {
    return (
      <TeamWeekDetail
        week={detail}
        onBack={() => setDetail(null)}
        onChange={(updated) => {
          setDetail(updated)
          // El consolidado se actualiza con el nuevo estado de esa semana.
          teamApi.summary().then(setRows, () => undefined)
        }}
      />
    )
  }

  return (
    <div className="mx-auto max-w-6xl px-3 py-4 text-text min-[700px]:px-6">
      <p className="text-[13px] font-bold text-accent">SUPERVISIÓN</p>
      <h1 className="text-2xl font-bold">Consolidado semanal</h1>
      <p className="text-sm text-muted">
        {pendingCount} {pendingCount === 1 ? 'semana pendiente' : 'semanas pendientes'}
        {correctedCount > 0 && ` · ${correctedCount} corregida(s) por el colaborador`}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar por empleado, departamento o analítica"
          aria-label="Buscar"
          className={`${SELECT} min-w-52 flex-1 px-3 placeholder:text-faint`}
        />
        <select id="team-period" aria-label="Período" className={SELECT} value={period} onChange={(event) => setPeriod(event.target.value)}>
          <option value={ALL}>Todas las semanas</option>
          {periods.map((weekStart) => (
            <option key={weekStart} value={weekStart}>
              {weekLabel(weekStart)}
              {weekStart === currentWeek ? ' (actual)' : ''}
            </option>
          ))}
        </select>
        <select
          id="team-status"
          aria-label="Estado"
          className={SELECT}
          value={status}
          onChange={(event) => setStatus(event.target.value as EntryStatus | typeof ALL)}
        >
          <option value={ALL}>Todos los estados</option>
          <option value="pending">Pendientes</option>
          <option value="approved">Aprobados</option>
          <option value="rejected">Rechazados</option>
        </select>
        {filtered && (
          <button
            type="button"
            className="h-10 cursor-pointer px-2 text-sm font-semibold text-accent hover:underline"
            onClick={() => {
              setSearch('')
              setPeriod(lastClosedWeek)
              setStatus('pending')
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
              <th className="px-3 py-2 font-semibold">Analítica</th>
              <th className="px-3 py-2 text-right font-semibold">H. Normal</th>
              <th className="px-3 py-2 text-right font-semibold">H. Extra</th>
              <th className="px-3 py-2 text-right font-semibold">H. Domingo</th>
              <th className="px-3 py-2 text-right font-semibold">Festivo</th>
              <th className="px-3 py-2 text-center font-semibold">Dietas</th>
              <th className="px-3 py-2 text-center font-semibold">Estado</th>
              <th className="px-3 py-2 text-right font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr
                key={`${row.employeeId}:${row.weekStart}`}
                className="cursor-pointer border-b border-border last:border-0 hover:bg-accent-soft"
                onClick={() => void open(row)}
              >
                {showPeriod && <td className="px-3 py-2 whitespace-nowrap text-muted">{weekLabel(row.weekStart)}</td>}
                <td className="px-3 py-2">
                  <button
                    type="button"
                    disabled={opening}
                    className="cursor-pointer text-left font-semibold text-text hover:underline focus-visible:outline-2 focus-visible:outline-accent"
                    aria-label={`Revisar la semana de ${row.employeeName}`}
                  >
                    {row.employeeName}
                  </button>
                  {row.departmentName && <div className="text-xs text-muted">{row.departmentName}</div>}
                </td>
                <td className="px-3 py-2 text-muted">{row.projects.join(', ')}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMinutes(row.totals.normal)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMinutes(row.totals.extra)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMinutes(row.totals.sunday)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMinutes(row.totals.holiday)}</td>
                <td className="px-3 py-2 text-center tabular-nums">{row.totals.perDiems}</td>
                <td className="px-3 py-2 text-center">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[row.status]}`}>
                    {row.corrected ? 'Corregida' : STATUS_LABELS[row.status]}
                  </span>
                </td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatMinutes(row.totals.total)}</td>
              </tr>
            ))}
            {rows !== null && visible.length === 0 && (
              <tr>
                <td colSpan={showPeriod ? 10 : 9} className="px-3 py-6 text-center text-muted">
                  No hay semanas para los filtros seleccionados.
                </td>
              </tr>
            )}
            {rows === null && !error && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-muted">Cargando…</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
