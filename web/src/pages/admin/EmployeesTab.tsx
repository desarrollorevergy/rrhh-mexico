import { Pencil, Plus } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { apiGet, apiPost, apiPut } from '../../api/client.ts'
import { BUTTON_PRIMARY, BUTTON_SECONDARY, ERROR_BOX, INPUT, LABEL, messageOf } from './ui.ts'

interface Employee {
  id: number
  employeeNumber: string
  fullName: string
  email: string
  jobTitle: string | null
  departmentId: number | null
  departmentName: string | null
  supervisorId: number | null
  supervisorName: string | null
  isActive: boolean
}

interface Department {
  id: number
  name: string
}

interface FormState {
  id: number | null
  employeeNumber: string
  fullName: string
  email: string
  jobTitle: string
  departmentId: string
  supervisorId: string
  isActive: boolean
}

const EMPTY_FORM: FormState = {
  id: null,
  employeeNumber: '',
  fullName: '',
  email: '',
  jobTitle: '',
  departmentId: '',
  supervisorId: '',
  isActive: true,
}

function toForm(employee: Employee): FormState {
  return {
    id: employee.id,
    employeeNumber: employee.employeeNumber,
    fullName: employee.fullName,
    email: employee.email,
    jobTitle: employee.jobTitle ?? '',
    departmentId: employee.departmentId?.toString() ?? '',
    supervisorId: employee.supervisorId?.toString() ?? '',
    isActive: employee.isActive,
  }
}

