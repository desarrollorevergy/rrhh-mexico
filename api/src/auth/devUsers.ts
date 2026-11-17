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
  /** Fecha de ingreso ficticia (AAAA-MM-DD): de ella sale su saldo de vacaciones. */
  hireDate: string
}

export const DEV_USERS: DevUser[] = [
  {
    id: 'dev-colaborador',
    name: 'Colaborador de Prueba',
    email: 'colaborador@example.test',
    groupRoles: [],
    reportsTo: 'dev-supervisor',
    hireDate: '2025-02-03',
  },
  {
    id: 'dev-supervisor',
    name: 'Supervisor de Prueba',
    email: 'supervisor@example.test',
    groupRoles: [],
    hireDate: '2019-03-04',
  },
  { id: 'dev-rrhh', name: 'RRHH de Prueba', email: 'rrhh@example.test', groupRoles: ['rrhh'], hireDate: '2022-08-15' },
  {
    id: 'dev-direccion',
    name: 'Dirección de Prueba',
    email: 'direccion@example.test',
    groupRoles: ['direccion'],
    hireDate: '2016-01-11',
  },
  {
    id: 'dev-controlling',
    name: 'Controlling de Prueba',
    email: 'controlling@example.test',
    groupRoles: ['controlling'],
    hireDate: '2023-01-09',
  },
  {
    id: 'dev-almacen',
    name: 'Almacén de Prueba',
    email: 'almacen@example.test',
    groupRoles: ['almacen'],
    hireDate: '2024-05-06',
  },
  { id: 'dev-it', name: 'IT de Prueba', email: 'it@example.test', groupRoles: ['it'], hireDate: '2023-09-18' },
  {
    id: 'dev-etica',
    name: 'Comité de Ética de Prueba',
    email: 'etica@example.test',
    groupRoles: ['etica'],
    hireDate: '2020-10-05',
  },
  // Al final de la lista: el número de empleado de prueba sale de la posición.
  // Con ficha completa (ingreso y supervisor) para poder probar todos los módulos entrando como administrador.
  {
    id: 'dev-admin',
    name: 'Administrador de Prueba',
    email: 'admin@example.test',
    groupRoles: ['admin'],
    reportsTo: 'dev-supervisor',
    hireDate: '2021-06-01',
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
