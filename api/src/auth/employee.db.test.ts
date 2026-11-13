import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import sql from 'mssql'
import { afterAll, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { closePool, getPool } from '../db/pool.js'
import { testDb } from '../db/testSetup.js'
import { encodePrincipal, PRINCIPAL_HEADER } from './principal.js'

// Contra la base de datos LOCAL; se omite donde no hay (ver testSetup.ts).
const db = testDb()

describe.skipIf(!db)('Ficha automática al usar el Parte de Horas', () => {
  const dbConfig = db!
  const tag = `a${Date.now().toString(36)}`
  const email = `nueva-${tag}@example.test`
  const server = createApp({ webDist: tmpdir() + '/no-existe', config: { devAuth: false, groupIds: {}, db: dbConfig } }).listen(0)
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  const today = () =>
    fetch(`${baseUrl}/api/timesheet/today?timeZone=America/Mexico_City`, {
      headers: { [PRINCIPAL_HEADER]: encodePrincipal({ id: email, name: 'Persona Nueva', email, groups: [] }) },
    })

  const fichas = async () => {
    const pool = await getPool(dbConfig)
    const result = await pool
      .request()
      .input('email', sql.NVarChar(254), email)
      .query<{ id: number; employee_number: string; full_name: string; supervisor_id: number | null }>(
        'SELECT id, employee_number, full_name, supervisor_id FROM employees WHERE email = @email',
      )
    return result.recordset
  }

  afterAll(async () => {
    server.close()
    const pool = await getPool(dbConfig)
    await pool.request().input('email', sql.NVarChar(254), email).query('DELETE FROM employees WHERE email = @email')
    await closePool()
  })

  it('quien no tiene ficha entra y se le crea una básica, sin supervisor', async () => {
    expect(await fichas()).toEqual([])
    expect((await today()).status).toBe(200)

    const [ficha, ...rest] = await fichas()
    expect(rest).toEqual([])
    expect(ficha).toMatchObject({ full_name: 'Persona Nueva', supervisor_id: null, employee_number: `AUTO-${ficha!.id}` })
  })

  it('las siguientes veces usa la misma ficha', async () => {
    await Promise.all([today(), today(), today()])
    expect(await fichas()).toHaveLength(1)
  })

  it('una ficha dada de baja no se reactiva sola', async () => {
    const pool = await getPool(dbConfig)
    await pool.request().input('email', sql.NVarChar(254), email).query('UPDATE employees SET is_active = 0 WHERE email = @email')
    const res = await today()
    expect(res.status).toBe(403)
    expect(((await res.json()) as { error: string }).error).toContain('dada de baja')
    expect(await fichas()).toHaveLength(1)
  })
})
