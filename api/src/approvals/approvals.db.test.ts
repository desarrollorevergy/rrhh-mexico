import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import sql from 'mssql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { DEV_USER_HEADER } from '../auth/middleware.js'
import type { Role } from '../auth/types.js'
import { loadConfig } from '../config/env.js'
import { findEmployeeByEmail } from '../db/employees.js'
import { closePool, getPool } from '../db/pool.js'
import { testDb } from '../db/testSetup.js'
import type { ApprovalEvent } from './notifications.js'
import { createApprovalService, type Actor } from './service.js'

// Flujo completo contra la base de datos LOCAL; se omite donde no hay (ver testSetup.ts).
// El tipo "demo" tiene la cadena: supervisor -> Controlling y Almacén en paralelo -> RRHH.
const db = testDb()

describe.skipIf(!db)('Motor de aprobaciones con base de datos', () => {
  const dbConfig = db!
  const events: ApprovalEvent[] = []
  const service = createApprovalService({ db: dbConfig, includeDemo: true, notifier: (event) => void events.push(event) })
  const created: number[] = []
  const actors: Record<string, Actor> = {}

  const actorFor = async (email: string, ...roles: Role[]): Promise<Actor> => {
    const employee = await findEmployeeByEmail(dbConfig, email)
    if (!employee) throw new Error(`Falta el empleado de prueba ${email}`)
    return { employeeId: employee.id, roles: ['colaborador', ...roles] }
  }

  const newRequest = async (): Promise<number> => {
    const id = await service.create({ type: 'demo', requesterId: actors.colaborador!.employeeId })
    created.push(id)
    return id
  }

  beforeAll(async () => {
    actors.colaborador = await actorFor('colaborador@example.test')
    actors.supervisor = await actorFor('supervisor@example.test', 'supervisor')
    actors.controlling = await actorFor('controlling@example.test', 'controlling')
    actors.almacen = await actorFor('almacen@example.test', 'almacen')
    actors.rrhh = await actorFor('rrhh@example.test', 'rrhh')
    actors.it = await actorFor('it@example.test', 'it')
  })

  afterAll(async () => {
    // Limpia solo lo que crearon estas pruebas.
    const pool = await getPool(dbConfig)
    for (const id of created) {
      await pool.request().input('id', sql.Int, id).query('DELETE FROM approval_actions WHERE request_id = @id')
      await pool.request().input('id', sql.Int, id).query('DELETE FROM approval_requests WHERE id = @id')
    }
    await closePool()
  })

  it('recorre toda la cadena hasta quedar aprobada, con historial', async () => {
    events.length = 0
    const id = await newRequest()

    // Paso 1: solo le toca al supervisor del solicitante.
    expect((await service.listPending(actors.supervisor!)).map((item) => item.id)).toContain(id)
    expect((await service.listPending(actors.rrhh!)).map((item) => item.id)).not.toContain(id)
    await expect(service.decide(id, actors.rrhh!, 'approve')).rejects.toThrow('No te corresponde')
    expect(await service.decide(id, actors.supervisor!, 'approve')).toMatchObject({ status: 'pending', currentStep: 1 })

    // Paso 2, en paralelo: hasta que no aprueban los dos, no avanza.
    expect(await service.decide(id, actors.almacen!, 'approve')).toMatchObject({ status: 'pending', currentStep: 1 })
    await expect(service.decide(id, actors.almacen!, 'approve')).rejects.toThrow('No te corresponde')
    expect((await service.listPending(actors.almacen!)).map((item) => item.id)).not.toContain(id)
    expect(await service.decide(id, actors.controlling!, 'approve')).toMatchObject({ status: 'pending', currentStep: 2 })

    // Paso 3: RRHH aprueba y termina.
    expect(await service.decide(id, actors.rrhh!, 'approve')).toMatchObject({ status: 'approved' })
    await expect(service.decide(id, actors.rrhh!, 'approve')).rejects.toThrow('ya no está pendiente')

    const detail = await service.get(id, actors.colaborador!)
    expect(detail.history?.map((entry) => `${entry.action}:${entry.actorName}`)).toEqual([
      'submitted:Colaborador de Prueba',
      'approved:Supervisor de Prueba',
      'approved:Almacén de Prueba',
      'approved:Controlling de Prueba',
      'approved:RRHH de Prueba',
    ])
    expect(detail.history?.every((entry) => entry.at instanceof Date)).toBe(true)

    // Avisos: al enviar, al cambiar de paso (dos veces) y al aprobar. No al esperar en paralelo.
    expect(events.filter((event) => event.requestId === id).map((event) => event.kind)).toEqual([
      'submitted',
      'step_pending',
      'step_pending',
      'approved',
    ])
  })

  it('rechazar exige motivo y no guarda nada si falta', async () => {
    const id = await newRequest()
    await expect(service.decide(id, actors.supervisor!, 'reject')).rejects.toThrow('motivo')
    await expect(service.decide(id, actors.supervisor!, 'reject', '  ')).rejects.toThrow('motivo')

    const detail = await service.get(id, actors.colaborador!)
    expect(detail.status).toBe('pending')
    expect(detail.history).toHaveLength(1)
  })

  it('tras un rechazo, el solicitante corrige y reenvía desde el primer paso', async () => {
    const id = await newRequest()
    await service.decide(id, actors.supervisor!, 'approve')
    const rejected = await service.decide(id, actors.controlling!, 'reject', 'Tiene un adeudo pendiente')
    expect(rejected.status).toBe('rejected')

    await expect(service.resubmit(id, actors.supervisor!)).rejects.toThrow('No te corresponde')
    expect(await service.resubmit(id, actors.colaborador!)).toMatchObject({ status: 'pending', currentStep: 0, round: 2 })

    // La aprobación del supervisor de la primera vuelta ya no cuenta.
    expect((await service.listPending(actors.supervisor!)).map((item) => item.id)).toContain(id)

    const detail = await service.get(id, actors.colaborador!)
    expect(detail.history?.find((entry) => entry.action === 'rejected')?.reason).toBe('Tiene un adeudo pendiente')
    expect(detail.history?.at(-1)).toMatchObject({ action: 'resubmitted', round: 2 })
  })

  it('el solicitante puede cancelar; los demás no', async () => {
    const id = await newRequest()
    await expect(service.cancel(id, actors.supervisor!)).rejects.toThrow('No te corresponde')
    expect((await service.cancel(id, actors.colaborador!)).status).toBe('cancelled')
    await expect(service.decide(id, actors.supervisor!, 'approve')).rejects.toThrow('ya no está pendiente')
  })

  it('quien no es solicitante ni aprobador no puede ver la solicitud', async () => {
    const id = await newRequest()
    await expect(service.get(id, actors.it!)).rejects.toThrow('no encontrada')
    expect((await service.get(id, actors.rrhh!)).id).toBe(id)
    await expect(service.get(999_999_999, actors.rrhh!)).rejects.toThrow('no encontrada')
  })

  it('las acciones disponibles dependen de quién consulta', async () => {
    const id = await newRequest()
    expect(await service.get(id, actors.colaborador!)).toMatchObject({ canDecide: false, canCancel: true })
    expect(await service.get(id, actors.supervisor!)).toMatchObject({ canDecide: true, canCancel: false })
    expect((await service.listMine(actors.colaborador!)).map((item) => item.id)).toContain(id)
  })

  it('dos decisiones simultáneas del mismo paso no se duplican', async () => {
    const id = await newRequest()
    const results = await Promise.allSettled([
      service.decide(id, actors.supervisor!, 'approve'),
      service.decide(id, actors.supervisor!, 'approve'),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect((await service.get(id, actors.colaborador!)).history).toHaveLength(2)
  })

  it('no admite tipos desconocidos, ni el de prueba fuera de local', async () => {
    await expect(service.create({ type: 'no-existe', requesterId: actors.colaborador!.employeeId })).rejects.toThrow(
      'desconocido',
    )
    const production = createApprovalService({ db: dbConfig, includeDemo: false })
    await expect(production.create({ type: 'demo', requesterId: actors.colaborador!.employeeId })).rejects.toThrow(
      'desconocido',
    )
  })

  describe('por HTTP', () => {
    const config = { ...loadConfig({ DEV_AUTH: 'true' }), db: dbConfig }
    const server = createApp({ webDist: tmpdir() + '/no-existe', config }).listen(0)
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

    afterAll(() => {
      server.close()
    })

    const call = async (devUser: string, method: string, path: string, body?: unknown) => {
      const res = await fetch(`${baseUrl}/api/approvals${path}`, {
        method,
        headers: { [DEV_USER_HEADER]: devUser, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      return { status: res.status, body: (await res.json()) as Record<string, unknown> }
    }

    it('crea, lista, rechaza con motivo y aplica los permisos', async () => {
      const createdRes = await call('dev-colaborador', 'POST', '/demo')
      expect(createdRes.status).toBe(200)
      const id = createdRes.body.id as number
      created.push(id)

      // A quien no le toca: 403. Sin motivo: 400. Identificador inválido: 404.
      expect((await call('dev-rrhh', 'POST', `/${id}/approve`)).status).toBe(403)
      expect((await call('dev-supervisor', 'POST', `/${id}/reject`, {})).status).toBe(400)
      expect((await call('dev-supervisor', 'GET', '/abc')).status).toBe(404)
      expect((await call('dev-it', 'GET', `/${id}`)).status).toBe(404)

      const pending = await fetch(`${baseUrl}/api/approvals/pending`, { headers: { [DEV_USER_HEADER]: 'dev-supervisor' } })
      expect(((await pending.json()) as { id: number }[]).map((item) => item.id)).toContain(id)

      const rejected = await call('dev-supervisor', 'POST', `/${id}/reject`, { reason: 'Falta un dato' })
      expect(rejected.body).toMatchObject({ status: 'rejected' })
      expect((await call('dev-supervisor', 'POST', `/${id}/approve`)).status).toBe(409)
    })
  })
})
