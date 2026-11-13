import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import sql from 'mssql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { encodePrincipal, PRINCIPAL_HEADER } from '../auth/principal.js'
import { closePool, getPool } from '../db/pool.js'
import { testDb } from '../db/testSetup.js'
import { createPayrollService, parseWeekKeys, payrollCsv, type PayrollWeek } from './payroll.js'

const mx = (local: string) => new Date(`${local}-06:00`)
const h = (hours: number) => hours * 60

describe('CSV de nómina', () => {
  const week = (overrides: Partial<PayrollWeek> = {}): PayrollWeek => ({
    employeeId: 1,
    employeeNumber: 'E-001',
    employeeName: 'Ana Pérez',
    email: 'ana@example.test',
    departmentName: 'Operaciones',
    weekStart: '2026-11-02',
    weekEnd: '2026-11-08',
    projects: ['MX0011000', 'MX0012000'],
    totals: { normal: h(40), extra: 90, sunday: 0, holiday: h(8), total: h(48) + 90, perDiems: 3 },
    inactiveDays: 1,
    approvedAt: null,
    ...overrides,
  })

  it('lleva cabecera, una línea por semana, horas con dos decimales, BOM y CRLF', () => {
    const csv = payrollCsv([week()])
    expect(csv.startsWith('﻿')).toBe(true)
    const lines = csv.slice(1).split('\r\n')
    expect(lines[0]).toBe(
      'Periodo,No_Empleado,Empleado,Correo,Departamento,Analiticas,H_Normales,H_Extras,H_Domingo,H_Festivo,Dietas,Dias_Inactiva,Total_Horas',
    )
    expect(lines[1]).toBe(
      '"2026-11-02 a 2026-11-08","E-001","Ana Pérez","ana@example.test","Operaciones","MX0011000 | MX0012000",40.00,1.50,0.00,8.00,3,1,49.50',
    )
    expect(lines[2]).toBe('')
  })

  it('escapa comillas y neutraliza lo que Excel tomaría por fórmula', () => {
    const csv = payrollCsv([week({ employeeName: '=CMD("x")', departmentName: null, employeeNumber: '+52 1' })])
    const line = csv.split('\r\n')[1]!
    expect(line).toContain(`"'=CMD(""x"")"`)
    expect(line).toContain(`"'+52 1"`)
    expect(line).toContain(',"",') // departamento vacío
  })

  it('valida las semanas pedidas y las lleva a su lunes', () => {
    expect(parseWeekKeys({ weeks: [{ employeeId: 7, weekStart: '2026-11-05' }] })).toEqual([
      { employeeId: 7, weekStart: '2026-11-02' },
    ])
    expect(() => parseWeekKeys({ weeks: [] })).toThrow('No hay semanas')
    expect(() => parseWeekKeys({})).toThrow('No hay semanas')
    expect(() => parseWeekKeys({ weeks: [{ employeeId: 'x', weekStart: '2026-11-02' }] })).toThrow('Semana no válida')
  })
})

// Contra la base de datos LOCAL; se omite donde no hay (ver testSetup.ts).
const db = testDb()

