import { GROUP_ROLES, type AppConfig } from '../config/env.js'
import type { AuthUser, Role } from './types.js'

/**
 * Administrador de la plataforma: entra a todos los módulos y actúa como RRHH y como supervisor
 * de cualquier empleado. Dos límites: no decide sobre sus propias solicitudes (las valida su
 * supervisor) y, como administrador, no tendrá acceso al Buzón de Quejas.
 */
export function isAdmin(roles: readonly Role[]): boolean {
  return roles.includes('admin')
}

/** Roles que el administrador puede elegir en el selector «Ver como». */
export const VIEW_AS_ROLES: readonly Role[] = [
  'colaborador',
  'supervisor',
  ...GROUP_ROLES.filter((role) => role !== 'admin'),
]

/**
 * Selector «Ver como»: el administrador pasa a tener solo el rol elegido (más Colaborador),
 * y la app se comporta como con cualquier persona de ese rol. Solo vale para quien es
 * administrador de verdad; para los demás, o con un rol desconocido, no cambia nada.
 * «Supervisor» sigue saliendo de los datos: alcanza solo a su equipo directo, si lo tiene.
 */
export function viewAs(roles: Role[], requested: string | undefined): { roles: Role[]; viewAs: Role | null } {
  const role = VIEW_AS_ROLES.find((candidate) => candidate === requested)
  if (!isAdmin(roles) || !role) return { roles, viewAs: null }
  return { roles: role === 'colaborador' ? ['colaborador'] : ['colaborador', role], viewAs: role }
}

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
