import { apiDownload, apiGet, apiPost, apiPut } from '../../api/client.ts'

export type ShiftType = 'activa' | 'inactiva'

export interface Project {
  id: number
  code: string
  name: string | null
  detail: string | null
}

export interface TimeEntry {
  id: number
  workDate: string
  projectId: number
  projectCode: string
  projectName: string | null
  shiftType: ShiftType
  perDiem: boolean
  comment: string | null
  /** Instantes en formato ISO. Los pone el servidor. */
  clockIn: string
  clockOut: string | null
  status: 'pending' | 'approved' | 'rejected'
  /** Motivo del supervisor si el día está rechazado. */
  rejectReason: string | null
  correctionSentAt: string | null
  correctionNote: string | null
  /** Las horas se corrigieron a mano. */
  hoursEdited: boolean
}

export interface TodayView {
  workDate: string
  /** La jornada activa es la de ayer (abierta o cerrada de madrugada). */
  isYesterday: boolean
  entry: TimeEntry | null
}

export type EntryStatus = TimeEntry['status']

/** Minutos de cada tipo de hora. */
export interface HoursBreakdown {
  normal: number
  extra: number
  sunday: number
  holiday: number
  total: number
}

export interface WeekDay extends TimeEntry, HoursBreakdown {
  kind: 'weekday' | 'saturday' | 'sunday' | 'holiday'
  /** false si falta la salida. */
  complete: boolean
}

export interface WeekView {
  weekStart: string
  weekEnd: string
  status: EntryStatus | null
  totals: HoursBreakdown & { perDiems: number }
  days: WeekDay[]
}

export const STATUS_LABELS: Record<EntryStatus, string> = {
  pending: 'Pendiente',
  approved: 'Aprobado',
  rejected: 'Rechazado',
}

export const STATUS_STYLES: Record<EntryStatus, string> = {
  pending: 'bg-amber-100 text-amber-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
}

