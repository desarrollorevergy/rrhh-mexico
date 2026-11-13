import sql from 'mssql'
import type { DbConfig } from '../config/env.js'
import { getPool } from '../db/pool.js'
import { addDays, minutesToHours, weekStartOf, type DateKey } from './hours.js'
import { buildWeek, ENTRY_COLUMNS, TimesheetError, weekStatusOf, type TimeEntry, type WeekView } from './service.js'

// Panel de RRHH del Parte de Horas: solo semanas APROBADAS, listas para nómina.
// Una semana está aprobada cuando lo están todas sus jornadas. Es de solo lectura:
// aprobar, rechazar y corregir es cosa del supervisor.

interface PayrollEmployee {
  employeeId: number
  employeeNumber: string
  employeeName: string
  email: string
  departmentName: string | null
}

/** Una fila del reporte de nómina: la semana aprobada de un colaborador. */
export interface PayrollWeek extends PayrollEmployee {
  weekStart: DateKey
  weekEnd: DateKey
  /** Códigos de las analíticas de la semana. */
  projects: string[]
  totals: WeekView['totals']
  /** Días con jornada de tipo Inactiva (sus horas cuentan igual; nómina decide). */
  inactiveDays: number
  /** Cuándo se aprobó la última jornada de la semana. */
  approvedAt: Date | null
}

export interface PayrollWeekDetail extends PayrollEmployee, WeekView {
  // Mismos campos que el detalle de supervisión, para compartir la pantalla.
  corrected: false
  correctionSentAt: null
  correctionNote: null
}

export interface WeekKey {
  employeeId: number
  weekStart: DateKey
}

type PayrollEntryRow = TimeEntry & PayrollEmployee & { reviewedAt: Date | null }

/** Límite de semanas por exportación, para acotar la petición. */
const MAX_EXPORT_WEEKS = 5000

export function parseWeekKeys(body: unknown): WeekKey[] {
  const weeks = (typeof body === 'object' && body !== null ? (body as Record<string, unknown>).weeks : undefined) ?? []
  if (!Array.isArray(weeks) || weeks.length === 0) throw new TimesheetError(400, 'No hay semanas que exportar')
  if (weeks.length > MAX_EXPORT_WEEKS) throw new TimesheetError(400, 'Demasiadas semanas: acota los filtros')
  return weeks.map((item) => {
    const data = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>
    const employeeId = Number(data.employeeId)
    const weekStart = typeof data.weekStart === 'string' ? data.weekStart : ''
    if (!Number.isInteger(employeeId) || employeeId <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
      throw new TimesheetError(400, 'Semana no válida')
    }
    return { employeeId, weekStart: weekStartOf(weekStart) }
  })
}

const CSV_HEADERS = [
  'Periodo',
  'No_Empleado',
  'Empleado',
  'Correo',
  'Departamento',
  'Analiticas',
  'H_Normales',
  'H_Extras',
  'H_Domingo',
  'H_Festivo',
  'Dietas',
  'Dias_Inactiva',
  'Total_Horas',
]

/**
 * Texto de una celda. Un valor que empiece por =, +, -, @, tabulador o retorno lleva un
 * apóstrofo delante para que Excel no lo ejecute como fórmula.
 */
function csvText(value: string | null): string {
  const text = value ?? ''
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return `"${safe.replace(/"/g, '""')}"`
}

/** Horas con dos decimales y punto decimal (510 minutos → «8.50»). */
function csvHours(minutes: number): string {
  return minutesToHours(minutes).toFixed(2)
}

/**
 * CSV de nómina: una línea por colaborador y semana. Lleva la marca BOM y saltos CRLF
 * para que Excel lo abra con los acentos correctos.
 */
export function payrollCsv(rows: readonly PayrollWeek[]): string {
  const lines = rows.map((row) =>
    [
      csvText(`${row.weekStart} a ${row.weekEnd}`),
      csvText(row.employeeNumber),
      csvText(row.employeeName),
      csvText(row.email),
      csvText(row.departmentName),
      csvText(row.projects.join(' | ')),
      csvHours(row.totals.normal),
      csvHours(row.totals.extra),
      csvHours(row.totals.sunday),
      csvHours(row.totals.holiday),
      String(row.totals.perDiems),
      String(row.inactiveDays),
      csvHours(row.totals.total),
    ].join(','),
  )
  return '﻿' + [CSV_HEADERS.join(','), ...lines].join('\r\n') + '\r\n'
}

