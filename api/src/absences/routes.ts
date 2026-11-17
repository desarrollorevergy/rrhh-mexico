import { Router, type Request, type RequestHandler } from 'express'
import { getActor, requireEmployee, type Actor } from '../auth/employee.js'
import type { DbConfig } from '../config/env.js'
import { parseAdjustment, parseReason, type AbsenceReviewService } from './review.js'
import { AbsenceError, parseAbsence, timeZoneOrDefault, type AbsenceService } from './service.js'

/**
 * Rutas de /api/absences: vacaciones y ausentismos. Van detrás de `authenticate`.
 * Quien actúa sale siempre de la sesión, nunca de la petición. El alcance de la revisión
 * (equipo directo para el supervisor, todo para RRHH) lo decide el servicio.
 */
export function absencesRouter(db: DbConfig, service: AbsenceService, review: AbsenceReviewService): Router {
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

  const idOf = (req: Request): number => {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id <= 0) throw new AbsenceError(404, 'Solicitud no encontrada')
    return id
  }

  router.post('/:id/cancel', handle((actor, req) => service.cancel(actor, idOf(req))))

  // --- Revisión: supervisor (su equipo) y RRHH (todas) ---

  router.get('/review', handle((actor) => review.list(actor)))

  router.post('/:id/approve', handle((actor, req) => review.decide(actor, idOf(req), 'approve')))

  router.post(
    '/:id/reject',
    handle((actor, req) =>
      review.decide(actor, idOf(req), 'reject', parseReason(req.body, 'El motivo del rechazo es obligatorio')),
    ),
  )

  // --- Solo RRHH ---

  router.post(
    '/:id/cancel-approved',
    handle((actor, req) =>
      review.cancelApproved(actor, idOf(req), parseReason(req.body, 'El motivo de la cancelación es obligatorio')),
    ),
  )

  router.get('/balances', handle((actor, req) => review.balances(actor, timeZoneOrDefault(req.query.timeZone))))

  router.post(
    '/balances/:employeeId/adjust',
    handle(async (actor, req) => {
      const employeeId = Number(req.params.employeeId)
      if (!Number.isInteger(employeeId) || employeeId <= 0) throw new AbsenceError(404, 'Empleado no encontrado')
      await review.adjust(actor, employeeId, parseAdjustment(req.body), timeZoneOrDefault(bodyOf(req).timeZone))
      return { ok: true }
    }),
  )

  return router
}