export function EmployeesTab() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [search, setSearch] = useState('')
  const [form, setForm] = useState<FormState | null>(null)
  const [newDepartment, setNewDepartment] = useState('')
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([apiGet<Employee[]>('/api/employees'), apiGet<Department[]>('/api/departments')])
      .then(([employeeList, departmentList]) => {
        if (cancelled) return
        setEmployees(employeeList)
        setDepartments(departmentList)
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
    if (!term) return employees
    return employees.filter((employee) =>
      [employee.fullName, employee.email, employee.employeeNumber, employee.departmentName ?? '']
        .join(' ')
        .toLowerCase()
        .includes(term),
    )
  }, [employees, search])

  const set = <K extends keyof FormState>(field: K, value: FormState[K]) =>
    setForm((current) => (current ? { ...current, [field]: value } : current))

  const openForm = (state: FormState) => {
    setFormError(null)
    setNewDepartment('')
    setForm(state)
  }

  const addDepartment = async () => {
    const name = newDepartment.trim()
    if (!name) return
    setFormError(null)
    try {
      const created = await apiPost<Department>('/api/departments', { name })
      setDepartments((list) => [...list, created].sort((a, b) => a.name.localeCompare(b.name)))
      set('departmentId', created.id.toString())
      setNewDepartment('')
    } catch (cause) {
      setFormError(messageOf(cause))
    }
  }

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!form) return
    setSaving(true)
    setFormError(null)
    const body = {
      employeeNumber: form.employeeNumber,
      fullName: form.fullName,
      email: form.email,
      jobTitle: form.jobTitle,
      departmentId: form.departmentId ? Number(form.departmentId) : null,
      supervisorId: form.supervisorId ? Number(form.supervisorId) : null,
      isActive: form.isActive,
    }
    try {
      if (form.id === null) await apiPost<Employee>('/api/employees', body)
      else await apiPut<Employee>(`/api/employees/${form.id}`, body)
      // Se recarga la lista: un cambio puede afectar al nombre de supervisor de otras filas.
      setEmployees(await apiGet<Employee[]>('/api/employees'))
      setForm(null)
    } catch (cause) {
      setFormError(messageOf(cause))
    } finally {
      setSaving(false)
    }
  }

  if (loadError) return <p className={ERROR_BOX}>{loadError}</p>

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar por nombre, correo, número o departamento"
          aria-label="Buscar empleado"
          className={`${INPUT} max-w-md flex-1`}
        />
        <button type="button" className={`${BUTTON_PRIMARY} flex items-center gap-1.5`} onClick={() => openForm(EMPTY_FORM)}>
          <Plus size={16} aria-hidden="true" /> Nuevo empleado
        </button>
      </div>

      <div className="mt-3 overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-border text-xs text-muted">
            <tr>
              <th className="px-3 py-2 font-semibold">Nº</th>
              <th className="px-3 py-2 font-semibold">Nombre</th>
              <th className="px-3 py-2 font-semibold">Departamento</th>
              <th className="px-3 py-2 font-semibold">Supervisor</th>
              <th className="px-3 py-2 font-semibold">Estado</th>
              <th className="px-3 py-2" aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {visible.map((employee) => (
              <tr key={employee.id} className="border-b border-border last:border-0">
                <td className="px-3 py-2 text-muted">{employee.employeeNumber}</td>
                <td className="px-3 py-2">
                  <div className="font-semibold text-text">{employee.fullName}</div>
                  <div className="text-xs text-muted">
                    {employee.email}
                    {employee.jobTitle && ` · ${employee.jobTitle}`}
                  </div>
                </td>
                <td className="px-3 py-2">{employee.departmentName ?? '—'}</td>
                <td className="px-3 py-2">{employee.supervisorName ?? '—'}</td>
                <td className="px-3 py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${employee.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-700'}`}
                  >
                    {employee.isActive ? 'Activo' : 'Baja'}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    title={`Editar a ${employee.fullName}`}
                    aria-label={`Editar a ${employee.fullName}`}
                    className="cursor-pointer rounded-lg p-2 text-secondary hover:bg-accent-soft-strong"
                    onClick={() => openForm(toForm(employee))}
                  >
                    <Pencil size={16} />
                  </button>
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted">
                  Sin empleados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {form && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
          <form
            onSubmit={(event) => void save(event)}
            aria-label={form.id === null ? 'Nuevo empleado' : 'Editar empleado'}
            className="mt-10 w-full max-w-lg rounded-2xl border border-border bg-surface p-5 text-text shadow-xl"
          >
            <h2 className="text-lg font-bold">{form.id === null ? 'Nuevo empleado' : 'Editar empleado'}</h2>

            <div className="mt-4 grid grid-cols-1 gap-3 min-[520px]:grid-cols-2">
              <div>
                <label className={LABEL} htmlFor="emp-number">Nº de empleado</label>
                <input id="emp-number" required maxLength={20} className={INPUT} value={form.employeeNumber} onChange={(event) => set('employeeNumber', event.target.value)} />
              </div>
              <div>
                <label className={LABEL} htmlFor="emp-job">Puesto</label>
                <input id="emp-job" maxLength={100} className={INPUT} value={form.jobTitle} onChange={(event) => set('jobTitle', event.target.value)} />
              </div>
              <div className="min-[520px]:col-span-2">
                <label className={LABEL} htmlFor="emp-name">Nombre completo</label>
                <input id="emp-name" required maxLength={200} className={INPUT} value={form.fullName} onChange={(event) => set('fullName', event.target.value)} />
              </div>
              <div className="min-[520px]:col-span-2">
                <label className={LABEL} htmlFor="emp-email">Correo corporativo</label>
                <input id="emp-email" type="email" required maxLength={254} className={INPUT} value={form.email} onChange={(event) => set('email', event.target.value)} />
              </div>
              <div>
                <label className={LABEL} htmlFor="emp-department">Departamento</label>
                <select id="emp-department" className={INPUT} value={form.departmentId} onChange={(event) => set('departmentId', event.target.value)}>
                  <option value="">Sin departamento</option>
                  {departments.map((department) => (
                    <option key={department.id} value={department.id}>{department.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={LABEL} htmlFor="emp-new-department">Añadir departamento</label>
                <div className="flex gap-2">
                  <input id="emp-new-department" maxLength={100} className={INPUT} value={newDepartment} onChange={(event) => setNewDepartment(event.target.value)} />
                  <button type="button" className={BUTTON_SECONDARY} disabled={!newDepartment.trim()} onClick={() => void addDepartment()}>
                    Añadir
                  </button>
                </div>
              </div>
              <div className="min-[520px]:col-span-2">
                <label className={LABEL} htmlFor="emp-supervisor">Supervisor / Responsable</label>
                <select id="emp-supervisor" className={INPUT} value={form.supervisorId} onChange={(event) => set('supervisorId', event.target.value)}>
                  <option value="">Sin supervisor</option>
                  {employees
                    .filter((employee) => employee.isActive && employee.id !== form.id)
                    .map((employee) => (
                      <option key={employee.id} value={employee.id}>{employee.fullName}</option>
                    ))}
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm min-[520px]:col-span-2">
                <input type="checkbox" className="size-4" checked={form.isActive} onChange={(event) => set('isActive', event.target.checked)} />
                Empleado activo
              </label>
            </div>

            {formError && <p role="alert" className={`${ERROR_BOX} mt-3`}>{formError}</p>}

            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className={BUTTON_SECONDARY} onClick={() => setForm(null)} disabled={saving}>
                Cancelar
              </button>
              <button type="submit" className={BUTTON_PRIMARY} disabled={saving}>
                {saving ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}
