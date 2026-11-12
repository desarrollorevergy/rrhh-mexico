import express, { type Express } from 'express'

// Se separa de server.ts para poder probar la app sin abrir un puerto.
export function createApp(): Express {
  const app = express()

  app.disable('x-powered-by')
  app.use(express.json())

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' })
  })

  return app
}
