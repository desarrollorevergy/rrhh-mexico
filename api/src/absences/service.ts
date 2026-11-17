import sql from 'mssql'
import { isValidDate } from '../admin/validation.js'
import { ABSENCE_STEPS_NO_SUPERVISOR, ABSENCE_TYPE } from '../approvals/chains.js'
import type { ApprovalService } from '../approvals/service.js'
import { ApprovalError, type ApprovalStatus, type ApprovalStep } from '../approvals/types.js'
import type { Actor } from '../auth/employee.js'
import type { DbConfig } from '../config/env.js'
import { getPool } from '../db/pool.js'
import { isValidTimeZone, localParts } from '../timesheet/shift.js'
import {
  checkVacationRequest,
  vacationBalance,
  workingDays,
  type BalanceInput,
  type DateKey,
  type VacationBalance,
  type VacationCheck,
} from './balance.js'

// Solicitudes de vacaciones y ausentismo del propio colaborador (módulo 08).
// El estado y el historial de aprobación viven en el motor de aprobaciones.

export type AbsenceType = 'vacation' | 'sick_leave'

/** Estado que ve el colaborador: en qué paso está o cómo terminó. */
export type AbsenceStatus = 'pending_supervisor' | 'pending_hr' | 'approved' | 'rejected' | 'cancelled'

export interface AbsenceInput {
  type: AbsenceType
  startDate: DateKey
  endDate: DateKey
  comment: string | null
}

export interface AbsenceView {
  id: number
  type: AbsenceType
  startDate: DateKey
  endDate: DateKey
  /** Días que cuenta: laborables en vacaciones, naturales en incapacidad. */
  days: number
  comment: string | null
  status: AbsenceStatus
  /** Motivo del rechazo, o de la cancelación hecha por RRHH. */
  reason: string | null
  canCancel: boolean
  createdAt: Date
}

export interface AbsenceOverview {
  today: DateKey
  /** null si RRHH aún no registró la fecha de ingreso. */
  hireDate: DateKey | null
  /** Saldo de vacaciones del año de servicio en curso. null sin fecha de ingreso. */
  balance: VacationBalance | null
  requests: AbsenceView[]
}

export interface AbsencePreview {
  days: number
  /** Solo en vacaciones: saldo de cada año de servicio que toca la solicitud. */
  years: { number: number; start: DateKey; end: DateKey; available: number; requested: number; shortage: number }[]
  /** null si se puede solicitar; si no, el motivo. */
  problem: string | null
}

export class AbsenceError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'AbsenceError'
    this.status = status
  }
}

export const MAX_COMMENT = 1000
/** Tope de una sola solicitud, para no generar rangos absurdos por un error al teclear. */
const MAX_RANGE_DAYS = 366
const DEFAULT_TIME_ZONE = 'America/Mexico_City'

const TYPES: readonly AbsenceType[] = ['vacation', 'sick_leave']

export function parseAbsence(body: unknown): AbsenceInput {
  const data = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
  const type = data.type
  const startDate = data.startDate
  const endDate = data.endDate
  if (typeof type !== 'string' || !TYPES.includes(type as AbsenceType)) {
    throw new AbsenceError(400, 'El tipo de ausencia no es válido')
  }
  if (typeof startDate !== 'string' || typeof endDate !== 'string' || !isValidDate(startDate) || !isValidDate(endDate)) {
    throw new AbsenceError(400, 'Las fechas no son válidas')
  }
  if (endDate < startDate) throw new AbsenceError(400, 'La fecha final no puede ser anterior a la inicial')
  if (calendarDays(startDate, endDate).length > MAX_RANGE_DAYS) {
    throw new AbsenceError(400, 'El periodo es demasiado largo')
  }
  let comment: string | null = null
  if (data.comment !== undefined && data.comment !== null) {
    if (typeof data.comment !== 'string' || data.comment.length > MAX_COMMENT) {
      throw new AbsenceError(400, 'El comentario no es válido')
    }
    comment = data.comment.trim() || null
  }
  return { type: type as AbsenceType, startDate, endDate, comment }
}

/** Zona horaria del dispositivo; si no llega o no es válida, la del centro de México. */
export function timeZoneOrDefault(value: unknown): string {
  return isValidTimeZone(value) ? value : DEFAULT_TIME_ZONE
}

