import { setViewAsRole } from '../api/client.ts'
import { ROLE_LABELS, useAuth, type Role } from '../auth/authContext.ts'

// Roles que el administrador puede elegir. La API valida la lista por su cuenta.
const VIEW_AS_ROLES: Role[] = ['colaborador', 'supervisor', 'rrhh', 'direccion', 'controlling', 'almacen', 'it', 'etica']

/**
 * Selector «Ver como», solo para administradores: la app pasa a comportarse como con
 * cualquier persona del rol elegido. Los permisos los recorta la API, no esta pantalla.
 */
export function RoleSwitcher() {
  const { isAdmin, viewAs } = useAuth()
  if (!isAdmin) return null

  return (
    <select
      aria-label="Ver la plataforma como otro rol"
      title="Ver la plataforma como otro rol"
      value={viewAs ?? ''}
      onChange={(event) => {
        setViewAsRole(event.target.value || null)
        // Vuelve al inicio con recarga completa: la pantalla actual puede no existir para el nuevo rol.
        window.location.assign('/')
      }}
      className={`h-11 max-w-[11rem] cursor-pointer rounded-lg border bg-surface px-2 text-sm font-medium text-text focus-visible:outline-2 focus-visible:outline-accent ${
        viewAs ? 'border-accent' : 'border-border'
      }`}
    >
      <option value="">{ROLE_LABELS.admin}</option>
      {VIEW_AS_ROLES.map((role) => (
        <option key={role} value={role}>
          Ver como {ROLE_LABELS[role]}
        </option>
      ))}
    </select>
  )
}
