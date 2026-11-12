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

/** Comprueba que la base de datos responde. */
export async function pingDb(config: DbConfig): Promise<void> {
  const pool = await getPool(config)
  await pool.request().query('SELECT 1')
}
