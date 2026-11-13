import sql from 'mssql'
import type { ApprovalService } from '../approvals/service.js'
import { ApprovalError } from '../approvals/types.js'
import type { Actor } from '../auth/employee.js'
import { isAdmin } from '../auth/roles.js'
import type { DbConfig } from '../config/env.js'
import { getPool } from '../db/pool.js'
import { createCorrections, type ChangeSet, type CorrectionInput } from './corrections.js'
import { addDays, weekStartOf, type DateKey } from './hours.js'
import {
  buildWeek,
  ENTRY_COLUMNS,
  TimesheetError,
  weekStatusOf,
  type EntryStatus,
  type TimeEntry,
  type WeekView,
} from './service.js'

// Supervisión del Parte de Horas: el supervisor ve y valida las semanas de su equipo,
// es decir, de los empleados que lo tienen como supervisor directo. El administrador ve y valida
// las de todos los empleados.

/** Tipo de solicitud en el motor de aprobaciones. Una por colaborador y semana. */
const REQUEST_TYPE = 'timesheet_week'

export interface TeamMember {
  employeeId: number
  employeeName: string
  departmentName: string | null
}

/** Una fila del consolidado: la semana de un colaborador. */
export interface TeamWeekSummary extends TeamMember {
  weekStart: DateKey
  status: EntryStatus
  /** El colaborador ya envió la corrección de los días rechazados y espera nueva revisión. */
  corrected: boolean
  /** Códigos de las analíticas de la semana. */
  projects: string[]
  totals: WeekView['totals']
  /** Días con el festivo aplicado. */
  holidayDays: number
}

export interface TeamWeekDetail extends TeamMember, WeekView {
  corrected: boolean
  correctionSentAt: Date | null
  correctionNote: string | null
}

/** Un movimiento del historial de una semana. */
export interface HistoryItem {
  kind: 'approved' | 'rejected' | 'resubmitted' | 'corrected_supervisor' | 'corrected_employee'
  actorName: string
  at: Date
  /** Motivo del rechazo o nota del reenvío. */
  reason: string | null
  /** Día corregido (solo en correcciones). */
  workDate: DateKey | null
  /** Campos cambiados, con el valor anterior y el nuevo (solo en correcciones). */
  changes: ChangeSet | null
}

type TeamEntryRow = TimeEntry & TeamMember

const APPROVAL_STATUS: Partial<Record<ApprovalError['code'], number>> = { not_allowed: 403, reason_required: 400 }

export function parseWeekAction(body: unknown): { employeeId: number; weekStart: DateKey } {
  const data = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
  const employeeId = Number(data.employeeId)
  const weekStart = typeof data.weekStart === 'string' ? data.weekStart : ''
  if (!Number.isInteger(employeeId) || employeeId <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    throw new TimesheetError(400, 'Semana no válida')
  }
  return { employeeId, weekStart: weekStartOf(weekStart) }
}

export function parseReject(body: unknown): { rejectedEntryIds: number[]; reason: string } {
  const data = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
  const reason = typeof data.reason === 'string' ? data.reason.trim() : ''
  const ids = Array.isArray(data.rejectedEntryIds) ? data.rejectedEntryIds.map(Number) : []
  if (!reason) throw new TimesheetError(400, 'El motivo del rechazo es obligatorio')
  if (reason.length > 1000) throw new TimesheetError(400, 'El motivo es demasiado largo')
  if (ids.length === 0 || ids.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new TimesheetError(400, 'Marca al menos un día de la semana como rechazado')
  }
  return { rejectedEntryIds: [...new Set(ids)], reason }
}

/**
 * A quién alcanza quien supervisa (condición SQL sobre `e`, con el parámetro @actorId):
 * el supervisor, a su equipo directo; el administrador, a todos menos a sí mismo, porque
 * su propia semana la valida su supervisor.
 */
function scopeSql(actor: Actor): string {
  return isAdmin(actor.roles) ? 'e.id <> @actorId' : 'e.supervisor_id = @actorId'
}

