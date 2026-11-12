import sql from 'mssql'
import type { DbConfig } from '../config/env.js'
import { getPool } from '../db/pool.js'
import type { EmployeeInput, HolidayInput } from './validation.js'

export interface EmployeeRow {
  id: number
  employeeNumber: string
  fullName: string
  email: string
  jobTitle: string | null
  departmentId: number | null
  departmentName: string | null
  supervisorId: number | null
  supervisorName: string | null
  isActive: boolean
}

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

const EMPLOYEE_SELECT = `
  SELECT e.id, e.employee_number AS employeeNumber, e.full_name AS fullName, e.email,
         e.job_title AS jobTitle, e.department_id AS departmentId, d.name AS departmentName,
         e.supervisor_id AS supervisorId, s.full_name AS supervisorName, e.is_active AS isActive
  FROM employees AS e
  LEFT JOIN departments AS d ON d.id = e.department_id
  LEFT JOIN employees AS s ON s.id = e.supervisor_id`

function bindEmployee(request: sql.Request, input: EmployeeInput): sql.Request {
  return request
    .input('number', sql.NVarChar(20), input.employeeNumber)
    .input('name', sql.NVarChar(200), input.fullName)
    .input('email', sql.NVarChar(254), input.email)
    .input('jobTitle', sql.NVarChar(100), input.jobTitle)
    .input('departmentId', sql.Int, input.departmentId)
    .input('supervisorId', sql.Int, input.supervisorId)
    .input('isActive', sql.Bit, input.isActive)
}

const EMPLOYEE_MESSAGES = {
  unique: 'Ya existe un empleado con ese número o ese correo',
  foreignKey: 'El departamento o el supervisor indicado no existe',
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
    async listEmployees(): Promise<EmployeeRow[]> {
      const pool = await getPool(db)
      const result = await pool.request().query<EmployeeRow>(`${EMPLOYEE_SELECT} ORDER BY e.full_name`)
      return result.recordset
    },

    async createEmployee(input: EmployeeInput): Promise<EmployeeRow> {
      const pool = await getPool(db)
      const id = await translating(EMPLOYEE_MESSAGES, async () => {
        const result = await bindEmployee(pool.request(), input).query<{ id: number }>(`
          INSERT INTO employees (employee_number, full_name, email, job_title, department_id, supervisor_id, is_active)
          OUTPUT INSERTED.id
          VALUES (@number, @name, @email, @jobTitle, @departmentId, @supervisorId, @isActive)`)
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
            SET employee_number = @number, full_name = @name, email = @email, job_title = @jobTitle,
                department_id = @departmentId, supervisor_id = @supervisorId, is_active = @isActive
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
