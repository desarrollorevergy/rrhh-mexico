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
import { createTeamService, parseReject, parseWeekAction } from './team.js'

const mx = (local: string) => new Date(`${local}-06:00`)
const h = (hours: number) => hours * 60

describe('validación de lo que envía el supervisor', () => {
  it('la semana se normaliza a su lunes', () => {
    expect(parseWeekAction({ employeeId: 7, weekStart: '2026-11-19' })).toEqual({ employeeId: 7, weekStart: '2026-11-16' })
    expect(() => parseWeekAction({ employeeId: 'x', weekStart: '2026-11-16' })).toThrow('Semana no válida')
    expect(() => parseWeekAction({ employeeId: 7 })).toThrow('Semana no válida')
  })

  it('rechazar exige motivo y al menos un día', () => {
    expect(() => parseReject({ rejectedEntryIds: [1], reason: '  ' })).toThrow('motivo')
    expect(() => parseReject({ rejectedEntryIds: [], reason: 'x' })).toThrow('al menos un día')
    expect(() => parseReject({ reason: 'x' })).toThrow('al menos un día')
    expect(parseReject({ rejectedEntryIds: [3, 3, 5], reason: ' Falta la salida ' })).toEqual({
      rejectedEntryIds: [3, 5],
      reason: 'Falta la salida',
    })
  })
})

// Contra la base de datos LOCAL; se omite donde no hay (ver testSetup.ts).
const db = testDb()

