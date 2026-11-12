import sql from 'mssql'
import type { DbConfig } from '../config/env.js'
import { getPool } from '../db/pool.js'
import {
  addDays,
  calculateWeek,
  weekStartOf,
  type DateKey,
  type DayKind,
  type HoursBreakdown,
} from './hours.js'
import { isValidTimeZone, localParts, resolveActiveShift } from './shift.js'

export type ShiftType = 'activa' | 'inactiva'
export type EntryStatus = 'pending' | 'approved' | 'rejected'

export interface TimeEntry {
  id: number
  workDate: DateKey
  projectId: number
  projectCode: string
  projectName: string | null
  shiftType: ShiftType
  perDiem: boolean
  comment: string | null
  clockIn: Date
  clockOut: Date | null
  status: EntryStatus
}

/** Una jornada con sus horas ya repartidas (en minutos). */
export interface WeekDay extends TimeEntry, HoursBreakdown {
  kind: DayKind
  /** false si falta la salida. */
  complete: boolean
}

/** «Mi semana»: las jornadas de lunes a domingo con su consolidado. */
export interface WeekView {
  weekStart: DateKey
  weekEnd: DateKey
  /** Estado de la semana; null si no tiene jornadas. */
  status: EntryStatus | null
  totals: HoursBreakdown & { perDiems: number }
  days: WeekDay[]
}

/** Lo que ve la pantalla de fichar. */
export interface TodayView {
  workDate: DateKey
  /** La jornada activa es la de ayer (abierta o cerrada de madrugada). */
  isYesterday: boolean
  entry: TimeEntry | null
}

export interface ClockInInput {
  projectId: number
  shiftType: ShiftType
  perDiem: boolean
  comment: string | null
}

/** Error de fichaje que la pantalla debe mostrar tal cual. */
export class TimesheetError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'TimesheetError'
    this.status = status
  }
}

const MAX_COMMENT = 1000
const UNIQUE_VIOLATION = [2601, 2627]

const ENTRY_SELECT = `
  SELECT t.id, CONVERT(char(10), t.work_date, 23) AS workDate, t.project_id AS projectId,
         p.code AS projectCode, p.name AS projectName, t.shift_type AS shiftType,
         t.per_diem AS perDiem, t.comment, t.clock_in AS clockIn, t.clock_out AS clockOut, t.status
  FROM time_entries AS t
  JOIN projects AS p ON p.id = t.project_id`

function cleanComment(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw new TimesheetError(400, 'El comentario no es válido')
  const comment = value.trim()
  if (comment.length > MAX_COMMENT) throw new TimesheetError(400, 'El comentario es demasiado largo')
  return comment || null
}

/** Valida lo que envía la pantalla al fichar la entrada. */
export function parseClockIn(body: unknown): ClockInInput {
  const data = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
  const projectId = Number(data.projectId)
  if (!Number.isInteger(projectId) || projectId <= 0) {
    throw new TimesheetError(400, 'Selecciona la analítica / proyecto antes de fichar')
  }
  if (data.shiftType !== 'activa' && data.shiftType !== 'inactiva') {
    throw new TimesheetError(400, 'Selecciona el tipo de jornada antes de fichar')
  }
  return { projectId, shiftType: data.shiftType, perDiem: data.perDiem === true, comment: cleanComment(data.comment) }
}

export function parseTimeZone(value: unknown): string {
  if (!isValidTimeZone(value)) throw new TimesheetError(400, 'Zona horaria no válida')
  return value
}

export function parseComment(body: unknown): string | null {
  const data = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
  return cleanComment(data.comment)
}

export interface TimesheetServiceOptions {
  db: DbConfig
  /** Reloj del servidor. Solo se cambia en las pruebas. */
  now?: () => Date
}

