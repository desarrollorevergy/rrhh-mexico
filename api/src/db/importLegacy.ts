import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import sql from 'mssql'
import { loadConfig, type DbConfig } from '../config/env.js'
import { closePool, getPool } from './pool.js'

// Importa los empleados y los registros de horas exportados de la app anterior (Supabase):
// data/users_rows.csv y data/registros_tiempos_rows.csv. Esos archivos tienen datos personales
// y no van al repositorio.
//
// Por defecto SIMULA: hace todo dentro de una transacción y la deshace, para ver el informe
// sin guardar nada. Con --apply guarda. Se puede repetir: lo que ya existe no se duplica.
//
// Reglas (decididas el 2026-11-13):
// - Solo se importan los usuarios con correo de empresa: es lo que los enlaza con su cuenta.
// - No se importan RFC ni correo personal.
// - Número de empleado provisional MIG-<8 primeros caracteres del id antiguo>; sin supervisor.
// - Todo tipo de jornada antiguo (Ordinaria, Activa, Teletrabajo) pasa a «activa».
// - Las analíticas que no estén en el catálogo se añaden sin nombre.
// - Los registros de cuentas que no están entre los usuarios importados se dejan fuera.

const TIME_ZONE = 'America/Mexico_City'
/** Solo se crean analíticas con forma de código real, p. ej. MX0097101 o MX0097101-01. */
const PROJECT_CODE = /^MX\d{7}(-\d{2})?$/

/** CSV con comillas, comas y saltos de línea dentro de las celdas. Devuelve una fila por objeto. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const source = text.replace(/^﻿/, '')
  for (let i = 0; i < source.length; i++) {
    const char = source[i]!
    if (quoted) {
      if (char !== '"') cell += char
      else if (source[i + 1] === '"') {
        cell += '"'
        i++
      } else quoted = false
    } else if (char === '"') quoted = true
    else if (char === ',') {
      row.push(cell)
      cell = ''
    } else if (char === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else if (char !== '\r') cell += char
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  const [header = [], ...body] = rows
  return body
    .filter((cells) => cells.some((value) => value !== ''))
    .map((cells) => Object.fromEntries(header.map((name, index) => [name, cells[index] ?? ''])))
}

/** Instante de Supabase («2026-10-12 14:32:54.186+00») como fecha; null si viene vacío. */
export function parseInstant(value: string): Date | null {
  if (!value.trim()) return null
  const iso = value.trim().replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00')
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) throw new Error(`Fecha no reconocida: ${value}`)
  return date
}

const emailOf = (value: string | undefined) => (value ?? '').trim().toLowerCase()

export interface PlannedEmployee {
  number: string
  name: string
  email: string
  jobTitle: string | null
  department: string | null
}

export interface PlannedEntry {
  email: string
  workDate: string
  projectCode: string
  perDiem: boolean
  comment: string | null
  clockIn: Date
  clockOut: Date | null
  status: 'pending' | 'approved' | 'rejected'
  rejectReason: string | null
  reviewedByEmail: string | null
  reviewedAt: Date | null
  hoursEdited: boolean
  correctionSentAt: Date | null
  correctionNote: string | null
  createdAt: Date | null
}

export interface ImportPlan {
  employees: PlannedEmployee[]
  /** Usuarios sin correo de empresa: no se importan. */
  usersWithoutEmail: number
  entries: PlannedEntry[]
  /** Registros de cuentas que no están entre los usuarios importados. */
  entriesOfUnknownPeople: number
  unknownPeople: number
}

const STATUS: Record<string, PlannedEntry['status']> = { pending: 'pending', approved: 'approved', rejected: 'rejected' }
const textOrNull = (value: string | undefined, max: number) => (value?.trim() ? value.trim().slice(0, max) : null)

/** Decide qué se importa, sin tocar la base de datos. */
export function planImport(users: Record<string, string>[], records: Record<string, string>[]): ImportPlan {
  const employees: PlannedEmployee[] = []
  let usersWithoutEmail = 0
  for (const user of users) {
    const email = emailOf(user.email_empresa)
    if (!email) {
      usersWithoutEmail++
      continue
    }
    employees.push({
      number: `MIG-${(user.id ?? '').slice(0, 8)}`,
      name: (user.nombre ?? '').trim() || email,
      email,
      jobTitle: textOrNull(user.puesto_trabajo, 100),
      department: textOrNull(user.departamento, 100),
    })
  }

  const known = new Set(employees.map((employee) => employee.email))
  const unknown = new Set<string>()
  const entries: PlannedEntry[] = []
  let entriesOfUnknownPeople = 0
  for (const record of records) {
    const email = emailOf(record.titulo)
    if (!known.has(email)) {
      unknown.add(email)
      entriesOfUnknownPeople++
      continue
    }
    const clockIn = parseInstant(record.hora_entrada ?? '')
    if (!clockIn) throw new Error(`Registro ${record.id} sin hora de entrada`)
    entries.push({
      email,
      workDate: record.fecha ?? '',
      projectCode: (record.analitica ?? '').trim(),
      perDiem: record.dieta === 'true',
      comment: textOrNull(record.comentario, 1000),
      clockIn,
      clockOut: parseInstant(record.hora_salida ?? ''),
      status: STATUS[record.estado_validacion ?? ''] ?? 'pending',
      rejectReason: textOrNull(record.motivo_rechazo, 1000),
      reviewedByEmail: emailOf(record.validado_por) || null,
      reviewedAt: parseInstant(record.validado_at ?? ''),
      hoursEdited: record.horas_corregidas === 'true',
      correctionSentAt: parseInstant(record.correccion_enviada_at ?? ''),
      correctionNote: textOrNull(record.nota_correccion, 1000),
      createdAt: parseInstant(record.created_at ?? ''),
    })
  }
  return { employees, usersWithoutEmail, entries, entriesOfUnknownPeople, unknownPeople: unknown.size }
}

