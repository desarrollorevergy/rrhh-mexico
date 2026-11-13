import type { RequestHandler, Response } from 'express'
import type { DbConfig } from '../config/env.js'
import { ensureEmployee } from '../db/employees.js'
import { getAuth } from './middleware.js'
import type { Role } from './types.js'

/** Quien actúa en una petición: su ficha de empleado y sus roles. */
export interface Actor {
  employeeId: number
  roles: Role[]
}

/**
 * Deja disponible para las rutas la ficha de empleado del usuario autenticado. A quien no
 * tiene se le crea una básica en ese momento (decisión del 2026-11-13: se puede usar el Parte
 * de Horas sin esperar a RRHH). Solo se rechaza a quien tiene la ficha dada de baja.
 * Va detrás de `authenticate`.
 */
export function requireEmployee(db: DbConfig): RequestHandler {
  return async (_req, res, next) => {
    const { user, roles } = getAuth(res)
    const employee = await ensureEmployee(db, user)
    if (!employee) {
      res.status(403).json({ error: 'Tu ficha de empleado está dada de baja. Consulta con RRHH.' })
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
