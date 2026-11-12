import { useEffect, useState } from 'react'
import { CommentDialog } from './CommentDialog.tsx'
import {
  formatMinutes,
  formatTime,
  parseDateKey,
  STATUS_LABELS,
  STATUS_STYLES,
  timesheetApi,
  weekLabel,
  type WeekDay,
  type WeekView,
} from './api.ts'

const CARD = 'rounded-2xl border border-border bg-surface shadow-sm'
const CHIP = 'max-w-full cursor-pointer truncate rounded-full border px-2.5 py-1 text-xs font-medium'

const dayLabel = (date: string) =>
  parseDateKey(date).toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' })

const longDayLabel = (date: string) =>
  parseDateKey(date).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Ha ocurrido un error'
}

function Kpi({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`min-w-0 rounded-lg px-0.5 py-1.5 text-center ${strong ? 'bg-accent-soft-strong' : 'bg-bg'}`}>
      <span className="block truncate text-[11px] font-semibold text-muted">{label}</span>
      <strong className={`text-[15px] tabular-nums ${strong ? 'text-accent' : 'text-text'}`}>{value}</strong>
    </div>
  )
}

export default function WeekPage() {
  const [weeks, setWeeks] = useState<string[]>([])
  const [current, setCurrent] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [week, setWeek] = useState<WeekView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [commentDay, setCommentDay] = useState<WeekDay | null>(null)
  const [saving, setSaving] = useState(false)

  // Semanas disponibles; se abre la actual.
  useEffect(() => {
    let cancelled = false
    timesheetApi
      .weeks()
      .then((result) => {
        if (cancelled) return
        setWeeks(result.weeks)
        setCurrent(result.current)
        setSelected(result.current)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(messageOf(cause))
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Jornadas de la semana elegida.
  useEffect(() => {
    if (!selected) return
    let cancelled = false
    timesheetApi
      .week(selected)
      .then((result) => {
        if (!cancelled) setWeek(result)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(messageOf(cause))
      })
    return () => {
      cancelled = true
    }
  }, [selected])

  const saveComment = async (text: string) => {
    if (!commentDay || !selected) return
    setSaving(true)
    setError(null)
    try {
      await timesheetApi.setEntryComment(commentDay.id, text)
      setWeek(await timesheetApi.week(selected))
      setCommentDay(null)
    } catch (cause) {
      setError(messageOf(cause))
      setCommentDay(null)
    } finally {
      setSaving(false)
    }
  }

  // Mientras llega la semana recién elegida no se muestra la anterior.
  const shown = week && week.weekStart === selected ? week : null
  const totals = shown?.totals

  return (
    <div className="mx-auto flex max-w-md flex-col gap-3 px-3 py-4">
      <section className={`${CARD} px-3.5 py-3`} aria-label="Resumen de la semana">
        <div className="flex items-center gap-2">
          <select
            id="week-select"
            aria-label="Período semanal"
            value={selected ?? ''}
            onChange={(event) => setSelected(event.target.value)}
            className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 text-sm font-semibold text-text focus-visible:outline-2 focus-visible:outline-accent"
          >
            {weeks.map((weekStart) => (
              <option key={weekStart} value={weekStart}>
                {weekLabel(weekStart)}
                {weekStart === current ? ' (actual)' : ''}
              </option>
            ))}
          </select>
          {shown?.status && (
            <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[shown.status]}`}>
              {STATUS_LABELS[shown.status]}
            </span>
          )}
        </div>

        {totals && shown.days.length > 0 && (
          // Todos los totales en una sola fila, sean cuatro, cinco o seis.
          <div className="mt-3 grid auto-cols-fr grid-flow-col gap-1">
            <Kpi label="Normal" value={formatMinutes(totals.normal)} />
            <Kpi label="Extra" value={formatMinutes(totals.extra)} />
            {totals.sunday > 0 && <Kpi label="Domingo" value={formatMinutes(totals.sunday)} />}
            {totals.holiday > 0 && <Kpi label="Festivo" value={formatMinutes(totals.holiday)} />}
            <Kpi label="Dietas" value={String(totals.perDiems)} />
            <Kpi label="Total" value={formatMinutes(totals.total)} strong />
          </div>
        )}
      </section>

      {error && (
        <p role="alert" className="rounded-lg bg-red-100 px-3 py-2 text-sm font-medium text-red-800">
          {error}
        </p>
      )}

      <section className="flex flex-col gap-2" aria-label="Jornadas de la semana">
        {!shown && !error && <p className={`${CARD} px-4 py-5 text-center text-muted`}>Cargando jornadas…</p>}

        {shown?.days.length === 0 && (
          <p className={`${CARD} px-4 py-6 text-center font-semibold text-muted`}>Sin registros en esta semana</p>
        )}

        {shown?.days.map((day) => {
          const editable = day.status !== 'approved'
          // Solo se etiqueta el día si su estado difiere del de la semana.
          const showStatus = day.status === 'rejected' || day.status !== shown.status
          return (
            <article
              key={day.id}
              className={`${CARD} px-3.5 py-2.5 ${day.status === 'rejected' ? 'border-red-300' : ''}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-1.5 font-semibold text-text first-letter:uppercase">
                    <span className="first-letter:uppercase">{dayLabel(day.workDate)}</span>
                    {day.kind === 'holiday' && (
                      <span className="rounded-full bg-accent-soft-strong px-2 py-0.5 text-[11px] font-semibold text-accent">Festivo</span>
                    )}
                    {showStatus && (
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLES[day.status]}`}>
                        {STATUS_LABELS[day.status]}
                      </span>
                    )}
                  </p>
                  <p className="truncate text-sm text-muted" title={day.projectName ?? undefined}>
                    {day.projectCode}
                    {day.perDiem && ' · Dieta'}
                    {day.shiftType === 'inactiva' && ' · Inactiva'}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm text-text tabular-nums">
                    {formatTime(day.clockIn)} – {day.clockOut ? formatTime(day.clockOut) : 'En curso'}
                  </p>
                  <p className="font-bold text-text tabular-nums">{day.complete ? formatMinutes(day.total) : '—'}</p>
                </div>
              </div>

              {(day.comment || editable) && (
                <div className="mt-2 flex">
                  <button
                    type="button"
                    title={day.comment ?? undefined}
                    onClick={() => setCommentDay(day)}
                    className={`${CHIP} ${
                      day.comment ? 'border-accent bg-accent-soft-strong text-accent' : 'border-dashed border-border text-muted'
                    }`}
                  >
                    {day.comment ?? '+ Nota'}
                  </button>
                </div>
              )}
            </article>
          )
        })}
      </section>

      {commentDay && (
        <CommentDialog
          initialText={commentDay.comment ?? ''}
          subtitle={longDayLabel(commentDay.workDate)}
          readOnly={commentDay.status === 'approved'}
          saving={saving}
          onSave={(text) => void saveComment(text)}
          onClose={() => setCommentDay(null)}
        />
      )}
    </div>
  )
}
