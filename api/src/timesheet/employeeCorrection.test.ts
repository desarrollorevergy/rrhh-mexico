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
import { createTimesheetService, parseNote } from './service.js'
import { createTeamService } from './team.js'

const MX = 'America/Mexico_City'
const mx = (local: string) => new Date(`${local}-06:00`)

describe('parseNote', () => {
  it('la nota es opcional y se limpia', () => {
    expect(parseNote({})).toBeNull()
    expect(parseNote({ note: '   ' })).toBeNull()
    expect(parseNote({ note: ' Ya puse la salida ' })).toBe('Ya puse la salida')
    expect(() => parseNote({ note: 5 })).toThrow('nota')
  })
})

// Contra la base de datos LOCAL; se omite donde no hay (ver testSetup.ts).
const db = testDb()

describe.skipIf(!db)('Corrección y reenvío del colaborador', () => {
  const dbConfig = db!
  const tag = `e${Date.now().toString(36)}`
  const emails = { boss: `jefa-${tag}@example.test`, worker: `tecnico-${tag}@example.test`, mate: `companero-${tag}@example.test` }
  const ids = { boss: 0, worker: 0, mate: 0 }
  const entryIds: Record<string, number> = {}
  const WEEK = '2026-10-19'
  const SENT_AT = mx('2026-10-27T09:00:00')

  const approvals = createApprovalService({ db: dbConfig, includeDemo: false, notifier: () => undefined })
  const service = createTimesheetService({ db: dbConfig, approvals, now: () => SENT_AT })
  const team = createTeamService({ db: dbConfig, approvals })
  const boss = (): Actor => ({ employeeId: ids.boss, roles: ['colaborador', 'supervisor'] })
  const worker = (): Actor => ({ employeeId: ids.worker, roles: ['colaborador'] })

  beforeAll(async () => {
    const pool = await getPool(dbConfig)
    for (const key of ['boss', 'worker', 'mate'] as const) {
      const result = await pool
        .request()
        .input('number', sql.NVarChar(20), `${tag}${key}`.slice(0, 20))
        .input('name', sql.NVarChar(200), `${key} ${tag}`)
        .input('email', sql.NVarChar(254), emails[key])
        .input('supervisorId', sql.Int, key === 'boss' ? null : ids.boss)
        .query<{ id: number }>(
          'INSERT INTO employees (employee_number, full_name, email, supervisor_id) OUTPUT INSERTED.id VALUES (@number, @name, @email, @supervisorId)',
        )
      ids[key] = result.recordset[0]!.id
    }
    const projectId = (await pool.request().query<{ id: number }>("SELECT id FROM projects WHERE code = 'MX0011000'")).recordset[0]!.id
    // Lunes 8 h; martes sin salida; miércoles 8 h.
    for (const [date, hours] of [['2026-10-19', 8], ['2026-10-20', null], ['2026-10-21', 8]] as const) {
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

  const statuses = async () =>
    Object.fromEntries((await service.week(ids.worker, WEEK)).days.map((day) => [day.workDate.slice(8), day.status]))

  it('mientras no hay rechazo, el colaborador no puede corregir ni enviar nada', async () => {
    await expect(service.correctOwnEntry(ids.worker, entryIds['2026-10-19']!, { perDiem: true })).rejects.toThrow(
      'Solo se pueden corregir los días rechazados',
    )
    await expect(service.sendCorrection(worker(), WEEK, null)).rejects.toThrow('No hay días rechazados')
    expect((await service.weeks(ids.worker, MX)).rejectedWeeks).toEqual([])
  })

  it('tras el rechazo ve el motivo y la semana queda señalada', async () => {
    await team.reject(boss(), ids.worker, WEEK, {
      rejectedEntryIds: [entryIds['2026-10-20']!],
      reason: 'Falta la salida del martes',
    })
    const week = await service.week(ids.worker, WEEK)
    expect(week.status).toBe('rejected')
    expect(week.days.find((day) => day.workDate === '2026-10-20')?.rejectReason).toBe('Falta la salida del martes')
    expect((await service.weeks(ids.worker, MX)).rejectedWeeks).toEqual([WEEK])
  })

  it('solo puede corregir sus propios días rechazados', async () => {
    // Un día no rechazado de la misma semana
    await expect(service.correctOwnEntry(ids.worker, entryIds['2026-10-21']!, { perDiem: true })).rejects.toThrow(
      'Solo se pueden corregir los días rechazados',
    )
    // El día rechazado de otra persona
    await expect(service.correctOwnEntry(ids.mate, entryIds['2026-10-20']!, { perDiem: true })).rejects.toThrow('no encontrada')
  })

  it('no puede enviar la corrección si el día rechazado sigue sin salida', async () => {
    await expect(service.sendCorrection(worker(), WEEK, null)).rejects.toThrow('Completa la hora de salida')
    expect(await statuses()).toEqual({ '19': 'pending', '20': 'rejected', '21': 'pending' })
  })

  it('corrige el día rechazado: sigue rechazado hasta que lo envía', async () => {
    const week = await service.correctOwnEntry(ids.worker, entryIds['2026-10-20']!, {
      clockOut: mx('2026-10-20T17:00:00'),
      perDiem: true,
    })
    const tuesday = week.days.find((day) => day.workDate === '2026-10-20')!
    expect(tuesday).toMatchObject({ status: 'rejected', hoursEdited: true, perDiem: true, total: 9 * 60 })
  })

  it('envía la corrección: el día vuelve a pendiente y el supervisor la ve como corregida', async () => {
    const week = await service.sendCorrection(worker(), '2026-10-22', 'Ya puse la salida del martes')
    expect(week.status).toBe('pending')
    const tuesday = week.days.find((day) => day.workDate === '2026-10-20')!
    expect(tuesday.correctionSentAt?.toISOString()).toBe(SENT_AT.toISOString())
    expect(tuesday.correctionNote).toBe('Ya puse la salida del martes')
    // El motivo original se conserva para que el supervisor sepa qué se pidió
    expect(tuesday.rejectReason).toBe('Falta la salida del martes')
    expect((await service.weeks(ids.worker, MX)).rejectedWeeks).toEqual([])

    const summary = (await team.summary(boss())).find((row) => row.employeeId === ids.worker)
    expect(summary).toMatchObject({ status: 'pending', corrected: true })
    expect(await team.detail(boss(), ids.worker, WEEK)).toMatchObject({
      corrected: true,
      correctionNote: 'Ya puse la salida del martes',
    })

    // Enviada la corrección ya no puede seguir cambiando el día
    await expect(service.correctOwnEntry(ids.worker, entryIds['2026-10-20']!, { perDiem: false })).rejects.toThrow(
      'Solo se pueden corregir los días rechazados',
    )
    await expect(service.sendCorrection(worker(), WEEK, null)).rejects.toThrow('No hay días rechazados')
  })

  it('todo queda en el historial y el supervisor aprueba', async () => {
    expect((await approvals.findLatest('timesheet_week', `${ids.worker}:${WEEK}`))?.status).toBe('pending')

    const history = await team.history(boss(), ids.worker, WEEK)
    expect(history.map((item) => item.kind)).toEqual(
      expect.arrayContaining(['rejected', 'corrected_employee', 'resubmitted']),
    )
    expect(history.find((item) => item.kind === 'resubmitted')).toMatchObject({
      actorName: `worker ${tag}`,
      reason: 'Ya puse la salida del martes',
    })
    expect(history.find((item) => item.kind === 'corrected_employee')).toMatchObject({
      actorName: `worker ${tag}`,
      workDate: '2026-10-20',
      changes: { perDiem: { from: false, to: true }, clockOut: { from: null, to: mx('2026-10-20T17:00:00').toISOString() } },
    })

    const approved = await team.approve(boss(), ids.worker, WEEK)
    expect(approved.status).toBe('approved')
    expect(approved.corrected).toBe(false)
    expect((await approvals.findLatest('timesheet_week', `${ids.worker}:${WEEK}`))?.status).toBe('approved')
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

    it('rechazo, corrección y reenvío de punta a punta', async () => {
      const monday = entryIds['2026-10-19']!
      const rejected = await call(emails.boss, 'POST', '/team/week/reject', {
        employeeId: ids.worker,
        weekStart: WEEK,
        rejectedEntryIds: [monday],
        reason: 'La analítica del lunes no es correcta',
      })
      expect(rejected.status).toBe(200)

      // El compañero no puede tocar ni enviar la semana de otro
      expect((await call(emails.mate, 'PUT', `/entries/${monday}`, { perDiem: true })).status).toBe(404)
      expect((await call(emails.mate, 'POST', '/week/send-correction', { date: WEEK })).status).toBe(409)

      expect((await call(emails.worker, 'PUT', `/entries/${monday}`, { shiftType: 'otra' })).status).toBe(400)
      expect((await call(emails.worker, 'POST', '/week/send-correction', {})).status).toBe(400)

      const corrected = await call(emails.worker, 'PUT', `/entries/${monday}`, { shiftType: 'inactiva' })
      expect(corrected.status).toBe(200)
      expect(corrected.body.days[0]).toMatchObject({ shiftType: 'inactiva', status: 'rejected' })

      const sent = await call(emails.worker, 'POST', '/week/send-correction', { date: WEEK, note: 'Corregido el tipo' })
      expect(sent.status).toBe(200)
      expect(sent.body.status).toBe('pending')
    })
  })
})