describe.skipIf(!db)('Panel de RRHH: semanas aprobadas', () => {
  const dbConfig = db!
  const tag = `n${Date.now().toString(36)}`
  const emails = { worker: `nomina-${tag}@example.test`, rrhh: `rrhh-${tag}@example.test` }
  let workerId = 0
  const APPROVED = '2026-10-05' // lunes
  const PENDING = '2026-10-12'
  const payroll = createPayrollService({ db: dbConfig })

  beforeAll(async () => {
    const pool = await getPool(dbConfig)
    workerId = (
      await pool
        .request()
        .input('number', sql.NVarChar(20), `${tag}w`)
        .input('name', sql.NVarChar(200), `Nómina ${tag}`)
        .input('email', sql.NVarChar(254), emails.worker)
        .query<{ id: number }>(
          'INSERT INTO employees (employee_number, full_name, email) OUTPUT INSERTED.id VALUES (@number, @name, @email)',
        )
    ).recordset[0]!.id

    const projectId = (await pool.request().query<{ id: number }>("SELECT id FROM projects WHERE code = 'MX0011000'")).recordset[0]!.id
    // Semana aprobada: lunes 9 h con dieta, martes 8 h inactiva, domingo 4 h.
    // Semana siguiente: lunes aprobado y martes pendiente → no cuenta como aprobada.
    const entries: [string, number, boolean, 'activa' | 'inactiva', 'approved' | 'pending'][] = [
      ['2026-10-05', 9, true, 'activa', 'approved'],
      ['2026-10-06', 8, false, 'inactiva', 'approved'],
      ['2026-10-11', 4, false, 'activa', 'approved'],
      ['2026-10-12', 8, false, 'activa', 'approved'],
      ['2026-10-13', 8, false, 'activa', 'pending'],
    ]
    for (const [date, hours, perDiem, shiftType, status] of entries) {
      const clockIn = mx(`${date}T08:00:00`)
      await pool
        .request()
        .input('employeeId', sql.Int, workerId)
        .input('date', sql.Date, date)
        .input('projectId', sql.Int, projectId)
        .input('shiftType', sql.NVarChar(20), shiftType)
        .input('perDiem', sql.Bit, perDiem)
        .input('clockIn', sql.DateTime2(0), clockIn)
        .input('clockOut', sql.DateTime2(0), new Date(clockIn.getTime() + hours * 3_600_000))
        .input('status', sql.NVarChar(20), status)
        .query(`
          INSERT INTO time_entries (employee_id, work_date, project_id, shift_type, per_diem, clock_in, clock_out, time_zone, status, reviewed_at)
          VALUES (@employeeId, @date, @projectId, @shiftType, @perDiem, @clockIn, @clockOut, 'America/Mexico_City', @status,
                  CASE WHEN @status = 'approved' THEN SYSUTCDATETIME() END)`)
    }
  })

  afterAll(async () => {
    const pool = await getPool(dbConfig)
    await pool.request().input('id', sql.Int, workerId).query('DELETE FROM time_entries WHERE employee_id = @id')
    await pool.request().query(`DELETE FROM employees WHERE email LIKE '%-${tag}@example.test'`)
    await closePool()
  })

  const mine = async () => (await payroll.summary()).filter((row) => row.employeeId === workerId)

  it('solo aparecen las semanas con todas las jornadas aprobadas', async () => {
    const rows = await mine()
    expect(rows.map((row) => row.weekStart)).toEqual([APPROVED])
    expect(rows[0]).toMatchObject({
      employeeNumber: `${tag}w`,
      email: emails.worker,
      weekEnd: '2026-10-11',
      projects: ['MX0011000'],
      totals: { normal: h(16), extra: h(1), sunday: h(4), holiday: 0, total: h(21), perDiems: 1 },
      inactiveDays: 1,
    })
    expect(rows[0]!.approvedAt).toBeInstanceOf(Date)
  })

  it('el detalle trae los días de la semana aprobada; una no aprobada no existe', async () => {
    const week = await payroll.detail(workerId, '2026-10-08')
    expect(week).toMatchObject({ weekStart: APPROVED, status: 'approved', employeeId: workerId })
    expect(week.days.map((day) => day.workDate)).toEqual(['2026-10-05', '2026-10-06', '2026-10-11'])

    await expect(payroll.detail(workerId, PENDING)).rejects.toThrow('no encontrada')
    await expect(payroll.detail(workerId, '2026-09-07')).rejects.toThrow('no encontrada')
  })

  it('el CSV solo incluye las semanas pedidas que están aprobadas', async () => {
    const csv = await payroll.exportCsv([
      { employeeId: workerId, weekStart: APPROVED },
      { employeeId: workerId, weekStart: PENDING },
    ])
    const lines = csv.trim().split('\r\n')
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain(`"2026-10-05 a 2026-10-11","${tag}w"`)
    expect(lines[1]!.endsWith(',16.00,1.00,4.00,0.00,1,1,21.00')).toBe(true)

    await expect(payroll.exportCsv([{ employeeId: workerId, weekStart: PENDING }])).rejects.toThrow('No hay semanas aprobadas')
  })

  describe('por HTTP', () => {
    const config = { devAuth: false, groupIds: { rrhh: 'grupo-rrhh' }, db: dbConfig }
    const server = createApp({ webDist: tmpdir() + '/no-existe', config }).listen(0)
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

    afterAll(() => {
      server.close()
    })

    const call = (groups: string[], method: string, path: string, body?: unknown) =>
      fetch(`${baseUrl}/api/timesheet/payroll${path}`, {
        method,
        headers: {
          [PRINCIPAL_HEADER]: encodePrincipal({ id: emails.rrhh, name: 'RRHH', email: emails.rrhh, groups }),
          'Content-Type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })

    it('solo RRHH entra al panel', async () => {
      expect((await call([], 'GET', '/summary')).status).toBe(403)
      expect((await call([], 'POST', '/export', { weeks: [{ employeeId: workerId, weekStart: APPROVED }] })).status).toBe(403)
      expect((await call(['grupo-rrhh'], 'GET', '/summary')).status).toBe(200)
    })

    it('RRHH no necesita ficha de empleado y entrar no le crea una', async () => {
      await call(['grupo-rrhh'], 'GET', '/summary')
      const pool = await getPool(dbConfig)
      const found = await pool.request().input('email', sql.NVarChar(254), emails.rrhh).query('SELECT 1 FROM employees WHERE email = @email')
      expect(found.recordset).toHaveLength(0)
    })

    it('descarga el CSV como archivo y valida la petición', async () => {
      const res = await call(['grupo-rrhh'], 'POST', '/export', { weeks: [{ employeeId: workerId, weekStart: APPROVED }] })
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('text/csv')
      expect(res.headers.get('content-disposition')).toContain('attachment')
      expect(await res.text()).toContain(`"${tag}w"`)

      expect((await call(['grupo-rrhh'], 'POST', '/export', { weeks: [] })).status).toBe(400)
      expect((await call(['grupo-rrhh'], 'GET', `/week?employeeId=${workerId}&date=${PENDING}`)).status).toBe(404)
      expect((await call(['grupo-rrhh'], 'GET', `/week?employeeId=${workerId}&date=${APPROVED}`)).status).toBe(200)
    })
  })
})
