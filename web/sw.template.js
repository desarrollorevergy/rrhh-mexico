// Service worker: guarda la aplicación en el dispositivo para poder abrirla y fichar sin red.
// Es una plantilla: al compilar, vite.config.ts sustituye la versión y la lista de archivos
// y la publica como /sw.js. Nunca guarda respuestas de la API: los datos van siempre al servidor.

const CACHE = 'rrhh-__VERSION__'
/** Todos los archivos de la aplicación compilada, incluidas las pantallas que se cargan bajo demanda. */
const PRECACHE = __PRECACHE__
/** Con datos móviles activos pero sin cobertura real, no se espera a la red más que esto para abrir la app. */
const NAVIGATION_TIMEOUT_MS = 3000

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)))
})

// La versión nueva espera a que se cierre la app para activarse: así una sesión abierta no se
// queda a medias entre dos versiones. Al activarse, borra las cachés de versiones anteriores.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  // La API y el inicio de sesión de App Service van siempre directos a la red.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/.auth/')) return

  if (request.mode === 'navigate') {
    event.respondWith(openApp(request))
    return
  }
  event.respondWith(fromCacheFirst(request))
})

/** Abrir la app: primero la red (para tener la última versión y el inicio de sesión); sin red, la copia guardada. */
async function openApp(request) {
  try {
    const response = await withTimeout(fetch(request), NAVIGATION_TIMEOUT_MS)
    // Solo se guarda la propia página; una redirección al inicio de sesión se devuelve tal cual.
    if (response.ok && response.type === 'basic') {
      const copy = response.clone()
      caches.open(CACHE).then((cache) => cache.put('/', copy))
    }
    return response
  } catch (error) {
    const cached = await caches.match('/')
    if (cached) return cached
    throw error
  }
}

/** Archivos de la aplicación (llevan hash en el nombre): la copia guardada y, si no está, la red. */
async function fromCacheFirst(request) {
  const cached = await caches.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok && response.type === 'basic') {
    const copy = response.clone()
    caches.open(CACHE).then((cache) => cache.put(request, copy))
  }
  return response
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}
