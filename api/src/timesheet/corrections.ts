import sql from 'mssql'
import type { DbConfig } from '../config/env.js'
import { getPool } from '../db/pool.js'
import { TimesheetError, type EntryStatus, type ShiftType } from './service.js'

// Corrección manual de una jornada, con su historial. La usa el supervisor sobre su equipo
// y el colaborador sobre sus días rechazados.

export interface CorrectionInput {
  projectId?: number
  shiftType?: ShiftType
  perDiem?: boolean
  clockIn?: Date
  /** null no se admite: una corrección no puede quitar la salida. */
  clockOut?: Date
}

export type ChangeSet = Record<string, { from: unknown; to: unknown }>

const MAX_SHIFT_MS = 24 * 3_600_000
/** La entrada corregida debe seguir cerca del día de la jornada. */
const MAX_DISTANCE_FROM_DAY_MS = 36 * 3_600_000

function parseInstant(value: unknown, label: string): Date | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const date = typeof value === 'string' ? new Date(value) : new Date(Number.NaN)
  if (Number.isNaN(date.getTime())) throw new TimesheetError(400, `La hora de ${label} no es válida`)
  // Las horas se guardan con precisión de segundos.
  date.setMilliseconds(0)
  return date
}

/** Valida lo que envía la pantalla. Los campos que no vienen se conservan. */
export function parseCorrection(body: unknown): CorrectionInput {
  const data = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
  const input: CorrectionInput = {}

  if (data.projectId !== undefined) {
    const projectId = Number(data.projectId)
    if (!Number.isInteger(projectId) || projectId <= 0) throw new TimesheetError(400, 'La analítica no es válida')
    input.projectId = projectId
  }
  if (data.shiftType !== undefined) {
    if (data.shiftType !== 'activa' && data.shiftType !== 'inactiva') {
      throw new TimesheetError(400, 'El tipo de jornada no es válido')
    }
    input.shiftType = data.shiftType
  }
  if (data.perDiem !== undefined) {
    if (typeof data.perDiem !== 'boolean') throw new TimesheetError(400, 'La dieta no es válida')
    input.perDiem = data.perDiem
  }
  const clockIn = parseInstant(data.clockIn, 'entrada')
  const clockOut = parseInstant(data.clockOut, 'salida')
  if (clockIn) input.clockIn = clockIn
  if (clockOut) input.clockOut = clockOut
  return input
}

interface CurrentEntry {
  id: number
  workDate: string
  projectId: number
  projectCode: string
  shiftType: ShiftType
  perDiem: boolean
  clockIn: Date
  clockOut: Date | null
  status: EntryStatus
}

