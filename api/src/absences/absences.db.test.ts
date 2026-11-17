import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import sql from 'mssql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { createApprovalService, type Actor } from '../approvals/service.js'
import { DEV_USER_HEADER } from '../auth/middleware.js'
import { loadConfig } from '../config/env.js'
import { findEmployeeByEmail } from '../db/employees.js'
import { closePool, getPool } from '../db/pool.js'
import { testDb } from '../db/testSetup.js'
import { createAbsenceService, parseAbsence } from './service.js'

const MX = 'America/Mexico_City'

describe('parseAbsence', () => {
  const valid = { type: 'vacation', startDate: '2026-11-23', endDate: '2026-11-28' }

  it('acepta una solicitud correcta y limpia el comentario', () => {
    expect(parseAbsence({ ...valid, comment: '  viaje  ' })).toEqual({ ...valid, comment: 'viaje' })
    expect(parseAbsence(valid).comment).toBeNull()
  })

  it.each([
    ['tipo desconocido', { ...valid, type: 'permiso' }],
    ['fecha que no existe', { ...valid, startDate: '2026-02-30' }],
    ['rango al revés', { ...valid, endDate: '2026-11-20' }],
    ['rango de más de un año', { ...valid, endDate: '2028-01-01' }],
    ['comentario que no es texto', { ...valid, comment: 5 }],
    ['cuerpo vacío', null],
  ])('rechaza: %s', (_caso, body) => {
    expect(() => parseAbsence(body)).toThrow()
  })
})

// Contra la base de datos LOCAL; se omite donde no hay (ver testSetup.ts).
const db = testDb()

