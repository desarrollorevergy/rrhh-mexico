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

const VIEW_AS_KEY = 'viewAsRole'

/** Rol elegido por el administrador en el selector «Ver como». La API lo ignora si no lo es. */
export function getViewAsRole(): string | null {
  try {
    return localStorage.getItem(VIEW_AS_KEY)
  } catch {
    return null
  }
}

export function setViewAsRole(role: string | null): void {
  try {
    if (role) localStorage.setItem(VIEW_AS_KEY, role)
    else localStorage.removeItem(VIEW_AS_KEY)
  } catch {
    // Sin almacenamiento: se queda como administrador.
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

export function apiGet<T>(path: string): Promise<T> {
  return apiRequest<T>('GET', path)
}

export function apiPost<T>(path: string, body: unknown = {}): Promise<T> {
  return apiRequest<T>('POST', path, body)
}

export function apiPut<T>(path: string, body: unknown): Promise<T> {
  return apiRequest<T>('PUT', path, body)
}

export function apiDelete<T>(path: string): Promise<T> {
  return apiRequest<T>('DELETE', path)
}

async function apiRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  const viewAsRole = getViewAsRole()
  if (viewAsRole) headers['X-View-As-Role'] = viewAsRole

  // En producción este bloque no existe: la identidad la pone App Service.
  if (import.meta.env.DEV) {
    const devUser = getDevUser()
    if (devUser) headers['X-Dev-User'] = devUser
  }

  const res = await fetch(path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
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
