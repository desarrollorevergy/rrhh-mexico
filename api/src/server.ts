import { createApp } from './app.js'
import { loadConfig } from './config/env.js'
import { migrate } from './db/migrate.js'

// App Service entrega el puerto en process.env.PORT; en local se usa el 3000.
const port = Number(process.env.PORT ?? 3000)
const config = loadConfig()

// En Azure las tablas se ponen al día al arrancar (DB_MIGRATE_ON_START=true).
// Si una migración falla, la app no arranca: es preferible a funcionar con tablas a medias.
if (config.db && config.migrateOnStart) {
  try {
    const applied = await migrate(config.db)
    console.log(applied.length ? `Migraciones aplicadas: ${applied.join(', ')}` : 'Base de datos al día.')
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error ? ` (${error.cause.message})` : ''
    console.error(`No se pudieron aplicar las migraciones: ${error instanceof Error ? error.message : 'error'}${cause}`)
    process.exit(1)
  }
}

createApp({ config }).listen(port, () => {
  console.log(`API escuchando en el puerto ${port}`)
  if (config.devAuth) console.log('AVISO: autenticación simulada activa (DEV_AUTH=true). Solo para local.')
})