export function createPayrollService(options: { db: DbConfig }) {
  const { db } = options

  /** Jornadas con los datos del empleado; todas, o las de una persona en una semana. */
  async function loadEntries(filter?: WeekKey): Promise<PayrollEntryRow[]> {
    const pool = await getPool(db)
    const request = pool.request()
    let where = ''
    if (filter) {
      request
        .input('employeeId', sql.Int, filter.employeeId)
        .input('from', sql.Date, filter.weekStart)
        .input('to', sql.Date, addDays(filter.weekStart, 6))
      where = 'WHERE e.id = @employeeId AND t.work_date BETWEEN @from AND @to'
    }
    const result = await request.query<PayrollEntryRow>(`
      SELECT ${ENTRY_COLUMNS}, t.reviewed_at AS reviewedAt,
             e.id AS employeeId, e.employee_number AS employeeNumber, e.full_name AS employeeName,
             e.email, d.name AS departmentName
      FROM time_entries AS t
      JOIN projects AS p ON p.id = t.project_id
      JOIN employees AS e ON e.id = t.employee_id
      LEFT JOIN departments AS d ON d.id = e.department_id
      ${where}
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

  function employeeOf(row: PayrollEntryRow): PayrollEmployee {
    return {
      employeeId: row.employeeId,
      employeeNumber: row.employeeNumber,
      employeeName: row.employeeName,
      email: row.email,
      departmentName: row.departmentName,
    }
  }

  /** Semanas aprobadas, de la más reciente a la más antigua y por nombre. */
  async function summary(): Promise<PayrollWeek[]> {
    const [entries, holidays] = await Promise.all([loadEntries(), holidaySet()])

    const groups = new Map<string, PayrollEntryRow[]>()
    for (const entry of entries) {
      const key = `${entry.employeeId}:${weekStartOf(entry.workDate)}`
      groups.set(key, [...(groups.get(key) ?? []), entry])
    }

    return [...groups.values()]
      .filter((group) => weekStatusOf(group) === 'approved')
      .map((group) => {
        const first = group[0]!
        const weekStart = weekStartOf(first.workDate)
        const reviewed = group.flatMap((entry) => (entry.reviewedAt ? [entry.reviewedAt.getTime()] : []))
        return {
          ...employeeOf(first),
          weekStart,
          weekEnd: addDays(weekStart, 6),
          projects: [...new Set(group.map((entry) => entry.projectCode))],
          totals: buildWeek(group, holidays).totals,
          inactiveDays: group.filter((entry) => entry.shiftType === 'inactiva').length,
          approvedAt: reviewed.length > 0 ? new Date(Math.max(...reviewed)) : null,
        }
      })
      .sort((a, b) => b.weekStart.localeCompare(a.weekStart) || a.employeeName.localeCompare(b.employeeName))
  }

  return {
    summary,

    /** Detalle día por día de una semana aprobada. Una que no lo está se trata como inexistente. */
    async detail(employeeId: number, date: DateKey): Promise<PayrollWeekDetail> {
      const weekStart = weekStartOf(date)
      const [entries, holidays] = await Promise.all([loadEntries({ employeeId, weekStart }), holidaySet()])
      if (weekStatusOf(entries) !== 'approved') throw new TimesheetError(404, 'Semana aprobada no encontrada')
      return {
        ...employeeOf(entries[0]!),
        weekStart,
        weekEnd: addDays(weekStart, 6),
        status: 'approved',
        ...buildWeek(entries, holidays),
        corrected: false,
        correctionSentAt: null,
        correctionNote: null,
      }
    },

    /** CSV de las semanas pedidas. Las que no estén aprobadas se dejan fuera. */
    async exportCsv(keys: readonly WeekKey[]): Promise<string> {
      const wanted = new Set(keys.map((key) => `${key.employeeId}:${key.weekStart}`))
      const rows = (await summary()).filter((row) => wanted.has(`${row.employeeId}:${row.weekStart}`))
      if (rows.length === 0) throw new TimesheetError(404, 'No hay semanas aprobadas que exportar')
      return payrollCsv(rows)
    },
  }
}

export type PayrollService = ReturnType<typeof createPayrollService>
