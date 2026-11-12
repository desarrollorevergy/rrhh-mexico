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
}
