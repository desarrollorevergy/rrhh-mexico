import { Router, type Request, type RequestHandler, type Response } from 'express'
import { isValidDate } from '../admin/validation.js'
import { getActor, requireEmployee, type Actor } from '../auth/employee.js'
import { requireRole } from '../auth/middleware.js'
import type { DbConfig } from '../config/env.js'
import { parseCorrection } from './corrections.js'
import { parseWeekKeys, type PayrollService } from './payroll.js'
import { parseReject, parseWeekAction, type TeamService } from './team.js'
import {
  parseClockIn,
  parseComment,
  parseNote,
  parseTimeZone,
  TimesheetError,
  type TimesheetService,
} from './service.js'

/**
 * Rutas de /api/timesheet/payroll: el panel de RRHH con las semanas aprobadas y el CSV de
 * nómina. Solo RRHH (y el administrador). No exigen ficha de empleado: son de solo lectura.
 */
export function payrollRouter(payroll: PayrollService): Router {
  const router = Router()
  router.use(requireRole('rrhh'))

  const handle =
    (action: (req: Request, res: Response) => Promise<void>): RequestHandler =>
    async (req, res) => {
      try {
        await action(req, res)
      } catch (error) {
        if (!(error instanceof TimesheetError)) throw error
        res.status(error.status).json({ error: error.message })
      }
    }

  router.get('/summary', handle(async (_req, res) => void res.json(await payroll.summary())))

  router.get(
    '/week',
    handle(async (req, res) => {
      const employeeId = Number(req.query.employeeId)
      const date = req.query.date
      if (!Number.isInteger(employeeId) || typeof date !== 'string' || !isValidDate(date)) {
        throw new TimesheetError(400, 'Semana no válida')
      }
      res.json(await payroll.detail(employeeId, date))
    }),
  )

  // Exporta exactamente las semanas que RRHH tiene a la vista tras filtrar.
  router.post(
    '/export',
    handle(async (req, res) => {
      const csv = await payroll.exportCsv(parseWeekKeys(req.body))
      res
        .type('text/csv; charset=utf-8')
        .set('Content-Disposition', 'attachment; filename="reporte_nomina_semanal.csv"')
        .send(csv)
    }),
  )

  return router
}

/**
 * Rutas de /api/timesheet: el fichaje del propio colaborador. Van detrás de `authenticate`.
 * Cada uno solo ve y cambia sus jornadas: el empleado sale siempre de la sesión, nunca de la petición.
 */
export function timesheetRouter(db: DbConfig, service: TimesheetService, team: TeamService): Router {
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

  // Corrección de los días rechazados y reenvío al supervisor
  router.put(
    '/entries/:id',
    handle((actor, req) => {
      const id = Number(req.params.id)
      if (!Number.isInteger(id) || id <= 0) throw new TimesheetError(404, 'Jornada no encontrada')
      return service.correctOwnEntry(actor.employeeId, id, parseCorrection(req.body))
    }),
  )

  router.post(
    '/week/send-correction',
    handle((actor, req) => {
      const date = (req.body as Record<string, unknown> | undefined)?.date
      if (typeof date !== 'string' || !isValidDate(date)) throw new TimesheetError(400, 'Fecha no válida')
      return service.sendCorrection(actor, date, parseNote(req.body))
    }),
  )

  // Supervisión: quien tiene gente a su cargo, solo sobre su equipo directo. El administrador
  // pasa siempre (requireRole) y alcanza a todos los empleados (team.ts).
  const supervisor = requireRole('supervisor')

  router.get('/team/summary', supervisor, handle((actor) => team.summary(actor)))

  router.get(
    '/team/week',
    supervisor,
    handle((actor, req) => {
      const employeeId = Number(req.query.employeeId)
      const date = req.query.date
      if (!Number.isInteger(employeeId) || typeof date !== 'string' || !isValidDate(date)) {
        throw new TimesheetError(400, 'Semana no válida')
      }
      return team.detail(actor, employeeId, date)
    }),
  )

  router.get(
    '/team/week/history',
    supervisor,
    handle((actor, req) => {
      const employeeId = Number(req.query.employeeId)
      const date = req.query.date
      if (!Number.isInteger(employeeId) || typeof date !== 'string' || !isValidDate(date)) {
        throw new TimesheetError(400, 'Semana no válida')
      }
      return team.history(actor, employeeId, date)
    }),
  )

  router.put(
    '/team/entries/:id',
    supervisor,
    handle((actor, req) => {
      const id = Number(req.params.id)
      if (!Number.isInteger(id) || id <= 0) throw new TimesheetError(404, 'Jornada no encontrada')
      return team.correct(actor, id, parseCorrection(req.body))
    }),
  )

  router.post(
    '/team/week/approve',
    supervisor,
    handle((actor, req) => {
      const { employeeId, weekStart } = parseWeekAction(req.body)
      return team.approve(actor, employeeId, weekStart)
    }),
  )

  router.post(
    '/team/week/reject',
    supervisor,
    handle((actor, req) => {
      const { employeeId, weekStart } = parseWeekAction(req.body)
      return team.reject(actor, employeeId, weekStart, parseReject(req.body))
    }),
  )

  return router
}
