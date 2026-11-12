import { existsSync } from 'node:fs'
import path from 'node:path'
import express, { type Express } from 'express'

// Front compilado. La ruta vale igual en desarrollo (api/src, con tsx) y compilado
// (api/dist): los dos están a dos niveles de la raíz del repo.
const DEFAULT_WEB_DIST = path.resolve(import.meta.dirname, '../../web/dist')

export interface AppOptions {
  /** Carpeta del front compilado. Solo se cambia en las pruebas. */
  webDist?: string
}

// Se separa de server.ts para poder probar la app sin abrir un puerto.
export function createApp(options: AppOptions = {}): Express {
  const webDist = options.webDist ?? DEFAULT_WEB_DIST
  const app = express()

  app.disable('x-powered-by')
  app.use(express.json())

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' })
  })

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

  return app
}
