import sql from 'mssql'
import type { ApprovalService } from '../approvals/service.js'
import { slotsFor } from '../approvals/stateMachine.js'
import { ApprovalError, type ApprovalStatus, type ApprovalStep } from '../approvals/types.js'
import type { Actor } from '../auth/employee.js'
import { isAdmin } from '../auth/roles.js'
import type { DbConfig } from '../config/env.js'
import { getPool } from '../db/pool.js'
import { localParts } from '../timesheet/shift.js'
import { vacationBalance, type BalanceInput, type DateKey, type VacationBalance } from './balance.js'
import { AbsenceError, MAX_COMMENT, statusOf, type AbsenceStatus, type AbsenceType } from './service.js'

// Revisión de ausencias (módulo 08): el supervisor decide las de su equipo directo; RRHH da la
// aprobación final, ve todas, ajusta saldos y cancela las ya aprobadas. El administrador hace
// lo mismo que RRHH y que el supervisor de cualquiera, salvo decidir sus propias solicitudes.

export interface ReviewItem {
  id: number
  employeeId: number
  employeeName: string
  departmentName: string | null
  type: AbsenceType
  startDate: DateKey
  endDate: DateKey
  days: number
  comment: string | null
  status: AbsenceStatus
  /** Motivo del rechazo, o de la cancelación hecha por RRHH. */
  reason: string | null
  createdAt: Date
  /** A quien consulta le toca aprobar o rechazar ahora. */
  canDecide: boolean
  /** RRHH puede cancelar una solicitud ya aprobada (devuelve el saldo). */
  canCancelApproved: boolean
}

export interface AdjustmentView {
  days: number
  reason: string
  byName: string
  at: Date
}

export interface EmployeeBalance {
  employeeId: number
  employeeNumber: string
  employeeName: string
  departmentName: string | null
  /** null si RRHH aún no la registró: sin ella no hay saldo. */
  hireDate: DateKey | null
  /** Saldo del año de servicio en curso. */
  balance: VacationBalance | null
  /** Ajustes manuales de ese año de servicio, del más reciente al más antiguo. */
  adjustments: AdjustmentView[]
}

export interface AdjustmentInput {
  days: number
  reason: string
}

/** Tope de un ajuste, para evitar errores al teclear. */
const MAX_ADJUSTMENT_DAYS = 60

export function parseReason(body: unknown, required: string): string {
  const data = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
  const reason = typeof data.reason === 'string' ? data.reason.trim() : ''
  if (!reason) throw new AbsenceError(400, required)
  if (reason.length > MAX_COMMENT) throw new AbsenceError(400, 'El motivo es demasiado largo')
  return reason
}

export function parseAdjustment(body: unknown): AdjustmentInput {
  const data = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
  const days = data.days
  if (typeof days !== 'number' || !Number.isInteger(days) || days === 0 || Math.abs(days) > MAX_ADJUSTMENT_DAYS) {
    throw new AbsenceError(400, `Los días del ajuste deben ser un número entero distinto de cero (máximo ${MAX_ADJUSTMENT_DAYS})`)
  }
  return { days, reason: parseReason(body, 'El motivo del ajuste es obligatorio') }
}

const isHr = (actor: Actor): boolean => isAdmin(actor.roles) || actor.roles.includes('rrhh')

const APPROVAL_ERRORS: Partial<Record<ApprovalError['code'], [number, string]>> = {
  not_allowed: [403, 'No te corresponde decidir esta solicitud'],
  invalid_slot: [403, 'No te corresponde decidir esta solicitud'],
  not_pending: [409, 'La solicitud ya no está pendiente'],
  reason_required: [400, 'El motivo del rechazo es obligatorio'],
}

interface ReviewRow {
  id: number
  approval_id: number
  employeeId: number
  employeeName: string
  supervisorId: number | null
  departmentName: string | null
  absence_type: AbsenceType
  start_date: string
  end_date: string
  days: number
  comment: string | null
  cancelled_at: Date | null
  cancel_reason: string | null
  created_at: Date
  approval_status: ApprovalStatus
  steps: string
  current_step: number
  round: number
  reject_reason: string | null
}

export interface ReviewServiceOptions {
  db: DbConfig
  approvals: ApprovalService
  /** Reloj. Solo se cambia en las pruebas. */
  now?: () => Date
}

