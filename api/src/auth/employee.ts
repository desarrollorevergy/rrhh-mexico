import type { RequestHandler, Response } from 'express'
import type { DbConfig } from '../config/env.js'
import { findEmployeeByEmail } from '../db/employees.js'
import { getAuth } from './middleware.js'
import type { Role } from './types.js'

/** Quien actúa en una petición: su ficha de empleado y sus roles. */
export interface Actor {
  employeeId: number
  roles: Role[]
}

/**
 * Exige que el usuario autenticado tenga ficha de empleado activa y la deja disponible
 * para las rutas. Va detrás de `authenticate`.
 */
export function requireEmployee(db: DbConfig): RequestHandler {
  return async (_req, res, next) => {
    const { user, roles } = getAuth(res)
    const employee = await findEmployeeByEmail(db, user.email)
    if (!employee) {
      res.status(403).json({ error: 'Tu usuario no tiene ficha de empleado. Pide a RRHH que te dé de alta.' })
      return
    }
    const actor: Actor = { employeeId: employee.id, roles }
    res.locals.actor = actor
    next()
  }
}

/** Solo en rutas que pasan por `requireEmployee`. */
export function getActor(res: Response): Actor {
  const actor = res.locals.actor as Actor | undefined
  if (!actor) throw new Error('getActor se usó en una ruta sin requireEmployee')
  return actor
}
