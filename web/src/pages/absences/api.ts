import { apiGet, apiPost } from '../../api/client.ts'

export type AbsenceType = 'vacation' | 'sick_leave'

/** En qué paso está la solicitud o cómo terminó. */
export type AbsenceStatus = 'pending_supervisor' | 'pending_hr' | 'approved' | 'rejected' | 'cancelled'

export interface AbsenceRequest {
  id: number
  type: AbsenceType
  startDate: string
  endDate: string
  /** Días que cuenta: laborables en vacaciones, naturales en incapacidad. */
  days: number
  comment: string | null
  status: AbsenceStatus
  /** Motivo del rechazo o de la cancelación hecha por RRHH. */
  reason: string | null
  canCancel: boolean
  createdAt: string
}

/** Saldo de vacaciones de un año de servicio (de aniversario a aniversario). */
export interface VacationBalance {
  number: number
  start: string
  end: string
  entitlement: number
  adjustment: number
  used: number
  reserved: number
  available: number
}

export interface AbsenceOverview {
  today: string
  /** null si RRHH aún no registró la fecha de ingreso. */
  hireDate: string | null
  balance: VacationBalance | null
  requests: AbsenceRequest[]
}

export interface AbsencePreview {
  days: number
  years: { number: number; start: string; end: string; available: number; requested: number; shortage: number }[]
  /** null si se puede solicitar; si no, el motivo. */
  problem: string | null
}

/** Una solicitud vista por quien la revisa (supervisor o RRHH). */
export interface ReviewItem {
  id: number
  employeeId: number
  employeeName: string
  departmentName: string | null
  type: AbsenceType
  startDate: string
  endDate: string
  days: number
  comment: string | null
  status: AbsenceStatus
  reason: string | null
  createdAt: string
  /** Le toca aprobar o rechazar ahora a quien consulta. */
  canDecide: boolean
  /** RRHH puede cancelar una solicitud ya aprobada. */
  canCancelApproved: boolean
}

export interface BalanceAdjustment {
  days: number
  reason: string
  byName: string
  at: string
}

export interface EmployeeBalance {
  employeeId: number
  employeeNumber: string
  employeeName: string
  departmentName: string | null
  hireDate: string | null
  balance: VacationBalance | null
  /** Ajustes de RRHH del año de servicio en curso. */
  adjustments: BalanceAdjustment[]
}

export interface AbsenceInput {
  type: AbsenceType
  startDate: string
  endDate: string
  comment: string
}

export const TYPE_LABELS: Record<AbsenceType, string> = {
  vacation: 'Vacaciones',
  sick_leave: 'Incapacidad',
}

export const STATUS_LABELS: Record<AbsenceStatus, string> = {
  pending_supervisor: 'Pendiente del supervisor',
  pending_hr: 'Pendiente de RRHH',
  approved: 'Aprobada',
  rejected: 'Rechazada',
  cancelled: 'Cancelada',
}

export const STATUS_STYLES: Record<AbsenceStatus, string> = {
  pending_supervisor: 'bg-amber-100 text-amber-800',
  pending_hr: 'bg-amber-100 text-amber-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
  cancelled: 'bg-gray-200 text-gray-700',
}

/** «23 nov 2026» a partir de AAAA-MM-DD, sin depender de la zona horaria. */
export function formatDate(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function daysLabel(days: number): string {
  return days === 1 ? '1 día' : `${days} días`
}

// La zona del dispositivo decide qué día es «hoy» para el servidor.
function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

export const absencesApi = {
  mine: () => apiGet<AbsenceOverview>(`/api/absences/mine?timeZone=${encodeURIComponent(deviceTimeZone())}`),
  preview: (input: AbsenceInput) =>
    apiPost<AbsencePreview>('/api/absences/preview', { ...input, timeZone: deviceTimeZone() }),
  create: (input: AbsenceInput) => apiPost<AbsenceRequest>('/api/absences', { ...input, timeZone: deviceTimeZone() }),
  cancel: (id: number) => apiPost<AbsenceRequest>(`/api/absences/${id}/cancel`),
  // Revisión (supervisor y RRHH)
  review: () => apiGet<ReviewItem[]>('/api/absences/review'),
  approve: (id: number) => apiPost<ReviewItem>(`/api/absences/${id}/approve`),
  reject: (id: number, reason: string) => apiPost<ReviewItem>(`/api/absences/${id}/reject`, { reason }),
  // Solo RRHH
  cancelApproved: (id: number, reason: string) => apiPost<ReviewItem>(`/api/absences/${id}/cancel-approved`, { reason }),
  balances: () => apiGet<EmployeeBalance[]>(`/api/absences/balances?timeZone=${encodeURIComponent(deviceTimeZone())}`),
  adjust: (employeeId: number, days: number, reason: string) =>
    apiPost<{ ok: true }>(`/api/absences/balances/${employeeId}/adjust`, { days, reason, timeZone: deviceTimeZone() }),
}
