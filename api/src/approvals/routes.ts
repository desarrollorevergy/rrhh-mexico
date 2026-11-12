import { Router, type RequestHandler, type Response } from 'express'
import { getAuth } from '../auth/middleware.js'
import type { AppConfig, DbConfig } from '../config/env.js'
import { findEmployeeByEmail } from '../db/employees.js'
import { DEMO_TYPE } from './chains.js'
import type { Actor, ApprovalService } from './service.js'
import { ApprovalError, type ApprovalErrorCode } from './types.js'

const HTTP_STATUS: Record<ApprovalErrorCode, number> = {
  not_found: 404,
  not_allowed: 403,
  not_pending: 409,
  not_rejected: 409,
  invalid_slot: 409,
  reason_required: 400,
  invalid_chain: 500,
  unknown_type: 400,
}

/** Quien actúa en esta petición. Solo en rutas que pasan por `resolveActor`. */
function getActor(res: Response): Actor {
  return res.locals.actor as Actor
}

/** Rutas de /api/approvals. Van detrás de `authenticate`. */
export function approvalsRouter(config: AppConfig, db: DbConfig, service: ApprovalService): Router {
  const router = Router()

  // Las aprobaciones se hacen entre empleados: hace falta la ficha de quien actúa.
  const resolveActor: RequestHandler = async (_req, res, next) => {
    const { user, roles } = getAuth(res)
    const employee = await findEmployeeByEmail(db, user.email)
    if (!employee) {
      res.status(403).json({ error: 'Tu usuario no tiene ficha de empleado' })
      return
    }
    const actor: Actor = { employeeId: employee.id, roles }
    res.locals.actor = actor
    next()
  }
  router.use(resolveActor)

  /** Ejecuta la acción y traduce los errores del motor a su código HTTP. */
  const handle =
    (action: (id: number, actor: Actor, body: Record<string, unknown>) => Promise<unknown>): RequestHandler =>
    async (req, res) => {
      const id = Number(req.params.id ?? 0)
      const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>
      try {
        if (req.params.id !== undefined && !(Number.isInteger(id) && id > 0)) throw new ApprovalError('not_found')
        res.json(await action(id, getActor(res), body))
      } catch (error) {
        if (!(error instanceof ApprovalError)) throw error
        res.status(HTTP_STATUS[error.code]).json({ error: error.message })
      }
    }

  router.get('/pending', handle((_id, actor) => service.listPending(actor)))
  router.get('/mine', handle((_id, actor) => service.listMine(actor)))

  // Solo en local: crea una solicitud de prueba a nombre del usuario actual.
  if (config.devAuth) {
    router.post(
      '/demo',
      handle(async (_id, actor) => {
        const id = await service.create({ type: DEMO_TYPE, requesterId: actor.employeeId })
        return service.get(id, actor)
      }),
    )
  }

  router.get('/:id', handle((id, actor) => service.get(id, actor)))
  router.post('/:id/approve', handle((id, actor) => service.decide(id, actor, 'approve')))
  router.post(
    '/:id/reject',
    handle((id, actor, body) =>
      service.decide(id, actor, 'reject', typeof body.reason === 'string' ? body.reason : undefined),
    ),
  )
  router.post('/:id/resubmit', handle((id, actor) => service.resubmit(id, actor)))
  router.post('/:id/cancel', handle((id, actor) => service.cancel(id, actor)))

  return router
}
