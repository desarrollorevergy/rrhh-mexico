import { existsSync } from 'node:fs'
import path from 'node:path'
import express, { type ErrorRequestHandler, type Express } from 'express'
import { createAdminRepository } from './admin/repository.js'
import { adminRouter } from './admin/routes.js'
import { approvalsRouter } from './approvals/routes.js'
import { createApprovalService } from './approvals/service.js'
import { DEV_USERS, devIsSupervisor } from './auth/devUsers.js'
import { authenticate, devAuth, getAuth, type SupervisorLookup } from './auth/middleware.js'
import { loadConfig, type AppConfig } from './config/env.js'
import { pingDb, supervisorLookupFromDb } from './db/employees.js'

// Front compilado. La ruta vale igual en desarrollo (api/src, con tsx) y compilado
// (api/dist): los dos están a dos niveles de la raíz del repo.
const DEFAULT_WEB_DIST = path.resolve(import.meta.dirname, '../../web/dist')

export interface AppOptions {
  /** Carpeta del front compilado. Solo se cambia en las pruebas. */
  webDist?: string
  /** Configuración. Por defecto se lee de las variables de entorno. */
  config?: AppConfig
  /** Cómo saber si un usuario tiene gente a su cargo. */
  isSupervisor?: SupervisorLookup
}

const noSupervisors: SupervisorLookup = async () => false

// Supervisor "por datos": sale de la tabla de empleados. Sin base de datos configurada
// se usa la jerarquía de prueba en local y, fuera de local, nadie es supervisor.
function defaultSupervisorLookup(config: AppConfig): SupervisorLookup {
  if (config.db) return supervisorLookupFromDb(config.db)
  return config.devAuth ? devIsSupervisor : noSupervisors
}

// Se separa de server.ts para poder probar la app sin abrir un puerto.
export function createApp(options: AppOptions = {}): Express {
  const webDist = options.webDist ?? DEFAULT_WEB_DIST
  const config = options.config ?? loadConfig()
  const isSupervisor = options.isSupervisor ?? defaultSupervisorLookup(config)
  const app = express()

  app.disable('x-powered-by')
  app.use(express.json())

  // Pública: la usa la comprobación de estado de App Service.
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' })
  })

  // Solo en local: usuario simulado y lista de usuarios de prueba para el selector.
  if (config.devAuth) {
    app.use('/api', devAuth(config))
    app.get('/api/dev/users', (_req, res) => {
      res.json(DEV_USERS.map(({ id, name }) => ({ id, name })))
    })
  }

  // A partir de aquí, toda la API exige un usuario autenticado.
  app.use('/api', authenticate(config, isSupervisor))

  app.get('/api/me', (_req, res) => {
    const { user, roles } = getAuth(res)
    res.json({ id: user.id, name: user.name, email: user.email, roles })
  })

  // ¿Responde la base de datos? No da detalles del error.
  app.get('/api/health/db', async (_req, res) => {
    if (!config.db) {
      res.status(503).json({ status: 'sin configurar' })
      return
    }
    try {
      await pingDb(config.db)
      res.json({ status: 'ok' })
    } catch {
      res.status(503).json({ status: 'error' })
    }
  })

  // Catálogos, administración y motor de aprobaciones. Necesitan la base de datos.
  if (config.db) {
    app.use('/api', adminRouter(createAdminRepository(config.db)))
    const approvals = createApprovalService({ db: config.db, includeDemo: config.devAuth })
    app.use('/api/approvals', approvalsRouter(config, config.db, approvals))
  }

  // Cualquier /api que no exista responde 404 en JSON, nunca el index.html del front.
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Recurso no encontrado' })
  })

  // En producción Express sirve también el front. En desarrollo lo sirve Vite,
  // así que si no hay compilado esta parte no se monta.
  const indexHtml = path.join(webDist, 'index.html')
  if (existsSync(indexHtml)) {
    // Los archivos de /assets llevan hash en el nombre: caché larga, y 404 si no existen.
    app.use(
      '/assets',
      express.static(path.join(webDist, 'assets'), {
        immutable: true,
        maxAge: '1y',
        fallthrough: false,
      }),
    )
    app.use(express.static(webDist, { index: false }))

    // Resto de rutas: las resuelve el router del front (sintaxis de comodín de Express 5).
    app.get('/{*splat}', (_req, res) => {
      res.set('Cache-Control', 'no-cache')
      res.sendFile(indexHtml)
    })
  }

  // Errores no controlados: respuesta genérica. No se registra la petición ni datos personales.
  const onError: ErrorRequestHandler = (err, _req, res, next) => {
    if (res.headersSent) {
      next(err)
      return
    }
    const status = typeof err?.status === 'number' ? err.status : 500
    if (status >= 500) console.error('Error no controlado:', err instanceof Error ? err.name : 'desconocido')
    res.status(status).json({ error: status === 404 ? 'Recurso no encontrado' : 'Error interno' })
  }
  app.use(onError)

  return app
}
