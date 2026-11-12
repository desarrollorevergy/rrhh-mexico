import { ArrowLeft, Pencil } from 'lucide-react'
import { useState } from 'react'
import { CorrectEntryDialog } from '../CorrectEntryDialog.tsx'
import {
  addDaysKey,
  formatMinutes,
  formatTime,
  parseDateKey,
  STATUS_LABELS,
  STATUS_STYLES,
  teamApi,
  weekLabel,
  type TeamWeekDetail as Detail,
  type WeekDay,
} from '../api.ts'
import { RejectDialog } from './RejectDialog.tsx'
import { WeekHistory } from './WeekHistory.tsx'

interface Props {
  week: Detail
  /** Se llama con la semana ya actualizada tras aprobar o rechazar. */
  onChange: (week: Detail) => void
  onBack: () => void
}

const TAG = 'rounded-full px-2 py-0.5 text-[11px] font-semibold'
const dayLabel = (date: string) =>
  parseDateKey(date).toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' })

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Ha ocurrido un error'
}

function Kpi({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`min-w-20 rounded-lg px-3 py-1.5 text-center ${strong ? 'bg-accent-soft-strong' : 'bg-bg'}`}>
      <span className="block text-[11px] font-semibold text-muted">{label}</span>
      <strong className={`tabular-nums ${strong ? 'text-accent' : 'text-text'}`}>{value}</strong>
    </div>
  )
}