/** Minutos como «h:mm» (510 → «8:30»). */
export function formatMinutes(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`
}

/** Hora local del dispositivo de un instante ISO. */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false })
}

/** Fecha AAAA-MM-DD como fecha local, sin desfase de zona horaria. */
export function parseDateKey(date: string): Date {
  return new Date(`${date}T00:00:00`)
}

const DATE_FORMAT: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric' }

/** Día `days` después de una fecha AAAA-MM-DD. */
export function addDaysKey(date: string, days: number): string {
  const result = parseDateKey(date)
  result.setDate(result.getDate() + days)
  const month = String(result.getMonth() + 1).padStart(2, '0')
  return `${result.getFullYear()}-${month}-${String(result.getDate()).padStart(2, '0')}`
}

/** Lunes de la semana de una fecha AAAA-MM-DD. */
export function weekStartKey(date: string): string {
  const weekday = parseDateKey(date).getDay() // 0 = domingo
  return addDaysKey(date, weekday === 0 ? -6 : 1 - weekday)
}

/** «16/11/2026 al 22/11/2026», a partir del lunes. */
export function weekLabel(weekStart: string): string {
  const format = (date: string) => parseDateKey(date).toLocaleDateString('es-MX', DATE_FORMAT)
  return `${format(weekStart)} al ${format(addDaysKey(weekStart, 6))}`
}

/** Una fila del consolidado de supervisión: la semana de un colaborador. */
export interface TeamWeekSummary {
  employeeId: number
  employeeName: string
  departmentName: string | null
  weekStart: string
  status: EntryStatus
  /** El colaborador ya envió la corrección y espera nueva revisión. */
  corrected: boolean
  projects: string[]
  totals: WeekView['totals']
  holidayDays: number
}

export interface TeamWeekDetail extends WeekView {
  employeeId: number
  employeeName: string
  departmentName: string | null
  corrected: boolean
  correctionSentAt: string | null
  correctionNote: string | null
}

export const SHIFT_TYPES: { id: ShiftType; label: string }[] = [
  { id: 'activa', label: 'Activa' },
  { id: 'inactiva', label: 'Inactiva' },
]

/** Zona horaria del dispositivo. El servidor la usa para saber a qué día pertenece el fichaje. */
export function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

export function projectLabel(project: Pick<Project, 'code' | 'name' | 'detail'>): string {
  const name = [project.name, project.detail].filter(Boolean).join(' - ')
  return name ? `${project.code} · ${name}` : project.code
}

export const timesheetApi = {
  projects: () => apiGet<Project[]>('/api/projects'),
  today: () => apiGet<TodayView>(`/api/timesheet/today?timeZone=${encodeURIComponent(deviceTimeZone())}`),
  clockIn: (input: { projectId: number; shiftType: ShiftType; perDiem: boolean; comment: string }) =>
    apiPost<TodayView>('/api/timesheet/clock-in', { ...input, timeZone: deviceTimeZone() }),
  clockOut: () => apiPost<TodayView>('/api/timesheet/clock-out', { timeZone: deviceTimeZone() }),
  setComment: (comment: string) =>
    apiPut<TodayView>('/api/timesheet/today/comment', { comment, timeZone: deviceTimeZone() }),
  weeks: () =>
    apiGet<{ current: string; weeks: string[]; rejectedWeeks: string[] }>(
      `/api/timesheet/weeks?timeZone=${encodeURIComponent(deviceTimeZone())}`,
    ),
  /** El colaborador corrige uno de sus días rechazados. */
  correctEntry: (entryId: number, changes: EntryCorrection) =>
    apiPut<WeekView>(`/api/timesheet/entries/${entryId}`, changes),
  /** Devuelve a revisión los días rechazados de la semana, con una nota opcional. */
  sendCorrection: (date: string, note: string) =>
    apiPost<WeekView>('/api/timesheet/week/send-correction', { date, note }),
  week: (date: string) => apiGet<WeekView>(`/api/timesheet/week?date=${date}`),
  setEntryComment: (entryId: number, comment: string) =>
    apiPut<{ ok: true }>(`/api/timesheet/entries/${entryId}/comment`, { comment }),
}

/** Supervisión: semanas del equipo directo. */
export const teamApi = {
  summary: () => apiGet<TeamWeekSummary[]>('/api/timesheet/team/summary'),
  week: (employeeId: number, weekStart: string) =>
    apiGet<TeamWeekDetail>(`/api/timesheet/team/week?employeeId=${employeeId}&date=${weekStart}`),
  approve: (employeeId: number, weekStart: string) =>
    apiPost<TeamWeekDetail>('/api/timesheet/team/week/approve', { employeeId, weekStart }),
  reject: (employeeId: number, weekStart: string, rejectedEntryIds: number[], reason: string) =>
    apiPost<TeamWeekDetail>('/api/timesheet/team/week/reject', { employeeId, weekStart, rejectedEntryIds, reason }),
  correct: (entryId: number, changes: EntryCorrection) =>
    apiPut<TeamWeekDetail>(`/api/timesheet/team/entries/${entryId}`, changes),
  history: (employeeId: number, weekStart: string) =>
    apiGet<HistoryItem[]>(`/api/timesheet/team/week/history?employeeId=${employeeId}&date=${weekStart}`),
}

/** Una fila del reporte de nómina: la semana aprobada de un colaborador. */
export interface PayrollWeek {
  employeeId: number
  employeeNumber: string
  employeeName: string
  email: string
  departmentName: string | null
  weekStart: string
  weekEnd: string
  projects: string[]
  totals: WeekView['totals']
  inactiveDays: number
  approvedAt: string | null
}

/** Panel de RRHH: semanas aprobadas, de solo lectura. */
export const payrollApi = {
  summary: () => apiGet<PayrollWeek[]>('/api/timesheet/payroll/summary'),
  week: (employeeId: number, weekStart: string) =>
    apiGet<TeamWeekDetail>(`/api/timesheet/payroll/week?employeeId=${employeeId}&date=${weekStart}`),
  /** CSV de nómina de las semanas indicadas. */
  exportCsv: (weeks: { employeeId: number; weekStart: string }[]) =>
    apiDownload('/api/timesheet/payroll/export', { weeks }),
}

/** Cambios de una corrección. Solo se envían los campos que cambian; las horas, como instantes ISO. */
export interface EntryCorrection {
  projectId?: number
  shiftType?: ShiftType
  perDiem?: boolean
  clockIn?: string
  clockOut?: string
}

/** Un movimiento del historial de una semana. */
export interface HistoryItem {
  kind: 'approved' | 'rejected' | 'resubmitted' | 'corrected_supervisor' | 'corrected_employee'
  actorName: string
  at: string
  reason: string | null
  workDate: string | null
  changes: Record<string, { from: unknown; to: unknown }> | null
}

/** «HH:MM» local de un instante ISO, para un campo de hora. */
export function toTimeInput(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/**
 * Combina el día de la jornada con horas «HH:MM» locales. Si la salida no es posterior
 * a la entrada, se entiende que la jornada terminó al día siguiente.
 */
export function buildSchedule(workDate: string, timeIn: string, timeOut: string): { clockIn: Date; clockOut: Date | null; nextDay: boolean } {
  const clockIn = new Date(`${workDate}T${timeIn}:00`)
  if (!timeOut) return { clockIn, clockOut: null, nextDay: false }
  const clockOut = new Date(`${workDate}T${timeOut}:00`)
  const nextDay = clockOut <= clockIn
  if (nextDay) clockOut.setDate(clockOut.getDate() + 1)
  return { clockIn, clockOut, nextDay }
}
