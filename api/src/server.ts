import { createApp } from './app.js'
import { loadConfig } from './config/env.js'

// App Service entrega el puerto en process.env.PORT; en local se usa el 3000.
const port = Number(process.env.PORT ?? 3000)
const config = loadConfig()

createApp({ config }).listen(port, () => {
  console.log(`API escuchando en el puerto ${port}`)
  if (config.devAuth) console.log('AVISO: autenticación simulada activa (DEV_AUTH=true). Solo para local.')
})
