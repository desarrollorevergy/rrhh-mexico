import { useSearchParams } from 'react-router-dom'
import { hasRole, useAuth } from '../../auth/authContext.ts'
import { EmployeesTab } from './EmployeesTab.tsx'
import { HolidaysTab } from './HolidaysTab.tsx'
import { MyFileTab } from './MyFileTab.tsx'

type TabId = 'employees' | 'mine' | 'holidays'

// Ficha de Empleado. Pestañas según el rol (la API vuelve a comprobarlo):
// - Todos: «Mi ficha», en solo lectura.
// - RRHH: todos los empleados (alta y edición) y el calendario de festivos.
// - Dirección: todos los empleados, sin datos sensibles.
// - Responsable: su equipo directo, sin datos sensibles.
export default function AdminPage() {
  const { roles } = useAuth()
  const [params, setParams] = useSearchParams()

  const isHr = hasRole(roles, 'rrhh')
  const seesAll = isHr || hasRole(roles, 'direccion')
  const tabs: { id: TabId; label: string }[] = [
    ...(seesAll
      ? [{ id: 'employees' as const, label: 'Empleados' }]
      : hasRole(roles, 'supervisor')
        ? [{ id: 'employees' as const, label: 'Mi equipo' }]
        : []),
    { id: 'mine', label: 'Mi ficha' },
    ...(isHr ? [{ id: 'holidays' as const, label: 'Festivos' }] : []),
  ]

  // La pestaña va en la URL para volver a ella desde un expediente.
  const tab = tabs.find((item) => item.id === params.get('vista'))?.id ?? tabs[0]!.id
  const select = (id: TabId) => setParams(id === tabs[0]!.id ? {} : { vista: id }, { replace: true })

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 text-text min-[700px]:px-8">
      {isHr && <p className="text-[13px] font-bold text-accent">RECURSOS HUMANOS</p>}
      <h1 className="text-2xl font-bold">Ficha de Empleado</h1>

      {tabs.length > 1 && (
        <div role="tablist" className="mt-4 flex gap-1 border-b border-border">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => select(item.id)}
              className={`-mb-px cursor-pointer border-b-2 px-4 py-2 text-sm font-semibold ${
                tab === item.id ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-text'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}

      <div className="mt-4">
        {tab === 'employees' && <EmployeesTab canCreate={isHr} teamOnly={!seesAll} />}
        {tab === 'mine' && <MyFileTab />}
        {tab === 'holidays' && <HolidaysTab />}
      </div>
    </div>
  )
}
