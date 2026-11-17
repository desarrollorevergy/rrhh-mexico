import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { hasRole, useAuth } from '../../auth/authContext.ts'
import { BUTTON_PRIMARY, BUTTON_SECONDARY, ERROR_BOX, INPUT, LABEL, messageOf } from '../admin/ui.ts'
import {
  absencesApi,
  daysLabel,
  formatDate,
  STATUS_LABELS,
  STATUS_STYLES,
  TYPE_LABELS,
  type AbsenceStatus,
  type ReviewItem,
} from './api.ts'

const CARD = 'rounded-2xl border border-border bg-surface shadow-sm'

type Filter = 'mine' | 'all' | AbsenceStatus

/** Acción que pide motivo: rechazar, o cancelar una solicitud ya aprobada (solo RRHH). */
interface ReasonDialog {
  item: ReviewItem
  action: 'reject' | 'cancel'
}

const DIALOG_TEXT = {
  reject: { title: 'Rechazar solicitud', label: 'Motivo del rechazo', button: 'Rechazar', note: 'El rechazo es definitivo: el colaborador tendrá que hacer una solicitud nueva.' },
  cancel: { title: 'Cancelar solicitud aprobada', label: 'Motivo de la cancelación', button: 'Cancelar solicitud', note: 'La ausencia deja de contar y, si eran vacaciones, los días vuelven al saldo.' },
}

