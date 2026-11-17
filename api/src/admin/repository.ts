import sql from 'mssql'
import type { DbConfig } from '../config/env.js'
import { getPool } from '../db/pool.js'
import type { EmployeeInput, HolidayInput } from './validation.js'

/** Lo que muestra la lista: sin datos sensibles. */
export interface EmployeeSummary {
  id: number
  employeeNumber: string
  fullName: string
  email: string
  jobTitle: string | null
  departmentId: number | null
  departmentName: string | null
  supervisorId: number | null
  supervisorName: string | null
  projectId: number | null
  projectCode: string | null
  projectName: string | null
  hireDate: string | null
  isActive: boolean
}

/** Expediente completo, con los datos sensibles. Solo para RRHH. */
export interface EmployeeRow extends EmployeeSummary, Omit<EmployeeInput, keyof EmployeeSummary> {}

/** Error de datos que la pantalla debe mostrar tal cual (duplicado, referencia inválida...). */
export class AdminError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'AdminError'
    this.status = status
  }
}

// Códigos de error de SQL Server.
const UNIQUE_VIOLATION = [2601, 2627]
const FOREIGN_KEY_VIOLATION = 547

function sqlErrorNumber(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null && 'number' in error && typeof error.number === 'number'
    ? error.number
    : undefined
}

/** Traduce los errores de restricciones de la base de datos a mensajes para RRHH. */
async function translating<T>(messages: { unique: string; foreignKey?: string }, work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    const number = sqlErrorNumber(error)
    if (number !== undefined && UNIQUE_VIOLATION.includes(number)) throw new AdminError(409, messages.unique)
    if (number === FOREIGN_KEY_VIOLATION && messages.foreignKey) throw new AdminError(400, messages.foreignKey)
    throw error
  }
}

const SUMMARY_COLUMNS = `
  e.id, e.employee_number AS employeeNumber, e.full_name AS fullName, e.email,
  e.job_title AS jobTitle, CONVERT(char(10), e.hire_date, 23) AS hireDate,
  e.department_id AS departmentId, d.name AS departmentName,
  e.supervisor_id AS supervisorId, s.full_name AS supervisorName,
  e.project_id AS projectId, p.code AS projectCode, p.name AS projectName, e.is_active AS isActive`

const EMPLOYEE_JOINS = `
  FROM employees AS e
  LEFT JOIN departments AS d ON d.id = e.department_id
  LEFT JOIN employees AS s ON s.id = e.supervisor_id
  LEFT JOIN projects AS p ON p.id = e.project_id`

/**
 * Campos que RRHH captura: columna, propiedad y tipo. De aquí salen el INSERT, el UPDATE
 * y las columnas del expediente, para que no se desajusten al añadir un campo.
 */
const FIELDS: [column: string, key: keyof EmployeeInput, type: sql.ISqlType | (() => sql.ISqlType), kind?: 'date'][] = [
  ['employee_number', 'employeeNumber', sql.NVarChar(20)],
  ['full_name', 'fullName', sql.NVarChar(200)],
  ['email', 'email', sql.NVarChar(254)],
  ['job_title', 'jobTitle', sql.NVarChar(100)],
  ['hire_date', 'hireDate', sql.Date, 'date'],
  ['imss_end_date', 'imssEndDate', sql.Date, 'date'],
  ['department_id', 'departmentId', sql.Int],
  ['supervisor_id', 'supervisorId', sql.Int],
  ['project_id', 'projectId', sql.Int],
  ['is_active', 'isActive', sql.Bit],
  ['rfc', 'rfc', sql.NVarChar(13)],
  ['nss', 'nss', sql.NVarChar(11)],
  ['curp', 'curp', sql.NVarChar(18)],
  ['personal_email', 'personalEmail', sql.NVarChar(254)],
  ['personal_phone', 'personalPhone', sql.NVarChar(30)],
  ['work_phone', 'workPhone', sql.NVarChar(30)],
  ['marital_status', 'maritalStatus', sql.NVarChar(20)],
  ['emergency_contact_name', 'emergencyContactName', sql.NVarChar(200)],
  ['emergency_contact_phone', 'emergencyContactPhone', sql.NVarChar(30)],
  ['blood_type', 'bloodType', sql.NVarChar(3)],
  ['home_address', 'homeAddress', sql.NVarChar(500)],
  ['size_pants', 'sizePants', sql.NVarChar(20)],
  ['size_tshirt', 'sizeTshirt', sql.NVarChar(20)],
  ['size_shoes', 'sizeShoes', sql.NVarChar(20)],
  ['size_jacket', 'sizeJacket', sql.NVarChar(20)],
  ['size_shirt', 'sizeShirt', sql.NVarChar(20)],
  ['contract_type', 'contractType', sql.NVarChar(20)],
  ['contract_start', 'contractStart', sql.Date, 'date'],
  ['contract_end', 'contractEnd', sql.Date, 'date'],
  ['criminal_record_letter', 'criminalRecordLetter', sql.Bit],
]

