import { ApiError, NetworkError } from '../../api/client.ts'
import { timesheetApi, type Project, type ShiftType, type TimeEntry, type TodayView } from './api.ts'

// Fichaje sin conexión. Sin red, el fichaje se guarda en el dispositivo con su hora y se sube
// al reconectar; el servidor lo marca como «fichado sin conexión». Todo vive en localStorage,
// separado por usuario.

/** Hora local hasta la que la jornada de ayer sigue siendo la activa (igual que en el servidor). */
const CUTOFF_HOUR = 8

/** Se emite en `window` cuando una sincronización sube o descarta algo. */
export const SYNC_EVENT = 'timesheet-sync'

export interface OfflineClockIn {
  /** Instante ISO con la hora del dispositivo. */
  at: string
  projectId: number
  projectCode: string
  projectName: string | null
  shiftType: ShiftType
  perDiem: boolean
  comment: string
}

/** Un fichaje pendiente de subir: la entrada, la salida o las dos. */
export interface OfflineRecord {
  id: string
  /** Día de la jornada según el dispositivo. Solo para mostrarla: el definitivo lo calcula el servidor. */
  workDate: string
  clockIn: OfflineClockIn | null
  clockOut: { at: string } | null
  /** Jornada del servidor a la que pertenece la salida, si la entrada se fichó con conexión. */
  entry: TimeEntry | null
  /** El servidor rechazó este fichaje: no se reintenta hasta que el usuario lo descarte. */
  error: string | null
}

