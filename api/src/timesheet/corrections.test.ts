import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import sql from 'mssql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { createApprovalService } from '../approvals/service.js'
import type { Actor } from '../auth/employee.js'
import { encodePrincipal, PRINCIPAL_HEADER } from '../auth/principal.js'
import { closePool, getPool } from '../db/pool.js'
import { testDb } from '../db/testSetup.js'
import { parseCorrection } from './corrections.js'
import { createTeamService } from './team.js'

const mx = (local: string) => new Date(`${local}-06:00`)
const h = (hours: number) => hours * 60

describe('parseCorrection', () => {
  it('solo incluye los campos enviados', () => {
    expect(parseCorrection({})).toEqual({})
    expect(parseCorrection({ perDiem: false })).toEqual({ perDiem: false })
    expect(parseCorrection({ projectId: '7', shiftType: 'inactiva' })).toEqual({ projectId: 7, shiftType: 'inactiva' })
  })

  it('convierte las horas y descarta los milisegundos', () => {
    const parsed = parseCorrection({ clockIn: '2026-11-02T14:00:00.750Z', clockOut: '2026-11-02T22:30:00Z' })
    expect(parsed.clockIn?.toISOString()).toBe('2026-11-02T14:00:00.000Z')
    expect(parsed.clockOut?.toISOString()).toBe('2026-11-02T22:30:00.000Z')
  })

  it.each([
    ['analítica', { projectId: 'abc' }],
    ['tipo de jornada', { shiftType: 'Teletrabajo' }],
    ['dieta', { perDiem: 'sí' }],
    ['entrada', { clockIn: 'ayer por la mañana' }],
    ['salida', { clockOut: 12345 }],
  ])('rechaza un valor inválido de %s', (label, body) => {
    expect(() => parseCorrection(body)).toThrow(label)
  })
})

// Contra la base de datos LOCAL; se omite donde no hay (ver testSetup.ts).
const db = testDb()

