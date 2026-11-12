import { existsSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadConfig } from '../config/env.js'
import { supervisorLookupFromDb } from './employees.js'
import { listMigrations, migrate } from './migrate.js'
import { closePool, getPool } from './pool.js'
import { seed } from './seed.js'

describe('listMigrations', () => {
  it('devuelve los scripts numerados en orden', () => {
    const files = listMigrations()
    expect(files[0]).toBe('001_base.sql')
    expect(files).toEqual([...files].sort())
  })
})

// Pruebas contra la base de datos LOCAL de desarrollo. Necesitan api/.env con DB_SERVER;
// donde no hay base de datos (por ejemplo en GitHub Actions) se omiten.
const envFile = path.resolve(import.meta.dirname, '../../.env')
if (!process.env.DB_SERVER && existsSync(envFile)) process.loadEnvFile(envFile)
const config = loadConfig()
const db = config.devAuth ? config.db : undefined

describe.skipIf(!db)('Base de datos local', () => {
  const dbConfig = db!
  const user = (email: string) => ({ id: 'x', name: 'x', email, groups: [] })

  beforeAll(async () => {
    await migrate(dbConfig)
    await seed(dbConfig)
  })

  afterAll(async () => {
    await closePool()
  })

  it('crea las tablas base', async () => {
    const pool = await getPool(dbConfig)
    const result = await pool
      .request()
      .query<{ name: string }>("SELECT name FROM sys.tables WHERE name IN ('departments','employees','projects','holidays')")
    expect(result.recordset.map((row) => row.name).sort()).toEqual(['departments', 'employees', 'holidays', 'projects'])
  })

  it('volver a migrar no aplica nada', async () => {
    expect(await migrate(dbConfig)).toEqual([])
  })

  it('volver a cargar los datos de prueba no los duplica', async () => {
    const pool = await getPool(dbConfig)
    const count = async () =>
      (await pool.request().query<{ n: number }>('SELECT COUNT(*) AS n FROM employees')).recordset[0]?.n
    const before = await count()
    await seed(dbConfig)
    expect(await count()).toBe(before)
  })

  it('es supervisor quien tiene empleados a su cargo', async () => {
    const isSupervisor = supervisorLookupFromDb(dbConfig)
    expect(await isSupervisor(user('supervisor@example.test'))).toBe(true)
    expect(await isSupervisor(user('SUPERVISOR@example.test'))).toBe(true)
    expect(await isSupervisor(user('colaborador@example.test'))).toBe(false)
    expect(await isSupervisor(user('no-existe@example.test'))).toBe(false)
    expect(await isSupervisor(user(''))).toBe(false)
  })
})
