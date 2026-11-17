import { Router, type Request, type RequestHandler, type Response } from 'express'
import { getAuth, requireRole } from '../auth/middleware.js'
import { fileAccess, isHrRole, listScope, withoutSensitive } from './access.js'
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
  (action: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  async (req, res) => {
    try {
      res.json(await action(req, res))
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

  // A partir de aquí, solo RRHH salvo la lectura de fichas: altas, ediciones y catálogos.
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

  // Lectura de fichas: cada uno según su rol (ver access.ts). Solo RRHH escribe.
  router.get(
    '/employees',
    handle(async (_req, res) => {
      const { user, roles } = getAuth(res)
      const scope = listScope(roles)
      if (!scope) throw new AdminError(403, 'No tienes acceso a la lista de empleados')
      if (scope === 'all') return repository.listEmployees()
      const actorId = await repository.employeeIdByEmail(user.email)
      return actorId === undefined ? [] : repository.listEmployees({ supervisorId: actorId })
    }),
  )

  // «Mi ficha»: la propia, completa y en solo lectura. Va antes de /employees/:id.
  router.get(
    '/employees/me',
    handle(async (_req, res) => {
      const actorId = await repository.employeeIdByEmail(getAuth(res).user.email)
      if (actorId === undefined) throw new AdminError(404, 'Aún no tienes ficha de empleado. Consulta con RRHH.')
      return { ...(await repository.getEmployee(actorId)), access: 'full' }
    }),
  )

  router.get(
    '/employees/:id',
    handle(async (req, res) => {
      const { user, roles } = getAuth(res)
      const employee = await repository.getEmployee(idParam(req.params.id))
      const actorId = isHrRole(roles) ? undefined : await repository.employeeIdByEmail(user.email)
      const access = fileAccess(roles, actorId, employee)
      if (!access) throw new AdminError(403, 'No tienes acceso a esta ficha')
      return access === 'full' ? { ...employee, access } : { ...withoutSensitive(employee), access }
    }),
  )
  router.post('/employees', rrhh, handle((req) => repository.createEmployee(valueOf(parseEmployee(req.body)))))
  router.put(
    '/employees/:id',
    rrhh,
    handle((req) => repository.updateEmployee(idParam(req.params.id), valueOf(parseEmployee(req.body)))),
  )

  return router
}