describe.skipIf(!db)('Vacaciones y ausentismos del colaborador', () => {
  const dbConfig = db!
  const tag = `v${Date.now().toString(36)}`
  const approvals = createApprovalService({ db: dbConfig, includeDemo: false, notifier: () => undefined })
  // «Hoy» es el lunes 16 de noviembre de 2026 a mediodía en el centro de México.
  const service = createAbsenceService({ db: dbConfig, approvals, now: () => new Date('2026-11-16T18:00:00Z') })

  let bossId = 0
  let workerId = 0 // con supervisor y fecha de ingreso 2026-03-10 (año de servicio 1: 12 días)
  let lonerId = 0 // sin supervisor
  let newcomerId = 0 // sin fecha de ingreso
  let boss: Actor
  let worker: Actor
  let hr: Actor

  const vacation = (startDate: string, endDate: string) => ({ type: 'vacation' as const, startDate, endDate, comment: null })
  const balanceOf = async (id: number) => (await service.overview(id, MX)).balance

  beforeAll(async () => {
    const pool = await getPool(dbConfig)
    const insert = async (name: string, hireDate: string | null, supervisorId: number | null) =>
      (
        await pool
          .request()
          .input('number', sql.NVarChar(20), `${tag}${name}`.slice(0, 20))
          .input('email', sql.NVarChar(254), `${name}-${tag}@example.test`)
          .input('hireDate', sql.Date, hireDate)
          .input('supervisorId', sql.Int, supervisorId)
          .query<{ id: number }>(`
            INSERT INTO employees (employee_number, full_name, email, hire_date, supervisor_id)
            OUTPUT INSERTED.id VALUES (@number, 'Ausencias de Prueba', @email, @hireDate, @supervisorId)`)
      ).recordset[0]!.id
    bossId = await insert('jefe', '2019-03-04', null)
    workerId = await insert('tec', '2026-03-10', bossId)
    lonerId = await insert('solo', '2026-03-10', null)
    newcomerId = await insert('nuevo', null, bossId)

    boss = { employeeId: bossId, roles: ['colaborador', 'supervisor'] }
    worker = { employeeId: workerId, roles: ['colaborador'] }
    const hrEmployee = await findEmployeeByEmail(dbConfig, 'rrhh@example.test')
    if (!hrEmployee) throw new Error('Falta el empleado de prueba de RRHH')
    hr = { employeeId: hrEmployee.id, roles: ['colaborador', 'rrhh'] }
  })

  afterAll(async () => {
    const pool = await getPool(dbConfig)
    const mine = `SELECT id FROM employees WHERE email LIKE '%-${tag}@example.test'`
    await pool.request().query(`
      DELETE FROM absence_days WHERE request_id IN (SELECT id FROM absence_requests WHERE employee_id IN (${mine}));
      DELETE FROM absence_requests WHERE employee_id IN (${mine});
      DELETE FROM approval_actions WHERE request_id IN (SELECT id FROM approval_requests WHERE requester_id IN (${mine}));
      DELETE FROM approval_requests WHERE requester_id IN (${mine});
      UPDATE employees SET supervisor_id = NULL WHERE email LIKE '%-${tag}@example.test';
      DELETE FROM employees WHERE email LIKE '%-${tag}@example.test';`)
    await closePool()
  })

  /** Id de la aprobación de una solicitud de ausencia. */
  const approvalOf = async (absenceId: number): Promise<number> => {
    const pool = await getPool(dbConfig)
    const result = await pool
      .request()
      .input('id', sql.Int, absenceId)
      .query<{ id: number }>('SELECT approval_request_id AS id FROM absence_requests WHERE id = @id')
    return result.recordset[0]!.id
  }

  it('el primer año tiene los 12 días desde el ingreso', async () => {
    const overview = await service.overview(workerId, MX)
    expect(overview).toMatchObject({ today: '2026-11-16', hireDate: '2026-03-10', requests: [] })
    expect(overview.balance).toMatchObject({ number: 1, entitlement: 12, available: 12, end: '2027-03-09' })
  })

  it('la vista previa cuenta de lunes a sábado y avisa si no alcanza', async () => {
    // Del lunes 23 al domingo 29 de noviembre: 6 días laborables.
    const ok = await service.preview(workerId, vacation('2026-11-23', '2026-11-29'), MX)
    expect(ok).toMatchObject({ days: 6, problem: null })
    expect(ok.years[0]).toMatchObject({ number: 1, available: 12, requested: 6, shortage: 0 })

    const tooMany = await service.preview(workerId, vacation('2026-11-23', '2026-12-12'), MX)
    expect(tooMany.problem).toContain('Saldo insuficiente')
  })

  it('una solicitud reserva saldo, no admite solapes y se puede cancelar mientras está pendiente', async () => {
    const created = await service.create(workerId, vacation('2026-11-23', '2026-11-28'), MX)
    expect(created).toMatchObject({ type: 'vacation', days: 6, status: 'pending_supervisor', canCancel: true })
    expect(await balanceOf(workerId)).toMatchObject({ used: 0, reserved: 6, available: 6 })

    // Mismo día otra vez, y un periodo de 7 días cuando quedan 6.
    await expect(service.create(workerId, vacation('2026-11-28', '2026-11-30'), MX)).rejects.toThrow('Ya tienes vacaciones')
    await expect(service.create(workerId, vacation('2026-11-30', '2026-12-07'), MX)).rejects.toThrow('Saldo insuficiente')

    // Nadie más puede cancelarla.
    await expect(service.cancel(boss, created.id)).rejects.toThrow('Solicitud no encontrada')

    expect(await service.cancel(worker, created.id)).toMatchObject({ status: 'cancelled', canCancel: false })
    expect(await balanceOf(workerId)).toMatchObject({ reserved: 0, available: 12 })
    await expect(service.cancel(worker, created.id)).rejects.toThrow('Solo se puede cancelar una solicitud pendiente')
  })

  it('pasa por el supervisor y por RRHH; al aprobarse descuenta el saldo y ya no la cancela el colaborador', async () => {
    const created = await service.create(workerId, vacation('2026-12-01', '2026-12-03'), MX)
    const approvalId = await approvalOf(created.id)

    await approvals.decide(approvalId, boss, 'approve')
    expect((await service.overview(workerId, MX)).requests[0]).toMatchObject({ status: 'pending_hr', canCancel: true })

    await approvals.decide(approvalId, hr, 'approve')
    expect((await service.overview(workerId, MX)).requests[0]).toMatchObject({ status: 'approved', canCancel: false })
    expect(await balanceOf(workerId)).toMatchObject({ used: 3, reserved: 0, available: 9 })
    await expect(service.cancel(worker, created.id)).rejects.toThrow('Solo se puede cancelar una solicitud pendiente')
  })

  it('un rechazo es definitivo, muestra el motivo y devuelve el saldo', async () => {
    const before = await balanceOf(workerId)
    const created = await service.create(workerId, vacation('2026-12-14', '2026-12-15'), MX)
    await approvals.decide(await approvalOf(created.id), boss, 'reject', 'Cierre de proyecto esa semana')

    const rejected = (await service.overview(workerId, MX)).requests[0]
    expect(rejected).toMatchObject({ status: 'rejected', reason: 'Cierre de proyecto esa semana', canCancel: false })
    expect((await balanceOf(workerId))?.available).toBe(before?.available)
  })

  it('las vacaciones no se piden para fechas pasadas', async () => {
    await expect(service.create(workerId, vacation('2026-11-10', '2026-11-11'), MX)).rejects.toThrow('fechas pasadas')
  })

  it('quien no tiene supervisor va directo a RRHH', async () => {
    const created = await service.create(lonerId, vacation('2026-11-24', '2026-11-25'), MX)
    expect(created.status).toBe('pending_hr')
    await approvals.decide(await approvalOf(created.id), hr, 'approve')
    expect((await service.overview(lonerId, MX)).requests[0]?.status).toBe('approved')
  })

  it('sin fecha de ingreso no hay vacaciones, pero sí incapacidad', async () => {
    expect((await service.overview(newcomerId, MX)).balance).toBeNull()
    await expect(service.create(newcomerId, vacation('2026-11-24', '2026-11-25'), MX)).rejects.toThrow('fecha de ingreso')

    // La incapacidad admite fechas pasadas y cuenta días naturales (sábado 7 a lunes 9).
    const sick = await service.create(
      newcomerId,
      { type: 'sick_leave', startDate: '2026-11-07', endDate: '2026-11-09', comment: 'Gripe' },
      MX,
    )
    expect(sick).toMatchObject({ type: 'sick_leave', days: 3, status: 'pending_supervisor', comment: 'Gripe' })
    await expect(
      service.create(newcomerId, { type: 'sick_leave', startDate: '2026-11-09', endDate: '2026-11-10', comment: null }, MX),
    ).rejects.toThrow('Ya tienes una incapacidad')
  })
})

