import { useState } from 'react'
import { Link } from 'react-router-dom'
import { hasRole, useAuth } from '../../auth/authContext.ts'
import { EmployeesTab } from './EmployeesTab.tsx'
import { HolidaysTab } from './HolidaysTab.tsx'

const TABS = [
  { id: 'employees', label: 'Empleados' },
  { id: 'holidays', label: 'Festivos' },
] as const

type TabId = (typeof TABS)[number]['id']

// Administración básica de RRHH: lo mínimo de la Ficha de Empleado que necesita el Parte de Horas.
export default function AdminPage() {
  const { roles } = useAuth()
  const [tab, setTab] = useState<TabId>('employees')

  // La API también lo impide; aquí solo se evita mostrar una pantalla vacía.
  if (!hasRole(roles, 'rrhh')) {
    return (
      <div className="px-4 py-10 min-[700px]:px-10">
        <h1 className="text-2xl font-bold text-text">Sin acceso</h1>
        <p className="mt-2 text-muted">Esta pantalla es solo para Recursos Humanos.</p>
        <Link to="/" className="mt-4 inline-block font-semibold text-accent hover:underline">
          Volver a los módulos
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 text-text min-[700px]:px-8">
      <p className="text-[13px] font-bold text-accent">RECURSOS HUMANOS</p>
      <h1 className="text-2xl font-bold">Empleados y festivos</h1>

      <div role="tablist" className="mt-4 flex gap-1 border-b border-border">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
            className={`-mb-px cursor-pointer border-b-2 px-4 py-2 text-sm font-semibold ${
              tab === item.id ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-text'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="mt-4">{tab === 'employees' ? <EmployeesTab /> : <HolidaysTab />}</div>
    </div>
  )
}