// Solicitudes por revisar: las de su equipo para el supervisor, todas para RRHH.
export default function ReviewPage() {
  const { roles } = useAuth()
  const isHr = hasRole(roles, 'rrhh')

  const [items, setItems] = useState<ReviewItem[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('mine')
  const [search, setSearch] = useState('')
  const [busyId, setBusyId] = useState<number | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<ReasonDialog | null>(null)
  const [reason, setReason] = useState('')
  const [dialogError, setDialogError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    absencesApi
      .review()
      .then((result) => {
        if (!cancelled) setItems(result)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setLoadError(messageOf(cause))
      })
    return () => {
      cancelled = true
    }
  }, [])

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    return (items ?? []).filter((item) => {
      if (filter === 'mine' && !item.canDecide) return false
      if (filter !== 'mine' && filter !== 'all' && item.status !== filter) return false
      return !term || `${item.employeeName} ${item.departmentName ?? ''}`.toLowerCase().includes(term)
    })
  }, [items, filter, search])

  const pendingCount = (items ?? []).filter((item) => item.canDecide).length

  const replace = (updated: ReviewItem) =>
    setItems((list) => (list ? list.map((item) => (item.id === updated.id ? updated : item)) : list))

  const approve = async (item: ReviewItem) => {
    setBusyId(item.id)
    setActionError(null)
    try {
      replace(await absencesApi.approve(item.id))
    } catch (cause) {
      setActionError(messageOf(cause))
    } finally {
      setBusyId(null)
    }
  }

  const openDialog = (item: ReviewItem, action: ReasonDialog['action']) => {
    setReason('')
    setDialogError(null)
    setDialog({ item, action })
  }

  const submitDialog = async (event: FormEvent) => {
    event.preventDefault()
    if (!dialog) return
    setBusyId(dialog.item.id)
    setDialogError(null)
    try {
      const updated =
        dialog.action === 'reject'
          ? await absencesApi.reject(dialog.item.id, reason)
          : await absencesApi.cancelApproved(dialog.item.id, reason)
      replace(updated)
      setDialog(null)
    } catch (cause) {
      setDialogError(messageOf(cause))
    } finally {
      setBusyId(null)
    }
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-3xl px-3 py-4">
        <p className={ERROR_BOX}>{loadError}</p>
      </div>
    )
  }
  if (!items) return null

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3 px-3 py-4 text-text">
      <div>
        <p className="text-[13px] font-bold text-accent">VACACIONES / AUSENTISMOS</p>
        <h1 className="text-2xl font-bold">Solicitudes</h1>
        <p className="mt-0.5 text-sm text-muted">
          {isHr ? 'Todas las solicitudes de la empresa.' : 'Solicitudes de tu equipo.'}{' '}
          {pendingCount === 0 ? 'No tienes ninguna por decidir.' : `Tienes ${pendingCount} por decidir.`}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <select aria-label="Filtrar por estado" className={`${INPUT} w-auto`} value={filter} onChange={(event) => setFilter(event.target.value as Filter)}>
          <option value="mine">Por decidir</option>
          <option value="all">Todas</option>
          {(Object.keys(STATUS_LABELS) as AbsenceStatus[]).map((status) => (
            <option key={status} value={status}>{STATUS_LABELS[status]}</option>
          ))}
        </select>
        <input
          type="search"
          aria-label="Buscar persona"
          placeholder="Buscar por nombre o departamento"
          className={`${INPUT} min-w-0 flex-1`}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      {actionError && <p role="alert" className={ERROR_BOX}>{actionError}</p>}

      {visible.length === 0 && <p className={`${CARD} p-4 text-sm text-muted`}>No hay solicitudes con este filtro.</p>}

      {visible.map((item) => (
        <article key={item.id} className={`${CARD} p-3`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <strong className="block truncate text-sm">{item.employeeName}</strong>
              {item.departmentName && <span className="text-xs text-muted">{item.departmentName}</span>}
            </div>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[item.status]}`}>
              {STATUS_LABELS[item.status]}
            </span>
          </div>
          <p className="mt-2 text-sm">
            <strong>{TYPE_LABELS[item.type]}</strong>
            {' · '}
            {item.startDate === item.endDate
              ? formatDate(item.startDate)
              : `${formatDate(item.startDate)} al ${formatDate(item.endDate)}`}
            <span className="text-muted"> · {daysLabel(item.days)}</span>
          </p>
          {item.comment && <p className="mt-1 text-xs text-muted">{item.comment}</p>}
          {item.reason && (
            <p className="mt-2 rounded-lg bg-red-100 px-2 py-1 text-xs font-medium text-red-800">Motivo: {item.reason}</p>
          )}

          {(item.canDecide || item.canCancelApproved) && (
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              {item.canDecide && (
                <>
                  <button type="button" className={BUTTON_SECONDARY} disabled={busyId === item.id} onClick={() => openDialog(item, 'reject')}>
                    Rechazar
                  </button>
                  <button type="button" className={BUTTON_PRIMARY} disabled={busyId === item.id} onClick={() => void approve(item)}>
                    {busyId === item.id ? 'Guardando…' : 'Aprobar'}
                  </button>
                </>
              )}
              {item.canCancelApproved && (
                <button type="button" className={BUTTON_SECONDARY} disabled={busyId === item.id} onClick={() => openDialog(item, 'cancel')}>
                  Cancelar solicitud
                </button>
              )}
            </div>
          )}
        </article>
      ))}

      {dialog && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
          <form
            onSubmit={(event) => void submitDialog(event)}
            aria-label={DIALOG_TEXT[dialog.action].title}
            className="mt-10 w-full max-w-md rounded-2xl border border-border bg-surface p-5 text-text shadow-xl"
          >
            <h2 className="text-lg font-bold">{DIALOG_TEXT[dialog.action].title}</h2>
            <p className="mt-1 text-sm text-muted">
              {dialog.item.employeeName}: {TYPE_LABELS[dialog.item.type].toLowerCase()} del {formatDate(dialog.item.startDate)} al{' '}
              {formatDate(dialog.item.endDate)} ({daysLabel(dialog.item.days)}). {DIALOG_TEXT[dialog.action].note}
            </p>
            <label className={`${LABEL} mt-4`} htmlFor="review-reason">{DIALOG_TEXT[dialog.action].label}</label>
            <textarea
              id="review-reason"
              required
              maxLength={1000}
              rows={3}
              className={`${INPUT} h-auto py-2`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            {dialogError && <p role="alert" className={`${ERROR_BOX} mt-3`}>{dialogError}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className={BUTTON_SECONDARY} onClick={() => setDialog(null)} disabled={busyId !== null}>
                Volver
              </button>
              <button type="submit" className={BUTTON_PRIMARY} disabled={busyId !== null || !reason.trim()}>
                {busyId !== null ? 'Guardando…' : DIALOG_TEXT[dialog.action].button}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
