import { ChevronRight, Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BUTTON_PRIMARY, ERROR_BOX, INPUT, messageOf } from './ui.ts'
import { employeesApi, initialsOf, type EmployeeSummary } from './employees.ts'

type StatusFilter = 'active' | 'inactive' | 'all'

export function StatusBadge({ isActive }: { isActive: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
        isActive ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-700'
      }`}
    >
      <span className={`size-1.5 rounded-full ${isActive ? 'bg-green-600' : 'bg-gray-500'}`} aria-hidden="true" />
      {isActive ? 'Activo' : 'Baja'}
    </span>
  )
}

/** Avatar con las iniciales; hará de fotografía hasta que se puedan subir archivos. */
export function Avatar({ name, size = 'size-9 text-xs' }: { name: string; size?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`bg-brand-gradient flex shrink-0 items-center justify-center rounded-full font-bold text-white ${size}`}
    >
      {initialsOf(name)}
    </span>
  )
}

// Vista global de empleados: pocos datos, los más importantes. Cada renglón abre el expediente.
export function EmployeesTab() {
  const navigate = useNavigate()
  const [employees, setEmployees] = useState<EmployeeSummary[] | null>(null)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('active')
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    employeesApi
      .list()
      .then((list) => {
        if (!cancelled) setEmployees(list)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setLoadError(messageOf(cause))
      })
    return () => {
      cancelled = true
    }
  }, [])

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    return (employees ?? []).filter((employee) => {
      if (status === 'active' && !employee.isActive) return false
      if (status === 'inactive' && employee.isActive) return false
      if (!term) return true
      return [
        employee.fullName,
        employee.email,
        employee.employeeNumber,
        employee.jobTitle ?? '',
        employee.departmentName ?? '',
        employee.projectCode ?? '',
        employee.projectName ?? '',
      ]
        .join(' ')
        .toLowerCase()
        .includes(term)
    })
  }, [employees, search, status])

  if (loadError) return <p className={ERROR_BOX}>{loadError}</p>
  if (!employees) return null

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar por nombre, número, puesto, departamento o analítica"
          aria-label="Buscar empleado"
          className={`${INPUT} min-w-0 flex-1`}
        />
        <select aria-label="Filtrar por estatus" className={`${INPUT} w-auto`} value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}>
          <option value="active">Activos</option>
          <option value="inactive">Bajas</option>
          <option value="all">Todos</option>
        </select>
        <Link to="/empleados/nuevo" className={`${BUTTON_PRIMARY} flex items-center gap-1.5`}>
          <Plus size={16} aria-hidden="true" /> Nuevo empleado
        </Link>
      </div>

      <p className="mt-3 text-xs text-muted">
        {visible.length === 1 ? '1 empleado' : `${visible.length} empleados`}
      </p>

      <div className="mt-1 overflow-x-auto rounded-2xl border border-border bg-surface shadow-sm">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="border-b border-border text-[11px] tracking-wide text-muted uppercase">
            <tr>
              <th className="px-4 py-3 font-semibold">Empleado</th>
              <th className="px-4 py-3 font-semibold">Núm.</th>
              <th className="px-4 py-3 font-semibold">Puesto</th>
              <th className="px-4 py-3 font-semibold">Departamento</th>
              <th className="px-4 py-3 font-semibold">Analítica</th>
              <th className="px-4 py-3 font-semibold">Estatus</th>
              <th className="px-2 py-3" aria-label="Abrir" />
            </tr>
          </thead>
          <tbody>
            {visible.map((employee) => (
              <tr
                key={employee.id}
                className="cursor-pointer border-b border-border last:border-0 hover:bg-accent-soft"
                onClick={() => void navigate(`/empleados/${employee.id}`)}
              >
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-3">
                    <Avatar name={employee.fullName} />
                    <div className="min-w-0">
                      {/* El enlace permite abrir el expediente también con el teclado. */}
                      <Link
                        to={`/empleados/${employee.id}`}
                        className="block truncate font-semibold text-text hover:underline focus-visible:outline-2 focus-visible:outline-accent"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {employee.fullName}
                      </Link>
                      <div className="truncate text-xs text-muted">{employee.email}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-2.5 font-mono text-xs text-secondary">{employee.employeeNumber}</td>
                <td className="px-4 py-2.5">{employee.jobTitle ?? <span className="text-faint">—</span>}</td>
                <td className="px-4 py-2.5">{employee.departmentName ?? <span className="text-faint">—</span>}</td>
                <td className="px-4 py-2.5">
                  {employee.projectCode ? (
                    <>
                      <div className="font-mono text-xs">{employee.projectCode}</div>
                      {employee.projectName && <div className="text-xs text-muted">{employee.projectName}</div>}
                    </>
                  ) : (
                    <span className="text-faint">—</span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <StatusBadge isActive={employee.isActive} />
                </td>
                <td className="px-2 py-2.5 text-muted">
                  <ChevronRight size={18} aria-hidden="true" />
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted">
                  Sin empleados con este filtro.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}
