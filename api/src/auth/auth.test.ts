import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { afterAll, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { loadConfig, type AppConfig } from '../config/env.js'
import { DEV_USER_HEADER, requireRole, VIEW_AS_HEADER } from './middleware.js'
import { encodePrincipal, parsePrincipal, PRINCIPAL_HEADER } from './principal.js'
import { resolveRoles, viewAs } from './roles.js'
import type { AuthUser, Role } from './types.js'

const USER: AuthUser = {
  id: '11111111-aaaa-bbbb-cccc-222222222222',
  name: 'Usuario Uno',
  email: 'uno@example.test',
  groups: ['grupo-rrhh', 'grupo-otro'],
}

describe('parsePrincipal', () => {
  it('lee id, nombre, correo y grupos de la cabecera', () => {
    expect(parsePrincipal(encodePrincipal(USER))).toEqual(USER)
  })

  it('acepta los nombres largos de los claims', () => {
    const header = Buffer.from(
      JSON.stringify({
        claims: [
          { typ: 'http://schemas.microsoft.com/identity/claims/objectidentifier', val: 'abc' },
          { typ: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress', val: 'a@example.test' },
        ],
      }),
    ).toString('base64')
    // Sin claim de nombre, se usa el correo.
    expect(parsePrincipal(header)).toEqual({ id: 'abc', name: 'a@example.test', email: 'a@example.test', groups: [] })
  })

  it.each([
    ['sin cabecera', undefined],
    ['vacía', ''],
    ['no es base64 de un JSON', 'esto-no-es-valido'],
    ['JSON sin claims', Buffer.from('{"auth_typ":"aad"}').toString('base64')],
    ['sin identificador de usuario', Buffer.from('{"claims":[{"typ":"name","val":"X"}]}').toString('base64')],
  ])('devuelve null: %s', (_caso, header) => {
    expect(parsePrincipal(header)).toBeNull()
  })
})

describe('resolveRoles', () => {
  const groupIds = { rrhh: 'grupo-rrhh', direccion: 'grupo-direccion' }

  it('todo usuario autenticado es colaborador', () => {
    expect(resolveRoles({ ...USER, groups: [] }, groupIds, false)).toEqual(['colaborador'])
  })

  it('asigna los roles de los grupos a los que pertenece', () => {
    expect(resolveRoles(USER, groupIds, false)).toEqual(['colaborador', 'rrhh'])
  })

  it('supervisor se asigna por datos, no por grupo', () => {
    expect(resolveRoles({ ...USER, groups: [] }, groupIds, true)).toEqual(['colaborador', 'supervisor'])
  })

  it('un rol sin grupo configurado no se asigna a nadie', () => {
    expect(resolveRoles({ ...USER, groups: ['grupo-almacen'] }, groupIds, false)).toEqual(['colaborador'])
  })
})

describe('viewAs (selector «Ver como» del administrador)', () => {
  const admin: Role[] = ['colaborador', 'supervisor', 'admin', 'rrhh']

  it('el administrador pasa a tener solo el rol elegido', () => {
    expect(viewAs(admin, 'controlling')).toEqual({ roles: ['colaborador', 'controlling'], viewAs: 'controlling' })
    expect(viewAs(admin, 'supervisor')).toEqual({ roles: ['colaborador', 'supervisor'], viewAs: 'supervisor' })
    expect(viewAs(admin, 'colaborador')).toEqual({ roles: ['colaborador'], viewAs: 'colaborador' })
  })

  it('sin elegir, o con un rol que no existe, sigue como administrador', () => {
    expect(viewAs(admin, undefined)).toEqual({ roles: admin, viewAs: null })
    expect(viewAs(admin, 'admin')).toEqual({ roles: admin, viewAs: null })
    expect(viewAs(admin, 'jefe-supremo')).toEqual({ roles: admin, viewAs: null })
  })

  it('quien no es administrador no gana ni cambia roles', () => {
    expect(viewAs(['colaborador'], 'rrhh')).toEqual({ roles: ['colaborador'], viewAs: null })
    expect(viewAs(['colaborador', 'rrhh'], 'direccion')).toEqual({ roles: ['colaborador', 'rrhh'], viewAs: null })
  })
})

describe('requireRole', () => {
  /** Devuelve 'pasa' o el código de estado con el que se rechazó. */
  const check = (roles: Role[]) => {
    let outcome: 'pasa' | number = 200
    const res = {
      locals: { auth: { user: USER, roles, isAdmin: roles.includes('admin'), viewAs: null } },
      status: (code: number) => {
        outcome = code
        return { json: () => undefined }
      },
    }
    requireRole('rrhh')({} as never, res as never, () => {
      outcome = 'pasa'
    })
    return outcome
  }

  it('deja pasar a quien tiene el rol y rechaza al resto', () => {
    expect(check(['colaborador', 'rrhh'])).toBe('pasa')
    expect(check(['colaborador', 'direccion'])).toBe(403)
  })

  it('el administrador pasa aunque no tenga el rol pedido', () => {
    expect(check(['colaborador', 'admin'])).toBe('pasa')
  })
})

describe('loadConfig', () => {
  it('por defecto la autenticación simulada está apagada', () => {
    expect(loadConfig({})).toEqual({ devAuth: false, groupIds: {} })
  })

  it('lee los grupos de las variables de entorno', () => {
    expect(loadConfig({ ENTRA_GROUP_RRHH: ' id-rrhh ' }).groupIds).toEqual({ rrhh: 'id-rrhh' })
  })

  it('en local usa grupos de prueba si no están configurados', () => {
    const config = loadConfig({ DEV_AUTH: 'true' })
    expect(config.devAuth).toBe(true)
    expect(config.groupIds.rrhh).toBe('dev-group-rrhh')
  })

  it('las migraciones al arrancar solo se activan si se pide y hay base de datos', () => {
    const dbEnv = { DB_SERVER: 'servidor', DB_NAME: 'rrhh', DB_USER: 'app', DB_PASSWORD: 'x' }
    expect(loadConfig(dbEnv).migrateOnStart).toBeUndefined()
    expect(loadConfig({ ...dbEnv, DB_MIGRATE_ON_START: 'true' }).migrateOnStart).toBe(true)
    expect(loadConfig({ DB_MIGRATE_ON_START: 'true' })).toEqual({ devAuth: false, groupIds: {} })
    expect(() => loadConfig({ DB_SERVER: 'servidor' })).toThrow('DB_NAME')
  })

  it('se niega a arrancar con autenticación simulada en producción', () => {
    expect(() => loadConfig({ DEV_AUTH: 'true', NODE_ENV: 'production' })).toThrow()
  })

  it('se niega a arrancar con autenticación simulada en Azure App Service', () => {
    expect(() => loadConfig({ DEV_AUTH: 'true', WEBSITE_SITE_NAME: 'rrhh-mexico' })).toThrow()
  })
})

function start(config: AppConfig) {
  const server = createApp({ webDist: tmpdir() + '/no-existe', config }).listen(0)
  const { port } = server.address() as AddressInfo
  return { server, baseUrl: `http://127.0.0.1:${port}` }
}

describe('GET /api/me como en producción', () => {
  const { server, baseUrl } = start({ devAuth: false, groupIds: { rrhh: 'grupo-rrhh', admin: 'grupo-admin' } })
  afterAll(() => {
    server.close()
  })

  it('sin cabecera de App Service responde 401', async () => {
    const res = await fetch(`${baseUrl}/api/me`)
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'No autenticado' })
  })

  it('con cabecera devuelve el usuario y sus roles', async () => {
    const res = await fetch(`${baseUrl}/api/me`, { headers: { [PRINCIPAL_HEADER]: encodePrincipal(USER) } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      id: USER.id,
      name: USER.name,
      email: USER.email,
      roles: ['colaborador', 'rrhh'],
      isAdmin: false,
      viewAs: null,
      // Esta app de prueba no tiene base de datos configurada.
      hasDatabase: false,
    })
  })

  it('el administrador puede ver la app como otro rol; los demás no', async () => {
    const me = async (groups: string[], role: string) => {
      const res = await fetch(`${baseUrl}/api/me`, {
        headers: { [PRINCIPAL_HEADER]: encodePrincipal({ ...USER, groups }), [VIEW_AS_HEADER]: role },
      })
      return (await res.json()) as { roles: string[]; isAdmin: boolean; viewAs: string | null }
    }

    expect(await me(['grupo-admin'], 'rrhh')).toMatchObject({ roles: ['colaborador', 'rrhh'], isAdmin: true, viewAs: 'rrhh' })
    expect(await me(['grupo-admin'], 'colaborador')).toMatchObject({ roles: ['colaborador'], isAdmin: true })
    // Quien no es administrador no gana el rol aunque envíe la cabecera
    expect(await me([], 'rrhh')).toMatchObject({ roles: ['colaborador'], isAdmin: false, viewAs: null })
  })

  it('ignora la cabecera del selector de desarrollo', async () => {
    const res = await fetch(`${baseUrl}/api/me`, { headers: { [DEV_USER_HEADER]: 'dev-rrhh' } })
    expect(res.status).toBe(401)
  })

  it('no expone la lista de usuarios de prueba', async () => {
    const sinSesion = await fetch(`${baseUrl}/api/dev/users`)
    expect(sinSesion.status).toBe(401)

    const conSesion = await fetch(`${baseUrl}/api/dev/users`, {
      headers: { [PRINCIPAL_HEADER]: encodePrincipal(USER) },
    })
    expect(conSesion.status).toBe(404)
  })
})

