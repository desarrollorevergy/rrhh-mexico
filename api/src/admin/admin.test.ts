import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { afterAll, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { DEV_USER_HEADER } from '../auth/middleware.js'
import { loadConfig } from '../config/env.js'
import { closePool, getPool } from '../db/pool.js'
import { testDb } from '../db/testSetup.js'
import { isValidDate, parseEmployee, parseHoliday } from './validation.js'

describe('parseEmployee', () => {
  const valid = { employeeNumber: ' 1042 ', fullName: ' Ana Ruiz ', email: ' Ana.Ruiz@Example.test ' }

  it('limpia espacios, pasa el correo a minúsculas y pone los valores por defecto', () => {
    expect(parseEmployee(valid)).toEqual({
      ok: true,
      value: {
        employeeNumber: '1042',
        fullName: 'Ana Ruiz',
        email: 'ana.ruiz@example.test',
        jobTitle: null,
        departmentId: null,
        supervisorId: null,
        isActive: true,
      },
    })
  })

  it.each([
    ['sin número', { ...valid, employeeNumber: '' }],
    ['sin nombre', { ...valid, fullName: '  ' }],
    ['correo inválido', { ...valid, email: 'no-es-correo' }],
    ['supervisor inválido', { ...valid, supervisorId: 'abc' }],
    ['departamento inválido', { ...valid, departmentId: -1 }],
    ['cuerpo vacío', null],
  ])('rechaza: %s', (_caso, body) => {
    expect(parseEmployee(body).ok).toBe(false)
  })
})

describe('festivos', () => {
  it('solo admite fechas que existen', () => {
    expect(isValidDate('2026-12-25')).toBe(true)
    expect(isValidDate('2026-02-30')).toBe(false)
    expect(isValidDate('25/12/2026')).toBe(false)
  })

  it('exige fecha y nombre', () => {
    expect(parseHoliday({ date: '2026-12-25', name: ' Navidad ' })).toEqual({
      ok: true,
      value: { date: '2026-12-25', name: 'Navidad' },
    })
    expect(parseHoliday({ date: '2026-12-25' }).ok).toBe(false)
  })
})

// Contra la base de datos LOCAL; se omite donde no hay (ver testSetup.ts).
const db = testDb()

describe.skipIf(!db)('Administración por HTTP', () => {
  const dbConfig = db!
  const config = { ...loadConfig({ DEV_AUTH: 'true' }), db: dbConfig }
  const server = createApp({ webDist: tmpdir() + '/no-existe', config }).listen(0)
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  // Sufijo único para no chocar con ejecuciones anteriores.
  const tag = `t${Date.now().toString(36)}`

  afterAll(async () => {
    server.close()
    const pool = await getPool(dbConfig)
    await pool.request().query(`UPDATE employees SET supervisor_id = NULL WHERE email LIKE '%-${tag}@example.test'`)
    await pool.request().query(`DELETE FROM employees WHERE email LIKE '%-${tag}@example.test'`)
    await pool.request().query(`DELETE FROM departments WHERE name LIKE '%${tag}'`)
    await pool.request().query("DELETE FROM holidays WHERE holiday_date = '2099-01-15'")
    await closePool()
  })

  const call = async (devUser: string, method: string, path: string, body?: unknown) => {
    const res = await fetch(`${baseUrl}/api${path}`, {
      method,
      headers: { [DEV_USER_HEADER]: devUser, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { status: res.status, body: (await res.json()) as any }
  }

  const employee = (name: string, extra: Record<string, unknown> = {}) => ({
    employeeNumber: `${name.slice(0, 6)}-${tag}`.slice(0, 20),
    fullName: `${name} ${tag}`,
    email: `${name}-${tag}@example.test`,
    ...extra,
  })

  it('las analíticas las ve cualquier empleado, con su nombre', async () => {
    const { status, body } = await call('dev-colaborador', 'GET', '/projects')
    expect(status).toBe(200)
    expect(body.find((project: any) => project.code === 'MX0011000')?.name).toBe('GERENCIA')
  })

  it('solo RRHH accede a empleados y departamentos', async () => {
    for (const user of ['dev-colaborador', 'dev-supervisor', 'dev-direccion']) {
      expect((await call(user, 'GET', '/employees')).status).toBe(403)
      expect((await call(user, 'POST', '/employees', employee('intruso'))).status).toBe(403)
      expect((await call(user, 'GET', '/departments')).status).toBe(403)
    }
    expect((await call('dev-rrhh', 'GET', '/employees')).status).toBe(200)
  })

  it('RRHH da de alta, edita y asigna supervisor', async () => {
    const department = await call('dev-rrhh', 'POST', '/departments', { name: `Operaciones ${tag}` })
    expect(department.status).toBe(200)

    const boss = await call('dev-rrhh', 'POST', '/employees', employee('jefa', { jobTitle: 'Jefa de parque' }))
    expect(boss.status).toBe(200)

    const worker = await call(
      'dev-rrhh',
      'POST',
      '/employees',
      employee('tecnico', { departmentId: department.body.id, supervisorId: boss.body.id }),
    )
    expect(worker.body).toMatchObject({
      departmentName: `Operaciones ${tag}`,
      supervisorName: `jefa ${tag}`,
      isActive: true,
    })

    // Datos inválidos y duplicados
    expect((await call('dev-rrhh', 'POST', '/employees', { fullName: 'Sin datos' })).status).toBe(400)
    expect((await call('dev-rrhh', 'POST', '/employees', employee('tecnico'))).status).toBe(409)
    expect((await call('dev-rrhh', 'POST', '/employees', employee('otro', { supervisorId: 999999999 }))).status).toBe(400)

    // Nadie puede ser su propio supervisor, ni directa ni indirectamente
    const self = await call('dev-rrhh', 'PUT', `/employees/${worker.body.id}`, employee('tecnico', { supervisorId: worker.body.id }))
    expect(self.status).toBe(400)
    const cycle = await call('dev-rrhh', 'PUT', `/employees/${boss.body.id}`, employee('jefa', { supervisorId: worker.body.id }))
    expect(cycle.status).toBe(400)

    // Baja: se desactiva, no se borra
    const inactive = await call('dev-rrhh', 'PUT', `/employees/${worker.body.id}`, employee('tecnico', { isActive: false }))
    expect(inactive.body).toMatchObject({ isActive: false, supervisorId: null })

    expect((await call('dev-rrhh', 'PUT', '/employees/999999999', employee('nadie'))).status).toBe(404)
    expect((await call('dev-rrhh', 'PUT', '/employees/abc', employee('nadie'))).status).toBe(404)
  })

  it('festivos: todos los consultan, solo RRHH los cambia', async () => {
    const holiday = { date: '2099-01-15', name: 'Festivo de prueba' }
    expect((await call('dev-supervisor', 'POST', '/holidays', holiday)).status).toBe(403)

    const created = await call('dev-rrhh', 'POST', '/holidays', holiday)
    expect(created.body).toMatchObject(holiday)
    expect((await call('dev-rrhh', 'POST', '/holidays', holiday)).status).toBe(409)
    expect((await call('dev-rrhh', 'POST', '/holidays', { date: '2099-02-30', name: 'x' })).status).toBe(400)

    const list = await call('dev-colaborador', 'GET', '/holidays?year=2099')
    expect(list.body).toEqual([{ id: created.body.id, ...holiday }])

    expect((await call('dev-colaborador', 'DELETE', `/holidays/${created.body.id}`)).status).toBe(403)
    expect((await call('dev-rrhh', 'DELETE', `/holidays/${created.body.id}`)).status).toBe(200)
    expect((await call('dev-rrhh', 'DELETE', `/holidays/${created.body.id}`)).status).toBe(404)
  })
})
