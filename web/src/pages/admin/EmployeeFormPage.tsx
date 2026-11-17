import { ArrowLeft } from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  BLOOD_TYPES,
  CONTRACT_TYPE_LABELS,
  employeesApi,
  MARITAL_STATUS_LABELS,
  type Department,
  type EmployeeFile,
  type EmployeeSummary,
  type Project,
} from './employees.ts'
import { BUTTON_PRIMARY, BUTTON_SECONDARY, ERROR_BOX, INPUT, LABEL, messageOf } from './ui.ts'

const CARD = 'rounded-2xl border border-border bg-surface shadow-sm'

/** Campos de texto del formulario: todos viajan como texto y la API los valida y normaliza. */
const TEXT_FIELDS = [
  'employeeNumber', 'fullName', 'email', 'jobTitle', 'hireDate', 'imssEndDate', 'departmentId', 'supervisorId',
  'projectId', 'rfc', 'nss', 'curp', 'personalEmail', 'personalPhone', 'workPhone', 'maritalStatus',
  'emergencyContactName', 'emergencyContactPhone', 'bloodType', 'homeAddress', 'sizePants', 'sizeTshirt',
  'sizeShoes', 'sizeJacket', 'sizeShirt', 'contractType', 'contractStart', 'contractEnd',
] as const

type TextField = (typeof TEXT_FIELDS)[number]
type FormState = Record<TextField, string> & { isActive: boolean; criminalRecordLetter: boolean }

const ID_FIELDS: readonly TextField[] = ['departmentId', 'supervisorId', 'projectId']

function emptyForm(): FormState {
  const text = Object.fromEntries(TEXT_FIELDS.map((field) => [field, ''])) as Record<TextField, string>
  return { ...text, isActive: true, criminalRecordLetter: false }
}

function toForm(employee: EmployeeFile): FormState {
  const text = Object.fromEntries(
    TEXT_FIELDS.map((field) => [field, employee[field] === null ? '' : String(employee[field])]),
  ) as Record<TextField, string>
  return { ...text, isActive: employee.isActive, criminalRecordLetter: employee.criminalRecordLetter }
}

function toBody(form: FormState): Record<string, unknown> {
  const body: Record<string, unknown> = { isActive: form.isActive, criminalRecordLetter: form.criminalRecordLetter }
  for (const field of TEXT_FIELDS) {
    const value = form[field].trim()
    body[field] = ID_FIELDS.includes(field) ? (value ? Number(value) : null) : value
  }
  return body
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className={`${CARD} p-5 min-[700px]:p-6`}>
      <h2 className="text-xs font-bold tracking-wider text-secondary uppercase">{title}</h2>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
      <div className="mt-4 grid grid-cols-1 gap-x-4 gap-y-3 min-[600px]:grid-cols-2 min-[1000px]:grid-cols-3">{children}</div>
    </section>
  )
}

const WIDE = 'min-[600px]:col-span-2'

