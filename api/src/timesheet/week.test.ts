import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import sql from 'mssql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { createApprovalService } from '../approvals/service.js'
import { encodePrincipal, PRINCIPAL_HEADER } from '../auth/principal.js'
import { closePool, getPool } from '../db/pool.js'
import { testDb } from '../db/testSetup.js'
import { createTimesheetService } from './service.js'

const MX = 'America/Mexico_City'
const mx = (local: string) => new Date(`${local}-06:00`)
const h = (hours: number) => hours * 60

// Contra la base de datos LOCAL; se omite donde no hay (ver testSetup.ts).
const db = testDb()

describe.skipIf(!db)('Mi semana', () => {
  const dbConfig = db!
  const tag = `w${Date.now().toString(36)}`
  const email = `semana-${tag}@example.test`
  const otherEmail = `otro-${tag}@example.test`
  let employeeId = 0
  let otherId = 0
  let projectId = 0
  const entryIds: Record<string, number> = {}

  const approvals = createApprovalService({ db: dbConfig, includeDemo: false, notifier: () => undefined })
  const service = createTimesheetService({ db: dbConfig, approvals, now: () => mx('2026-11-25T10:00:00') })

  // Semana del 16 al 22 de noviembre de 2026. El lunes 16 es festivo (Día de la Revolución).
  const ENTRIES: [date: string, hours: number | null, perDiem: boolean, status: string][] = [
    ['2026-11-16', 9, true, 'approved'], // festivo
    ['2026-11-17', 8.5, true, 'approved'], // martes
    ['2026-11-18', 7, false, 'approved'], // miércoles
    ['2026-11-20', null, false, 'pending'], // viernes sin salida
    ['2026-11-21', 5, false, 'approved'], // sábado
    ['2026-11-22', 6, true, 'approved'], // domingo
    ['2026-11-09', 8, false, 'approved'], // otra semana
  ]

  beforeAll(async () => {
    const pool = await getPool(dbConfig)
    const insertEmployee = async (number: string, address: string) =>
      (
        await pool
          .request()
          .input('number', sql.NVarChar(20), number)
          .input('email', sql.NVarChar(254), address)
          .query<{ id: number }>(
            "INSERT INTO employees (employee_number, full_name, email) OUTPUT INSERTED.id VALUES (@number, 'Semana de Prueba', @email)",
          )
      ).recordset[0]!.id
    employeeId = await insertEmployee(`${tag}a`, email)
    otherId = await insertEmployee(`${tag}b`, otherEmail)
    projectId = (await pool.request().query<{ id: number }>("SELECT id FROM projects WHERE code = 'MX0011000'")).recordset[0]!.id

    for (const [date, hours, perDiem, status] of ENTRIES) {
      const clockIn = mx(`${date}T08:00:00`)
      const result = await pool
        .request()
        .input('employeeId', sql.Int, employeeId)
        .input('date', sql.Date, date)
        .input('projectId', sql.Int, projectId)
        .input('perDiem', sql.Bit, perDiem)
        .input('clockIn', sql.DateTime2(0), clockIn)
        .input('clockOut', sql.DateTime2(0), hours === null ? null : new Date(clockIn.getTime() + hours * 3_600_000))
        .input('status', sql.NVarChar(10), status)
        .query<{ id: number }>(`
          INSERT INTO time_entries (employee_id, work_date, project_id, shift_type, per_diem, clock_in, clock_out, time_zone, status)
          OUTPUT INSERTED.id
          VALUES (@employeeId, @date, @projectId, 'activa', @perDiem, @clockIn, @clockOut, 'America/Mexico_City', @status)`)
      entryIds[date] = result.recordset[0]!.id
    }
  })

  afterAll(async () => {
    const pool = await getPool(dbConfig)
    await pool.request().input('id', sql.Int, employeeId).query('DELETE FROM time_entries WHERE employee_id = @id')
    await pool.request().query(`DELETE FROM employees WHERE email LIKE '%-${tag}@example.test'`)
    await closePool()
  })

  it('devuelve la semana de lunes a domingo con el consolidado', async () => {
    // Cualquier día de la semana sirve para pedirla
    const week = await service.week(employeeId, '2026-11-19')
    expect(week).toMatchObject({ weekStart: '2026-11-16', weekEnd: '2026-11-22' })
    expect(week.totals).toEqual({
      normal: h(15), // 8 del martes + 7 del miércoles
      extra: h(5.5), // 0,5 del martes + 5 del sábado
      sunday: h(6),
      holiday: h(9),
      total: h(35.5),
      perDiems: 3,
    })
    expect(week.days.map((day) => day.workDate)).toEqual([
      '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-20', '2026-11-21', '2026-11-22',
    ])
  })

  it('cada día lleva su tipo, sus horas y sus datos', async () => {
    const week = await service.week(employeeId, '2026-11-16')
    const byDate = Object.fromEntries(week.days.map((day) => [day.workDate, day]))

    expect(byDate['2026-11-16']).toMatchObject({ kind: 'holiday', holiday: h(9), normal: 0, projectCode: 'MX0011000' })
    expect(byDate['2026-11-17']).toMatchObject({ kind: 'weekday', normal: h(8), extra: h(0.5), perDiem: true })
    expect(byDate['2026-11-20']).toMatchObject({ complete: false, total: 0, clockOut: null })
    expect(byDate['2026-11-21']).toMatchObject({ kind: 'saturday', extra: h(5) })
    expect(byDate['2026-11-22']).toMatchObject({ kind: 'sunday', sunday: h(6) })
  })

  it('el estado de la semana sale del de sus días', async () => {
    // Un día pendiente deja la semana pendiente
    expect((await service.week(employeeId, '2026-11-16')).status).toBe('pending')
    // Todos aprobados
    expect((await service.week(employeeId, '2026-11-09')).status).toBe('approved')

    const pool = await getPool(dbConfig)
    await pool.request().input('id', sql.Int, entryIds['2026-11-18']!).query("UPDATE time_entries SET status = 'rejected' WHERE id = @id")
    expect((await service.week(employeeId, '2026-11-16')).status).toBe('rejected')
  })

  it('una semana sin jornadas viene vacía', async () => {
    expect(await service.week(employeeId, '2026-12-01')).toEqual({
      weekStart: '2026-11-30',
      weekEnd: '2026-12-06',
      status: null,
      totals: { normal: 0, extra: 0, sunday: 0, holiday: 0, total: 0, perDiems: 0 },
      days: [],
    })
  })

  it('lista las semanas con jornadas y la actual, de la más reciente a la más antigua', async () => {
    expect(await service.weeks(employeeId, MX)).toEqual({
      current: '2026-11-23',
      weeks: ['2026-11-23', '2026-11-16', '2026-11-09'],
      // La prueba anterior dejó un día rechazado en la semana del 16
      rejectedWeeks: ['2026-11-16'],
    })
  })

  it('el comentario de un día se cambia si es propio y no está aprobado', async () => {
    const pending = entryIds['2026-11-20']!
    await service.setEntryComment(employeeId, pending, 'Olvidé fichar la salida')
    const week = await service.week(employeeId, '2026-11-20')
    expect(week.days.find((day) => day.id === pending)?.comment).toBe('Olvidé fichar la salida')

    await expect(service.setEntryComment(employeeId, entryIds['2026-11-17']!, 'x')).rejects.toThrow('aprobada')
    // La jornada de otra persona no existe para mí
    await expect(service.setEntryComment(otherId, pending, 'x')).rejects.toThrow('no encontrada')
  })

  describe('por HTTP', () => {
    const config = { devAuth: false, groupIds: {}, db: dbConfig }
    const server = createApp({ webDist: tmpdir() + '/no-existe', config }).listen(0)
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

    afterAll(() => {
      server.close()
    })

    const call = async (userEmail: string, method: string, path: string, body?: unknown) => {
      const res = await fetch(`${baseUrl}/api/timesheet${path}`, {
        method,
        headers: {
          [PRINCIPAL_HEADER]: encodePrincipal({ id: userEmail, name: 'x', email: userEmail, groups: [] }),
          'Content-Type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      return { status: res.status, body: (await res.json()) as any }
    }

    it('cada uno ve solo su semana', async () => {
      const mine = await call(email, 'GET', '/week?date=2026-11-16')
      expect(mine.status).toBe(200)
      expect(mine.body.days).toHaveLength(6)

      const other = await call(otherEmail, 'GET', '/week?date=2026-11-16')
      expect(other.body.days).toEqual([])

      expect((await call(email, 'GET', '/week?date=2026-13-40')).status).toBe(400)
      expect((await call(email, 'GET', '/week')).status).toBe(400)
      expect((await call(email, 'GET', `/weeks?timeZone=${MX}`)).body.weeks).toContain('2026-11-16')
    })

    it('no se puede comentar la jornada de otra persona', async () => {
      const path = `/entries/${entryIds['2026-11-20']}/comment`
      expect((await call(otherEmail, 'PUT', path, { comment: 'intruso' })).status).toBe(404)
      expect((await call(email, 'PUT', path, { comment: 'mío' })).status).toBe(200)
      expect((await call(email, 'PUT', '/entries/abc/comment', { comment: 'x' })).status).toBe(404)
    })
  })
})
