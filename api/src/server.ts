import { createApp } from './app.js'

// App Service entrega el puerto en process.env.PORT; en local se usa el 3000.
const port = Number(process.env.PORT ?? 3000)

createApp().listen(port, () => {
  console.log(`API escuchando en el puerto ${port}`)
})
