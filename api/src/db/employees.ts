import sql from 'mssql'
import type { SupervisorLookup } from '../auth/middleware.js'
import type { DbConfig } from '../config/env.js'
import { getPool } from './pool.js'

/**
 * Supervisor "por datos": el usuario tiene empleados activos a su cargo.
 * El usuario autenticado se enlaza con su ficha por el correo.
 */
export function supervisorLookupFromDb(config: DbConfig): SupervisorLookup {
  return async (user) => {
    if (!user.email) return false
    const pool = await getPool(config)
    const result = await pool
      .request()
      .input('email', sql.NVarChar(254), user.email)
      .query<{ is_supervisor: number }>(`
        SELECT CASE WHEN EXISTS (
          SELECT 1
          FROM employees AS supervisor
          JOIN employees AS report ON report.supervisor_id = supervisor.id
          WHERE supervisor.email = @email AND supervisor.is_active = 1 AND report.is_active = 1
        ) THEN 1 ELSE 0 END AS is_supervisor`)
    return result.recordset[0]?.is_supervisor === 1
  }
}

export interface EmployeeRef {
  id: number
  fullName: string
}

/** Ficha activa del usuario autenticado, enlazada por el correo. */
export async function findEmployeeByEmail(config: DbConfig, email: string): Promise<EmployeeRef | undefined> {
  if (!email) return undefined
  const pool = await getPool(config)
  const result = await pool
    .request()
    .input('email', sql.NVarChar(254), email)
    .query<{ id: number; full_name: string }>(
      'SELECT id, full_name FROM employees WHERE email = @email AND is_active = 1',
    )
  const row = result.recordset[0]
  return row ? { id: row.id, fullName: row.full_name } : undefined
}

/** Prefijo del número de empleado provisional de las fichas creadas automáticamente. */
export const AUTO_NUMBER_PREFIX = 'AUTO-'

/**
 * Ficha del usuario autenticado; si no tiene, se le crea una básica con el nombre y el correo
 * de su cuenta, para que pueda fichar sin esperar a RRHH. Queda sin supervisor ni departamento
 * y con un número provisional (AUTO-…) hasta que RRHH la complete.
 * Devuelve undefined si no hay correo o si su ficha está dada de baja: esa no se reactiva sola.
 */
export async function ensureEmployee(
  config: DbConfig,
  user: { name: string; email: string },
): Promise<EmployeeRef | undefined> {
  if (!user.email) return undefined
  const existing = await findEmployeeByEmail(config, user.email)
  if (existing) return existing

  const pool = await getPool(config)
  try {
    // El número es obligatorio y único: se pone uno temporal y enseguida el definitivo con el id.
    const created = await pool
      .request()
      .input('name', sql.NVarChar(200), user.name.trim() || user.email)
      .input('email', sql.NVarChar(254), user.email)
      .query<{ id: number }>(`
        DECLARE @new TABLE (id INT);
        INSERT INTO employees (employee_number, full_name, email)
        OUTPUT INSERTED.id INTO @new
        VALUES (LEFT('TMP-' + REPLACE(CONVERT(NVARCHAR(36), NEWID()), '-', ''), 20), @name, @email);
        UPDATE employees SET employee_number = '${AUTO_NUMBER_PREFIX}' + CONVERT(NVARCHAR(12), id)
        WHERE id = (SELECT id FROM @new);
        SELECT id FROM @new;`)
    const id = created.recordset[0]?.id
    return id === undefined ? undefined : { id, fullName: user.name.trim() || user.email }
  } catch (error) {
    // 2601/2627: ya existe una ficha con ese correo. O la creó otra petición a la vez (se
    // devuelve esa) o está dada de baja (no se encuentra activa y se devuelve undefined).
    const number = (error as { number?: number }).number
    if (number !== 2601 && number !== 2627) throw error
    return findEmployeeByEmail(config, user.email)
  }
}

/** Comprueba que la base de datos responde. */
export async function pingDb(config: DbConfig): Promise<void> {
  const pool = await getPool(config)
  await pool.request().query('SELECT 1')
}
