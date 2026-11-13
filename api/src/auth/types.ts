import type { GroupRole } from '../config/env.js'

/** Colaborador: cualquier empleado autenticado. Supervisor: por datos (tiene gente a su cargo). */
export type Role = 'colaborador' | 'supervisor' | GroupRole

/** Usuario tal como llega de Entra ID, antes de calcular sus roles. */
export interface AuthUser {
  /** ID de objeto del usuario en Entra ID. */
  id: string
  name: string
  email: string
  /** IDs de los grupos de Entra ID a los que pertenece. */
  groups: string[]
}

/** Lo que el resto de la API usa: el usuario y sus roles ya resueltos. */
export interface AuthContext {
  user: AuthUser
  /** Roles con los que actúa en esta petición. */
  roles: Role[]
  /** Es administrador de verdad, aunque esté viendo la app como otro rol. */
  isAdmin: boolean
  /** Rol elegido por el administrador en el selector «Ver como», si hay alguno. */
  viewAs: Role | null
}