// Alta y edición del expediente de un empleado, con todos sus datos por secciones. Solo RRHH.
export default function EmployeeFormPage() {
  const params = useParams()
  const id = params.id === undefined ? null : Number(params.id)
  const navigate = useNavigate()

  const [form, setForm] = useState<FormState | null>(id === null ? emptyForm() : null)
  const [employees, setEmployees] = useState<EmployeeSummary[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [newDepartment, setNewDepartment] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      employeesApi.list(),
      employeesApi.departments(),
      employeesApi.projects(),
      id === null ? null : employeesApi.get(id),
    ])
      .then(([employeeList, departmentList, projectList, employee]) => {
        if (cancelled) return
        setEmployees(employeeList)
        setDepartments(departmentList)
        // Si su analítica ya no está activa no viene en el catálogo: se añade para no perderla al guardar.
        const own =
          employee?.projectId && employee.projectCode && !projectList.some((project) => project.id === employee.projectId)
            ? [{ id: employee.projectId, code: employee.projectCode, name: employee.projectName, detail: null }]
            : []
        setProjects([...projectList, ...own])
        if (employee) setForm(toForm(employee))
      })
      .catch((cause: unknown) => {
        if (!cancelled) setLoadError(messageOf(cause))
      })
    return () => {
      cancelled = true
    }
  }, [id])

  const backTo = id === null ? '/empleados' : `/empleados/${id}`

  if (loadError) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-6">
        <p className={ERROR_BOX}>{loadError}</p>
      </div>
    )
  }
  if (!form) return null

  const set = <K extends keyof FormState>(field: K, value: FormState[K]) =>
    setForm((current) => (current ? { ...current, [field]: value } : current))

  /** Campo de texto, fecha, correo o teléfono enlazado al formulario. */
  const input = (
    field: TextField,
    label: string,
    options: { type?: string; required?: boolean; maxLength?: number; wide?: boolean; hint?: string; upper?: boolean; placeholder?: string } = {},
  ) => (
    <div className={options.wide ? WIDE : undefined}>
      <label className={LABEL} htmlFor={`emp-${field}`}>
        {label}
        {options.required && <span className="text-red-600"> *</span>}
      </label>
      <input
        id={`emp-${field}`}
        type={options.type ?? 'text'}
        required={options.required}
        maxLength={options.maxLength}
        placeholder={options.placeholder}
        className={`${INPUT} ${options.upper ? 'font-mono uppercase' : ''}`}
        value={form[field]}
        onChange={(event) => set(field, options.upper ? event.target.value.toUpperCase() : event.target.value)}
      />
      {options.hint && <p className="mt-1 text-xs text-muted">{options.hint}</p>}
    </div>
  )

  const select = (field: TextField, label: string, empty: string, choices: [value: string, label: string][], wide = false) => (
    <div className={wide ? WIDE : undefined}>
      <label className={LABEL} htmlFor={`emp-${field}`}>{label}</label>
      <select id={`emp-${field}`} className={INPUT} value={form[field]} onChange={(event) => set(field, event.target.value)}>
        <option value="">{empty}</option>
        {choices.map(([value, text]) => (
          <option key={value} value={value}>{text}</option>
        ))}
      </select>
    </div>
  )

  const addDepartment = async () => {
    const name = newDepartment.trim()
    if (!name) return
    setFormError(null)
    try {
      const created = await employeesApi.createDepartment(name)
      setDepartments((list) => [...list, created].sort((a, b) => a.name.localeCompare(b.name)))
      set('departmentId', created.id.toString())
      setNewDepartment('')
    } catch (cause) {
      setFormError(messageOf(cause))
    }
  }

  const save = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setFormError(null)
    try {
      const saved = id === null ? await employeesApi.create(toBody(form)) : await employeesApi.update(id, toBody(form))
      void navigate(`/empleados/${saved.id}`)
    } catch (cause) {
      setFormError(messageOf(cause))
      setSaving(false)
    }
  }

  const indefinite = form.contractType === 'indefinido'

  return (
    <form onSubmit={(event) => void save(event)} className="mx-auto max-w-5xl px-4 py-6 text-text min-[700px]:px-8">
      <div className="flex items-center gap-3">
        <Link
          to={backTo}
          aria-label="Volver"
          title="Volver"
          className="rounded-lg p-2 text-secondary hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-accent"
        >
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 className="text-xl font-bold">{id === null ? 'Nuevo empleado' : 'Editar expediente'}</h1>
          <p className="text-xs text-muted">Solo son obligatorios el número, el nombre y el correo de empresa.</p>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-4">
        <Section title="Datos generales">
          {input('employeeNumber', 'Núm. de empleado', { required: true, maxLength: 20 })}
          {input('fullName', 'Nombre completo', { required: true, maxLength: 200, wide: true })}
          {input('email', 'Email empresa', {
            type: 'email',
            required: true,
            maxLength: 254,
            wide: true,
            hint: 'Con este correo se enlaza su cuenta de Microsoft 365 con la ficha.',
          })}
          <div>
            <label className={LABEL} htmlFor="emp-status">Estatus</label>
            <select id="emp-status" className={INPUT} value={form.isActive ? 'active' : 'inactive'} onChange={(event) => set('isActive', event.target.value === 'active')}>
              <option value="active">Activo</option>
              <option value="inactive">Baja</option>
            </select>
          </div>
        </Section>

        <Section title="Datos laborales">
          {input('jobTitle', 'Puesto de trabajo', { maxLength: 100 })}
          {select(
            'projectId',
            'Analítica',
            'Sin analítica',
            projects.map((project) => [String(project.id), project.name ? `${project.code} · ${project.name}` : project.code]),
            true,
          )}
          {select('departmentId', 'Departamento', 'Sin departamento', departments.map((item) => [String(item.id), item.name]))}
          <div>
            <label className={LABEL} htmlFor="emp-new-department">Añadir departamento</label>
            <div className="flex gap-2">
              <input id="emp-new-department" maxLength={100} className={INPUT} value={newDepartment} onChange={(event) => setNewDepartment(event.target.value)} />
              <button type="button" className={BUTTON_SECONDARY} disabled={!newDepartment.trim()} onClick={() => void addDepartment()}>
                Añadir
              </button>
            </div>
          </div>
          {select(
            'supervisorId',
            'Supervisor / Responsable',
            'Sin supervisor',
            employees.filter((item) => item.isActive && item.id !== id).map((item) => [String(item.id), item.fullName]),
          )}
          {input('workPhone', 'Teléfono empresa', { type: 'tel', maxLength: 30 })}
        </Section>

        <Section title="Contrato e IMSS">
          {select('contractType', 'Tipo de contrato', 'Sin especificar', Object.entries(CONTRACT_TYPE_LABELS))}
          {input('contractStart', 'Inicio de contrato', { type: 'date' })}
          <div>
            <label className={LABEL} htmlFor="emp-contractEnd">Fin de contrato</label>
            <input
              id="emp-contractEnd"
              type="date"
              className={INPUT}
              disabled={indefinite}
              min={form.contractStart || undefined}
              value={indefinite ? '' : form.contractEnd}
              onChange={(event) => set('contractEnd', event.target.value)}
            />
            {indefinite && <p className="mt-1 text-xs text-muted">Un contrato indefinido no tiene fecha de fin.</p>}
          </div>
          {input('hireDate', 'Alta IMSS Revergy', { type: 'date', hint: 'De esta fecha sale la antigüedad para las vacaciones.' })}
          {input('imssEndDate', 'Baja IMSS', { type: 'date' })}
        </Section>

        <Section title="Identificación" hint="Datos sensibles: solo los ven Recursos Humanos y el propio empleado.">
          {input('rfc', 'RFC', { maxLength: 15, upper: true, placeholder: '13 caracteres' })}
          {input('nss', 'NSS', { maxLength: 13, upper: true, placeholder: '11 dígitos' })}
          {input('curp', 'CURP', { maxLength: 20, upper: true, placeholder: '18 caracteres' })}
          <label className={`flex items-center gap-2 text-sm ${WIDE}`}>
            <input type="checkbox" className="size-4" checked={form.criminalRecordLetter} onChange={(event) => set('criminalRecordLetter', event.target.checked)} />
            Entregó la carta de no antecedentes penales
          </label>
        </Section>

        <Section title="Datos personales">
          {input('personalEmail', 'Email personal', { type: 'email', maxLength: 254 })}
          {input('personalPhone', 'Teléfono personal', { type: 'tel', maxLength: 30 })}
          {select('maritalStatus', 'Estado civil', 'Sin especificar', Object.entries(MARITAL_STATUS_LABELS))}
          {select('bloodType', 'Tipo de sangre', 'Sin especificar', BLOOD_TYPES.map((type) => [type, type]))}
          {input('homeAddress', 'Domicilio particular', { maxLength: 500, wide: true })}
        </Section>

        <Section title="En caso de emergencia">
          {input('emergencyContactName', 'Nombre del contacto', { maxLength: 200, wide: true })}
          {input('emergencyContactPhone', 'Teléfono del contacto', { type: 'tel', maxLength: 30 })}
        </Section>

        <Section title="Tallas">
          {input('sizePants', 'Pantalón', { maxLength: 20 })}
          {input('sizeTshirt', 'Playera', { maxLength: 20 })}
          {input('sizeShirt', 'Camisa', { maxLength: 20 })}
          {input('sizeShoes', 'Calzado', { maxLength: 20 })}
          {input('sizeJacket', 'Rompevientos y chamarra de frío', { maxLength: 20 })}
        </Section>
      </div>

      {formError && <p role="alert" className={`${ERROR_BOX} mt-4`}>{formError}</p>}

      <div className="sticky bottom-0 mt-4 flex justify-end gap-2 border-t border-border bg-bg py-3">
        <Link to={backTo} className={`${BUTTON_SECONDARY} flex items-center`}>
          Cancelar
        </Link>
        <button type="submit" className={BUTTON_PRIMARY} disabled={saving}>
          {saving ? 'Guardando…' : id === null ? 'Crear empleado' : 'Guardar cambios'}
        </button>
      </div>
    </form>
  )
}