export interface ImportReport {
  departmentsCreated: number
  employeesCreated: number
  employeesExisting: number
  projectsCreated: string[]
  entriesCreated: number
  entriesExisting: number
  /** Registros con una analítica que no existe ni tiene forma de código válido. */
  entriesWithBadProject: number
}

/** Lleva el plan a la base de datos en una transacción. Sin `apply`, la deshace al terminar. */
export async function runImport(db: DbConfig, plan: ImportPlan, apply: boolean): Promise<ImportReport> {
  const pool = await getPool(db)
  const tx = new sql.Transaction(pool)
  await tx.begin()
  const request = () => new sql.Request(tx)
  const report: ImportReport = {
    departmentsCreated: 0,
    employeesCreated: 0,
    employeesExisting: 0,
    projectsCreated: [],
    entriesCreated: 0,
    entriesExisting: 0,
    entriesWithBadProject: 0,
  }

  try {
    // Departamentos
    const departments = new Map<string, number>()
    for (const row of (await request().query<{ id: number; name: string }>('SELECT id, name FROM departments')).recordset) {
      departments.set(row.name.toLowerCase(), row.id)
    }
    for (const name of new Set(plan.employees.flatMap((employee) => (employee.department ? [employee.department] : [])))) {
      if (departments.has(name.toLowerCase())) continue
      const created = await request()
        .input('name', sql.NVarChar(100), name)
        .query<{ id: number }>('INSERT INTO departments (name) OUTPUT INSERTED.id VALUES (@name)')
      departments.set(name.toLowerCase(), created.recordset[0]!.id)
      report.departmentsCreated++
    }

    // Empleados: el correo los identifica. A una ficha que ya existe solo se le completa lo vacío.
    const employeeIds = new Map<string, number>()
    for (const employee of plan.employees) {
      const departmentId = employee.department ? (departments.get(employee.department.toLowerCase()) ?? null) : null
      const found = await request()
        .input('email', sql.NVarChar(254), employee.email)
        .query<{ id: number }>('SELECT id FROM employees WHERE email = @email')
      const existing = found.recordset[0]
      if (existing) {
        await request()
          .input('id', sql.Int, existing.id)
          .input('departmentId', sql.Int, departmentId)
          .input('jobTitle', sql.NVarChar(100), employee.jobTitle)
          .query(`
            UPDATE employees
            SET department_id = COALESCE(department_id, @departmentId), job_title = COALESCE(job_title, @jobTitle)
            WHERE id = @id`)
        employeeIds.set(employee.email, existing.id)
        report.employeesExisting++
        continue
      }
      const created = await request()
        .input('number', sql.NVarChar(20), employee.number)
        .input('name', sql.NVarChar(200), employee.name)
        .input('email', sql.NVarChar(254), employee.email)
        .input('departmentId', sql.Int, departmentId)
        .input('jobTitle', sql.NVarChar(100), employee.jobTitle)
        .query<{ id: number }>(`
          INSERT INTO employees (employee_number, full_name, email, department_id, job_title)
          OUTPUT INSERTED.id
          VALUES (@number, @name, @email, @departmentId, @jobTitle)`)
      employeeIds.set(employee.email, created.recordset[0]!.id)
      report.employeesCreated++
    }

    // Analíticas: las que falten se añaden sin nombre.
    const projects = new Map<string, number>()
    for (const row of (await request().query<{ id: number; code: string }>('SELECT id, code FROM projects')).recordset) {
      projects.set(row.code, row.id)
    }
    for (const code of new Set(plan.entries.map((entry) => entry.projectCode))) {
      if (projects.has(code) || !PROJECT_CODE.test(code)) continue
      const created = await request()
        .input('code', sql.NVarChar(20), code)
        .query<{ id: number }>('INSERT INTO projects (code) OUTPUT INSERTED.id VALUES (@code)')
      projects.set(code, created.recordset[0]!.id)
      report.projectsCreated.push(code)
    }

    // Jornadas: una por persona y día. La que ya existe no se toca.
    for (const entry of plan.entries) {
      const employeeId = employeeIds.get(entry.email)
      const projectId = projects.get(entry.projectCode)
      if (employeeId === undefined) continue
      if (projectId === undefined) {
        report.entriesWithBadProject++
        continue
      }
      const exists = await request()
        .input('employeeId', sql.Int, employeeId)
        .input('date', sql.Date, entry.workDate)
        .query('SELECT 1 AS found FROM time_entries WHERE employee_id = @employeeId AND work_date = @date')
      if (exists.recordset.length > 0) {
        report.entriesExisting++
        continue
      }
      // Quien validó, si tiene ficha; si no (por ejemplo una cuenta de pruebas), queda vacío.
      const reviewer = entry.reviewedByEmail ? ((await request()
        .input('email', sql.NVarChar(254), entry.reviewedByEmail)
        .query<{ id: number }>('SELECT id FROM employees WHERE email = @email')).recordset[0]?.id ?? null) : null

      await request()
        .input('employeeId', sql.Int, employeeId)
        .input('date', sql.Date, entry.workDate)
        .input('projectId', sql.Int, projectId)
        .input('perDiem', sql.Bit, entry.perDiem)
        .input('comment', sql.NVarChar(1000), entry.comment)
        .input('clockIn', sql.DateTime2(0), entry.clockIn)
        .input('clockOut', sql.DateTime2(0), entry.clockOut)
        .input('timeZone', sql.NVarChar(64), TIME_ZONE)
        .input('status', sql.NVarChar(10), entry.status)
        .input('rejectReason', sql.NVarChar(1000), entry.status === 'rejected' ? entry.rejectReason : null)
        .input('reviewedBy', sql.Int, reviewer)
        .input('reviewedAt', sql.DateTime2(0), entry.reviewedAt)
        .input('hoursEdited', sql.Bit, entry.hoursEdited)
        .input('correctionSentAt', sql.DateTime2(0), entry.correctionSentAt)
        .input('correctionNote', sql.NVarChar(1000), entry.correctionNote)
        .input('createdAt', sql.DateTime2(0), entry.createdAt ?? entry.clockIn)
        .query(`
          INSERT INTO time_entries
            (employee_id, work_date, project_id, shift_type, per_diem, comment, clock_in, clock_out, time_zone,
             status, reject_reason, reviewed_by, reviewed_at, hours_edited, correction_sent_at, correction_note,
             created_at, updated_at)
          VALUES
            (@employeeId, @date, @projectId, 'activa', @perDiem, @comment, @clockIn, @clockOut, @timeZone,
             @status, @rejectReason, @reviewedBy, @reviewedAt, @hoursEdited, @correctionSentAt, @correctionNote,
             @createdAt, SYSUTCDATETIME())`)
      report.entriesCreated++
    }

    if (apply) await tx.commit()
    else await tx.rollback()
    return report
  } catch (error) {
    await tx.rollback()
    throw error
  }
}

