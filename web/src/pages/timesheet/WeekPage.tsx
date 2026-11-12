import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CommentDialog } from './CommentDialog.tsx'
import { CorrectEntryDialog } from './CorrectEntryDialog.tsx'
import {
  formatMinutes,
  formatTime,
  parseDateKey,
  STATUS_LABELS,
  STATUS_STYLES,
  timesheetApi,
  weekLabel,
  type EntryCorrection,
  type WeekDay,
  type WeekView,
} from './api.ts'

const CARD = 'rounded-2xl border border-border bg-surface shadow-sm'
const CHIP = 'max-w-full cursor-pointer truncate rounded-full border px-2.5 py-1 text-xs font-medium'

const dayLabel = (date: string) =>
  parseDateKey(date).toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' })

const longDayLabel = (date: string) =>
  parseDateKey(date).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('es-MX', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })

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
  // ?semana=AAAA-MM-DD abre directamente esa semana (aviso de semana rechazada).
  const [searchParams] = useSearchParams()
  const requested = searchParams.get('semana')

  const [weeks, setWeeks] = useState<string[]>([])
  const [rejectedWeeks, setRejectedWeeks] = useState<string[]>([])
  const [current, setCurrent] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [week, setWeek] = useState<WeekView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // Ventanas abiertas y su error propio
  const [commentDay, setCommentDay] = useState<WeekDay | null>(null)
  const [correctDay, setCorrectDay] = useState<WeekDay | null>(null)
  const [sending, setSending] = useState(false)
  const [note, setNote] = useState('')
  const [dialogError, setDialogError] = useState<string | null>(null)

  // Semanas disponibles; se abre la pedida o la actual.
  useEffect(() => {
    let cancelled = false
    timesheetApi
      .weeks()
      .then((result) => {
        if (cancelled) return
        setWeeks(result.weeks)
        setRejectedWeeks(result.rejectedWeeks)
        setCurrent(result.current)
        setSelected(requested && result.weeks.includes(requested) ? requested : result.current)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(messageOf(cause))
      })
    return () => {
      cancelled = true
    }
  }, [requested])

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

  /** Ejecuta una acción de una ventana; si va bien, actualiza la semana y la cierra. */
  const runDialog = async (action: () => Promise<WeekView>, close: () => void) => {
    setSaving(true)
    setDialogError(null)
    try {
      setWeek(await action())
      close()
      // Puede haber cambiado qué semanas tienen días rechazados.
      timesheetApi.weeks().then((result) => setRejectedWeeks(result.rejectedWeeks), () => undefined)
    } catch (cause) {
      setDialogError(messageOf(cause))
    } finally {
      setSaving(false)
    }
  }

  const saveComment = (text: string) => {
    if (!commentDay || !selected) return
    const day = commentDay
    void runDialog(async () => {
      await timesheetApi.setEntryComment(day.id, text)
      return timesheetApi.week(selected)
    }, () => setCommentDay(null))
  }

  const saveCorrection = (changes: EntryCorrection) => {
    if (!correctDay) return
    const day = correctDay
    void runDialog(() => timesheetApi.correctEntry(day.id, changes), () => setCorrectDay(null))
  }

  const sendCorrection = () => {
    if (!selected) return
    void runDialog(() => timesheetApi.sendCorrection(selected, note.trim()), () => setSending(false))
  }

  // Mientras llega la semana recién elegida no se muestra la anterior.
  const shown = week && week.weekStart === selected ? week : null
  const totals = shown?.totals
  const rejectedDays = shown?.days.filter((day) => day.status === 'rejected') ?? []
  const reasons = [...new Set(rejectedDays.map((day) => day.rejectReason).filter(Boolean))]
  const sentAt = shown?.status === 'pending' ? shown.days.map((day) => day.correctionSentAt).filter(Boolean).sort().at(-1) : undefined
  const otherRejected = rejectedWeeks.filter((weekStart) => weekStart !== selected)

  return (
    <div className="mx-auto flex max-w-md flex-col gap-3 px-3 py-4">
      {otherRejected.length > 0 && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          <strong>Semana rechazada</strong>
          {otherRejected.map((weekStart) => (
            <button
              key={weekStart}
              type="button"
              className="cursor-pointer font-semibold underline"
              onClick={() => setSelected(weekStart)}
            >
              {weekLabel(weekStart)} ›
            </button>
          ))}
        </div>
      )}

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

        {shown?.status === 'rejected' && (
          <div role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
            {reasons.map((reason) => (
              <p key={reason}>{reason}</p>
            ))}
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setDialogError(null)
                setNote('')
                setSending(true)
              }}
              className="mt-2 h-10 w-full cursor-pointer rounded-lg bg-brand-blue px-4 text-sm font-semibold text-white disabled:opacity-50"
            >
              Enviar corrección
            </button>
          </div>
        )}

        {sentAt && <p className="mt-2 text-xs font-semibold text-accent">Corrección enviada · {formatDateTime(sentAt)}</p>}

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
          const rejected = day.status === 'rejected'
          const editable = day.status !== 'approved'
          // Solo se etiqueta el día si su estado difiere del de la semana.
          const showStatus = rejected || day.status !== shown.status
          return (
            <article key={day.id} className={`${CARD} px-3.5 py-2.5 ${rejected ? 'border-red-300' : ''}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-1.5 font-semibold text-text">
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
                  <p className="font-bold text-text tabular-nums">
                    {day.complete ? formatMinutes(day.total) : '—'}
                    {day.hoursEdited && <span className="font-normal text-muted"> · editado</span>}
                  </p>
                </div>
              </div>

              {rejected && day.rejectReason && <p className="mt-1.5 text-xs text-red-700">{day.rejectReason}</p>}

              {(day.comment || editable) && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    title={day.comment ?? undefined}
                    onClick={() => {
                      setDialogError(null)
                      setCommentDay(day)
                    }}
                    className={`${CHIP} ${
                      day.comment ? 'border-accent bg-accent-soft-strong text-accent' : 'border-dashed border-border text-muted'
                    }`}
                  >
                    {day.comment ?? '+ Nota'}
                  </button>
                  {rejected && (
                    <button
                      type="button"
                      aria-label={`Corregir la jornada del ${dayLabel(day.workDate)}`}
                      onClick={() => {
                        setDialogError(null)
                        setCorrectDay(day)
                      }}
                      className={`${CHIP} border-red-300 bg-red-50 font-semibold text-red-700`}
                    >
                      Corregir
                    </button>
                  )}
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
          onSave={saveComment}
          onClose={() => setCommentDay(null)}
        />
      )}

      {correctDay && (
        <CorrectEntryDialog
          day={correctDay}
          notice={correctDay.rejectReason}
          saving={saving}
          error={dialogError}
          onSave={saveCorrection}
          onClose={() => setCorrectDay(null)}
        />
      )}

      {sending && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 min-[520px]:items-center">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="send-title"
            className="w-full max-w-md rounded-2xl border border-border bg-surface p-4 text-text shadow-xl"
          >
            <h2 id="send-title" className="text-lg font-bold">Enviar corrección</h2>
            <p className="text-sm text-muted">Los días rechazados vuelven a tu supervisor para que los revise.</p>
            <textarea
              id="send-note"
              rows={3}
              maxLength={1000}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Nota para tu supervisor (opcional)"
              className="mt-3 w-full rounded-lg border border-border bg-surface p-3 text-sm text-text placeholder:text-faint focus-visible:outline-2 focus-visible:outline-accent"
            />
            {dialogError && (
              <p role="alert" className="mt-2 rounded-lg bg-red-100 px-3 py-2 text-sm font-medium text-red-800">
                {dialogError}
              </p>
            )}
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                className="h-10 cursor-pointer rounded-lg border border-border px-4 text-sm font-semibold text-text"
                onClick={() => setSending(false)}
                disabled={saving}
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={saving}
                className="h-10 cursor-pointer rounded-lg bg-brand-blue px-4 text-sm font-semibold text-white disabled:opacity-50"
                onClick={sendCorrection}
              >
                {saving ? 'Enviando…' : 'Enviar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
