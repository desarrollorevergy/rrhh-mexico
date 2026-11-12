import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import sql from 'mssql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { encodePrincipal, PRINCIPAL_HEADER } from '../auth/principal.js'
import { closePool, getPool } from '../db/pool.js'
import { testDb } from '../db/testSetup.js'
import { createTimesheetService, parseClockIn } from './service.js'
import { isValidTimeZone, localParts, resolveActiveShift } from './shift.js'

const MX = 'America/Mexico_City' // UTC−6, sin horario de verano
const SONORA = 'America/Hermosillo' // UTC−7

/** Instante a partir de una hora local de Ciudad de México. */
const mx = (local: string) => new Date(`${local}-06:00`)

describe('zona horaria y día de la jornada', () => {
  it('reconoce zonas horarias válidas', () => {
    expect(isValidTimeZone(MX)).toBe(true)
    expect(isValidTimeZone('Marte/Olympus')).toBe(false)
    expect(isValidTimeZone('')).toBe(false)
    expect(isValidTimeZone(undefined)).toBe(false)
  })

  it('el mismo instante cae en días distintos según la zona', () => {
    // 00:30 del martes en Ciudad de México = 23:30 del lunes en Sonora
    const instant = mx('2026-11-10T00:30:00')
    expect(localParts(instant, MX)).toEqual({ date: '2026-11-10', hour: 0 })
    expect(localParts(instant, SONORA)).toEqual({ date: '2026-11-09', hour: 23 })
    // En UTC ya son las 06:30
    expect(localParts(instant, 'UTC')).toEqual({ date: '2026-11-10', hour: 6 })
  })
})

describe('jornada activa (regla de medianoche)', () => {
  const open = { clockOut: null }
  const active = (local: string, today?: { clockOut: Date | null }, yesterday?: { clockOut: Date | null }) =>
    resolveActiveShift({ now: mx(local), timeZone: MX, today, yesterday })

  it('sin jornadas, la activa es la de hoy', () => {
    expect(active('2026-11-10T07:00:00')).toEqual({ workDate: '2026-11-10', isYesterday: false })
  })

  it('antes de las 08:00, la jornada de ayer abierta sigue siendo la activa', () => {
    expect(active('2026-11-10T02:15:00', undefined, open)).toEqual({ workDate: '2026-11-09', isYesterday: true })
    expect(active('2026-11-10T07:59:00', undefined, open)).toEqual({ workDate: '2026-11-09', isYesterday: true })
  })

  it('desde las 08:00 la activa es la de hoy, aunque la de ayer siga abierta', () => {
    expect(active('2026-11-10T08:00:00', undefined, open)).toEqual({ workDate: '2026-11-10', isYesterday: false })
  })

  it('la de ayer cerrada de madrugada se sigue mostrando hasta las 08:00', () => {
    const closedAfterMidnight = { clockOut: mx('2026-11-10T01:00:00') }
    expect(active('2026-11-10T03:00:00', undefined, closedAfterMidnight).isYesterday).toBe(true)
  })

  it('la de ayer cerrada ayer no afecta', () => {
    const closedYesterday = { clockOut: mx('2026-11-09T18:00:00') }
    expect(active('2026-11-10T06:00:00', undefined, closedYesterday)).toEqual({
      workDate: '2026-11-10',
      isYesterday: false,
    })
  })

  it('si ya fichó hoy, manda la de hoy', () => {
    expect(active('2026-11-10T06:30:00', open, open)).toEqual({ workDate: '2026-11-10', isYesterday: false })
  })
})

describe('parseClockIn', () => {
  it('exige proyecto y tipo de jornada', () => {
    expect(() => parseClockIn({ shiftType: 'activa' })).toThrow('analítica')
    expect(() => parseClockIn({ projectId: 1 })).toThrow('tipo de jornada')
    expect(() => parseClockIn({ projectId: 1, shiftType: 'Teletrabajo' })).toThrow('tipo de jornada')
  })

  it('normaliza dieta y comentario', () => {
    expect(parseClockIn({ projectId: 3, shiftType: 'inactiva', perDiem: 'sí', comment: '  ' })).toEqual({
      projectId: 3,
      shiftType: 'inactiva',
      perDiem: false,
      comment: null,
    })
    expect(parseClockIn({ projectId: 3, shiftType: 'activa', perDiem: true, comment: ' ok ' }).comment).toBe('ok')
  })
})

// Contra la base de datos LOCAL; se omite donde no hay (ver testSetup.ts).
const db = testDb()

