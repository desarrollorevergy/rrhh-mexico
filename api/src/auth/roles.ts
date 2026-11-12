import { GROUP_ROLES, type AppConfig } from '../config/env.js'
import type { AuthUser, Role } from './types.js'

/**
 * Calcula los roles de un usuario.
 * - Colaborador: siempre.
 * - Supervisor: por datos (tiene empleados a su cargo), no por grupo.
 * - El resto: por pertenencia al grupo de Entra ID configurado para ese rol.
 */
export function resolveRoles(
  user: AuthUser,
  groupIds: AppConfig['groupIds'],
  isSupervisor: boolean,
): Role[] {
  const roles: Role[] = ['colaborador']
  if (isSupervisor) roles.push('supervisor')

  for (const role of GROUP_ROLES) {
    const groupId = groupIds[role]
    if (groupId && user.groups.includes(groupId)) roles.push(role)
  }

  return roles
}