describe('Autenticación simulada (solo local)', () => {
  const { server, baseUrl } = start(loadConfig({ DEV_AUTH: 'true' }))
  afterAll(() => {
    server.close()
  })

  const me = async (headers: Record<string, string> = {}) => {
    const res = await fetch(`${baseUrl}/api/me`, { headers })
    return { status: res.status, body: (await res.json()) as { id?: string; roles?: string[] } }
  }

  it('sin elegir usuario entra como colaborador de prueba', async () => {
    const { status, body } = await me()
    expect(status).toBe(200)
    expect(body.id).toBe('dev-colaborador')
    expect(body.roles).toEqual(['colaborador'])
  })

  it('el selector cambia de usuario y de roles', async () => {
    expect((await me({ [DEV_USER_HEADER]: 'dev-rrhh' })).body.roles).toEqual(['colaborador', 'rrhh'])
    expect((await me({ [DEV_USER_HEADER]: 'dev-direccion' })).body.roles).toEqual(['colaborador', 'direccion'])
  })

  it('el supervisor de prueba lo es porque tiene gente a su cargo', async () => {
    expect((await me({ [DEV_USER_HEADER]: 'dev-supervisor' })).body.roles).toEqual(['colaborador', 'supervisor'])
  })

  it('un usuario de prueba desconocido responde 400', async () => {
    expect((await me({ [DEV_USER_HEADER]: 'no-existe' })).status).toBe(400)
  })

  it('pisa una cabecera de App Service enviada a mano', async () => {
    const { body } = await me({ [PRINCIPAL_HEADER]: encodePrincipal(USER) })
    expect(body.id).toBe('dev-colaborador')
  })

  it('lista los usuarios de prueba para el selector', async () => {
    const res = await fetch(`${baseUrl}/api/dev/users`)
    const users = (await res.json()) as { id: string; name: string }[]
    expect(users.map((user) => user.id)).toContain('dev-rrhh')
    expect(Object.keys(users[0] ?? {})).toEqual(['id', 'name'])
  })
})
