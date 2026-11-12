import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from './app.js'
import { encodePrincipal, PRINCIPAL_HEADER } from './auth/principal.js'
import type { AppConfig } from './config/env.js'

// Configuración como en producción: sin autenticación simulada.
const PROD_CONFIG: AppConfig = { devAuth: false, groupIds: { rrhh: 'grupo-rrhh' } }

// Cabecera de un usuario autenticado, como la entregaría App Service.
const AUTH_HEADERS = {
  [PRINCIPAL_HEADER]: encodePrincipal({
    id: 'usuario-1',
    name: 'Usuario Uno',
    email: 'uno@example.test',
    groups: [],
  }),
}

function listen(server: Server): string {
  const { port } = server.address() as AddressInfo
  return `http://127.0.0.1:${port}`
}

describe('API', () => {
  // Carpeta sin front compilado: así la prueba no depende de web/dist.
  const emptyDir = mkdtempSync(path.join(tmpdir(), 'rrhh-sin-front-'))
  const server = createApp({ webDist: emptyDir, config: PROD_CONFIG }).listen(0)
  let baseUrl = ''

  beforeAll(() => {
    baseUrl = listen(server)
  })

  afterAll(() => {
    server.close()
    rmSync(emptyDir, { recursive: true, force: true })
  })

  it('GET /api/health responde ok sin autenticación', async () => {
    const res = await fetch(`${baseUrl}/api/health`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })

  it('una ruta /api que no existe responde 404 en JSON', async () => {
    const res = await fetch(`${baseUrl}/api/no-existe`, { headers: AUTH_HEADERS })
    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(await res.json()).toEqual({ error: 'Recurso no encontrado' })
  })

  it('sin front compilado, las rutas del front responden 404', async () => {
    const res = await fetch(`${baseUrl}/`)
    expect(res.status).toBe(404)
  })
})

describe('Front compilado', () => {
  const webDist = mkdtempSync(path.join(tmpdir(), 'rrhh-front-'))
  mkdirSync(path.join(webDist, 'assets'))
  writeFileSync(path.join(webDist, 'index.html'), '<!doctype html><title>front de prueba</title>')
  writeFileSync(path.join(webDist, 'assets', 'app-abc123.js'), 'console.log("ok")')

  const server = createApp({ webDist, config: PROD_CONFIG }).listen(0)
  let baseUrl = ''

  beforeAll(() => {
    baseUrl = listen(server)
  })

  afterAll(() => {
    server.close()
    rmSync(webDist, { recursive: true, force: true })
  })

  it.each(['/', '/parte-horas', '/parte-horas/semana/2026-45'])('%s devuelve el index.html', async (route) => {
    const res = await fetch(`${baseUrl}${route}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(await res.text()).toContain('front de prueba')
  })

  it('sirve los archivos de /assets', async () => {
    const res = await fetch(`${baseUrl}/assets/app-abc123.js`)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('console.log')
  })

  it('un archivo de /assets que no existe responde 404 en JSON, no el index.html', async () => {
    const res = await fetch(`${baseUrl}/assets/no-existe.js`)
    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).toContain('application/json')
  })

  it('las rutas /api siguen respondiendo JSON', async () => {
    const health = await fetch(`${baseUrl}/api/health`)
    expect(await health.json()).toEqual({ status: 'ok' })

    const missing = await fetch(`${baseUrl}/api/no-existe`, { headers: AUTH_HEADERS })
    expect(missing.status).toBe(404)
    expect(missing.headers.get('content-type')).toContain('application/json')
  })
})
