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
import { createAbsenceReviewService, parseAdjustment } from './review.js'
import { createAbsenceService } from './service.js'

const MX = 'America/Mexico_City'

describe('parseAdjustment', () => {
  it('exige días enteros distintos de cero y motivo', () => {
    expect(parseAdjustment({ days: -2, reason: ' Días tomados antes del sistema ' })).toEqual({
      days: -2,
      reason: 'Días tomados antes del sistema',
    })
    expect(() => parseAdjustment({ days: 0, reason: 'x' })).toThrow()
    expect(() => parseAdjustment({ days: 1.5, reason: 'x' })).toThrow()
    expect(() => parseAdjustment({ days: 500, reason: 'x' })).toThrow()
    expect(() => parseAdjustment({ days: 2, reason: '  ' })).toThrow('motivo')
  })
})

// Contra la base de datos LOCAL; se omite donde no hay (ver testSetup.ts).
const db = testDb()

describe.skipIf(!db)('Revisión de ausencias: supervisor y RRHH', () => {
  const dbConfig = db!
  const tag = `r${Date.now().toString(36)}`
  const approvals = createApprovalService({ db: dbConfig, includeDemo: false, notifier: () => undefined })
  // «Hoy» es el lunes 16 de noviembre de 2026 a mediodía en el centro de México.
  const clock = () => new Date('2026-11-16T18:00:00Z')
  const service = createAbsenceService({ db: dbConfig, approvals, now: clock })
  const review = createAbsenceReviewService({ db: dbConfig, approvals, now: clock })

  let workerId = 0 // con supervisor; ingreso 2026-03-10 (12 días)
  let lonerId = 0 // sin supervisor: va directo a RRHH
  let newcomerId = 0 // sin fecha de ingreso
  let boss: Actor
  let otherBoss: Actor
  let worker: Actor
  let hr: Actor
  let admin: Actor

  const vacation = (startDate: string, endDate: string) => ({ type: 'vacation' as const, startDate, endDate, comment: null })
  const idsOf = async (actor: Actor) => (await review.list(actor)).map((item) => item.id)
  const find = async (actor: Actor, id: number) => (await review.list(actor)).find((item) => item.id === id)
  const balanceOf = async (id: number) => (await service.overview(id, MX)).balance

  beforeAll(async () => {
    const pool = await getPool(dbConfig)
    const insert = async (name: string, hireDate: string | null, supervisorId: number | null) =>
      (
        await pool
          .request()
          .input('number', sql.NVarChar(20), `${tag}${name}`.slice(0, 20))
          .input('name', sql.NVarChar(200), `${name} ${tag}`)
          .input('email', sql.NVarChar(254), `${name}-${tag}@example.test`)
          .input('hireDate', sql.Date, hireDate)
          .input('supervisorId', sql.Int, supervisorId)
          .query<{ id: number }>(`
            INSERT INTO employees (employee_number, full_name, email, hire_date, supervisor_id)
            OUTPUT INSERTED.id VALUES (@number, @name, @email, @hireDate, @supervisorId)`)
      ).recordset[0]!.id
    const bossId = await insert('jefe', '2019-03-04', null)
    const otherBossId = await insert('otrojefe', '2019-03-04', null)
    workerId = await insert('tec', '2026-03-10', bossId)
    lonerId = await insert('solo', '2026-03-10', null)
    newcomerId = await insert('nuevo', null, bossId)

    boss = { employeeId: bossId, roles: ['colaborador', 'supervisor'] }
    otherBoss = { employeeId: otherBossId, roles: ['colaborador', 'supervisor'] }
    worker = { employeeId: workerId, roles: ['colaborador'] }
    const employeeOf = async (email: string) => {
      const employee = await findEmployeeByEmail(dbConfig, email)
      if (!employee) throw new Error(`Falta el empleado de prueba ${email}`)
      return employee.id
    }
    hr = { employeeId: await employeeOf('rrhh@example.test'), roles: ['colaborador', 'rrhh'] }
    admin = { employeeId: await employeeOf('admin@example.test'), roles: ['colaborador', 'admin'] }
  })

  afterAll(async () => {
    const pool = await getPool(dbConfig)
    const mine = `SELECT id FROM employees WHERE email LIKE '%-${tag}@example.test'`
    await pool.request().query(`
      DELETE FROM vacation_adjustments WHERE employee_id IN (${mine});
      DELETE FROM absence_days WHERE request_id IN (SELECT id FROM absence_requests WHERE employee_id IN (${mine}));
      DELETE FROM absence_requests WHERE employee_id IN (${mine});
      DELETE FROM approval_actions WHERE request_id IN (SELECT id FROM approval_requests WHERE requester_id IN (${mine}));
      DELETE FROM approval_requests WHERE requester_id IN (${mine});
      UPDATE employees SET supervisor_id = NULL WHERE email LIKE '%-${tag}@example.test';
      DELETE FROM employees WHERE email LIKE '%-${tag}@example.test';`)
    await closePool()
  })

  it('cada uno ve lo que le corresponde y solo decide en su paso', async () => {
    const team = await service.create(workerId, vacation('2026-11-23', '2026-11-25'), MX)
    const direct = await service.create(lonerId, vacation('2026-11-23', '2026-11-24'), MX)

    // El supervisor ve a su equipo directo; otro supervisor y un colaborador, nada de esto.
    expect(await idsOf(boss)).toEqual([team.id])
    expect(await idsOf(otherBoss)).toEqual([])
    expect(await idsOf(worker)).toEqual([])
    expect(await find(boss, team.id)).toMatchObject({
      employeeName: `tec ${tag}`,
      days: 3,
      status: 'pending_supervisor',
      canDecide: true,
      canCancelApproved: false,
    })

    // RRHH ve todas, pero solo decide las que ya están en su paso.
    expect(await find(hr, team.id)).toMatchObject({ status: 'pending_supervisor', canDecide: false })
    expect(await find(hr, direct.id)).toMatchObject({ status: 'pending_hr', canDecide: true })
    // El administrador puede decidir en cualquier paso.
    expect(await find(admin, team.id)).toMatchObject({ canDecide: true })

    // Fuera de alcance: como si no existiera. En alcance pero sin turno: prohibido.
    await expect(review.decide(otherBoss, team.id, 'approve')).rejects.toMatchObject({ status: 404 })
    await expect(review.decide(worker, team.id, 'approve')).rejects.toMatchObject({ status: 404 })
    await expect(review.decide(hr, team.id, 'approve')).rejects.toMatchObject({ status: 403 })
    await expect(review.decide(boss, team.id, 'reject')).rejects.toMatchObject({ status: 400 })

    // Supervisor y luego RRHH.
    expect(await review.decide(boss, team.id, 'approve')).toMatchObject({ status: 'pending_hr', canDecide: false })
    expect(await review.decide(hr, team.id, 'approve')).toMatchObject({ status: 'approved', canCancelApproved: true })
    await expect(review.decide(hr, team.id, 'approve')).rejects.toMatchObject({ status: 409 })
    expect(await balanceOf(workerId)).toMatchObject({ used: 3, available: 9 })

    // Rechazo de RRHH con motivo.
    expect(await review.decide(hr, direct.id, 'reject', 'Sin cobertura en esas fechas')).toMatchObject({
      status: 'rejected',
      reason: 'Sin cobertura en esas fechas',
    })
  })

  it('solo RRHH cancela una solicitud aprobada, con motivo, y devuelve el saldo', async () => {
    const approved = (await review.list(hr)).find((item) => item.employeeId === workerId && item.status === 'approved')!

    await expect(review.cancelApproved(boss, approved.id, 'No procede')).rejects.toMatchObject({ status: 403 })

    expect(await review.cancelApproved(hr, approved.id, 'Se reprograma el viaje')).toMatchObject({
      status: 'cancelled',
      reason: 'Se reprograma el viaje',
      canCancelApproved: false,
    })
    expect(await balanceOf(workerId)).toMatchObject({ used: 0, available: 12 })
    expect((await service.overview(workerId, MX)).requests[0]).toMatchObject({ status: 'cancelled', reason: 'Se reprograma el viaje' })

    // Ya cancelada, y una que nunca se aprobó.
    await expect(review.cancelApproved(hr, approved.id, 'Otra vez')).rejects.toMatchObject({ status: 409 })
    const pending = await service.create(workerId, vacation('2026-12-01', '2026-12-01'), MX)
    await expect(review.cancelApproved(hr, pending.id, 'Aún pendiente')).rejects.toMatchObject({ status: 409 })
  })

  it('RRHH ajusta el saldo del año de servicio en curso', async () => {
    await expect(review.balances(boss, MX)).rejects.toMatchObject({ status: 403 })
    await expect(review.adjust(boss, workerId, { days: 3, reason: 'x' }, MX)).rejects.toMatchObject({ status: 403 })
    await expect(review.adjust(hr, newcomerId, { days: 3, reason: 'x' }, MX)).rejects.toMatchObject({ status: 400 })
    await expect(review.adjust(hr, 999999999, { days: 3, reason: 'x' }, MX)).rejects.toMatchObject({ status: 404 })

    await review.adjust(hr, workerId, { days: -4, reason: 'Días tomados antes del sistema' }, MX)

    const balances = await review.balances(hr, MX)
    const mine = balances.find((item) => item.employeeId === workerId)
    // 12 del año − 4 del ajuste − 1 día en trámite de la prueba anterior.
    expect(mine?.balance).toMatchObject({ number: 1, entitlement: 12, adjustment: -4, reserved: 1, available: 7 })
    expect(mine?.adjustments).toHaveLength(1)
    expect(mine?.adjustments[0]).toMatchObject({ days: -4, reason: 'Días tomados antes del sistema', byName: 'RRHH de Prueba' })
    expect(balances.find((item) => item.employeeId === newcomerId)).toMatchObject({ hireDate: null, balance: null })

    // El colaborador ve el mismo saldo.
    expect(await balanceOf(workerId)).toMatchObject({ adjustment: -4, available: 7 })
  })
})

describe.skipIf(!db)('Revisión de ausencias por HTTP', () => {
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

  it('los saldos y los ajustes son solo de RRHH; la lista de revisión responde a todos según su alcance', async () => {
    expect((await call('dev-colaborador', 'GET', '/balances')).status).toBe(403)
    expect((await call('dev-supervisor', 'POST', '/balances/1/adjust', { days: 1, reason: 'x' })).status).toBe(403)
    expect((await call('dev-rrhh', 'GET', '/balances')).status).toBe(200)
    expect((await call('dev-rrhh', 'POST', '/balances/1/adjust', { days: 0, reason: 'x' })).status).toBe(400)

    expect((await call('dev-supervisor', 'GET', '/review')).status).toBe(200)
    expect((await call('dev-rrhh', 'POST', '/999999999/approve')).status).toBe(404)
    expect((await call('dev-rrhh', 'POST', '/999999999/reject', {})).status).toBe(400)
    expect((await call('dev-colaborador', 'POST', '/999999999/cancel-approved', { reason: 'x' })).status).toBe(403)
  })
})
