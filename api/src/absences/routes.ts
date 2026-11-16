import { Router, type Request, type RequestHandler } from 'express'
import { getActor, requireEmployee, type Actor } from '../auth/employee.js'
import type { DbConfig } from '../config/env.js'
import { AbsenceError, parseAbsence, timeZoneOrDefault, type AbsenceService } from './service.js'

/**
 * Rutas de /api/absences: vacaciones y ausentismos del propio colaborador. Van detrás de
 * `authenticate`. El empleado sale siempre de la sesión, nunca de la petición.
 */
export function absencesRouter(db: DbConfig, service: AbsenceService): Router {
  const router = Router()
  router.use(requireEmployee(db))

  const handle =
    (action: (actor: Actor, req: Request) => Promise<unknown>): RequestHandler =>
    async (req, res) => {
      try {
        res.json(await action(getActor(res), req))
      } catch (error) {
        if (!(error instanceof AbsenceError)) throw error
        res.status(error.status).json({ error: error.message })
      }
    }

  const bodyOf = (req: Request) => (req.body ?? {}) as Record<string, unknown>

  // Saldo de vacaciones y mis solicitudes.
  router.get('/mine', handle((actor, req) => service.overview(actor.employeeId, timeZoneOrDefault(req.query.timeZone))))

  // Días que contaría una solicitud y si se puede pedir, antes de enviarla.
  router.post(
    '/preview',
    handle((actor, req) => service.preview(actor.employeeId, parseAbsence(req.body), timeZoneOrDefault(bodyOf(req).timeZone))),
  )

  router.post(
    '/',
    handle((actor, req) => service.create(actor.employeeId, parseAbsence(req.body), timeZoneOrDefault(bodyOf(req).timeZone))),
  )

  router.post(
    '/:id/cancel',
    handle((actor, req) => {
      const id = Number(req.params.id)
      if (!Number.isInteger(id) || id <= 0) throw new AbsenceError(404, 'Solicitud no encontrada')
      return service.cancel(actor, id)
    }),
  )

  return router
}
