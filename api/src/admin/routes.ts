import { Router, type RequestHandler } from 'express'
import { requireRole } from '../auth/middleware.js'
import { AdminError, type AdminRepository } from './repository.js'
import { parseEmployee, parseHoliday, parseName, type Parsed } from './validation.js'

/** Identificador numérico de la URL, o error 404 si no lo es. */
function idParam(value: unknown): number {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) throw new AdminError(404, 'No encontrado')
  return id
}

function valueOf<T>(parsed: Parsed<T>): T {
  if (!parsed.ok) throw new AdminError(400, parsed.error)
  return parsed.value
}

/** Ejecuta la acción y responde; los errores de datos salen con su mensaje y código. */
const handle =
  (action: (req: Parameters<RequestHandler>[0]) => Promise<unknown>): RequestHandler =>
  async (req, res) => {
    try {
      res.json(await action(req))
    } catch (error) {
      if (!(error instanceof AdminError)) throw error
      res.status(error.status).json({ error: error.message })
    }
  }

/** Catálogos y administración. Va detrás de `authenticate`. */
export function adminRouter(repository: AdminRepository): Router {
  const router = Router()

  // Las analíticas las necesita cualquier empleado para fichar.
  router.get('/projects', handle(() => repository.listProjects()))

  // El calendario de festivos lo consulta cualquiera; solo RRHH lo cambia.
  router.get(
    '/holidays',
    handle((req) => {
      const year = Number(req.query.year ?? new Date().getFullYear())
      if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new AdminError(400, 'Año no válido')
      return repository.listHolidays(year)
    }),
  )

  // A partir de aquí, solo RRHH: datos de empleados y mantenimiento de catálogos.
  const rrhh = requireRole('rrhh')

  router.post('/holidays', rrhh, handle((req) => repository.createHoliday(valueOf(parseHoliday(req.body)))))
  router.delete(
    '/holidays/:id',
    rrhh,
    handle(async (req) => {
      await repository.deleteHoliday(idParam(req.params.id))
      return { ok: true }
    }),
  )

  router.get('/departments', rrhh, handle(() => repository.listDepartments()))
  router.post('/departments', rrhh, handle((req) => repository.createDepartment(valueOf(parseName(req.body, 100)))))

  router.get('/employees', rrhh, handle(() => repository.listEmployees()))
  router.post('/employees', rrhh, handle((req) => repository.createEmployee(valueOf(parseEmployee(req.body)))))
  router.put(
    '/employees/:id',
    rrhh,
    handle((req) => repository.updateEmployee(idParam(req.params.id), valueOf(parseEmployee(req.body)))),
  )

  return router
}