describe.skipIf(!db)('Supervisión del equipo', () => {
  const dbConfig = db!
  const tag = `s${Date.now().toString(36)}`
  const emails = {
    boss: `jefa-${tag}@example.test`,
    worker: `tecnico-${tag}@example.test`,
    other: `otrajefa-${tag}@example.test`,
    stranger: `ajeno-${tag}@example.test`,
  }
  const ids = { boss: 0, worker: 0, other: 0, stranger: 0 }
  const entryIds: Record<string, number> = {}
  const WEEK = '2026-11-02'

  const events: string[] = []
  const approvals = createApprovalService({ db: dbConfig, includeDemo: false, notifier: (event) => void events.push(event.kind) })
  const team = createTeamService({ db: dbConfig, approvals })
  const actor = (employeeId: number): Actor => ({ employeeId, roles: ['colaborador', 'supervisor'] })

  beforeAll(async () => {
    const pool = await getPool(dbConfig)
    const insertEmployee = async (key: keyof typeof ids, supervisorId: number | null) => {
      const result = await pool
        .request()
        .input('number', sql.NVarChar(20), `${tag}${key}`.slice(0, 20))
        .input('name', sql.NVarChar(200), `${key} ${tag}`)
        .input('email', sql.NVarChar(254), emails[key])
        .input('supervisorId', sql.Int, supervisorId)
        .query<{ id: number }>(
          'INSERT INTO employees (employee_number, full_name, email, supervisor_id) OUTPUT INSERTED.id VALUES (@number, @name, @email, @supervisorId)',
        )
      ids[key] = result.recordset[0]!.id
    }
    await insertEmployee('boss', null)
    await insertEmployee('other', null)
    await insertEmployee('worker', ids.boss)
    await insertEmployee('stranger', ids.other)

    const projectId = (await pool.request().query<{ id: number }>("SELECT id FROM projects WHERE code = 'MX0011000'")).recordset[0]!.id
    // Lunes 9 h con dieta, martes 8 h, miércoles sin salida.
    const entries: [string, number | null, boolean][] = [
      ['2026-11-02', 9, true],
      ['2026-11-03', 8, false],
      ['2026-11-04', null, false],
    ]
    for (const [date, hours, perDiem] of entries) {
      const clockIn = mx(`${date}T08:00:00`)
      const result = await pool
        .request()
        .input('employeeId', sql.Int, ids.worker)
        .input('date', sql.Date, date)
        .input('projectId', sql.Int, projectId)
        .input('perDiem', sql.Bit, perDiem)
        .input('clockIn', sql.DateTime2(0), clockIn)
        .input('clockOut', sql.DateTime2(0), hours === null ? null : new Date(clockIn.getTime() + hours * 3_600_000))
        .query<{ id: number }>(`
          INSERT INTO time_entries (employee_id, work_date, project_id, shift_type, per_diem, clock_in, clock_out, time_zone)
          OUTPUT INSERTED.id
          VALUES (@employeeId, @date, @projectId, 'activa', @perDiem, @clockIn, @clockOut, 'America/Mexico_City')`)
      entryIds[date] = result.recordset[0]!.id
    }
  })

  afterAll(async () => {
    const pool = await getPool(dbConfig)
    const mine = `(SELECT id FROM employees WHERE email LIKE '%-${tag}@example.test')`
    await pool.request().query(`DELETE FROM approval_actions WHERE request_id IN (SELECT id FROM approval_requests WHERE requester_id IN ${mine})`)
    await pool.request().query(`DELETE FROM approval_requests WHERE requester_id IN ${mine}`)
    await pool.request().query(`DELETE FROM time_entries WHERE employee_id IN ${mine}`)
    await pool.request().query(`UPDATE employees SET supervisor_id = NULL WHERE email LIKE '%-${tag}@example.test'`)
    await pool.request().query(`DELETE FROM employees WHERE email LIKE '%-${tag}@example.test'`)
    await closePool()
  })

  const statuses = async () => {
    const week = await team.detail(actor(ids.boss), ids.worker, WEEK)
    return Object.fromEntries(week.days.map((day) => [day.workDate.slice(8), day.status]))
  }

  it('el consolidado muestra solo a su equipo directo', async () => {
    const summary = await team.summary(actor(ids.boss))
    expect(summary).toHaveLength(1)
    expect(summary[0]).toMatchObject({
      employeeId: ids.worker,
      employeeName: `worker ${tag}`,
      weekStart: WEEK,
      status: 'pending',
      corrected: false,
      projects: ['MX0011000'],
      totals: { normal: h(16), extra: h(1), sunday: 0, holiday: 0, total: h(17), perDiems: 1 },
    })
    // La otra supervisora no ve a este colaborador, y quien no tiene equipo no ve nada
    expect(await team.summary(actor(ids.other))).toEqual([])
    expect(await team.summary(actor(ids.worker))).toEqual([])
  })

  it('el detalle trae la semana día por día', async () => {
    const week = await team.detail(actor(ids.boss), ids.worker, '2026-11-05')
    expect(week).toMatchObject({ weekStart: WEEK, weekEnd: '2026-11-08', status: 'pending', employeeName: `worker ${tag}` })
    expect(week.days.map((day) => [day.workDate, day.total, day.complete])).toEqual([
      ['2026-11-02', h(9), true],
      ['2026-11-03', h(8), true],
      ['2026-11-04', 0, false],
    ])
  })

  it('no se puede ver ni validar a quien no es de su equipo', async () => {
    await expect(team.detail(actor(ids.other), ids.worker, WEEK)).rejects.toThrow('no encontrado en tu equipo')
    await expect(team.approve(actor(ids.other), ids.worker, WEEK)).rejects.toThrow('no encontrado en tu equipo')
    await expect(
      team.reject(actor(ids.other), ids.worker, WEEK, { rejectedEntryIds: [entryIds['2026-11-04']!], reason: 'x' }),
    ).rejects.toThrow('no encontrado en tu equipo')
    // Nadie valida su propia semana
    await expect(team.approve(actor(ids.worker), ids.worker, WEEK)).rejects.toThrow('no encontrado en tu equipo')
  })

  it('no se aprueba una semana con una jornada sin salida', async () => {
    await expect(team.approve(actor(ids.boss), ids.worker, WEEK)).rejects.toThrow('sin salida')
    expect(await statuses()).toEqual({ '02': 'pending', '03': 'pending', '04': 'pending' })
  })

  it('rechazar marca solo los días indicados, con el motivo', async () => {
    await expect(
      team.reject(actor(ids.boss), ids.worker, WEEK, { rejectedEntryIds: [999_999_999], reason: 'x' }),
    ).rejects.toThrow('no pertenece a esta semana')

    const week = await team.reject(actor(ids.boss), ids.worker, WEEK, {
      rejectedEntryIds: [entryIds['2026-11-04']!],
      reason: 'Falta fichar la salida del miércoles',
    })
    expect(week.status).toBe('rejected')
    expect(await statuses()).toEqual({ '02': 'pending', '03': 'pending', '04': 'rejected' })
    expect(week.days.find((day) => day.workDate === '2026-11-04')?.rejectReason).toBe('Falta fichar la salida del miércoles')
    expect(week.days.find((day) => day.workDate === '2026-11-02')?.rejectReason).toBeNull()

    // Queda en el historial del motor de aprobaciones
    const latest = await approvals.findLatest('timesheet_week', `${ids.worker}:${WEEK}`)
    expect(latest?.status).toBe('rejected')
    const history = (await approvals.get(latest!.id, actor(ids.boss))).history
    expect(history?.map((entry) => [entry.action, entry.actorName, entry.reason])).toEqual([
      ['submitted', `worker ${tag}`, null],
      ['rejected', `boss ${tag}`, 'Falta fichar la salida del miércoles'],
    ])
  })

  it('aprobar deja todos los días aprobados y abre una nueva ronda en el historial', async () => {
    // Se completa la salida del miércoles (como hará la corrección) y se aprueba
    const pool = await getPool(dbConfig)
    await pool
      .request()
      .input('id', sql.Int, entryIds['2026-11-04']!)
      .input('out', sql.DateTime2(0), mx('2026-11-04T16:00:00'))
      .query('UPDATE time_entries SET clock_out = @out WHERE id = @id')

    events.length = 0
    const week = await team.approve(actor(ids.boss), ids.worker, WEEK)
    expect(week.status).toBe('approved')
    expect(await statuses()).toEqual({ '02': 'approved', '03': 'approved', '04': 'approved' })
    expect(week.days.every((day) => day.rejectReason === null)).toBe(true)
    expect(week.totals).toMatchObject({ normal: h(24), extra: h(1), total: h(25) })

    expect((await approvals.findLatest('timesheet_week', `${ids.worker}:${WEEK}`))?.status).toBe('approved')
    expect(events).toEqual(['submitted', 'approved'])

    await expect(team.approve(actor(ids.boss), ids.worker, WEEK)).rejects.toThrow('ya está aprobada')
  })

  it('rechazar una semana aprobada devuelve el resto de días a pendiente', async () => {
    await team.reject(actor(ids.boss), ids.worker, WEEK, {
      rejectedEntryIds: [entryIds['2026-11-02']!],
      reason: 'La analítica del lunes no es correcta',
    })
    expect(await statuses()).toEqual({ '02': 'rejected', '03': 'pending', '04': 'pending' })
    expect((await team.summary(actor(ids.boss)))[0]).toMatchObject({ status: 'rejected' })
  })

  describe('administrador', () => {
    const admin = (employeeId: number): Actor => ({ employeeId, roles: ['colaborador', 'admin'] })

    it('ve las semanas de todos, aunque no sean de su equipo', async () => {
      const summary = await team.summary(admin(ids.stranger))
      expect(summary.some((row) => row.employeeId === ids.worker)).toBe(true)
      expect((await team.detail(admin(ids.stranger), ids.worker, WEEK)).employeeId).toBe(ids.worker)
    })

    it('valida la semana de alguien que no es de su equipo y queda en el historial', async () => {
      await team.reject(admin(ids.stranger), ids.worker, WEEK, {
        rejectedEntryIds: [entryIds['2026-11-02']!],
        reason: 'Revisado por administración',
      })
      const history = await team.history(admin(ids.stranger), ids.worker, WEEK)
      // Se busca por el motivo: dos rechazos pueden caer en el mismo segundo.
      expect(history).toContainEqual(expect.objectContaining({ kind: 'rejected', reason: 'Revisado por administración' }))
    })

    it('no alcanza su propia semana: la valida su supervisor', async () => {
      const summary = await team.summary(admin(ids.worker))
      expect(summary.some((row) => row.employeeId === ids.worker)).toBe(false)
      await expect(team.detail(admin(ids.worker), ids.worker, WEEK)).rejects.toThrow('no encontrado en tu equipo')
      await expect(
        team.reject(admin(ids.worker), ids.worker, WEEK, { rejectedEntryIds: [entryIds['2026-11-02']!], reason: 'x' }),
      ).rejects.toThrow('no encontrado en tu equipo')
    })
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

    it('solo quien tiene equipo entra a supervisión, y solo ve el suyo', async () => {
      // El colaborador no tiene gente a su cargo: no es supervisor
      expect((await call(emails.worker, 'GET', '/summary')).status).toBe(403)
      expect((await call(emails.worker, 'POST', '/week/approve', { employeeId: ids.worker, weekStart: WEEK })).status).toBe(403)

      const mine = await call(emails.boss, 'GET', '/summary')
      expect(mine.status).toBe(200)
      expect(mine.body.map((row: any) => row.employeeId)).toEqual([ids.worker])

      // La otra supervisora sí es supervisora, pero no de este colaborador
      expect((await call(emails.other, 'GET', `/week?employeeId=${ids.worker}&date=${WEEK}`)).status).toBe(404)
      expect((await call(emails.other, 'POST', '/week/approve', { employeeId: ids.worker, weekStart: WEEK })).status).toBe(404)
    })

    it('valida lo que llega al rechazar', async () => {
      const base = { employeeId: ids.worker, weekStart: WEEK }
      expect((await call(emails.boss, 'POST', '/week/reject', { ...base, rejectedEntryIds: [entryIds['2026-11-03']] })).status).toBe(400)
      expect((await call(emails.boss, 'POST', '/week/reject', { ...base, reason: 'motivo' })).status).toBe(400)
      expect((await call(emails.boss, 'GET', '/week?employeeId=abc&date=x')).status).toBe(400)

      const ok = await call(emails.boss, 'POST', '/week/reject', {
        ...base,
        rejectedEntryIds: [entryIds['2026-11-03']],
        reason: 'Revisar el martes',
      })
      expect(ok.status).toBe(200)
      expect(ok.body.status).toBe('rejected')
    })
  })
})
