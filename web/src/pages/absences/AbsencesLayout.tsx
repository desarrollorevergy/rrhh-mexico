import { CalendarDays, ClipboardCheck, Scale } from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'
import { hasRole, useAuth } from '../../auth/authContext.ts'

// Pantallas de Vacaciones / Ausentismos con su menú inferior, igual que el Parte de Horas.
export default function AbsencesLayout() {
  const { roles } = useAuth()

  const items = [
    { to: '/vacaciones', end: true, label: 'Mis ausencias', icon: CalendarDays },
    // Supervisor (su equipo) y RRHH (todas). La API lo vuelve a comprobar.
    ...(hasRole(roles, 'supervisor', 'rrhh')
      ? [{ to: '/vacaciones/solicitudes', end: false, label: 'Solicitudes', icon: ClipboardCheck }]
      : []),
    // RRHH: saldo de cada empleado y ajustes manuales.
    ...(hasRole(roles, 'rrhh') ? [{ to: '/vacaciones/saldos', end: false, label: 'Saldos', icon: Scale }] : []),
  ]

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto">
        <Outlet />
      </div>

      {items.length > 1 && (
        <nav aria-label="Vacaciones y ausentismos" className="flex shrink-0 border-t border-border bg-surface">
          {items.map(({ to, end, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex flex-1 flex-col items-center gap-0.5 py-2 text-xs font-semibold focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${
                  isActive ? 'text-accent' : 'text-muted hover:text-text'
                }`
              }
            >
              <Icon size={22} aria-hidden="true" />
              {label}
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  )
}
