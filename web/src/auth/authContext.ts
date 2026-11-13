import { createContext, useContext } from 'react'

export type Role =
  | 'colaborador'
  | 'supervisor'
  | 'admin'
  | 'rrhh'
  | 'direccion'
  | 'controlling'
  | 'almacen'
  | 'it'
  | 'etica'

export const ROLE_LABELS: Record<Role, string> = {
  colaborador: 'Colaborador',
  supervisor: 'Supervisor',
  admin: 'Administrador',
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
  /** Roles con los que actúa ahora. Si el administrador eligió «Ver como», solo los de ese rol. */
  roles: Role[]
  /** Es administrador de verdad: puede usar el selector «Ver como». */
  isAdmin: boolean
  /** Rol elegido en el selector «Ver como»; null si actúa como administrador. */
  viewAs: Role | null
  /** false mientras el servidor no tenga base de datos: los módulos aún no funcionan. */
  hasDatabase: boolean
}

/**
 * ¿Tiene alguno de estos roles? El administrador cuenta como si los tuviera todos.
 * Solo decide qué se muestra: la API vuelve a comprobarlo.
 */
export function hasRole(roles: readonly Role[], ...allowed: Role[]): boolean {
  return roles.includes('admin') || roles.some((role) => allowed.includes(role))
}

export const AuthContext = createContext<CurrentUser | null>(null)

/** Usuario autenticado. Solo se usa dentro de <AuthProvider>, que garantiza que existe. */
export function useAuth(): CurrentUser {
  const user = useContext(AuthContext)
  if (!user) throw new Error('useAuth debe usarse dentro de <AuthProvider>')
  return user
}
