import { useEffect, useState, type ReactNode } from 'react'
import { ApiError, apiGet, getDevUser, NetworkError, setDevUser } from '../api/client.ts'
import { AuthContext, type CurrentUser } from './authContext.ts'

const CACHED_USER_KEY = 'auth.me'

/** Usuario de la última vez que hubo red. Solo sirve para pintar la app: la API comprueba todo de nuevo. */
function cachedUser(): CurrentUser | null {
  try {
    const raw = localStorage.getItem(CACHED_USER_KEY)
    return raw ? (JSON.parse(raw) as CurrentUser) : null
  } catch {
    return null
  }
}

function rememberUser(user: CurrentUser): void {
  try {
    localStorage.setItem(CACHED_USER_KEY, JSON.stringify(user))
  } catch {
    // Sin almacenamiento: la app no se podrá abrir sin red.
  }
}

type State = { status: 'loading' } | { status: 'ready'; user: CurrentUser } | { status: 'error' }

// Carga el usuario al arrancar. La app no se muestra hasta saber quién es.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false

    apiGet<CurrentUser>('/api/me')
      .then((user) => {
        rememberUser(user)
        if (!cancelled) setState({ status: 'ready', user })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        // Solo en local: el usuario de prueba guardado ya no existe. Se vuelve al de por defecto.
        if (import.meta.env.DEV && error instanceof ApiError && error.status === 400 && getDevUser()) {
          setDevUser(null)
          window.location.reload()
          return
        }
        // Sin red: se entra con el usuario de la última vez, para poder fichar sin conexión.
        const remembered = error instanceof NetworkError ? cachedUser() : null
        setState(remembered ? { status: 'ready', user: remembered } : { status: 'error' })
      })

    return () => {
      cancelled = true
    }
  }, [])

  if (state.status === 'loading') {
    return <div className="h-dvh bg-bg" aria-busy="true" />
  }

  if (state.status === 'error') {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-bg px-6 text-center text-text">
        <h1 className="text-xl font-bold">No se pudo cargar tu sesión</h1>
        <p className="max-w-sm text-[15px] text-muted">
          {import.meta.env.DEV
            ? 'Comprueba que la API está arrancada (cd api; npm run dev) y que api/.env tiene DEV_AUTH=true.'
            : 'Puede que tu sesión haya caducado o que no tengas conexión.'}
        </p>
        <button
          type="button"
          // Recargar la página completa hace que App Service pida iniciar sesión de nuevo.
          onClick={() => window.location.reload()}
          className="h-11 cursor-pointer rounded-lg bg-brand-blue px-5 font-semibold text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Volver a entrar
        </button>
      </div>
    )
  }

  return <AuthContext value={state.user}>{children}</AuthContext>
}