// Columnas del expediente que no están ya en el resumen.
const SUMMARY_KEYS = new Set<string>(['employeeNumber', 'fullName', 'email', 'jobTitle', 'hireDate', 'departmentId', 'supervisorId', 'projectId', 'isActive'])
const DETAIL_COLUMNS = FIELDS.filter(([, key]) => !SUMMARY_KEYS.has(key))
  .map(([column, key, , kind]) => (kind === 'date' ? `CONVERT(char(10), e.${column}, 23) AS ${key}` : `e.${column} AS ${key}`))
  .join(', ')

const EMPLOYEE_SELECT = `SELECT ${SUMMARY_COLUMNS}, ${DETAIL_COLUMNS} ${EMPLOYEE_JOINS}`

function bindEmployee(request: sql.Request, input: EmployeeInput): sql.Request {
  for (const [, key, type] of FIELDS) request.input(key, type, input[key])
  return request
}

const EMPLOYEE_MESSAGES = {
  unique: 'Ya existe un empleado con ese número, correo, RFC, NSS o CURP',
  foreignKey: 'El departamento, el supervisor o la analítica indicada no existe',
}

export function createAdminRepository(db: DbConfig) {
  async function getEmployee(id: number): Promise<EmployeeRow | undefined> {
    const pool = await getPool(db)
    const result = await pool.request().input('id', sql.Int, id).query<EmployeeRow>(`${EMPLOYEE_SELECT} WHERE e.id = @id`)
    return result.recordset[0]
  }

  /**
   * ¿Poner a `supervisorId` como jefe de `employeeId` crearía un ciclo?
   * Ocurre si el empleado ya está por encima de ese supervisor en la jerarquía.
   */
  async function wouldCreateCycle(employeeId: number, supervisorId: number): Promise<boolean> {
    if (employeeId === supervisorId) return true
    const pool = await getPool(db)
    const result = await pool
      .request()
      .input('employeeId', sql.Int, employeeId)
      .input('supervisorId', sql.Int, supervisorId)
      .query<{ n: number }>(`
        WITH chain AS (
          SELECT id, supervisor_id FROM employees WHERE id = @supervisorId
          UNION ALL
          SELECT e.id, e.supervisor_id FROM employees AS e JOIN chain AS c ON e.id = c.supervisor_id
        )
        SELECT COUNT(*) AS n FROM chain WHERE id = @employeeId
        OPTION (MAXRECURSION 200)`)
    return (result.recordset[0]?.n ?? 0) > 0
  }

  return {
    /** Lista para la tabla: solo lo esencial, sin datos sensibles. */
    async listEmployees(): Promise<EmployeeSummary[]> {
      const pool = await getPool(db)
      const result = await pool
        .request()
        .query<EmployeeSummary>(`SELECT ${SUMMARY_COLUMNS} ${EMPLOYEE_JOINS} ORDER BY e.full_name`)
      return result.recordset
    },

    /** Expediente completo de un empleado. */
    async getEmployee(id: number): Promise<EmployeeRow> {
      const employee = await getEmployee(id)
      if (!employee) throw new AdminError(404, 'Empleado no encontrado')
      return employee
    },

    async createEmployee(input: EmployeeInput): Promise<EmployeeRow> {
      const pool = await getPool(db)
      const id = await translating(EMPLOYEE_MESSAGES, async () => {
        const result = await bindEmployee(pool.request(), input).query<{ id: number }>(`
          INSERT INTO employees (${FIELDS.map(([column]) => column).join(', ')})
          OUTPUT INSERTED.id
          VALUES (${FIELDS.map(([, key]) => `@${key}`).join(', ')})`)
        return result.recordset[0]?.id
      })
      const created = id === undefined ? undefined : await getEmployee(id)
      if (!created) throw new Error('No se pudo crear el empleado')
      return created
    },

    async updateEmployee(id: number, input: EmployeeInput): Promise<EmployeeRow> {
      if (input.supervisorId !== null && (await wouldCreateCycle(id, input.supervisorId))) {
        throw new AdminError(400, 'Ese supervisor depende de este empleado: no pueden supervisarse entre sí')
      }
      const pool = await getPool(db)
      const affected = await translating(EMPLOYEE_MESSAGES, async () => {
        const result = await bindEmployee(pool.request(), input)
          .input('id', sql.Int, id)
          .query(`
            UPDATE employees
            SET ${FIELDS.map(([column, key]) => `${column} = @${key}`).join(', ')}
            WHERE id = @id`)
        return result.rowsAffected[0] ?? 0
      })
      const updated = affected > 0 ? await getEmployee(id) : undefined
      if (!updated) throw new AdminError(404, 'Empleado no encontrado')
      return updated
    },

    async listDepartments(): Promise<{ id: number; name: string }[]> {
      const pool = await getPool(db)
      const result = await pool
        .request()
        .query<{ id: number; name: string }>('SELECT id, name FROM departments WHERE is_active = 1 ORDER BY name')
      return result.recordset
    },

    async createDepartment(name: string): Promise<{ id: number; name: string }> {
      const pool = await getPool(db)
      return translating({ unique: 'Ya existe un departamento con ese nombre' }, async () => {
        const result = await pool
          .request()
          .input('name', sql.NVarChar(100), name)
          .query<{ id: number; name: string }>('INSERT INTO departments (name) OUTPUT INSERTED.id, INSERTED.name VALUES (@name)')
        const created = result.recordset[0]
        if (!created) throw new Error('No se pudo crear el departamento')
        return created
      })
    },

    /** Analíticas activas, para elegir al fichar. */
    async listProjects(): Promise<{ id: number; code: string; name: string | null; detail: string | null }[]> {
      const pool = await getPool(db)
      const result = await pool
        .request()
        .query<{ id: number; code: string; name: string | null; detail: string | null }>(
          'SELECT id, code, name, detail FROM projects WHERE is_active = 1 ORDER BY code',
        )
      return result.recordset
    },

    async listHolidays(year: number): Promise<{ id: number; date: string; name: string }[]> {
      const pool = await getPool(db)
      const result = await pool
        .request()
        .input('year', sql.Int, year)
        .query<{ id: number; date: string; name: string }>(`
          SELECT id, CONVERT(char(10), holiday_date, 23) AS date, name
          FROM holidays WHERE YEAR(holiday_date) = @year ORDER BY holiday_date`)
      return result.recordset
    },

    async createHoliday(input: HolidayInput): Promise<{ id: number; date: string; name: string }> {
      const pool = await getPool(db)
      return translating({ unique: 'Ese día ya está registrado como festivo' }, async () => {
        const result = await pool
          .request()
          .input('date', sql.Date, input.date)
          .input('name', sql.NVarChar(100), input.name)
          .query<{ id: number }>('INSERT INTO holidays (holiday_date, name) OUTPUT INSERTED.id VALUES (@date, @name)')
        const id = result.recordset[0]?.id
        if (id === undefined) throw new Error('No se pudo crear el festivo')
        return { id, ...input }
      })
    },

    async deleteHoliday(id: number): Promise<void> {
      const pool = await getPool(db)
      const result = await pool.request().input('id', sql.Int, id).query('DELETE FROM holidays WHERE id = @id')
      if ((result.rowsAffected[0] ?? 0) === 0) throw new AdminError(404, 'Festivo no encontrado')
    },
  }
}

export type AdminRepository = ReturnType<typeof createAdminRepository>
