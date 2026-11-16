import { useEffect, useState, type FormEvent } from 'react'
import { BUTTON_PRIMARY, BUTTON_SECONDARY, ERROR_BOX, INPUT, LABEL, messageOf } from '../admin/ui.ts'
import {
  absencesApi,
  daysLabel,
  formatDate,
  STATUS_LABELS,
  STATUS_STYLES,
  TYPE_LABELS,
  type AbsenceOverview,
  type AbsencePreview,
  type AbsenceRequest,
  type AbsenceType,
} from './api.ts'

const CARD = 'rounded-2xl border border-border bg-surface shadow-sm'

interface FormState {
  type: AbsenceType
  startDate: string
  endDate: string
  comment: string
}

const emptyForm = (today: string): FormState => ({ type: 'vacation', startDate: today, endDate: today, comment: '' })

function Kpi({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={`min-w-0 rounded-lg px-1 py-2 text-center ${strong ? 'bg-accent-soft-strong' : 'bg-bg'}`}>
      <span className="block truncate text-[11px] font-semibold text-muted">{label}</span>
      <strong className={`text-xl tabular-nums ${strong ? 'text-accent' : 'text-text'}`}>{value}</strong>
    </div>
  )
}

// Vacaciones y ausentismos del propio colaborador: saldo, nueva solicitud e historial.
export default function AbsencesPage() {
  const [overview, setOverview] = useState<AbsenceOverview | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  // Vista previa junto con la solicitud para la que se calculó: una respuesta vieja no se muestra.
  const [previewed, setPreviewed] = useState<{ key: string; value: AbsencePreview } | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [toCancel, setToCancel] = useState<AbsenceRequest | null>(null)
  const [cancelError, setCancelError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    absencesApi
      .mine()
      .then((result) => {
        if (!cancelled) setOverview(result)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setLoadError(messageOf(cause))
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Tras enviar o cancelar: saldo y lista al día.
  const reload = async () => setOverview(await absencesApi.mine())

  const rangeInvalid = form !== null && form.endDate < form.startDate
  const previewKey = form && form.startDate && form.endDate && !rangeInvalid ? `${form.type}|${form.startDate}|${form.endDate}` : null
  const preview = previewed && previewed.key === previewKey ? previewed.value : null

  // Vista previa: días que contaría la solicitud y si se puede pedir. La API lo vuelve a comprobar al enviar.
  useEffect(() => {
    if (!previewKey) return
    const [type, startDate, endDate] = previewKey.split('|') as [AbsenceType, string, string]
    let cancelled = false
    absencesApi
      .preview({ type, startDate, endDate, comment: '' })
      .then((value) => {
        if (!cancelled) setPreviewed({ key: previewKey, value })
      })
      .catch(() => {
        // Sin vista previa se puede enviar igual: la API hace la misma comprobación.
      })
    return () => {
      cancelled = true
    }
  }, [previewKey])

  const set = <K extends keyof FormState>(field: K, value: FormState[K]) =>
    setForm((current) => (current ? { ...current, [field]: value } : current))

  const openForm = () => {
    if (!overview) return
    setFormError(null)
    setForm(emptyForm(overview.today))
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!form) return
    setSaving(true)
    setFormError(null)
    try {
      await absencesApi.create(form)
      setForm(null)
      await reload()
    } catch (cause) {
      setFormError(messageOf(cause))
    } finally {
      setSaving(false)
    }
  }

  const confirmCancel = async () => {
    if (!toCancel) return
    setSaving(true)
    setCancelError(null)
    try {
      await absencesApi.cancel(toCancel.id)
      setToCancel(null)
      await reload()
    } catch (cause) {
      setCancelError(messageOf(cause))
    } finally {
      setSaving(false)
    }
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-2xl px-3 py-4">
        <p className={ERROR_BOX}>{loadError}</p>
      </div>
    )
  }
  if (!overview) return null

  const { balance } = overview

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-3 px-3 py-4 text-text">
      <div>
        <p className="text-[13px] font-bold text-accent">VACACIONES / AUSENTISMOS</p>
        <h1 className="text-2xl font-bold">Mis ausencias</h1>
      </div>

      <section className={`${CARD} p-4`} aria-label="Saldo de vacaciones">
        <h2 className="text-sm font-bold">Saldo de vacaciones</h2>
        {balance ? (
          <>
            <p className="mt-0.5 text-xs text-muted">
              Año de servicio {balance.number}: del {formatDate(balance.start)} al {formatDate(balance.end)}. Los días que no
              uses caducan al terminar.
            </p>
            <div className="mt-3 grid grid-cols-4 gap-1.5">
              <Kpi label="Disponibles" value={balance.available} strong />
              <Kpi label="Del año" value={balance.entitlement + balance.adjustment} />
              <Kpi label="Usados" value={balance.used} />
              <Kpi label="En trámite" value={balance.reserved} />
            </div>
            {balance.adjustment !== 0 && (
              <p className="mt-2 text-xs text-muted">
                Incluye un ajuste de RRHH de {balance.adjustment > 0 ? '+' : ''}
                {balance.adjustment} día(s).
              </p>
            )}
          </>
        ) : (
          <p className="mt-1 text-sm text-muted">
            RRHH aún no ha registrado tu fecha de ingreso. Sin ella no se puede calcular tu saldo ni pedir vacaciones; sí
            puedes registrar una incapacidad.
          </p>
        )}
      </section>

      <button type="button" className={BUTTON_PRIMARY} onClick={openForm}>
        Nueva solicitud
      </button>

      <section aria-label="Mis solicitudes" className="flex flex-col gap-2">
        <h2 className="text-sm font-bold">Mis solicitudes</h2>
        {overview.requests.length === 0 && <p className={`${CARD} p-4 text-sm text-muted`}>Aún no tienes solicitudes.</p>}
        {overview.requests.map((item) => (
          <article key={item.id} className={`${CARD} p-3`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong className="text-sm">{TYPE_LABELS[item.type]}</strong>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[item.status]}`}>
                {STATUS_LABELS[item.status]}
              </span>
            </div>
            <p className="mt-1 text-sm">
              {item.startDate === item.endDate
                ? formatDate(item.startDate)
                : `${formatDate(item.startDate)} al ${formatDate(item.endDate)}`}
              <span className="text-muted"> · {daysLabel(item.days)}</span>
            </p>
            {item.comment && <p className="mt-1 text-xs text-muted">{item.comment}</p>}
            {item.reason && (
              <p className="mt-2 rounded-lg bg-red-100 px-2 py-1 text-xs font-medium text-red-800">Motivo: {item.reason}</p>
            )}
            {item.canCancel && (
              <button
                type="button"
                className="mt-2 cursor-pointer text-xs font-semibold text-accent hover:underline"
                onClick={() => {
                  setCancelError(null)
                  setToCancel(item)
                }}
              >
                Cancelar solicitud
              </button>
            )}
          </article>
        ))}
      </section>

      {form && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
          <form
            onSubmit={(event) => void submit(event)}
            aria-label="Nueva solicitud"
            className="mt-10 w-full max-w-md rounded-2xl border border-border bg-surface p-5 text-text shadow-xl"
          >
            <h2 className="text-lg font-bold">Nueva solicitud</h2>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className={LABEL} htmlFor="abs-type">Tipo</label>
                <select id="abs-type" className={INPUT} value={form.type} onChange={(event) => set('type', event.target.value as AbsenceType)}>
                  <option value="vacation">{TYPE_LABELS.vacation}</option>
                  <option value="sick_leave">{TYPE_LABELS.sick_leave}</option>
                </select>
              </div>
              <div>
                <label className={LABEL} htmlFor="abs-start">Desde</label>
                <input
                  id="abs-start"
                  type="date"
                  required
                  className={INPUT}
                  value={form.startDate}
                  // Las vacaciones no se piden para fechas pasadas; la incapacidad sí.
                  min={form.type === 'vacation' ? overview.today : undefined}
                  onChange={(event) => {
                    const startDate = event.target.value
                    setForm((current) =>
                      current ? { ...current, startDate, endDate: current.endDate < startDate ? startDate : current.endDate } : current,
                    )
                  }}
                />
              </div>
              <div>
                <label className={LABEL} htmlFor="abs-end">Hasta</label>
                <input id="abs-end" type="date" required className={INPUT} value={form.endDate} min={form.startDate} onChange={(event) => set('endDate', event.target.value)} />
              </div>
              <div className="col-span-2">
                <label className={LABEL} htmlFor="abs-comment">Comentario (opcional)</label>
                <textarea id="abs-comment" maxLength={1000} rows={2} className={`${INPUT} h-auto py-2`} value={form.comment} onChange={(event) => set('comment', event.target.value)} />
              </div>
            </div>

            {form.type === 'sick_leave' && (
              <p className="mt-3 text-xs text-muted">
                La incapacidad requiere el documento del IMSS. Todavía no se puede adjuntar aquí: entrégalo a RRHH.
              </p>
            )}

            {rangeInvalid && <p className={`${ERROR_BOX} mt-3`}>La fecha final no puede ser anterior a la inicial.</p>}
            {preview && (
              <div className="mt-3 rounded-lg bg-bg px-3 py-2 text-sm" aria-live="polite">
                <p>
                  {form.type === 'vacation' ? 'Se descontarán ' : 'Cubre '}
                  <strong>{daysLabel(preview.days)}</strong>
                  {form.type === 'vacation' ? ' laborables (lunes a sábado, sin festivos).' : ' naturales.'}
                </p>
                {preview.years.length > 1 &&
                  preview.years.map((year) => (
                    <p key={year.number} className="text-xs text-muted">
                      Año de servicio {year.number}: {daysLabel(year.requested)} de {Math.max(0, year.available)} disponibles.
                    </p>
                  ))}
                {preview.problem && <p className="mt-1 font-medium text-red-700">{preview.problem}</p>}
              </div>
            )}

            {formError && <p role="alert" className={`${ERROR_BOX} mt-3`}>{formError}</p>}

            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className={BUTTON_SECONDARY} onClick={() => setForm(null)} disabled={saving}>
                Cerrar
              </button>
              <button type="submit" className={BUTTON_PRIMARY} disabled={saving || rangeInvalid || Boolean(preview?.problem)}>
                {saving ? 'Enviando…' : 'Enviar solicitud'}
              </button>
            </div>
          </form>
        </div>
      )}

      {toCancel && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
          <div role="dialog" aria-label="Cancelar solicitud" className="mt-10 w-full max-w-md rounded-2xl border border-border bg-surface p-5 text-text shadow-xl">
            <h2 className="text-lg font-bold">¿Cancelar la solicitud?</h2>
            <p className="mt-2 text-sm text-muted">
              {TYPE_LABELS[toCancel.type]} del {formatDate(toCancel.startDate)} al {formatDate(toCancel.endDate)} (
              {daysLabel(toCancel.days)}). No se puede deshacer; tendrías que pedirla de nuevo.
            </p>
            {cancelError && <p role="alert" className={`${ERROR_BOX} mt-3`}>{cancelError}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className={BUTTON_SECONDARY} onClick={() => setToCancel(null)} disabled={saving}>
                Volver
              </button>
              <button type="button" className={BUTTON_PRIMARY} onClick={() => void confirmCancel()} disabled={saving}>
                {saving ? 'Cancelando…' : 'Cancelar solicitud'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
