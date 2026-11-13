import sql from 'mssql'
import type { DbConfig } from '../config/env.js'

let poolPromise: Promise<sql.ConnectionPool> | undefined

/** Conexión compartida a la base de datos. Se abre la primera vez que se pide. */
export function getPool(config: DbConfig): Promise<sql.ConnectionPool> {
  poolPromise ??= new sql.ConnectionPool({
    server: config.server,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    options: {
      encrypt: config.encrypt,
      trustServerCertificate: config.trustServerCertificate,
    },
  })
    .connect()
    .catch((error: unknown) => {
      // Si falla, el siguiente intento vuelve a conectar en lugar de repetir el error.
      poolPromise = undefined
      throw error
    })
  return poolPromise
}

export async function closePool(): Promise<void> {
  const current = poolPromise
  poolPromise = undefined
  if (current) await (await current).close()
}
