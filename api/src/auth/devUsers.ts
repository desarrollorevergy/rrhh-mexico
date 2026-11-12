import type { GroupRole } from '../config/env.js'
import type { AuthUser } from './types.js'

/** Usuarios FICTICIOS para probar cada rol en local. No son personas reales. */
export interface DevUser {
  id: string
  name: string
  email: string
  /** Roles por grupo que tendrá este usuario de prueba. */
  groupRoles: GroupRole[]
  /** ID del usuario de prueba que es su supervisor. */
  reportsTo?: string
}

export const DEV_USERS: DevUser[] = [
  {
    id: 'dev-colaborador',
    name: 'Colaborador de Prueba',
    email: 'colaborador@example.test',
    groupRoles: [],
    reportsTo: 'dev-supervisor',
  },
  {
    id: 'dev-supervisor',
    name: 'Supervisor de Prueba',
    email: 'supervisor@example.test',
    groupRoles: [],
  },
  { id: 'dev-rrhh', name: 'RRHH de Prueba', email: 'rrhh@example.test', groupRoles: ['rrhh'] },
  {
    id: 'dev-direccion',
    name: 'Dirección de Prueba',
    email: 'direccion@example.test',
    groupRoles: ['direccion'],
  },
  {
    id: 'dev-controlling',
    name: 'Controlling de Prueba',
    email: 'controlling@example.test',
    groupRoles: ['controlling'],
  },
  {
    id: 'dev-almacen',
    name: 'Almacén de Prueba',
    email: 'almacen@example.test',
    groupRoles: ['almacen'],
  },
  { id: 'dev-it', name: 'IT de Prueba', email: 'it@example.test', groupRoles: ['it'] },
  {
    id: 'dev-etica',
    name: 'Comité de Ética de Prueba',
    email: 'etica@example.test',
    groupRoles: ['etica'],
  },
]

export const DEFAULT_DEV_USER_ID = 'dev-colaborador'

/**
 * ¿Tiene gente a su cargo? Versión provisional para local, con la jerarquía de arriba.
 * En el paso 3 se sustituye por la consulta a la tabla de empleados.
 */
export async function devIsSupervisor(user: AuthUser): Promise<boolean> {
  return DEV_USERS.some((devUser) => devUser.reportsTo === user.id)
}
