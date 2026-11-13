import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import sql from 'mssql'
import { loadConfig, type DbConfig } from '../config/env.js'
import { closePool, getPool } from './pool.js'

// Scripts SQL numerados (001_..., 002_...). Misma ruta desde api/src/db y api/dist/db.
const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../../../db/migrations')

/** Archivos de migración en el orden en que deben aplicarse. */
export function listMigrations(dir: string = MIGRATIONS_DIR): string[] {
  return readdirSync(dir)
    .filter((file) => /^\d{3}_.+\.sql$/.test(file))
    .sort()
}

/** Aplica las migraciones pendientes, cada una en su transacción. Devuelve las aplicadas. */
export async function migrate(config: DbConfig, dir: string = MIGRATIONS_DIR): Promise<string[]> {
  const pool = await getPool(config)

  await pool.request().query(`
    IF OBJECT_ID('schema_migrations') IS NULL
      CREATE TABLE schema_migrations (
        name        NVARCHAR(200) NOT NULL CONSTRAINT PK_schema_migrations PRIMARY KEY,
        applied_at  DATETIME2(0)  NOT NULL CONSTRAINT DF_schema_migrations_applied_at DEFAULT SYSUTCDATETIME()
      )`)

  const done = await pool.request().query<{ name: string }>('SELECT name FROM schema_migrations')
  const alreadyApplied = new Set(done.recordset.map((row) => row.name))

  const applied: string[] = []
  for (const file of listMigrations(dir)) {
    if (alreadyApplied.has(file)) continue

    const transaction = new sql.Transaction(pool)
    await transaction.begin()
    try {
      await new sql.Request(transaction).batch(readFileSync(path.join(dir, file), 'utf8'))
      await new sql.Request(transaction)
        .input('name', sql.NVarChar(200), file)
        .query('INSERT INTO schema_migrations (name) VALUES (@name)')
      await transaction.commit()
    } catch (error) {
      await transaction.rollback()
      throw new Error(`Falló la migración ${file}`, { cause: error })
    }
    applied.push(file)
  }
  return applied
}

// Ejecución directa: npm run db:migrate
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { db } = loadConfig()
  if (!db) {
    console.error('No hay base de datos configurada (falta DB_SERVER en api/.env).')
    process.exit(1)
  }
  try {
    const applied = await migrate(db)
    console.log(applied.length ? `Migraciones aplicadas: ${applied.join(', ')}` : 'No hay migraciones pendientes.')
  } finally {
    await closePool()
  }
}