describe.skipIf(!db)('Fichaje con base de datos', () => {
  const dbConfig = db!
  const tag = `f${Date.now().toString(36)}`
  const email = `fichaje-${tag}@example.test`
  let employeeId = 0
  let projectId = 0
  let inactiveProjectId = 0

  // Reloj controlado por la prueba.
  let clock = mx('2026-11-09T08:00:00')
  const service = createTimesheetService({ db: dbConfig, now: () => clock })

  const input = () => ({ projectId, shiftType: 'activa' as const, perDiem: true, comment: null })

  beforeAll(async () => {
    const pool = await getPool(dbConfig)
    const employee = await pool
      .request()
      .input('number', sql.NVarChar(20), tag)
      .input('email', sql.NVarChar(254), email)
      .query<{ id: number }>(
        "INSERT INTO employees (employee_number, full_name, email) OUTPUT INSERTED.id VALUES (@number, 'Fichaje de Prueba', @email)",
      )
    employeeId = employee.recordset[0]!.id
    projectId = (await pool.request().query<{ id: number }>("SELECT id FROM projects WHERE code = 'MX0011000'")).recordset[0]!.id
    inactiveProjectId = (
      await pool
        .request()
        .input('code', sql.NVarChar(20), `X${tag}`.slice(0, 20))
        .query<{ id: number }>('INSERT INTO projects (code, is_active) OUTPUT INSERTED.id VALUES (@code, 0)')
    ).recordset[0]!.id
  })

  afterAll(async () => {
    const pool = await getPool(dbConfig)
    await pool.request().input('id', sql.Int, employeeId).query('DELETE FROM time_entries WHERE employee_id = @id')
    await pool.request().input('id', sql.Int, employeeId).query('DELETE FROM employees WHERE id = @id')
    await pool.request().input('id', sql.Int, inactiveProjectId).query('DELETE FROM projects WHERE id = @id')
    await closePool()
  })

  it('entrada, espera y salida: un registro por día con la hora del servidor', async () => {
    clock = mx('2026-11-09T08:03:20')
    expect(await service.today(employeeId, MX)).toEqual({ workDate: '2026-11-09', isYesterday: false, entry: null })

    // No se puede fichar salida sin entrada
    await expect(service.clockOut(employeeId, MX)).rejects.toThrow('sin haber fichado la entrada')

    const afterIn = await service.clockIn(employeeId, MX, input())
    expect(afterIn.entry).toMatchObject({
      workDate: '2026-11-09',
      projectCode: 'MX0011000',
      projectName: 'GERENCIA',
      shiftType: 'activa',
      perDiem: true,
      clockOut: null,
      status: 'pending',
    })
    expect(afterIn.entry?.clockIn.toISOString()).toBe(clock.toISOString())

    // Un solo registro por día
    await expect(service.clockIn(employeeId, MX, input())).rejects.toThrow('Ya fichaste la entrada')

    clock = mx('2026-11-09T17:31:00')
    const afterOut = await service.clockOut(employeeId, MX)
    expect(afterOut.entry?.clockOut?.toISOString()).toBe(clock.toISOString())

    await expect(service.clockOut(employeeId, MX)).rejects.toThrow('Ya fichaste la salida')
    await expect(service.clockIn(employeeId, MX, input())).rejects.toThrow('Ya fichaste la entrada')
  })

  it('el comentario se puede añadir y quitar mientras no esté aprobada', async () => {
    clock = mx('2026-11-09T18:00:00')
    expect((await service.setComment(employeeId, MX, 'Salí tarde por una avería')).entry?.comment).toBe(
      'Salí tarde por una avería',
    )
    expect((await service.setComment(employeeId, MX, null)).entry?.comment).toBeNull()

    const pool = await getPool(dbConfig)
    await pool.request().input('id', sql.Int, employeeId).query("UPDATE time_entries SET status = 'approved' WHERE employee_id = @id")
    await expect(service.setComment(employeeId, MX, 'cambio')).rejects.toThrow('aprobada')
  })

  it('una jornada nocturna se cierra sobre el día de la entrada', async () => {
    clock = mx('2026-11-10T22:00:00')
    await service.clockIn(employeeId, MX, { ...input(), perDiem: false })

    // A las 05:30 del día siguiente la jornada activa sigue siendo la de ayer
    clock = mx('2026-11-11T05:30:00')
    const during = await service.today(employeeId, MX)
    expect(during).toMatchObject({ workDate: '2026-11-10', isYesterday: true })
    await expect(service.clockIn(employeeId, MX, input())).rejects.toThrow('ficha primero la salida')

    const closed = await service.clockOut(employeeId, MX)
    expect(closed.entry).toMatchObject({ workDate: '2026-11-10' })
    expect(closed.isYesterday).toBe(true)

    // Hasta las 08:00 se sigue viendo la de ayer; después ya se puede fichar la de hoy
    await expect(service.clockIn(employeeId, MX, input())).rejects.toThrow('a partir de las 08:00')
    clock = mx('2026-11-11T08:00:00')
    expect((await service.clockIn(employeeId, MX, input())).entry?.workDate).toBe('2026-11-11')
  })

  it('una jornada olvidada no bloquea el día siguiente a partir de las 08:00', async () => {
    // La del día 11 quedó abierta. A las 09:00 del 12 se ficha una nueva.
    clock = mx('2026-11-12T09:00:00')
    expect(await service.today(employeeId, MX)).toMatchObject({ workDate: '2026-11-12', entry: null })
    expect((await service.clockIn(employeeId, MX, input())).entry?.workDate).toBe('2026-11-12')
  })

  it('el día de la jornada depende de la zona horaria del colaborador', async () => {
    // 00:30 del 14 en Ciudad de México todavía es día 13 en Sonora
    clock = mx('2026-11-14T00:30:00')
    expect((await service.today(employeeId, SONORA)).workDate).toBe('2026-11-13')
    expect((await service.clockIn(employeeId, SONORA, input())).entry?.workDate).toBe('2026-11-13')
  })

  it('no deja fichar con una analítica inactiva o inexistente', async () => {
    clock = mx('2026-11-16T08:00:00')
    await expect(service.clockIn(employeeId, MX, { ...input(), projectId: inactiveProjectId })).rejects.toThrow('inactiva')
    await expect(service.clockIn(employeeId, MX, { ...input(), projectId: 999_999_999 })).rejects.toThrow('no existe')
  })

  it('dos entradas a la vez: solo se registra una', async () => {
    clock = mx('2026-11-17T08:00:00')
    const results = await Promise.allSettled([
      service.clockIn(employeeId, MX, input()),
      service.clockIn(employeeId, MX, input()),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
  })

  describe('por HTTP', () => {
    // Como en producción: sin autenticación simulada; la identidad llega en la cabecera de App Service.
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

    it('ficha con la hora real del servidor y valida lo que llega', async () => {
      const pool = await getPool(dbConfig)
      // Deja libre el día de hoy para este empleado
      const today = localParts(new Date(), MX).date
      await pool
        .request()
        .input('id', sql.Int, employeeId)
        .input('date', sql.Date, today)
        .query('DELETE FROM time_entries WHERE employee_id = @id AND work_date IN (@date, DATEADD(day, -1, @date))')

      expect((await call(email, 'GET', '/today')).status).toBe(400) // falta la zona horaria
      expect((await call(email, 'GET', '/today?timeZone=Marte/Olympus')).status).toBe(400)
      expect((await call(email, 'POST', '/clock-out', { timeZone: MX })).status).toBe(409)
      expect((await call(email, 'POST', '/clock-in', { timeZone: MX, shiftType: 'activa' })).status).toBe(400)

      const before = Date.now()
      const clockIn = await call(email, 'POST', '/clock-in', { timeZone: MX, projectId, shiftType: 'inactiva', perDiem: false })
      expect(clockIn.status).toBe(200)
      expect(clockIn.body.entry).toMatchObject({ shiftType: 'inactiva', clockOut: null })
      // La hora la puso el servidor en el momento de la llamada (precisión de segundos)
      const stored = new Date(clockIn.body.entry.clockIn).getTime()
      expect(stored).toBeGreaterThanOrEqual(before - 1000)
      expect(stored).toBeLessThanOrEqual(Date.now() + 1000)

      expect((await call(email, 'POST', '/clock-in', { timeZone: MX, projectId, shiftType: 'activa' })).status).toBe(409)
      expect((await call(email, 'PUT', '/today/comment', { timeZone: MX, comment: 'nota' })).body.entry.comment).toBe('nota')
      expect((await call(email, 'POST', '/clock-out', { timeZone: MX })).body.entry.clockOut).not.toBeNull()
    })

    it('quien no tiene ficha de empleado no puede fichar', async () => {
      const res = await call(`sin-ficha-${tag}@example.test`, 'GET', `/today?timeZone=${MX}`)
      expect(res.status).toBe(403)
      expect(res.body.error).toContain('ficha de empleado')
    })
  })
})
