import { existsSync } from 'node:fs'
import path from 'node:path'
import { loadConfig, type DbConfig } from '../config/env.js'
import { migrate } from './migrate.js'
import { closePool } from './pool.js'
import { seed } from './seed.js'

/**
 * Base de datos para las pruebas: la LOCAL de desarrollo, leída de api/.env.
 * Devuelve undefined donde no hay (por ejemplo en GitHub Actions); esas pruebas se omiten.
 * Exige DEV_AUTH=true para no tocar nunca una base que no sea de desarrollo.
 */
export function testDb(): DbConfig | undefined {
  const envFile = path.resolve(import.meta.dirname, '../../.env')
  if (!process.env.DB_SERVER && existsSync(envFile)) process.loadEnvFile(envFile)
  const config = loadConfig()
  return config.devAuth ? config.db : undefined
}

// Lo ejecuta Vitest una vez antes de todas las pruebas: tablas al día y datos de prueba.
export default async function setup(): Promise<void> {
  const db = testDb()
  if (!db) return
  await migrate(db)
  await seed(db)
  await closePool()
}
