import type { RequestHandler, Response } from 'express'
import type { AppConfig } from '../config/env.js'
import { DEFAULT_DEV_USER_ID, DEV_USERS } from './devUsers.js'
import { encodePrincipal, parsePrincipal, PRINCIPAL_HEADER } from './principal.js'
import { isAdmin, resolveRoles, viewAs } from './roles.js'
import type { AuthContext, AuthUser, Role } from './types.js'

/** Cabecera con la que el selector de desarrollo elige el usuario de prueba. */
export const DEV_USER_HEADER = 'x-dev-user'

/** Cabecera con el rol elegido por el administrador en el selector «Ver como». */
export const VIEW_AS_HEADER = 'x-view-as-role'

export type SupervisorLookup = (user: AuthUser) => Promise<boolean>

/**
 * SOLO DESARROLLO. Sustituye la cabecera de Easy Auth por la del usuario de prueba elegido.
 * A partir de aquí el resto del código no distingue un usuario real de uno simulado.
 */
export function devAuth(config: AppConfig): RequestHandler {
  return (req, res, next) => {
    const requested = req.get(DEV_USER_HEADER) ?? DEFAULT_DEV_USER_ID
    const devUser = DEV_USERS.find((user) => user.id === requested)
    if (!devUser) {
      res.status(400).json({ error: 'Usuario de prueba desconocido' })
      return
    }

    const groups = devUser.groupRoles
      .map((role) => config.groupIds[role])
      .filter((groupId): groupId is string => groupId !== undefined)

    // Se pisa cualquier valor que viniera en la petición.
    req.headers[PRINCIPAL_HEADER] = encodePrincipal({
      id: devUser.id,
      name: devUser.name,
      email: devUser.email,
      groups,
    })
    next()
  }
}

/** Exige un usuario autenticado y deja su contexto (usuario y roles) disponible para las rutas. */
export function authenticate(config: AppConfig, isSupervisor: SupervisorLookup): RequestHandler {
  return async (req, res, next) => {
    const user = parsePrincipal(req.get(PRINCIPAL_HEADER))
    if (!user) {
      res.status(401).json({ error: 'No autenticado' })
      return
    }

    const realRoles = resolveRoles(user, config.groupIds, await isSupervisor(user))
    // «Ver como»: solo tiene efecto si quien lo pide es administrador de verdad.
    const auth: AuthContext = { user, isAdmin: isAdmin(realRoles), ...viewAs(realRoles, req.get(VIEW_AS_HEADER)) }
    res.locals.auth = auth
    next()
  }
}

/** Contexto del usuario autenticado. Solo se puede usar en rutas que pasan por `authenticate`. */
export function getAuth(res: Response): AuthContext {
  const auth = res.locals.auth as AuthContext | undefined
  if (!auth) throw new Error('getAuth se usó en una ruta sin autenticación')
  return auth
}

/**
 * Exige que el usuario tenga al menos uno de los roles indicados. El administrador pasa siempre.
 * El Buzón de Quejas, cuando se construya, no debe usar esta función: el administrador queda fuera.
 */
export function requireRole(...allowed: Role[]): RequestHandler {
  return (_req, res, next) => {
    const { roles } = getAuth(res)
    if (!isAdmin(roles) && !roles.some((role) => allowed.includes(role))) {
      res.status(403).json({ error: 'No tienes permiso para esta acción' })
      return
    }
    next()
  }
}