// Ejecución directa: npm run db:import-legacy [-- --apply] [-- --dir <carpeta>]
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const dirArg = args.indexOf('--dir')
  const dir = dirArg >= 0 && args[dirArg + 1] ? path.resolve(args[dirArg + 1]!) : path.resolve(import.meta.dirname, '../../../data')

  const { db } = loadConfig()
  if (!db) {
    console.error('No hay base de datos configurada (falta DB_SERVER).')
    process.exit(1)
  }

  const plan = planImport(
    parseCsv(readFileSync(path.join(dir, 'users_rows.csv'), 'utf8')),
    parseCsv(readFileSync(path.join(dir, 'registros_tiempos_rows.csv'), 'utf8')),
  )
  // El informe solo lleva recuentos: sin nombres ni correos.
  console.log(`Destino: ${db.server} · base ${db.database}`)
  console.log(`Modo: ${apply ? 'APLICAR (se guardan los cambios)' : 'SIMULACIÓN (no se guarda nada; usa --apply para guardar)'}`)
  console.log(`Archivos: ${plan.employees.length + plan.usersWithoutEmail} usuarios, ${plan.entries.length + plan.entriesOfUnknownPeople} registros`)
  try {
    const report = await runImport(db, plan, apply)
    console.log(`Empleados: ${report.employeesCreated} nuevos, ${report.employeesExisting} ya existían, ${plan.usersWithoutEmail} sin correo de empresa (fuera)`)
    console.log(`Departamentos nuevos: ${report.departmentsCreated}`)
    console.log(`Analíticas añadidas al catálogo: ${report.projectsCreated.join(', ') || 'ninguna'}`)
    console.log(`Jornadas: ${report.entriesCreated} nuevas, ${report.entriesExisting} ya existían`)
    console.log(`Jornadas fuera: ${plan.entriesOfUnknownPeople} de ${plan.unknownPeople} cuentas que no están en usuarios, ${report.entriesWithBadProject} con analítica no válida`)
    console.log(apply ? 'Hecho.' : 'Simulación terminada: la base de datos no ha cambiado.')
  } finally {
    await closePool()
  }
}
