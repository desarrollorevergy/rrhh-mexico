// Único punto por el que el front habla con la API.

const DEV_USER_KEY = 'devUser'

/** Usuario de prueba elegido en el selector. Solo tiene efecto en desarrollo. */
export function getDevUser(): string | null {
  try {
    return localStorage.getItem(DEV_USER_KEY)
  } catch {
    return null
  }
}

export function setDevUser(id: string | null): void {
  try {
    if (id) localStorage.setItem(DEV_USER_KEY, id)
    else localStorage.removeItem(DEV_USER_KEY)
  } catch {
    // Sin almacenamiento: se queda el usuario de prueba por defecto.
  }
}

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }

  // En producción este bloque no existe: la identidad la pone App Service.
  if (import.meta.env.DEV) {
    const devUser = getDevUser()
    if (devUser) headers['X-Dev-User'] = devUser
  }

  const res = await fetch(path, { headers })
  if (!res.ok) {
    let message = `Error ${res.status}`
    try {
      const body: unknown = await res.json()
      if (typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string') {
        message = body.error
      }
    } catch {
      // La respuesta no era JSON: se deja el mensaje genérico.
    }
    throw new ApiError(res.status, message)
  }
  return (await res.json()) as T
}
