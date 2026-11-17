import { isAdmin } from '../auth/roles.js'
import type { Role } from '../auth/types.js'

// Quién ve qué de la Ficha de Empleado (confirmado el 2026-11-16):
// - RRHH ve y edita todo.
// - Cada colaborador ve su propia ficha completa, en solo lectura.
// - El responsable (su equipo directo) y Dirección (todos) ven una versión sin datos sensibles.

/** Datos que solo ven RRHH y el propio empleado. */
export const SENSITIVE_KEYS = [
  'rfc',
  'nss',
  'curp',
  'homeAddress',
  'bloodType',
  'maritalStatus',
  'criminalRecordLetter',
] as const

type SensitiveKey = (typeof SENSITIVE_KEYS)[number]

/** «full»: expediente entero. «limited»: sin datos sensibles. */
export type FileAccess = 'full' | 'limited'

export const isHrRole = (roles: readonly Role[]): boolean => isAdmin(roles) || roles.includes('rrhh')

/** Qué parte del expediente de `target` puede ver quien consulta, o null si nada. */
export function fileAccess(
  roles: readonly Role[],
  actorId: number | undefined,
  target: { id: number; supervisorId: number | null; isActive: boolean },
): FileAccess | null {
  if (isHrRole(roles)) return 'full'
  if (actorId !== undefined && actorId === target.id) return 'full'
  if (roles.includes('direccion')) return 'limited'
  if (roles.includes('supervisor') && actorId !== undefined && target.isActive && target.supervisorId === actorId) {
    return 'limited'
  }
  return null
}

/** Qué lista de empleados le corresponde: todos, su equipo directo activo, o ninguna. */
export function listScope(roles: readonly Role[]): 'all' | 'team' | null {
  if (isHrRole(roles) || roles.includes('direccion')) return 'all'
  if (roles.includes('supervisor')) return 'team'
  return null
}

/** Quita los datos sensibles: no se envían al navegador, ni vacíos. */
export function withoutSensitive<T extends Partial<Record<SensitiveKey, unknown>>>(file: T): Omit<T, SensitiveKey> {
  const copy: Record<string, unknown> = { ...file }
  for (const key of SENSITIVE_KEYS) delete copy[key]
  return copy as Omit<T, SensitiveKey>
}