export function createCorrections(db: DbConfig) {
  return {
    /**
     * Aplica la corrección y la anota en el historial. Devuelve los cambios hechos
     * (vacío si no cambió nada). No comprueba permisos: eso lo hace quien la llama.
     * Un día ya aprobado que se corrige vuelve a pendiente para que se apruebe de nuevo.
     */
    async apply(entryId: number, input: CorrectionInput, actorId: number, source: 'supervisor' | 'employee'): Promise<ChangeSet> {
      const pool = await getPool(db)
      const found = await pool
        .request()
        .input('id', sql.Int, entryId)
        .query<CurrentEntry>(`
          SELECT t.id, CONVERT(char(10), t.work_date, 23) AS workDate, t.project_id AS projectId,
                 p.code AS projectCode, t.shift_type AS shiftType, t.per_diem AS perDiem,
                 t.clock_in AS clockIn, t.clock_out AS clockOut, t.status
          FROM time_entries AS t JOIN projects AS p ON p.id = t.project_id
          WHERE t.id = @id`)
      const current = found.recordset[0]
      if (!current) throw new TimesheetError(404, 'Jornada no encontrada')

      const clockIn = input.clockIn ?? current.clockIn
      const clockOut = input.clockOut ?? current.clockOut
      if (clockOut) {
        if (clockOut.getTime() <= clockIn.getTime()) {
          throw new TimesheetError(400, 'La salida debe ser posterior a la entrada')
        }
        if (clockOut.getTime() - clockIn.getTime() > MAX_SHIFT_MS) {
          throw new TimesheetError(400, 'Una jornada no puede durar más de 24 horas')
        }
      }
      const dayStart = new Date(`${current.workDate}T12:00:00Z`).getTime()
      if (Math.abs(clockIn.getTime() - dayStart) > MAX_DISTANCE_FROM_DAY_MS) {
        throw new TimesheetError(400, 'La entrada no corresponde al día de la jornada')
      }

      let projectCode = current.projectCode
      if (input.projectId !== undefined && input.projectId !== current.projectId) {
        const project = await pool
          .request()
          .input('id', sql.Int, input.projectId)
          .query<{ code: string }>('SELECT code FROM projects WHERE id = @id AND is_active = 1')
        const row = project.recordset[0]
        if (!row) throw new TimesheetError(400, 'La analítica elegida no existe o está inactiva')
        projectCode = row.code
      }

      // Solo se anotan los campos que de verdad cambian.
      const changes: ChangeSet = {}
      if (projectCode !== current.projectCode) changes.project = { from: current.projectCode, to: projectCode }
      if (input.shiftType !== undefined && input.shiftType !== current.shiftType) {
        changes.shiftType = { from: current.shiftType, to: input.shiftType }
      }
      if (input.perDiem !== undefined && input.perDiem !== current.perDiem) {
        changes.perDiem = { from: current.perDiem, to: input.perDiem }
      }
      if (clockIn.getTime() !== current.clockIn.getTime()) {
        changes.clockIn = { from: current.clockIn.toISOString(), to: clockIn.toISOString() }
      }
      if ((clockOut?.getTime() ?? null) !== (current.clockOut?.getTime() ?? null)) {
        changes.clockOut = { from: current.clockOut?.toISOString() ?? null, to: clockOut?.toISOString() ?? null }
      }
      if (Object.keys(changes).length === 0) return changes

      const hoursChanged = 'clockIn' in changes || 'clockOut' in changes
      const transaction = new sql.Transaction(pool)
      await transaction.begin()
      try {
        await new sql.Request(transaction)
          .input('id', sql.Int, entryId)
          .input('projectId', sql.Int, input.projectId ?? current.projectId)
          .input('shiftType', sql.NVarChar(10), input.shiftType ?? current.shiftType)
          .input('perDiem', sql.Bit, input.perDiem ?? current.perDiem)
          .input('clockIn', sql.DateTime2(0), clockIn)
          .input('clockOut', sql.DateTime2(0), clockOut)
          .input('hoursChanged', sql.Bit, hoursChanged)
          .query(`
            UPDATE time_entries
            SET project_id = @projectId, shift_type = @shiftType, per_diem = @perDiem,
                clock_in = @clockIn, clock_out = @clockOut,
                hours_edited = CASE WHEN @hoursChanged = 1 THEN 1 ELSE hours_edited END,
                status = CASE WHEN status = 'approved' THEN 'pending' ELSE status END,
                updated_at = SYSUTCDATETIME()
            WHERE id = @id`)
        await new sql.Request(transaction)
          .input('entryId', sql.Int, entryId)
          .input('actorId', sql.Int, actorId)
          .input('source', sql.NVarChar(10), source)
          .input('changes', sql.NVarChar(sql.MAX), JSON.stringify(changes))
          .query('INSERT INTO time_entry_changes (entry_id, actor_id, source, changes) VALUES (@entryId, @actorId, @source, @changes)')
        await transaction.commit()
      } catch (error) {
        await transaction.rollback()
        throw error
      }
      return changes
    },
  }
}

export type Corrections = ReturnType<typeof createCorrections>
