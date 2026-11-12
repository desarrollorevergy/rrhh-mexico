import { useEffect, useState } from 'react'
import { apiGet, setDevUser } from '../api/client.ts'
import { useAuth } from '../auth/authContext.ts'

interface DevUser {
  id: string
  name: string
}

// SOLO DESARROLLO: cambia el usuario de prueba para ver la app con cada rol.
// Header.tsx solo lo carga si import.meta.env.DEV, así que no entra en producción.
export default function DevUserSwitcher() {
  const current = useAuth()
  const [users, setUsers] = useState<DevUser[]>([])

  useEffect(() => {
    apiGet<DevUser[]>('/api/dev/users')
      .then(setUsers)
      .catch(() => setUsers([]))
  }, [])

  if (users.length === 0) return null

  return (
    <select
      aria-label="Usuario de prueba (solo desarrollo)"
      title="Usuario de prueba (solo desarrollo)"
      value={current.id}
      onChange={(event) => {
        setDevUser(event.target.value)
        // Recarga completa: toda la app vuelve a pedir sus datos con el nuevo usuario.
        window.location.reload()
      }}
      className="h-11 max-w-[11rem] cursor-pointer rounded-lg border border-dashed border-accent bg-surface px-2 text-sm font-medium text-text focus-visible:outline-2 focus-visible:outline-accent"
    >
      {users.map((user) => (
        <option key={user.id} value={user.id}>
          {user.name}
        </option>
      ))}
    </select>
  )
}