export function createTimesheetService(options: TimesheetServiceOptions) {
  const { db } = options
  const now = options.now ?? (() => new Date())

  async function entriesByDate(employeeId: number, dates: DateKey[]): Promise<Map<DateKey, TimeEntry>> {
    const pool = await getPool(db)
    const request = pool.request().input('employeeId', sql.Int, employeeId)
    dates.forEach((date, index) => request.input(`d${index}`, sql.Date, date))
    const result = await request.query<TimeEntry>(`
      ${ENTRY_SELECT}
      WHERE t.employee_id = @employeeId AND t.work_date IN (${dates.map((_, index) => `@d${index}`).join(', ')})`)
    return new Map(result.recordset.map((entry) => [entry.workDate, entry]))
  }

  /** Jornada activa del empleado en este instante, según su zona horaria. */
  async function today(employeeId: number, timeZone: string, at: Date = now()): Promise<TodayView> {
    const todayDate = localParts(at, timeZone).date
    const yesterdayDate = addDays(todayDate, -1)
    const entries = await entriesByDate(employeeId, [todayDate, yesterdayDate])

    const active = resolveActiveShift({
      now: at,
      timeZone,
      today: entries.get(todayDate),
      yesterday: entries.get(yesterdayDate),
    })
    return { ...active, entry: entries.get(active.workDate) ?? null }
  }

  /** Estado de una semana a partir del de sus días. */
  function weekStatus(entries: TimeEntry[]): EntryStatus | null {
    if (entries.length === 0) return null
    if (entries.some((entry) => entry.status === 'rejected')) return 'rejected'
    if (entries.some((entry) => entry.status === 'pending')) return 'pending'
    return 'approved'
  }

  return {
    today,

    /** Jornadas y consolidado de la semana (lunes a domingo) que contiene `date`. */
    async week(employeeId: number, date: DateKey): Promise<WeekView> {
      const weekStart = weekStartOf(date)
      const weekEnd = addDays(weekStart, 6)
      const pool = await getPool(db)

      const [entries, holidays] = await Promise.all([
        pool
          .request()
          .input('employeeId', sql.Int, employeeId)
          .input('from', sql.Date, weekStart)
          .input('to', sql.Date, weekEnd)
          .query<TimeEntry>(`
            ${ENTRY_SELECT}
            WHERE t.employee_id = @employeeId AND t.work_date BETWEEN @from AND @to
            ORDER BY t.work_date`),
        pool
          .request()
          .input('from', sql.Date, weekStart)
          .input('to', sql.Date, weekEnd)
          .query<{ date: DateKey }>(`
            SELECT CONVERT(char(10), holiday_date, 23) AS date
            FROM holidays WHERE holiday_date BETWEEN @from AND @to`),
      ])

      const hours = calculateWeek(
        entries.recordset.map((entry) => ({
          date: entry.workDate,
          clockIn: entry.clockIn,
          clockOut: entry.clockOut,
          perDiem: entry.perDiem,
        })),
        new Set(holidays.recordset.map((holiday) => holiday.date)),
      )
      const hoursByDate = new Map(hours.days.map((day) => [day.date, day]))

      const { days: _days, ...totals } = hours
      return {
        weekStart,
        weekEnd,
        status: weekStatus(entries.recordset),
        totals,
        days: entries.recordset.flatMap((entry) => {
          const day = hoursByDate.get(entry.workDate)
          if (!day) return []
          const { date: _date, ...breakdown } = day
          return [{ ...entry, ...breakdown }]
        }),
      }
    },

    /** Semanas en las que el empleado tiene jornadas (lunes de cada una), más la actual. */
    async weeks(employeeId: number, timeZone: string): Promise<{ current: DateKey; weeks: DateKey[] }> {
      const current = weekStartOf(localParts(now(), timeZone).date)
      const pool = await getPool(db)
      const result = await pool
        .request()
        .input('employeeId', sql.Int, employeeId)
        .query<{ date: DateKey }>(`
          SELECT DISTINCT CONVERT(char(10), work_date, 23) AS date
          FROM time_entries WHERE employee_id = @employeeId`)
      const weeks = new Set(result.recordset.map((row) => weekStartOf(row.date)))
      weeks.add(current)
      // De la más reciente a la más antigua.
      return { current, weeks: [...weeks].sort().reverse() }
    },

    /** Comentario de una jornada propia, mientras no esté aprobada. */
    async setEntryComment(employeeId: number, entryId: number, comment: string | null): Promise<void> {
      const pool = await getPool(db)
      const found = await pool
        .request()
        .input('id', sql.Int, entryId)
        .input('employeeId', sql.Int, employeeId)
        .query<{ status: EntryStatus }>('SELECT status FROM time_entries WHERE id = @id AND employee_id = @employeeId')
      const entry = found.recordset[0]
      // Una jornada ajena se trata igual que una que no existe.
      if (!entry) throw new TimesheetError(404, 'Jornada no encontrada')
      if (entry.status === 'approved') {
        throw new TimesheetError(409, 'La jornada ya está aprobada y no se puede modificar')
      }
      await pool
        .request()
        .input('id', sql.Int, entryId)
        .input('comment', sql.NVarChar(1000), comment)
        .query('UPDATE time_entries SET comment = @comment, updated_at = SYSUTCDATETIME() WHERE id = @id')
    },

    /** Fichar entrada. La hora la pone el servidor. Un solo registro por día. */
    async clockIn(employeeId: number, timeZone: string, input: ClockInInput): Promise<TodayView> {
      const at = now()
      const current = await today(employeeId, timeZone, at)
      if (current.entry) {
        if (!current.isYesterday) throw new TimesheetError(409, 'Ya fichaste la entrada de hoy')
        throw new TimesheetError(
          409,
          current.entry.clockOut
            ? 'La jornada de ayer terminó de madrugada: podrás fichar la de hoy a partir de las 08:00'
            : 'Tienes abierta la jornada de ayer: ficha primero la salida',
        )
      }

      const pool = await getPool(db)
      const project = await pool
        .request()
        .input('id', sql.Int, input.projectId)
        .query('SELECT 1 FROM projects WHERE id = @id AND is_active = 1')
      if (project.recordset.length === 0) throw new TimesheetError(400, 'La analítica elegida no existe o está inactiva')

      try {
        await pool
          .request()
          .input('employeeId', sql.Int, employeeId)
          .input('workDate', sql.Date, current.workDate)
          .input('projectId', sql.Int, input.projectId)
          .input('shiftType', sql.NVarChar(10), input.shiftType)
          .input('perDiem', sql.Bit, input.perDiem)
          .input('comment', sql.NVarChar(1000), input.comment)
          .input('clockIn', sql.DateTime2(0), at)
          .input('timeZone', sql.NVarChar(64), timeZone)
          .query(`
            INSERT INTO time_entries (employee_id, work_date, project_id, shift_type, per_diem, comment, clock_in, time_zone)
            VALUES (@employeeId, @workDate, @projectId, @shiftType, @perDiem, @comment, @clockIn, @timeZone)`)
      } catch (error) {
        // Dos pulsaciones a la vez: la base de datos solo deja pasar una.
        const number = typeof error === 'object' && error !== null && 'number' in error ? error.number : undefined
        if (typeof number === 'number' && UNIQUE_VIOLATION.includes(number)) {
          throw new TimesheetError(409, 'Ya fichaste la entrada de hoy')
        }
        throw error
      }
      return today(employeeId, timeZone, at)
    },

    /** Fichar salida sobre la jornada abierta. La hora la pone el servidor. */
    async clockOut(employeeId: number, timeZone: string): Promise<TodayView> {
      const at = now()
      const current = await today(employeeId, timeZone, at)
      if (!current.entry) throw new TimesheetError(409, 'No puedes fichar la salida sin haber fichado la entrada')
      if (current.entry.clockOut) throw new TimesheetError(409, 'Ya fichaste la salida de esta jornada')

      const pool = await getPool(db)
      const result = await pool
        .request()
        .input('id', sql.Int, current.entry.id)
        .input('clockOut', sql.DateTime2(0), at)
        .query(`
          UPDATE time_entries
          SET clock_out = CASE WHEN @clockOut < clock_in THEN clock_in ELSE @clockOut END,
              updated_at = SYSUTCDATETIME()
          WHERE id = @id AND clock_out IS NULL`)
      if ((result.rowsAffected[0] ?? 0) === 0) throw new TimesheetError(409, 'Ya fichaste la salida de esta jornada')
      return today(employeeId, timeZone, at)
    },

    /** Añade, cambia o quita el comentario de la jornada activa mientras no esté aprobada. */
    async setComment(employeeId: number, timeZone: string, comment: string | null): Promise<TodayView> {
      const at = now()
      const current = await today(employeeId, timeZone, at)
      if (!current.entry) throw new TimesheetError(409, 'Aún no has fichado esta jornada')
      if (current.entry.status === 'approved') {
        throw new TimesheetError(409, 'La jornada ya está aprobada y no se puede modificar')
      }

      const pool = await getPool(db)
      await pool
        .request()
        .input('id', sql.Int, current.entry.id)
        .input('comment', sql.NVarChar(1000), comment)
        .query('UPDATE time_entries SET comment = @comment, updated_at = SYSUTCDATETIME() WHERE id = @id')
      return today(employeeId, timeZone, at)
    },
  }
}

export type TimesheetService = ReturnType<typeof createTimesheetService>