export function createTeamService(options: { db: DbConfig; approvals: ApprovalService }) {
  const { db, approvals } = options
  const corrections = createCorrections(db)

  /** Jornadas de las personas a su alcance, opcionalmente de una semana o de una persona. */
  async function teamEntries(
    actor: Actor,
    filter: { weekStart?: DateKey; employeeId?: number } = {},
  ): Promise<TeamEntryRow[]> {
    const pool = await getPool(db)
    const request = pool.request().input('actorId', sql.Int, actor.employeeId)
    const where = [scopeSql(actor)]
    if (filter.weekStart) {
      request.input('from', sql.Date, filter.weekStart).input('to', sql.Date, addDays(filter.weekStart, 6))
      where.push('t.work_date BETWEEN @from AND @to')
    }
    if (filter.employeeId !== undefined) {
      request.input('employeeId', sql.Int, filter.employeeId)
      where.push('e.id = @employeeId')
    }
    const result = await request.query<TeamEntryRow>(`
      SELECT ${ENTRY_COLUMNS},
             e.id AS employeeId, e.full_name AS employeeName, d.name AS departmentName
      FROM time_entries AS t
      JOIN projects AS p ON p.id = t.project_id
      JOIN employees AS e ON e.id = t.employee_id
      LEFT JOIN departments AS d ON d.id = e.department_id
      WHERE ${where.join(' AND ')}
      ORDER BY t.work_date`)
    return result.recordset
  }

  async function holidaySet(): Promise<Set<DateKey>> {
    const pool = await getPool(db)
    const result = await pool
      .request()
      .query<{ date: DateKey }>('SELECT CONVERT(char(10), holiday_date, 23) AS date FROM holidays')
    return new Set(result.recordset.map((row) => row.date))
  }

  /** El colaborador ya corrigió y reenvió: semana pendiente con algún día marcado como enviado. */
  function correctionOf(entries: readonly TimeEntry[], status: EntryStatus | null) {
    const sent = entries
      .filter((entry) => entry.correctionSentAt)
      .sort((a, b) => b.correctionSentAt!.getTime() - a.correctionSentAt!.getTime())
    return {
      corrected: status === 'pending' && sent.length > 0,
      correctionSentAt: sent[0]?.correctionSentAt ?? null,
      correctionNote: sent.find((entry) => entry.correctionNote)?.correctionNote ?? null,
    }
  }

  /** Semana de alguien a su alcance, lista para validar. 404 si no lo está. */
  async function loadWeek(actor: Actor, employeeId: number, weekStart: DateKey): Promise<TeamEntryRow[]> {
    const pool = await getPool(db)
    const member = await pool
      .request()
      .input('employeeId', sql.Int, employeeId)
      .input('actorId', sql.Int, actor.employeeId)
      .query(`SELECT 1 FROM employees AS e WHERE e.id = @employeeId AND ${scopeSql(actor)}`)
    // Quien no es de su equipo se trata igual que alguien que no existe.
    if (member.recordset.length === 0) throw new TimesheetError(404, 'Colaborador no encontrado en tu equipo')
    return teamEntries(actor, { employeeId, weekStart })
  }

  /**
   * Registra la decisión en el motor de aprobaciones. Es quien comprueba que quien decide
   * es el supervisor del colaborador y quien guarda el historial (quién, cuándo, motivo).
   * Cada ronda de revisión es una solicitud: se reutiliza la pendiente o se abre una nueva.
   */
  async function recordDecision(
    actor: Actor,
    employeeId: number,
    weekStart: DateKey,
    decision: 'approve' | 'reject',
    reason?: string,
  ): Promise<void> {
    const entityId = `${employeeId}:${weekStart}`
    try {
      const latest = await approvals.findLatest(REQUEST_TYPE, entityId)
      const requestId =
        latest?.status === 'pending'
          ? latest.id
          : await approvals.create({ type: REQUEST_TYPE, entityId, requesterId: employeeId })
      await approvals.decide(requestId, actor, decision, reason)
    } catch (error) {
      if (!(error instanceof ApprovalError)) throw error
      throw new TimesheetError(APPROVAL_STATUS[error.code] ?? 409, error.message)
    }
  }

  async function detail(actor: Actor, employeeId: number, date: DateKey): Promise<TeamWeekDetail> {
    const weekStart = weekStartOf(date)
    const entries = await loadWeek(actor, employeeId, weekStart)
    const pool = await getPool(db)
    const member = await pool
      .request()
      .input('employeeId', sql.Int, employeeId)
      .query<TeamMember>(`
        SELECT e.id AS employeeId, e.full_name AS employeeName, d.name AS departmentName
        FROM employees AS e LEFT JOIN departments AS d ON d.id = e.department_id
        WHERE e.id = @employeeId`)

    const status = weekStatusOf(entries)
    return {
      ...member.recordset[0]!,
      weekStart,
      weekEnd: addDays(weekStart, 6),
      status,
      ...buildWeek(entries, await holidaySet()),
      ...correctionOf(entries, status),
    }
  }

  return {
    detail,

    /**
     * El supervisor corrige una jornada de su equipo (horas, analítica, tipo o dieta).
     * Queda en el historial. Devuelve la semana ya actualizada.
     */
    async correct(actor: Actor, entryId: number, input: CorrectionInput): Promise<TeamWeekDetail> {
      const pool = await getPool(db)
      const found = await pool
        .request()
        .input('id', sql.Int, entryId)
        .input('actorId', sql.Int, actor.employeeId)
        .query<{ employeeId: number; workDate: DateKey }>(`
          SELECT t.employee_id AS employeeId, CONVERT(char(10), t.work_date, 23) AS workDate
          FROM time_entries AS t JOIN employees AS e ON e.id = t.employee_id
          WHERE t.id = @id AND ${scopeSql(actor)}`)
      const entry = found.recordset[0]
      // La jornada de alguien que no es de su equipo se trata como si no existiera.
      if (!entry) throw new TimesheetError(404, 'Jornada no encontrada')

      await corrections.apply(entryId, input, actor.employeeId, 'supervisor')
      return detail(actor, entry.employeeId, entry.workDate)
    },

    /**
     * Historial de la semana, del más reciente al más antiguo: decisiones de validación
     * (del motor de aprobaciones) y correcciones de jornadas.
     */
    async history(actor: Actor, employeeId: number, date: DateKey): Promise<HistoryItem[]> {
      const weekStart = weekStartOf(date)
      await loadWeek(actor, employeeId, weekStart) // comprueba que está a su alcance
      const pool = await getPool(db)

      const [decisions, changes] = await Promise.all([
        pool
          .request()
          .input('type', sql.NVarChar(50), REQUEST_TYPE)
          .input('entityId', sql.NVarChar(50), `${employeeId}:${weekStart}`)
          .query<{ action: string; actorName: string; reason: string | null; at: Date }>(`
            SELECT a.action, e.full_name AS actorName, a.reason, a.created_at AS at
            FROM approval_actions AS a
            JOIN approval_requests AS r ON r.id = a.request_id
            JOIN employees AS e ON e.id = a.actor_id
            WHERE r.request_type = @type AND r.entity_id = @entityId
              AND a.action IN ('approved', 'rejected', 'resubmitted')`),
        pool
          .request()
          .input('employeeId', sql.Int, employeeId)
          .input('from', sql.Date, weekStart)
          .input('to', sql.Date, addDays(weekStart, 6))
          .query<{ source: string; actorName: string; workDate: DateKey; changes: string; at: Date }>(`
            SELECT c.source, e.full_name AS actorName, CONVERT(char(10), t.work_date, 23) AS workDate,
                   c.changes, c.created_at AS at
            FROM time_entry_changes AS c
            JOIN time_entries AS t ON t.id = c.entry_id
            JOIN employees AS e ON e.id = c.actor_id
            WHERE t.employee_id = @employeeId AND t.work_date BETWEEN @from AND @to`),
      ])

      const items: HistoryItem[] = [
        ...decisions.recordset.map((row) => ({
          kind: row.action as HistoryItem['kind'],
          actorName: row.actorName,
          at: row.at,
          reason: row.reason,
          workDate: null,
          changes: null,
        })),
        ...changes.recordset.map((row) => ({
          kind: (row.source === 'supervisor' ? 'corrected_supervisor' : 'corrected_employee') as HistoryItem['kind'],
          actorName: row.actorName,
          at: row.at,
          reason: null,
          workDate: row.workDate,
          changes: JSON.parse(row.changes) as ChangeSet,
        })),
      ]
      return items.sort((a, b) => b.at.getTime() - a.at.getTime())
    },

    /** Consolidado semanal del equipo: una fila por colaborador y semana. */
    async summary(actor: Actor): Promise<TeamWeekSummary[]> {
      const [entries, holidays] = await Promise.all([teamEntries(actor), holidaySet()])

      const groups = new Map<string, TeamEntryRow[]>()
      for (const entry of entries) {
        const key = `${entry.employeeId}:${weekStartOf(entry.workDate)}`
        groups.set(key, [...(groups.get(key) ?? []), entry])
      }

      return [...groups.values()]
        .map((group) => {
          const first = group[0]!
          const status = weekStatusOf(group) ?? 'pending'
          const { totals, days } = buildWeek(group, holidays)
          return {
            employeeId: first.employeeId,
            employeeName: first.employeeName,
            departmentName: first.departmentName,
            weekStart: weekStartOf(first.workDate),
            status,
            corrected: correctionOf(group, status).corrected,
            projects: [...new Set(group.map((entry) => entry.projectCode))],
            totals,
            holidayDays: days.filter((day) => day.kind === 'holiday').length,
          }
        })
        .sort((a, b) => b.weekStart.localeCompare(a.weekStart) || a.employeeName.localeCompare(b.employeeName))
    },

    /** Aprueba todas las jornadas de la semana. */
    async approve(actor: Actor, employeeId: number, weekStart: DateKey): Promise<TeamWeekDetail> {
      const entries = await loadWeek(actor, employeeId, weekStart)
      if (entries.length === 0) throw new TimesheetError(409, 'La semana no tiene jornadas')
      if (entries.every((entry) => entry.status === 'approved')) throw new TimesheetError(409, 'La semana ya está aprobada')
      if (entries.some((entry) => !entry.clockOut)) {
        throw new TimesheetError(409, 'Hay jornadas sin salida: recházalas para que se corrijan antes de aprobar')
      }

      await recordDecision(actor, employeeId, weekStart, 'approve')

      const pool = await getPool(db)
      await pool
        .request()
        .input('employeeId', sql.Int, employeeId)
        .input('from', sql.Date, weekStart)
        .input('to', sql.Date, addDays(weekStart, 6))
        .input('reviewer', sql.Int, actor.employeeId)
        .query(`
          UPDATE time_entries
          SET status = 'approved', reject_reason = NULL, reviewed_by = @reviewer, reviewed_at = SYSUTCDATETIME(),
              correction_sent_at = NULL, correction_note = NULL, updated_at = SYSUTCDATETIME()
          WHERE employee_id = @employeeId AND work_date BETWEEN @from AND @to`)
      return detail(actor, employeeId, weekStart)
    },

    /**
     * Rechaza la semana marcando los días con el problema: esos quedan rechazados con el
     * motivo (son los únicos que el colaborador podrá corregir) y el resto vuelve a pendiente.
     */
    async reject(
      actor: Actor,
      employeeId: number,
      weekStart: DateKey,
      input: { rejectedEntryIds: number[]; reason: string },
    ): Promise<TeamWeekDetail> {
      const entries = await loadWeek(actor, employeeId, weekStart)
      const weekIds = new Set(entries.map((entry) => entry.id))
      if (!input.rejectedEntryIds.every((id) => weekIds.has(id))) {
        throw new TimesheetError(400, 'Algún día marcado no pertenece a esta semana')
      }

      await recordDecision(actor, employeeId, weekStart, 'reject', input.reason)

      const pool = await getPool(db)
      const request = pool
        .request()
        .input('employeeId', sql.Int, employeeId)
        .input('from', sql.Date, weekStart)
        .input('to', sql.Date, addDays(weekStart, 6))
        .input('reviewer', sql.Int, actor.employeeId)
        .input('reason', sql.NVarChar(1000), input.reason)
      input.rejectedEntryIds.forEach((id, index) => request.input(`r${index}`, sql.Int, id))
      const rejected = input.rejectedEntryIds.map((_, index) => `@r${index}`).join(', ')
      await request.query(`
        UPDATE time_entries
        SET status = CASE WHEN id IN (${rejected}) THEN 'rejected' ELSE 'pending' END,
            reject_reason = CASE WHEN id IN (${rejected}) THEN @reason END,
            reviewed_by = @reviewer, reviewed_at = SYSUTCDATETIME(),
            correction_sent_at = NULL, correction_note = NULL, updated_at = SYSUTCDATETIME()
        WHERE employee_id = @employeeId AND work_date BETWEEN @from AND @to`)
      return detail(actor, employeeId, weekStart)
    },
  }
}

export type TeamService = ReturnType<typeof createTeamService>
