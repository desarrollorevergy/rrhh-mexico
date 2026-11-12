import { apiGet, apiPost, apiPut } from '../../api/client.ts'

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
    apiGet<{ current: string; weeks: string[] }>(
      `/api/timesheet/weeks?timeZone=${encodeURIComponent(deviceTimeZone())}`,
    ),
  week: (date: string) => apiGet<WeekView>(`/api/timesheet/week?date=${date}`),
  setEntryComment: (entryId: number, comment: string) =>
    apiPut<{ ok: true }>(`/api/timesheet/entries/${entryId}/comment`, { comment }),
}