export interface SyncReport {
  /** Fichajes subidos. */
  synced: number
  /** Fichajes descartados porque el servidor ya tenía otro de ese día. */
  conflicts: number
  /** Fichajes que siguen en el dispositivo y se pueden reintentar. */
  remaining: number
  /** Por qué se detuvo: sin red, sesión caducada o fallo del servidor. null si terminó. */
  stopped: 'offline' | 'session' | 'error' | null
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

const userKey = (email: string) => email.trim().toLowerCase()
const queueKey = (email: string) => `timesheet.queue.${userKey(email)}`
const todayKey = (email: string) => `timesheet.today.${userKey(email)}`
const PROJECTS_KEY = 'timesheet.projects'

export function loadQueue(email: string): OfflineRecord[] {
  return read<OfflineRecord[]>(queueKey(email)) ?? []
}

function saveQueue(email: string, queue: OfflineRecord[]): boolean {
  return write(queueKey(email), queue)
}

/** Última respuesta del servidor, para poder mostrar la jornada sin red. */
export function cacheToday(email: string, today: TodayView): void {
  write(todayKey(email), today)
}

export function cacheProjects(projects: Project[]): void {
  write(PROJECTS_KEY, projects)
}

export function cachedProjects(): Project[] {
  return read<Project[]>(PROJECTS_KEY) ?? []
}

/** Fecha local AAAA-MM-DD del dispositivo. */
export function localDateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${String(date.getDate()).padStart(2, '0')}`
}

function yesterdayKey(now: Date): string {
  const date = new Date(now)
  date.setDate(date.getDate() - 1)
  return localDateKey(date)
}

/** Una jornada guardada en el dispositivo, con la forma de las del servidor. */
function entryOf(record: OfflineRecord): TimeEntry | null {
  if (record.clockIn) {
    return {
      id: 0,
      workDate: record.workDate,
      projectId: record.clockIn.projectId,
      projectCode: record.clockIn.projectCode,
      projectName: record.clockIn.projectName,
      shiftType: record.clockIn.shiftType,
      perDiem: record.clockIn.perDiem,
      comment: record.clockIn.comment || null,
      clockIn: record.clockIn.at,
      clockOut: record.clockOut?.at ?? null,
      status: 'pending',
      rejectReason: null,
      correctionSentAt: null,
      correctionNote: null,
      hoursEdited: false,
      clockInOffline: true,
      clockOutOffline: record.clockOut !== null,
    }
  }
  if (!record.entry) return null
  return { ...record.entry, clockOut: record.clockOut?.at ?? null, clockOutOffline: record.clockOut !== null }
}

/** ¿Sigue siendo esta la jornada que toca mostrar? Misma regla de medianoche que el servidor. */
function isActive(entry: TimeEntry, now: Date): boolean {
  const today = localDateKey(now)
  if (entry.workDate === today) return true
  if (entry.workDate !== yesterdayKey(now) || now.getHours() >= CUTOFF_HOUR) return false
  return !entry.clockOut || localDateKey(new Date(entry.clockOut)) === today
}

/**
 * Lo que debe ver la pantalla de fichar con lo que hay en el dispositivo: el último fichaje
 * pendiente de subir o, si no hay, la última respuesta del servidor.
 */
export function localToday(email: string, now: Date = new Date()): TodayView {
  const today = localDateKey(now)
  const pending = loadQueue(email)
    .filter((record) => !record.error)
    .at(-1)
  const candidates = [pending ? entryOf(pending) : null, read<TodayView>(todayKey(email))?.entry ?? null]
  const entry = candidates.find((candidate) => candidate !== null && isActive(candidate, now)) ?? null
  return entry
    ? { workDate: entry.workDate, isYesterday: entry.workDate !== today, entry }
    : { workDate: today, isYesterday: false, entry: null }
}

/** Fichajes que siguen en el dispositivo y cuántos rechazó el servidor. */
export function queueStatus(email: string): { pending: number; failed: OfflineRecord[] } {
  const queue = loadQueue(email)
  return { pending: queue.filter((record) => !record.error).length, failed: queue.filter((record) => record.error) }
}

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

/** Guarda en el dispositivo una entrada fichada sin conexión. Devuelve false si no se pudo guardar. */
export function enqueueClockIn(email: string, clockIn: Omit<OfflineClockIn, 'at'>, now: Date = new Date()): boolean {
  const record: OfflineRecord = {
    id: newId(),
    workDate: localDateKey(now),
    clockIn: { ...clockIn, at: now.toISOString() },
    clockOut: null,
    entry: null,
    error: null,
  }
  return saveQueue(email, [...loadQueue(email), record])
}

/**
 * Guarda en el dispositivo una salida fichada sin conexión: sobre la entrada pendiente si la hay
 * o, si la entrada ya está en el servidor, como salida suelta de esa jornada.
 */
export function enqueueClockOut(email: string, serverEntry: TimeEntry | null, now: Date = new Date()): boolean {
  const queue = loadQueue(email)
  const clockOut = { at: now.toISOString() }
  const last = queue.at(-1)
  if (last && !last.error && last.clockIn && !last.clockOut) {
    return saveQueue(email, [...queue.slice(0, -1), { ...last, clockOut }])
  }
  if (!serverEntry || serverEntry.id === 0) return false
  const record: OfflineRecord = {
    id: newId(),
    workDate: serverEntry.workDate,
    clockIn: null,
    clockOut,
    entry: serverEntry,
    error: null,
  }
  return saveQueue(email, [...queue, record])
}

/** Cambia el comentario de la entrada que aún no se ha subido. */
export function setPendingComment(email: string, comment: string): boolean {
  const queue = loadQueue(email)
  const last = queue.at(-1)
  if (!last?.clockIn || last.error) return false
  return saveQueue(email, [...queue.slice(0, -1), { ...last, clockIn: { ...last.clockIn, comment } }])
}

export function discardRecord(email: string, id: string): void {
  saveQueue(
    email,
    loadQueue(email).filter((record) => record.id !== id),
  )
}

const inFlight = new Map<string, Promise<SyncReport>>()

/**
 * Sube al servidor los fichajes guardados en el dispositivo, en orden. Se puede llamar las veces
 * que haga falta: si ya hay una subida en marcha, devuelve esa.
 */
export function syncQueue(email: string): Promise<SyncReport> {
  const key = userKey(email)
  const running = inFlight.get(key)
  if (running) return running
  const promise = runSync(email).finally(() => inFlight.delete(key))
  inFlight.set(key, promise)
  return promise
}

async function runSync(email: string): Promise<SyncReport> {
  const report: SyncReport = { synced: 0, conflicts: 0, remaining: 0, stopped: null }
  const ids = loadQueue(email)
    .filter((record) => !record.error)
    .map((record) => record.id)

  for (const id of ids) {
    const sent = loadQueue(email).find((record) => record.id === id)
    if (!sent) continue
    try {
      const result = await timesheetApi.sync({
        clockIn: sent.clockIn && {
          at: sent.clockIn.at,
          projectId: sent.clockIn.projectId,
          shiftType: sent.clockIn.shiftType,
          perDiem: sent.clockIn.perDiem,
          comment: sent.clockIn.comment,
        },
        clockOut: sent.clockOut,
      })
      cacheToday(email, result.today)
      if (result.clockIn === 'conflict' || result.clockOut === 'conflict') report.conflicts += 1
      else report.synced += 1

      // Mientras subía la entrada, el usuario pudo fichar la salida: se conserva como salida suelta.
      const queue = loadQueue(email)
      const current = queue.find((record) => record.id === id)
      const lateClockOut = current && !sent.clockOut && current.clockOut && result.clockIn === 'saved' ? current.clockOut : null
      saveQueue(
        email,
        queue.flatMap((record) => {
          if (record.id !== id) return [record]
          if (!lateClockOut || !result.today.entry) return []
          return [{ ...record, clockIn: null, clockOut: lateClockOut, entry: result.today.entry }]
        }),
      )
      if (lateClockOut && result.today.entry) ids.push(id)
    } catch (cause) {
      if (cause instanceof NetworkError) {
        report.stopped = 'offline'
        break
      }
      if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) {
        report.stopped = 'session'
        break
      }
      if (cause instanceof ApiError && cause.status >= 400 && cause.status < 500) {
        // El servidor no lo acepta tal cual (por ejemplo, hora en el futuro): no tiene sentido reintentar.
        saveQueue(
          email,
          loadQueue(email).map((record) => (record.id === id ? { ...record, error: cause.message } : record)),
        )
        continue
      }
      report.stopped = 'error'
      break
    }
  }

  report.remaining = queueStatus(email).pending
  if (report.synced > 0 || report.conflicts > 0) {
    window.dispatchEvent(new CustomEvent<SyncReport>(SYNC_EVENT, { detail: report }))
  }
  return report
}