export function createAbsenceReviewService(options: ReviewServiceOptions) {
  const { db, approvals } = options
  const now = options.now ?? (() => new Date())

  /** Solicitudes al alcance de quien consulta: RRHH todas; el supervisor, las de su equipo directo. */
  async function loadRows(actor: Actor, absenceId?: number): Promise<ReviewRow[]> {
    const pool = await getPool(db)
    const request = pool.request().input('actorId', sql.Int, actor.employeeId)
    const where = [isHr(actor) ? '1 = 1' : 'e.supervisor_id = @actorId']
    if (absenceId !== undefined) {
      request.input('id', sql.Int, absenceId)
      where.push('a.id = @id')
    }
    const result = await request.query<ReviewRow>(`
      SELECT a.id, r.id AS approval_id, e.id AS employeeId, e.full_name AS employeeName,
             e.supervisor_id AS supervisorId, d.name AS departmentName, a.absence_type,
             CONVERT(char(10), a.start_date, 23) AS start_date, CONVERT(char(10), a.end_date, 23) AS end_date,
             a.comment, a.cancelled_at, a.cancel_reason, a.created_at,
             (SELECT COUNT(*) FROM absence_days AS x WHERE x.request_id = a.id) AS days,
             r.status AS approval_status, r.steps, r.current_step, r.round,
             (SELECT TOP 1 x.reason FROM approval_actions AS x
              WHERE x.request_id = r.id AND x.action = 'rejected' ORDER BY x.id DESC) AS reject_reason
      FROM absence_requests AS a
      JOIN approval_requests AS r ON r.id = a.approval_request_id
      JOIN employees AS e ON e.id = a.employee_id
      LEFT JOIN departments AS d ON d.id = e.department_id
      WHERE ${where.join(' AND ')}
      ORDER BY a.created_at DESC, a.id DESC`)
    return result.recordset
  }

  function toItem(row: ReviewRow, actor: Actor): ReviewItem {
    const status = statusOf(row)
    // Mismas reglas que el motor: a quién le toca el paso actual. Cada paso tiene un solo aprobador.
    const canDecide =
      (status === 'pending_supervisor' || status === 'pending_hr') &&
      slotsFor(
        {
          status: row.approval_status,
          currentStep: row.current_step,
          round: row.round,
          steps: JSON.parse(row.steps) as ApprovalStep[],
          approvedSlots: [],
        },
        {
          isRequester: row.employeeId === actor.employeeId,
          isRequesterSupervisor: row.supervisorId === actor.employeeId,
          roles: actor.roles,
        },
      ).length > 0
    return {
      id: row.id,
      employeeId: row.employeeId,
      employeeName: row.employeeName,
      departmentName: row.departmentName,
      type: row.absence_type,
      startDate: row.start_date,
      endDate: row.end_date,
      days: row.days,
      comment: row.comment,
      status,
      reason: row.cancelled_at ? row.cancel_reason : status === 'rejected' ? row.reject_reason : null,
      createdAt: row.created_at,
      canDecide,
      canCancelApproved: status === 'approved' && isHr(actor),
    }
  }

  async function getItem(actor: Actor, absenceId: number): Promise<{ row: ReviewRow; item: ReviewItem }> {
    const row = (await loadRows(actor, absenceId))[0]
    // Una solicitud fuera de su alcance se responde igual que una que no existe.
    if (!row) throw new AbsenceError(404, 'Solicitud no encontrada')
    return { row, item: toItem(row, actor) }
  }

  function requireHr(actor: Actor): void {
    if (!isHr(actor)) throw new AbsenceError(403, 'Solo Recursos Humanos puede hacer esto')
  }

  return {
    /** Solicitudes de su equipo (supervisor) o de toda la empresa (RRHH), de la más reciente a la más antigua. */
    async list(actor: Actor): Promise<ReviewItem[]> {
      return (await loadRows(actor)).map((row) => toItem(row, actor))
    },

    /** Aprueba o rechaza (con motivo) la solicitud en el paso que le toca a quien actúa. */
    async decide(actor: Actor, absenceId: number, decision: 'approve' | 'reject', reason?: string): Promise<ReviewItem> {
      const { row } = await getItem(actor, absenceId)
      if (row.cancelled_at) throw new AbsenceError(409, 'La solicitud ya no está pendiente')
      try {
        await approvals.decide(row.approval_id, actor, decision, reason)
      } catch (error) {
        if (!(error instanceof ApprovalError)) throw error
        const [status, message] = APPROVAL_ERRORS[error.code] ?? [400, error.message]
        throw new AbsenceError(status, message)
      }
      return (await getItem(actor, absenceId)).item
    },

    /** RRHH cancela una solicitud ya aprobada: deja de contar y, si eran vacaciones, devuelve el saldo. */
    async cancelApproved(actor: Actor, absenceId: number, reason: string): Promise<ReviewItem> {
      requireHr(actor)
      await getItem(actor, absenceId)
      const pool = await getPool(db)
      const result = await pool
        .request()
        .input('id', sql.Int, absenceId)
        .input('actorId', sql.Int, actor.employeeId)
        .input('reason', sql.NVarChar(1000), reason)
        .query(`
          UPDATE a
          SET cancelled_at = SYSUTCDATETIME(), cancelled_by = @actorId, cancel_reason = @reason
          FROM absence_requests AS a
          JOIN approval_requests AS r ON r.id = a.approval_request_id
          WHERE a.id = @id AND a.cancelled_at IS NULL AND r.status = 'approved'`)
      if ((result.rowsAffected[0] ?? 0) === 0) throw new AbsenceError(409, 'Solo se puede cancelar una solicitud aprobada')
      return (await getItem(actor, absenceId)).item
    },

    /** Saldo de vacaciones de todos los empleados activos, para RRHH. */
    async balances(actor: Actor, timeZone: string): Promise<EmployeeBalance[]> {
      requireHr(actor)
      const pool = await getPool(db)
      const today = localParts(now(), timeZone).date

      const employees = await pool.request().query<{
        employeeId: number
        employeeNumber: string
        employeeName: string
        departmentName: string | null
        hireDate: string | null
      }>(`
        SELECT e.id AS employeeId, e.employee_number AS employeeNumber, e.full_name AS employeeName,
               d.name AS departmentName, CONVERT(char(10), e.hire_date, 23) AS hireDate
        FROM employees AS e
        LEFT JOIN departments AS d ON d.id = e.department_id
        WHERE e.is_active = 1
        ORDER BY e.full_name`)
      const days = await pool.request().query<{ employeeId: number; day: string; approved: number }>(`
        SELECT a.employee_id AS employeeId, CONVERT(char(10), x.day, 23) AS day,
               CASE WHEN r.status = 'approved' THEN 1 ELSE 0 END AS approved
        FROM absence_days AS x
        JOIN absence_requests AS a ON a.id = x.request_id
        LEFT JOIN approval_requests AS r ON r.id = a.approval_request_id
        WHERE a.absence_type = 'vacation' AND a.cancelled_at IS NULL
          AND (r.id IS NULL OR r.status IN ('pending', 'approved'))`)
      const adjustments = await pool.request().query<{
        employeeId: number
        serviceYear: number
        days: number
        reason: string
        byName: string
        at: Date
      }>(`
        SELECT v.employee_id AS employeeId, v.service_year AS serviceYear, v.days, v.reason,
               c.full_name AS byName, v.created_at AS at
        FROM vacation_adjustments AS v
        JOIN employees AS c ON c.id = v.created_by
        ORDER BY v.id DESC`)

      return employees.recordset.map((employee) => {
        const ownDays = days.recordset.filter((item) => item.employeeId === employee.employeeId)
        const ownAdjustments = adjustments.recordset.filter((item) => item.employeeId === employee.employeeId)
        const input: BalanceInput | null = employee.hireDate
          ? {
              hireDate: employee.hireDate,
              usedDays: ownDays.filter((item) => item.approved === 1).map((item) => item.day),
              reservedDays: ownDays.filter((item) => item.approved === 0).map((item) => item.day),
              adjustments: ownAdjustments,
            }
          : null
        const balance = input ? vacationBalance(input, today) : null
        return {
          ...employee,
          balance,
          adjustments: balance
            ? ownAdjustments
                .filter((item) => item.serviceYear === balance.number)
                .map(({ days: adjusted, reason, byName, at }) => ({ days: adjusted, reason, byName, at }))
            : [],
        }
      })
    },

    /** RRHH suma o quita días al saldo del año de servicio en curso de un empleado, con motivo. */
    async adjust(actor: Actor, employeeId: number, input: AdjustmentInput, timeZone: string): Promise<void> {
      requireHr(actor)
      const pool = await getPool(db)
      const found = await pool
        .request()
        .input('id', sql.Int, employeeId)
        .query<{ hireDate: string | null }>('SELECT CONVERT(char(10), hire_date, 23) AS hireDate FROM employees WHERE id = @id')
      const employee = found.recordset[0]
      if (!employee) throw new AbsenceError(404, 'Empleado no encontrado')
      const today = localParts(now(), timeZone).date
      const year = employee.hireDate
        ? vacationBalance({ hireDate: employee.hireDate, usedDays: [], reservedDays: [], adjustments: [] }, today)
        : null
      if (!year) throw new AbsenceError(400, 'El empleado no tiene fecha de ingreso (o es posterior a hoy): no hay saldo que ajustar')

      await pool
        .request()
        .input('employeeId', sql.Int, employeeId)
        .input('serviceYear', sql.Int, year.number)
        .input('days', sql.Int, input.days)
        .input('reason', sql.NVarChar(1000), input.reason)
        .input('actorId', sql.Int, actor.employeeId)
        .query(`
          INSERT INTO vacation_adjustments (employee_id, service_year, days, reason, created_by)
          VALUES (@employeeId, @serviceYear, @days, @reason, @actorId)`)
    },
  }
}

export type AbsenceReviewService = ReturnType<typeof createAbsenceReviewService>