describe.skipIf(!db)('Ausencias por HTTP', () => {
  const dbConfig = db!
  const config = { ...loadConfig({ DEV_AUTH: 'true' }), db: dbConfig }
  const server = createApp({ webDist: tmpdir() + '/no-existe', config }).listen(0)
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  afterAll(() => {
    server.close()
  })

  const call = async (devUser: string, method: string, path: string, body?: unknown) => {
    const res = await fetch(`${baseUrl}/api/absences${path}`, {
      method,
      headers: { [DEV_USER_HEADER]: devUser, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { status: res.status, body: (await res.json()) as any }
  }

  it('cada uno ve lo suyo; datos inválidos dan 400 y una solicitud ajena o inexistente 404', async () => {
    const mine = await call('dev-colaborador', 'GET', `/mine?timeZone=${encodeURIComponent(MX)}`)
    expect(mine.status).toBe(200)
    expect(Array.isArray(mine.body.requests)).toBe(true)

    expect((await call('dev-colaborador', 'POST', '/', { type: 'permiso' })).status).toBe(400)
    expect((await call('dev-colaborador', 'POST', '/preview', { type: 'vacation', startDate: 'ayer', endDate: 'hoy' })).status).toBe(400)
    expect((await call('dev-colaborador', 'POST', '/999999999/cancel')).status).toBe(404)
    expect((await call('dev-colaborador', 'POST', '/abc/cancel')).status).toBe(404)
  })
})