function calendarDays(start: DateKey, end: DateKey): DateKey[] {
  const days: DateKey[] = []
  const cursor = new Date(`${start}T00:00:00Z`)
  const last = new Date(`${end}T00:00:00Z`)
  while (cursor <= last) {
    days.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return days
}

const PROBLEMS: Record<Exclude<VacationCheck, { ok: true }>['reason'], string> = {
  no_days: 'El periodo no tiene días laborables',
  before_hire: 'El periodo empieza antes de tu fecha de ingreso',
  overlap: 'Ya tienes vacaciones solicitadas en alguno de esos días',
  insufficient: 'Saldo insuficiente',
}

function vacationProblem(check: VacationCheck): string | null {
  if (check.ok) return null
  if (check.reason !== 'insufficient') return PROBLEMS[check.reason]
  const short = check.years.find((year) => year.shortage > 0)
  return short
    ? `Saldo insuficiente: pides ${short.requested} día(s) y te quedan ${Math.max(0, short.balance.available)} hasta el ${short.balance.end}`
    : PROBLEMS.insufficient
}

export function statusOf(row: { approval_status: ApprovalStatus | null; steps: string | null; current_step: number | null; cancelled_at: Date | null }): AbsenceStatus {
  if (row.cancelled_at) return 'cancelled'
  if (row.approval_status === 'approved' || row.approval_status === 'rejected' || row.approval_status === 'cancelled') {
    return row.approval_status
  }
  const steps = row.steps ? (JSON.parse(row.steps) as ApprovalStep[]) : []
  const approver = steps[row.current_step ?? 0]?.approvers[0]
  return approver?.kind === 'supervisor' ? 'pending_supervisor' : 'pending_hr'
}

type Queryable = sql.ConnectionPool | sql.Transaction

function request(target: Queryable): sql.Request {
  return target instanceof sql.Transaction ? new sql.Request(target) : target.request()
}

export interface AbsenceServiceOptions {
  db: DbConfig
  approvals: ApprovalService
  /** Reloj. Solo se cambia en las pruebas. */
  now?: () => Date
}

export function createAbsenceService(options: AbsenceServiceOptions) {
  const { db, approvals } = options
  const now = options.now ?? (() => new Date())

  const todayIn = (timeZone: string): DateKey => localParts(now(), timeZone).date

  /**
   * Datos del saldo de vacaciones de un empleado. Cuentan las solicitudes vivas: aprobadas
   * (días usados) y pendientes (días reservados). Una solicitud recién creada que aún no tiene
   * su aprobación enlazada también reserva.
   */
  async function loadBalanceInput(target: Queryable, employeeId: number, hireDate: DateKey): Promise<BalanceInput> {
    const days = await request(target)
      .input('employeeId', sql.Int, employeeId)
      .query<{ day: string; approved: number }>(`
        SELECT CONVERT(char(10), d.day, 23) AS day, CASE WHEN r.status = 'approved' THEN 1 ELSE 0 END AS approved
        FROM absence_days AS d
        JOIN absence_requests AS a ON a.id = d.request_id
        LEFT JOIN approval_requests AS r ON r.id = a.approval_request_id
        WHERE a.employee_id = @employeeId AND a.absence_type = 'vacation' AND a.cancelled_at IS NULL
          AND (r.id IS NULL OR r.status IN ('pending', 'approved'))`)
    const adjustments = await request(target)
      .input('employeeId', sql.Int, employeeId)
      .query<{ serviceYear: number; days: number }>(
        'SELECT service_year AS serviceYear, days FROM vacation_adjustments WHERE employee_id = @employeeId',
      )
    return {
      hireDate,
      usedDays: days.recordset.filter((item) => item.approved === 1).map((item) => item.day),
      reservedDays: days.recordset.filter((item) => item.approved === 0).map((item) => item.day),
      adjustments: adjustments.recordset,
    }
  }

  async function loadHolidays(target: Queryable, start: DateKey, end: DateKey): Promise<Set<DateKey>> {
    const result = await request(target)
      .input('start', sql.Date, start)
      .input('end', sql.Date, end)
      .query<{ day: string }>(
        'SELECT CONVERT(char(10), holiday_date, 23) AS day FROM holidays WHERE holiday_date BETWEEN @start AND @end',
      )
    return new Set(result.recordset.map((item) => item.day))
  }

  async function loadEmployee(
    target: Queryable,
    employeeId: number,
    lock: boolean,
  ): Promise<{ hireDate: DateKey | null; supervisorId: number | null }> {
    const result = await request(target)
      .input('id', sql.Int, employeeId)
      .query<{ hireDate: string | null; supervisorId: number | null }>(`
        SELECT CONVERT(char(10), hire_date, 23) AS hireDate, supervisor_id AS supervisorId
        FROM employees ${lock ? 'WITH (UPDLOCK, ROWLOCK)' : ''} WHERE id = @id`)
    const row = result.recordset[0]
    if (!row) throw new AbsenceError(404, 'Empleado no encontrado')
    return row
  }

  /**
   * Días que cubriría la solicitud y, si no se puede pedir, por qué. Es la misma comprobación
   * para la vista previa del formulario y para crear la solicitud.
   */
  async function evaluate(
    target: Queryable,
    employeeId: number,
    hireDate: DateKey | null,
    input: AbsenceInput,
    today: DateKey,
  ): Promise<{ days: DateKey[]; preview: AbsencePreview }> {
    if (input.type === 'sick_leave') {
      // La incapacidad cuenta días naturales y admite fechas pasadas. No toca el saldo.
      const days = calendarDays(input.startDate, input.endDate)
      const overlap = await request(target)
        .input('employeeId', sql.Int, employeeId)
        .input('start', sql.Date, input.startDate)
        .input('end', sql.Date, input.endDate)
        .query<{ n: number }>(`
          SELECT COUNT(*) AS n
          FROM absence_days AS d
          JOIN absence_requests AS a ON a.id = d.request_id
          LEFT JOIN approval_requests AS r ON r.id = a.approval_request_id
          WHERE a.employee_id = @employeeId AND a.absence_type = 'sick_leave' AND a.cancelled_at IS NULL
            AND (r.id IS NULL OR r.status IN ('pending', 'approved'))
            AND d.day BETWEEN @start AND @end`)
      const problem = (overlap.recordset[0]?.n ?? 0) > 0 ? 'Ya tienes una incapacidad registrada en alguno de esos días' : null
      return { days, preview: { days: days.length, years: [], problem } }
    }

    const days = workingDays(input.startDate, input.endDate, await loadHolidays(target, input.startDate, input.endDate))
    if (!hireDate) {
      return {
        days,
        preview: { days: days.length, years: [], problem: 'RRHH aún no ha registrado tu fecha de ingreso; sin ella no hay saldo de vacaciones' },
      }
    }
    if (input.startDate < today) {
      return { days, preview: { days: days.length, years: [], problem: 'Las vacaciones no se pueden pedir para fechas pasadas' } }
    }
    const check = checkVacationRequest(await loadBalanceInput(target, employeeId, hireDate), days)
    return {
      days,
      preview: {
        days: days.length,
        years: check.years.map((year) => ({
          number: year.balance.number,
          start: year.balance.start,
          end: year.balance.end,
          available: year.balance.available,
          requested: year.requested,
          shortage: year.shortage,
        })),
        problem: vacationProblem(check),
      },
    }
  }

  interface RequestRow {
    id: number
    absence_type: AbsenceType
    start_date: string
    end_date: string
    days: number
    comment: string | null
    cancelled_at: Date | null
    cancel_reason: string | null
    created_at: Date
    approval_status: ApprovalStatus | null
    steps: string | null
    current_step: number | null
    reject_reason: string | null
  }

  async function listRequests(employeeId: number): Promise<AbsenceView[]> {
    const pool = await getPool(db)
    const result = await pool
      .request()
      .input('employeeId', sql.Int, employeeId)
      .query<RequestRow>(`
        SELECT a.id, a.absence_type, CONVERT(char(10), a.start_date, 23) AS start_date,
               CONVERT(char(10), a.end_date, 23) AS end_date, a.comment, a.cancelled_at, a.cancel_reason, a.created_at,
               (SELECT COUNT(*) FROM absence_days AS d WHERE d.request_id = a.id) AS days,
               r.status AS approval_status, r.steps, r.current_step,
               (SELECT TOP 1 x.reason FROM approval_actions AS x
                WHERE x.request_id = r.id AND x.action = 'rejected' ORDER BY x.id DESC) AS reject_reason
        FROM absence_requests AS a
        JOIN approval_requests AS r ON r.id = a.approval_request_id
        WHERE a.employee_id = @employeeId
        ORDER BY a.created_at DESC, a.id DESC`)
    return result.recordset.map((row) => {
      const status = statusOf(row)
      return {
        id: row.id,
        type: row.absence_type,
        startDate: row.start_date,
        endDate: row.end_date,
        days: row.days,
        comment: row.comment,
        status,
        reason: row.cancelled_at ? row.cancel_reason : status === 'rejected' ? row.reject_reason : null,
        // El colaborador solo cancela lo que sigue pendiente; lo aprobado lo cancela RRHH.
        canCancel: status === 'pending_supervisor' || status === 'pending_hr',
        createdAt: row.created_at,
      }
    })
  }

  return {
    /** Saldo de vacaciones y solicitudes del propio colaborador. */
    async overview(employeeId: number, timeZone: string): Promise<AbsenceOverview> {
      const pool = await getPool(db)
      const today = todayIn(timeZone)
      const { hireDate } = await loadEmployee(pool, employeeId, false)
      const balance = hireDate ? vacationBalance(await loadBalanceInput(pool, employeeId, hireDate), today) : null
      return { today, hireDate, balance, requests: await listRequests(employeeId) }
    },

    /** Qué pasaría si se enviara esta solicitud: días que cuenta y si el saldo alcanza. */
    async preview(employeeId: number, input: AbsenceInput, timeZone: string): Promise<AbsencePreview> {
      const pool = await getPool(db)
      const { hireDate } = await loadEmployee(pool, employeeId, false)
      return (await evaluate(pool, employeeId, hireDate, input, todayIn(timeZone))).preview
    },

    /** Crea la solicitud y la envía a aprobar: al supervisor, o directa a RRHH si no tiene. */
    async create(employeeId: number, input: AbsenceInput, timeZone: string): Promise<AbsenceView> {
      const pool = await getPool(db)
      const today = todayIn(timeZone)

      // La ficha se bloquea durante la comprobación y el alta: dos solicitudes simultáneas
      // no pueden gastar el mismo saldo.
      const tx = new sql.Transaction(pool)
      await tx.begin()
      let absenceId: number
      let hasSupervisor: boolean
      try {
        const employee = await loadEmployee(tx, employeeId, true)
        const { days, preview } = await evaluate(tx, employeeId, employee.hireDate, input, today)
        if (preview.problem) throw new AbsenceError(400, preview.problem)

        const inserted = await new sql.Request(tx)
          .input('employeeId', sql.Int, employeeId)
          .input('type', sql.NVarChar(20), input.type)
          .input('start', sql.Date, input.startDate)
          .input('end', sql.Date, input.endDate)
          .input('comment', sql.NVarChar(1000), input.comment)
          .query<{ id: number }>(`
            INSERT INTO absence_requests (employee_id, absence_type, start_date, end_date, comment)
            OUTPUT INSERTED.id
            VALUES (@employeeId, @type, @start, @end, @comment)`)
        const newId = inserted.recordset[0]?.id
        if (newId === undefined) throw new Error('No se pudo crear la solicitud')

        // Los días viajan como JSON para insertarlos de una vez.
        await new sql.Request(tx)
          .input('requestId', sql.Int, newId)
          .input('days', sql.NVarChar(sql.MAX), JSON.stringify(days))
          .query('INSERT INTO absence_days (request_id, day) SELECT @requestId, CONVERT(date, value) FROM OPENJSON(@days)')

        absenceId = newId
        hasSupervisor = employee.supervisorId !== null
        await tx.commit()
      } catch (error) {
        await tx.rollback()
        throw error
      }

      try {
        const approvalId = await approvals.create({
          type: ABSENCE_TYPE,
          entityId: String(absenceId),
          requesterId: employeeId,
          ...(hasSupervisor ? {} : { steps: ABSENCE_STEPS_NO_SUPERVISOR }),
        })
        await pool
          .request()
          .input('id', sql.Int, absenceId)
          .input('approvalId', sql.Int, approvalId)
          .query('UPDATE absence_requests SET approval_request_id = @approvalId WHERE id = @id')
      } catch (error) {
        // Sin aprobación la solicitud no sirve: se retira para que no reserve saldo.
        await pool.request().input('id', sql.Int, absenceId).query(`
          DELETE FROM absence_days WHERE request_id = @id;
          DELETE FROM absence_requests WHERE id = @id AND approval_request_id IS NULL;`)
        throw error
      }

      const created = (await listRequests(employeeId)).find((item) => item.id === absenceId)
      if (!created) throw new Error('No se pudo leer la solicitud creada')
      return created
    },

    /** El colaborador cancela una solicitud suya que sigue pendiente. */
    async cancel(actor: Actor, absenceId: number): Promise<AbsenceView> {
      const pool = await getPool(db)
      const found = await pool
        .request()
        .input('id', sql.Int, absenceId)
        .input('employeeId', sql.Int, actor.employeeId)
        .query<{ approvalId: number | null }>(
          'SELECT approval_request_id AS approvalId FROM absence_requests WHERE id = @id AND employee_id = @employeeId',
        )
      const approvalId = found.recordset[0]?.approvalId
      // Una solicitud ajena se responde igual que una que no existe.
      if (approvalId === undefined || approvalId === null) throw new AbsenceError(404, 'Solicitud no encontrada')

      try {
        await approvals.cancel(approvalId, actor)
      } catch (error) {
        if (!(error instanceof ApprovalError)) throw error
        throw new AbsenceError(409, 'Solo se puede cancelar una solicitud pendiente')
      }
      const cancelled = (await listRequests(actor.employeeId)).find((item) => item.id === absenceId)
      if (!cancelled) throw new Error('No se pudo leer la solicitud cancelada')
      return cancelled
    },
  }
}

export type AbsenceService = ReturnType<typeof createAbsenceService>
