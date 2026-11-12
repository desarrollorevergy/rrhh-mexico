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
  roles: Role[]
}
