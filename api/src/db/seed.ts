import { pathToFileURL } from 'node:url'
import sql from 'mssql'
import { DEV_USERS } from '../auth/devUsers.js'
import { loadConfig, type DbConfig } from '../config/env.js'
import { closePool, getPool } from './pool.js'

// Datos de PRUEBA para desarrollo en local. Todo es ficticio salvo los códigos de
// analítica, que salen del prototipo parte-horas. Se puede ejecutar varias veces.

const DEPARTMENT = 'Departamento de Prueba'

const PROJECT_CODES = [
  'MX0010000', 'MX0011000', 'MX0012000', 'MX0013000', 'MX0014000', 'MX0015000',
  'MX0016000', 'MX0017000', 'MX0020000', 'MX0031000', 'MX0032000', 'MX0057400',
  'MX0078800', 'MX0081400', 'MX0085600', 'MX0090100', 'MX0091600', 'MX0093100',
  'MX0094200', 'MX0096100', 'MX0096200', 'MX0096300', 'MX0097100', 'MX0097200',
  'MX0097300', 'MX0098400', 'MX00OYMPA', 'MX00REPEJ',
]

// Días de descanso obligatorio (art. 74 LFT) de 2026 y 2027. Solo para probar en local.
const HOLIDAYS: [date: string, name: string][] = [
  ['2026-01-01', 'Año Nuevo'],
  ['2026-02-02', 'Día de la Constitución'],
  ['2026-03-16', 'Natalicio de Benito Juárez'],
  ['2026-05-01', 'Día del Trabajo'],
  ['2026-09-16', 'Día de la Independencia'],
  ['2026-11-16', 'Día de la Revolución'],
  ['2026-12-25', 'Navidad'],
  ['2027-01-01', 'Año Nuevo'],
  ['2027-02-01', 'Día de la Constitución'],
  ['2027-03-15', 'Natalicio de Benito Juárez'],
  ['2027-05-01', 'Día del Trabajo'],
  ['2027-09-16', 'Día de la Independencia'],
  ['2027-11-15', 'Día de la Revolución'],
  ['2027-12-25', 'Navidad'],
]

export async function seed(config: DbConfig): Promise<void> {
  const pool = await getPool(config)

  await pool
    .request()
    .input('name', sql.NVarChar(100), DEPARTMENT)
    .query('IF NOT EXISTS (SELECT 1 FROM departments WHERE name = @name) INSERT INTO departments (name) VALUES (@name)')

  // Un empleado por cada usuario de prueba del selector, enlazados por correo.
  for (const [index, user] of DEV_USERS.entries()) {
    await pool
      .request()
      .input('number', sql.NVarChar(20), `PRUEBA-${String(index + 1).padStart(3, '0')}`)
      .input('name', sql.NVarChar(200), user.name)
      .input('email', sql.NVarChar(254), user.email)
      .input('department', sql.NVarChar(100), DEPARTMENT)
      .query(`
        IF NOT EXISTS (SELECT 1 FROM employees WHERE email = @email)
          INSERT INTO employees (employee_number, full_name, email, department_id)
          SELECT @number, @name, @email, id FROM departments WHERE name = @department`)
  }

  // La jerarquía sale de devUsers.ts (reportsTo).
  for (const user of DEV_USERS) {
    const supervisor = DEV_USERS.find((candidate) => candidate.id === user.reportsTo)
    if (!supervisor) continue
    await pool
      .request()
      .input('email', sql.NVarChar(254), user.email)
      .input('supervisorEmail', sql.NVarChar(254), supervisor.email)
      .query(`
        UPDATE employees
        SET supervisor_id = (SELECT id FROM employees WHERE email = @supervisorEmail)
        WHERE email = @email`)
  }

  for (const code of PROJECT_CODES) {
    await pool
      .request()
      .input('code', sql.NVarChar(20), code)
      .query('IF NOT EXISTS (SELECT 1 FROM projects WHERE code = @code) INSERT INTO projects (code) VALUES (@code)')
  }

  for (const [date, name] of HOLIDAYS) {
    await pool
      .request()
      .input('date', sql.Date, date)
      .input('name', sql.NVarChar(100), name)
      .query(`
        IF NOT EXISTS (SELECT 1 FROM holidays WHERE holiday_date = @date)
          INSERT INTO holidays (holiday_date, name) VALUES (@date, @name)`)
  }
}

// Ejecución directa: npm run db:seed
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = loadConfig()
  // Los datos de prueba nunca deben llegar a una base real: solo con autenticación simulada.
  if (!config.devAuth) {
    console.error('Los datos de prueba solo se cargan en local (DEV_AUTH=true).')
    process.exit(1)
  }
  if (!config.db) {
    console.error('No hay base de datos configurada (falta DB_SERVER en api/.env).')
    process.exit(1)
  }
  try {
    await seed(config.db)
    console.log('Datos de prueba cargados.')
  } finally {
    await closePool()
  }
}