// Revisión semanal de un colaborador: detalle día por día, aprobar o rechazar.
export function TeamWeekDetail({ week, onChange, onBack }: Props) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState(false)
  const [correcting, setCorrecting] = useState<WeekDay | null>(null)
  // Cambia con cada acción para que el historial se vuelva a cargar.
  const [historyVersion, setHistoryVersion] = useState(0)

  const byDate = new Map(week.days.map((day) => [day.workDate, day]))
  const dates = Array.from({ length: 7 }, (_, index) => addDaysKey(week.weekStart, index))
  const canDecide = week.days.length > 0 && week.status !== 'approved'

  const run = async (action: () => Promise<Detail>) => {
    setSaving(true)
    setError(null)
    try {
      onChange(await action())
      setRejecting(false)
      setCorrecting(null)
      setHistoryVersion((version) => version + 1)
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-3 py-4 text-text min-[700px]:px-6">
      <button
        type="button"
        onClick={onBack}
        className="mb-3 flex cursor-pointer items-center gap-1.5 text-sm font-semibold text-accent hover:underline"
      >
        <ArrowLeft size={16} aria-hidden="true" /> Volver al consolidado
      </button>

      <section className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">{week.employeeName}</h1>
            <p className="text-sm text-muted">
              {week.departmentName ? `${week.departmentName} · ` : ''}
              {weekLabel(week.weekStart)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {week.status && (
              <span className={`${TAG} text-xs ${STATUS_STYLES[week.status]}`}>
                {week.corrected ? 'Corregida' : STATUS_LABELS[week.status]}
              </span>
            )}
            {canDecide && (
              <>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    setError(null)
                    setRejecting(true)
                  }}
                  className="h-10 cursor-pointer rounded-lg border border-red-300 px-4 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  Rechazar
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void run(() => teamApi.approve(week.employeeId, week.weekStart))}
                  className="h-10 cursor-pointer rounded-lg bg-brand-green px-4 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
                >
                  {saving && !rejecting ? 'Procesando…' : 'Aprobar semana'}
                </button>
              </>
            )}
          </div>
        </div>

        {week.corrected && (
          <p className="mt-3 rounded-lg bg-accent-soft-strong px-3 py-2 text-sm">
            <strong>Corrección enviada.</strong>
            {week.correctionNote && ` ${week.correctionNote}`}
          </p>
        )}

        {error && !rejecting && !correcting && (
          <p role="alert" className="mt-3 rounded-lg bg-red-100 px-3 py-2 text-sm font-medium text-red-800">
            {error}
          </p>
        )}

        <div className="mt-3 flex flex-wrap gap-1.5">
          <Kpi label="Normal" value={formatMinutes(week.totals.normal)} />
          <Kpi label="Extra" value={formatMinutes(week.totals.extra)} />
          <Kpi label="Domingo" value={formatMinutes(week.totals.sunday)} />
          <Kpi label="Festivo" value={formatMinutes(week.totals.holiday)} />
          <Kpi label="Dietas" value={String(week.totals.perDiems)} />
          <Kpi label="Total" value={formatMinutes(week.totals.total)} strong />
        </div>
      </section>

      <h2 className="mt-5 mb-2 font-bold">Jornadas de la semana</h2>
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b border-border text-xs text-muted">
            <tr>
              <th className="px-3 py-2 font-semibold">Día</th>
              <th className="px-3 py-2 font-semibold">Analítica</th>
              <th className="px-3 py-2 font-semibold">Tipo</th>
              <th className="px-3 py-2 font-semibold">Horario</th>
              <th className="px-3 py-2 text-right font-semibold">Normal</th>
              <th className="px-3 py-2 text-right font-semibold">Extra</th>
              <th className="px-3 py-2 text-right font-semibold">Total</th>
              <th className="px-3 py-2 font-semibold">Detalles</th>
              <th className="px-3 py-2" aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {dates.map((date) => {
              const day = byDate.get(date)
              if (!day) {
                return (
                  <tr key={date} className="border-b border-border text-faint last:border-0">
                    <td className="px-3 py-2 first-letter:uppercase">{dayLabel(date)}</td>
                    <td colSpan={8} className="px-3 py-2">Sin registro</td>
                  </tr>
                )
              }
              return (
                <tr key={date} className={`border-b border-border align-top last:border-0 ${day.status === 'rejected' ? 'bg-red-50/60' : ''}`}>
                  <td className="px-3 py-2 font-semibold whitespace-nowrap first-letter:uppercase">{dayLabel(date)}</td>
                  <td className="px-3 py-2">
                    <div>{day.projectCode}</div>
                    {day.projectName && <div className="text-xs text-muted">{day.projectName}</div>}
                  </td>
                  <td className="px-3 py-2">{day.shiftType === 'activa' ? 'Activa' : 'Inactiva'}</td>
                  <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                    {formatTime(day.clockIn)} – {day.clockOut ? formatTime(day.clockOut) : '…'}
                    {!day.complete && <span className={`${TAG} ml-1.5 bg-amber-100 text-amber-800`}>En curso</span>}
                    {day.hoursEdited && (
                      <span className="ml-1.5 text-xs text-muted" title="Horario corregido a mano (ver historial)">editado</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatMinutes(day.normal)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatMinutes(day.extra)}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatMinutes(day.total)}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {day.kind === 'holiday' && <span className={`${TAG} bg-accent-soft-strong text-accent`}>Festivo</span>}
                      {day.kind === 'sunday' && <span className={`${TAG} bg-accent-soft-strong text-accent`}>Domingo</span>}
                      {day.perDiem && <span className={`${TAG} bg-green-100 text-green-800`}>Dieta</span>}
                      {day.status === 'rejected' && <span className={`${TAG} bg-red-100 text-red-800`}>Rechazado</span>}
                      {day.correctionSentAt && <span className={`${TAG} bg-accent-soft-strong text-accent`}>Corregido</span>}
                    </div>
                    {day.rejectReason && <p className="mt-1 text-xs text-red-700">{day.rejectReason}</p>}
                    {day.comment && <p className="mt-1 text-xs text-muted">«{day.comment}»</p>}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <button
                      type="button"
                      title="Corregir jornada"
                      aria-label={`Corregir la jornada del ${dayLabel(date)}`}
                      disabled={saving}
                      onClick={() => {
                        setError(null)
                        setCorrecting(day)
                      }}
                      className="cursor-pointer rounded-lg p-2 text-secondary hover:bg-accent-soft-strong disabled:opacity-50"
                    >
                      <Pencil size={16} />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <WeekHistory key={historyVersion} employeeId={week.employeeId} weekStart={week.weekStart} />

      {correcting && (
        <CorrectEntryDialog
          day={correcting}
          saving={saving}
          error={error}
          onClose={() => setCorrecting(null)}
          onSave={(changes) => void run(() => teamApi.correct(correcting.id, changes))}
        />
      )}

      {rejecting && (
        <RejectDialog
          days={week.days}
          saving={saving}
          error={error}
          onClose={() => setRejecting(false)}
          onConfirm={(ids, reason) => void run(() => teamApi.reject(week.employeeId, week.weekStart, ids, reason))}
        />
      )}
    </div>
  )
}
