import { CalendarDays, ClipboardCheck, Clock } from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'
import { hasRole, useAuth } from '../../auth/authContext.ts'

// Pantallas del Parte de Horas con su menú inferior, como en la app de fichaje.
export default function TimesheetLayout() {
  const { roles } = useAuth()

  const items = [
    { to: '/parte-horas', end: true, label: 'Fichar', icon: Clock },
    { to: '/parte-horas/semana', end: false, label: 'Mi Semana', icon: CalendarDays },
    // Para quien tiene gente a su cargo y para el administrador. La API lo vuelve a comprobar.
    ...(hasRole(roles, 'supervisor')
      ? [{ to: '/parte-horas/equipo', end: false, label: 'Supervisión', icon: ClipboardCheck }]
      : []),
  ]

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto">
        <Outlet />
      </div>

      <nav aria-label="Parte de horas" className="flex shrink-0 border-t border-border bg-surface">
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
    </div>
  )
}