describe.skipIf(!db)('Corrección de jornadas por el supervisor', () => {
  const dbConfig = db!
  const tag = `c${Date.now().toString(36)}`
  const emails = {
    boss: `jefa-${tag}@example.test`,
    worker: `tecnico-${tag}@example.test`,
    other: `otrajefa-${tag}@example.test`,
  }
  const ids = { boss: 0, worker: 0, other: 0 }
  const entryIds: Record<string, number> = {}
  let projectId = 0
  let otherProjectId = 0
  const WEEK = '2026-10-26'

  const approvals = createApprovalService({ db: dbConfig, includeDemo: false, notifier: () => undefined })
  const team = createTeamService({ db: dbConfig, approvals })
  const actor = (employeeId: number): Actor => ({ employeeId, roles: ['colaborador', 'supervisor'] })
  const day = async (date: string) => (await team.detail(actor(ids.boss), ids.worker, WEEK)).days.find((item) => item.workDate === date)!

  beforeAll(async () => {
    const pool = await getPool(dbConfig)
    for (const key of ['boss', 'other', 'worker'] as const) {
      const result = await pool
        .request()
        .input('number', sql.NVarChar(20), `${tag}${key}`.slice(0, 20))
        .input('name', sql.NVarChar(200), `${key} ${tag}`)
        .input('email', sql.NVarChar(254), emails[key])
        .input('supervisorId', sql.Int, key === 'worker' ? ids.boss : null)
        .query<{ id: number }>(
          'INSERT INTO employees (employee_number, full_name, email, supervisor_id) OUTPUT INSERTED.id VALUES (@number, @name, @email, @supervisorId)',
        )
      ids[key] = result.recordset[0]!.id
    }
    const codes = await pool
      .request()
      .query<{ id: number; code: string }>("SELECT id, code FROM projects WHERE code IN ('MX0011000', 'MX0013000')")
    projectId = codes.recordset.find((row) => row.code === 'MX0011000')!.id
    otherProjectId = codes.recordset.find((row) => row.code === 'MX0013000')!.id

    // Lunes 8 h; martes sin salida.
    for (const [date, hours] of [['2026-10-26', 8], ['2026-10-27', null]] as const) {
      const clockIn = mx(`${date}T08:00:00`)
      const result = await pool
        .request()
        .input('employeeId', sql.Int, ids.worker)
        .input('date', sql.Date, date)
        .input('projectId', sql.Int, projectId)
        .input('clockIn', sql.DateTime2(0), clockIn)
        .input('clockOut', sql.DateTime2(0), hours === null ? null : new Date(clockIn.getTime() + hours * 3_600_000))
        .query<{ id: number }>(`
          INSERT INTO time_entries (employee_id, work_date, project_id, shift_type, per_diem, clock_in, clock_out, time_zone)
          OUTPUT INSERTED.id
          VALUES (@employeeId, @date, @projectId, 'activa', 0, @clockIn, @clockOut, 'America/Mexico_City')`)
      entryIds[date] = result.recordset[0]!.id
    }
  })

  afterAll(async () => {
    const pool = await getPool(dbConfig)
    const mine = `(SELECT id FROM employees WHERE email LIKE '%-${tag}@example.test')`
    await pool.request().query(`DELETE FROM time_entry_changes WHERE entry_id IN (SELECT id FROM time_entries WHERE employee_id IN ${mine})`)
    await pool.request().query(`DELETE FROM approval_actions WHERE request_id IN (SELECT id FROM approval_requests WHERE requester_id IN ${mine})`)
    await pool.request().query(`DELETE FROM approval_requests WHERE requester_id IN ${mine}`)
    await pool.request().query(`DELETE FROM time_entries WHERE employee_id IN ${mine}`)
    await pool.request().query(`UPDATE employees SET supervisor_id = NULL WHERE email LIKE '%-${tag}@example.test'`)
    await pool.request().query(`DELETE FROM employees WHERE email LIKE '%-${tag}@example.test'`)
    await closePool()
  })

  it('valida las horas y la analítica antes de guardar', async () => {
    const tuesday = entryIds['2026-10-27']!
    await expect(team.correct(actor(ids.boss), tuesday, { clockOut: mx('2026-10-27T07:00:00') })).rejects.toThrow('posterior a la entrada')
    await expect(team.correct(actor(ids.boss), tuesday, { clockOut: mx('2026-10-28T09:00:00') })).rejects.toThrow('más de 24 horas')
    await expect(team.correct(actor(ids.boss), tuesday, { clockIn: mx('2026-11-05T08:00:00') })).rejects.toThrow('no corresponde al día')
    await expect(team.correct(actor(ids.boss), tuesday, { projectId: 999_999_999 })).rejects.toThrow('no existe')
    expect((await day('2026-10-27')).clockOut).toBeNull()
  })

  it('corrige la jornada, recalcula la semana y marca las horas como editadas', async () => {
    const before = await team.detail(actor(ids.boss), ids.worker, WEEK)
    expect(before.totals).toMatchObject({ normal: h(8), total: h(8) })

    const week = await team.correct(actor(ids.boss), entryIds['2026-10-27']!, {
      clockOut: mx('2026-10-27T17:30:00'),
      projectId: otherProjectId,
      perDiem: true,
    })
    expect(week.totals).toMatchObject({ normal: h(16), extra: h(1.5), total: h(17.5), perDiems: 1 })

    const tuesday = week.days.find((item) => item.workDate === '2026-10-27')!
    expect(tuesday).toMatchObject({ projectCode: 'MX0013000', perDiem: true, hoursEdited: true, status: 'pending', complete: true })
    // El lunes no se tocó
    expect((await day('2026-10-26')).hoursEdited).toBe(false)
  })

  it('una corrección sin cambios no deja rastro', async () => {
    const before = await team.history(actor(ids.boss), ids.worker, WEEK)
    await team.correct(actor(ids.boss), entryIds['2026-10-27']!, { perDiem: true, projectId: otherProjectId })
    expect(await team.history(actor(ids.boss), ids.worker, WEEK)).toHaveLength(before.length)
  })

  it('solo el supervisor directo puede corregir', async () => {
    await expect(team.correct(actor(ids.other), entryIds['2026-10-26']!, { perDiem: true })).rejects.toThrow('no encontrada')
    await expect(team.correct(actor(ids.worker), entryIds['2026-10-26']!, { perDiem: true })).rejects.toThrow('no encontrada')
    await expect(team.correct(actor(ids.boss), 999_999_999, { perDiem: true })).rejects.toThrow('no encontrada')
  })

  it('corregir un día aprobado lo devuelve a pendiente', async () => {
    await team.approve(actor(ids.boss), ids.worker, WEEK)
    expect((await team.detail(actor(ids.boss), ids.worker, WEEK)).status).toBe('approved')

    const week = await team.correct(actor(ids.boss), entryIds['2026-10-26']!, { shiftType: 'inactiva' })
    expect(week.status).toBe('pending')
    expect(week.days.map((item) => item.status)).toEqual(['pending', 'approved'])
  })

  it('el historial reúne decisiones y correcciones, de la más reciente a la más antigua', async () => {
    await team.reject(actor(ids.boss), ids.worker, WEEK, {
      rejectedEntryIds: [entryIds['2026-10-26']!],
      reason: 'El lunes fue jornada activa',
    })
    const history = await team.history(actor(ids.boss), ids.worker, WEEK)

    expect(history.map((item) => item.kind)).toEqual(
      expect.arrayContaining(['rejected', 'corrected_supervisor', 'approved']),
    )
    // No se muestran los envíos automáticos del motor
    expect(history.some((item) => (item.kind as string) === 'submitted')).toBe(false)
    expect([...history].sort((a, b) => b.at.getTime() - a.at.getTime())).toEqual(history)

    expect(history.find((item) => item.kind === 'rejected')).toMatchObject({
      actorName: `boss ${tag}`,
      reason: 'El lunes fue jornada activa',
    })
    const tuesday = history.find((item) => item.kind === 'corrected_supervisor' && item.workDate === '2026-10-27')!
    expect(tuesday.actorName).toBe(`boss ${tag}`)
    expect(tuesday.changes).toEqual({
      project: { from: 'MX0011000', to: 'MX0013000' },
      perDiem: { from: false, to: true },
      clockOut: { from: null, to: mx('2026-10-27T17:30:00').toISOString() },
    })

    await expect(team.history(actor(ids.other), ids.worker, WEEK)).rejects.toThrow('no encontrado en tu equipo')
  })

  describe('por HTTP', () => {
    const config = { devAuth: false, groupIds: {}, db: dbConfig }
    const server = createApp({ webDist: tmpdir() + '/no-existe', config }).listen(0)
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

    afterAll(() => {
      server.close()
    })

    const call = async (userEmail: string, method: string, path: string, body?: unknown) => {
      const res = await fetch(`${baseUrl}/api/timesheet/team${path}`, {
        method,
        headers: {
          [PRINCIPAL_HEADER]: encodePrincipal({ id: userEmail, name: 'x', email: userEmail, groups: [] }),
          'Content-Type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      return { status: res.status, body: (await res.json()) as any }
    }

    it('corrige y consulta el historial con los permisos correctos', async () => {
      const path = `/entries/${entryIds['2026-10-26']}`
      // Ni el colaborador ni la otra jefa (que aquí no tiene equipo) son supervisores
      expect((await call(emails.worker, 'PUT', path, { perDiem: true })).status).toBe(403)
      expect((await call(emails.other, 'PUT', path, { perDiem: true })).status).toBe(403)
      expect((await call(emails.boss, 'PUT', path, { clockOut: 'mal' })).status).toBe(400)
      expect((await call(emails.boss, 'PUT', '/entries/abc', { perDiem: true })).status).toBe(404)

      const ok = await call(emails.boss, 'PUT', path, { clockIn: mx('2026-10-26T07:30:00').toISOString() })
      expect(ok.status).toBe(200)
      expect(ok.body.days[0]).toMatchObject({ hoursEdited: true, total: h(8.5) })

      const history = await call(emails.boss, 'GET', `/week/history?employeeId=${ids.worker}&date=${WEEK}`)
      expect(history.status).toBe(200)
      expect(
        history.body.some(
          (item: any) => item.kind === 'corrected_supervisor' && item.workDate === '2026-10-26' && item.changes.clockIn,
        ),
      ).toBe(true)
      expect((await call(emails.other, 'GET', `/week/history?employeeId=${ids.worker}&date=${WEEK}`)).status).toBe(403)
    })
  })
})
