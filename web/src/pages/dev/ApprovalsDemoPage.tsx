import { useCallback, useEffect, useState } from 'react'
import { apiGet, apiPost } from '../../api/client.ts'

// SOLO DESARROLLO: página para probar el motor de aprobaciones sin un módulo real.
// App.tsx solo la carga si import.meta.env.DEV, así que no entra en producción.

interface HistoryEntry {
  action: string
  actorName: string
  round: number
  reason: string | null
  at: string
}

interface ApprovalRequest {
  id: number
  typeLabel: string
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  currentStep: number
  round: number
  steps: { approvers: ({ kind: 'supervisor' } | { kind: 'role'; role: string })[] }[]
  requesterName: string
  canDecide: boolean
  canResubmit: boolean
  canCancel: boolean
  history?: HistoryEntry[]
}

const STATUS: Record<ApprovalRequest['status'], { label: string; className: string }> = {
  pending: { label: 'Pendiente', className: 'bg-amber-100 text-amber-800' },
  approved: { label: 'Aprobada', className: 'bg-green-100 text-green-800' },
  rejected: { label: 'Rechazada', className: 'bg-red-100 text-red-800' },
  cancelled: { label: 'Cancelada', className: 'bg-gray-200 text-gray-700' },
}

const ACTIONS: Record<string, string> = {
  submitted: 'Envió',
  approved: 'Aprobó',
  rejected: 'Rechazó',
  resubmitted: 'Reenvió',
  cancelled: 'Canceló',
}

const BUTTON = 'h-9 cursor-pointer rounded-lg px-3 text-sm font-semibold disabled:opacity-50'

function stepLabel(request: ApprovalRequest): string {
  const names = request.steps.map((step) =>
    step.approvers.map((spec) => (spec.kind === 'supervisor' ? 'supervisor' : spec.role)).join(' + '),
  )
  return names.map((name, index) => (index === request.currentStep && request.status === 'pending' ? `[${name}]` : name)).join(' → ')
}

export default function ApprovalsDemoPage() {
  const [pending, setPending] = useState<ApprovalRequest[]>([])
  const [mine, setMine] = useState<ApprovalRequest[]>([])
  const [detail, setDetail] = useState<ApprovalRequest | null>(null)
  const [rejecting, setRejecting] = useState<number | null>(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const [pendingList, mineList] = await Promise.all([
      apiGet<ApprovalRequest[]>('/api/approvals/pending'),
      apiGet<ApprovalRequest[]>('/api/approvals/mine'),
    ])
    setPending(pendingList)
    setMine(mineList)
  }, [])

  const run = useCallback(
    async (action: () => Promise<ApprovalRequest | void>) => {
      setError(null)
      try {
        const result = await action()
        if (result) setDetail(await apiGet<ApprovalRequest>(`/api/approvals/${result.id}`))
        await reload()
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Error')
      }
    },
    [reload],
  )

  // Carga inicial.
  useEffect(() => {
    let cancelled = false
    Promise.all([
      apiGet<ApprovalRequest[]>('/api/approvals/pending'),
      apiGet<ApprovalRequest[]>('/api/approvals/mine'),
    ])
      .then(([pendingList, mineList]) => {
        if (cancelled) return
        setPending(pendingList)
        setMine(mineList)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Error')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const renderRow = (request: ApprovalRequest) => (
    <li key={request.id} className="rounded-xl border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">#{request.id}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS[request.status].className}`}>
          {STATUS[request.status].label}
        </span>
        <span className="text-sm text-muted">de {request.requesterName}</span>
        <span className="text-xs text-faint">{stepLabel(request)}</span>
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          className={`${BUTTON} border border-border text-text`}
          onClick={() => void run(() => apiGet<ApprovalRequest>(`/api/approvals/${request.id}`))}
        >
          Historial
        </button>
        {request.canDecide && (
          <>
            <button
              type="button"
              className={`${BUTTON} bg-brand-green text-white`}
              onClick={() => void run(() => apiPost<ApprovalRequest>(`/api/approvals/${request.id}/approve`))}
            >
              Aceptar
            </button>
            <button
              type="button"
              className={`${BUTTON} bg-red-600 text-white`}
              onClick={() => {
                setRejecting(request.id)
                setReason('')
              }}
            >
              Rechazar
            </button>
          </>
        )}
        {request.canResubmit && (
          <button
            type="button"
            className={`${BUTTON} bg-brand-blue text-white`}
            onClick={() => void run(() => apiPost<ApprovalRequest>(`/api/approvals/${request.id}/resubmit`))}
          >
            Reenviar
          </button>
        )}
        {request.canCancel && (
          <button
            type="button"
            className={`${BUTTON} border border-border text-text`}
            onClick={() => void run(() => apiPost<ApprovalRequest>(`/api/approvals/${request.id}/cancel`))}
          >
            Cancelar
          </button>
        )}
      </div>

      {rejecting === request.id && (
        <form
          className="mt-2 flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            setRejecting(null)
            void run(() => apiPost<ApprovalRequest>(`/api/approvals/${request.id}/reject`, { reason }))
          }}
        >
          <input
            autoFocus
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Motivo del rechazo"
            aria-label="Motivo del rechazo"
            className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 text-sm text-text"
          />
          <button type="submit" className={`${BUTTON} bg-red-600 text-white`}>
            Confirmar rechazo
          </button>
        </form>
      )}
    </li>
  )

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 text-text">
      <p className="text-[13px] font-bold text-accent">SOLO DESARROLLO</p>
      <h1 className="text-2xl font-bold">Prueba del motor de aprobaciones</h1>
      <p className="mt-1 text-sm text-muted">
        Cadena de prueba: supervisor → Controlling + Almacén (en paralelo) → RRHH. Cambia de usuario arriba para
        actuar como cada uno.
      </p>

      <button
        type="button"
        className={`${BUTTON} mt-4 bg-brand-blue text-white`}
        onClick={() => void run(() => apiPost<ApprovalRequest>('/api/approvals/demo'))}
      >
        Crear solicitud de prueba
      </button>

      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-red-100 px-3 py-2 text-sm font-medium text-red-800">
          {error}
        </p>
      )}

      <h2 className="mt-6 mb-2 font-bold">Pendientes de mi decisión ({pending.length})</h2>
      <ul className="flex flex-col gap-2">{pending.map(renderRow)}</ul>

      <h2 className="mt-6 mb-2 font-bold">Mis solicitudes ({mine.length})</h2>
      <ul className="flex flex-col gap-2">{mine.map(renderRow)}</ul>

      {detail?.history && (
        <section className="mt-6 rounded-xl border border-border bg-surface p-3">
          <h2 className="font-bold">Historial de la solicitud #{detail.id}</h2>
          <ol className="mt-2 flex flex-col gap-1 text-sm">
            {detail.history.map((entry, index) => (
              <li key={index}>
                <span className="text-faint">{new Date(entry.at).toLocaleString('es-MX')}</span> ·{' '}
                <strong>{ACTIONS[entry.action] ?? entry.action}</strong> {entry.actorName}
                {entry.round > 1 && <span className="text-faint"> (vuelta {entry.round})</span>}
                {entry.reason && <span className="text-muted"> — «{entry.reason}»</span>}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  )
}
