import { Router, type RequestHandler } from 'express'
import { isValidDate } from '../admin/validation.js'
import { getActor, requireEmployee, type Actor } from '../auth/employee.js'
import type { DbConfig } from '../config/env.js'
import { parseClockIn, parseComment, parseTimeZone, TimesheetError, type TimesheetService } from './service.js'

/**
 * Rutas de /api/timesheet: el fichaje del propio colaborador. Van detrás de `authenticate`.
 * Cada uno solo ve y cambia sus jornadas: el empleado sale siempre de la sesión, nunca de la petición.
 */
export function timesheetRouter(db: DbConfig, service: TimesheetService): Router {
  const router = Router()
  router.use(requireEmployee(db))

  const handle =
    (action: (actor: Actor, req: Parameters<RequestHandler>[0]) => Promise<unknown>): RequestHandler =>
    async (req, res) => {
      try {
        res.json(await action(getActor(res), req))
      } catch (error) {
        if (!(error instanceof TimesheetError)) throw error
        res.status(error.status).json({ error: error.message })
      }
    }

  // La zona horaria del dispositivo viaja en cada petición; la hora la pone siempre el servidor.
  const timeZoneOf = (req: Parameters<RequestHandler>[0]) =>
    parseTimeZone(req.method === 'GET' ? req.query.timeZone : (req.body as Record<string, unknown> | undefined)?.timeZone)

  router.get('/today', handle((actor, req) => service.today(actor.employeeId, timeZoneOf(req))))

  router.post(
    '/clock-in',
    handle((actor, req) => service.clockIn(actor.employeeId, timeZoneOf(req), parseClockIn(req.body))),
  )

  router.post('/clock-out', handle((actor, req) => service.clockOut(actor.employeeId, timeZoneOf(req))))

  router.put(
    '/today/comment',
    handle((actor, req) => service.setComment(actor.employeeId, timeZoneOf(req), parseComment(req.body))),
  )

  // «Mi semana»
  router.get('/weeks', handle((actor, req) => service.weeks(actor.employeeId, timeZoneOf(req))))

  router.get(
    '/week',
    handle((actor, req) => {
      const date = req.query.date
      if (typeof date !== 'string' || !isValidDate(date)) throw new TimesheetError(400, 'Fecha no válida')
      return service.week(actor.employeeId, date)
    }),
  )

  router.put(
    '/entries/:id/comment',
    handle(async (actor, req) => {
      const id = Number(req.params.id)
      if (!Number.isInteger(id) || id <= 0) throw new TimesheetError(404, 'Jornada no encontrada')
      await service.setEntryComment(actor.employeeId, id, parseComment(req.body))
      return { ok: true }
    }),
  )

  return router
}
