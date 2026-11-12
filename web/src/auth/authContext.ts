import { createContext, useContext } from 'react'

export type Role =
  | 'colaborador'
  | 'supervisor'
  | 'rrhh'
  | 'direccion'
  | 'controlling'
  | 'almacen'
  | 'it'
  | 'etica'

export const ROLE_LABELS: Record<Role, string> = {
  colaborador: 'Colaborador',
  supervisor: 'Supervisor',
  rrhh: 'RRHH',
  direccion: 'Dirección General',
  controlling: 'Controlling',
  almacen: 'Almacén',
  it: 'IT / Sistemas',
  etica: 'Comité de Ética',
}

/** Usuario autenticado, tal como lo devuelve GET /api/me. */
export interface CurrentUser {
  id: string
  name: string
  email: string
  roles: Role[]
  /** false mientras el servidor no tenga base de datos: los módulos aún no funcionan. */
  hasDatabase: boolean
}

export const AuthContext = createContext<CurrentUser | null>(null)

/** Usuario autenticado. Solo se usa dentro de <AuthProvider>, que garantiza que existe. */
export function useAuth(): CurrentUser {
  const user = useContext(AuthContext)
  if (!user) throw new Error('useAuth debe usarse dentro de <AuthProvider>')
  return user
}
