// Validación de lo que envía RRHH desde las pantallas de administración. Funciones puras.

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

export interface EmployeeInput {
  employeeNumber: string
  fullName: string
  email: string
  jobTitle: string | null
  departmentId: number | null
  supervisorId: number | null
  isActive: boolean
}

export interface HolidayInput {
  date: string
  name: string
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function optionalId(value: unknown): number | null | undefined {
  if (value === null || value === undefined || value === '') return null
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : undefined
}

export function parseEmployee(body: unknown): Parsed<EmployeeInput> {
  const data = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>

  const employeeNumber = text(data.employeeNumber)
  const fullName = text(data.fullName)
  const email = text(data.email).toLowerCase()
  const jobTitle = text(data.jobTitle)
  const departmentId = optionalId(data.departmentId)
  const supervisorId = optionalId(data.supervisorId)

  if (!employeeNumber || employeeNumber.length > 20) {
    return { ok: false, error: 'El número de empleado es obligatorio (máximo 20 caracteres)' }
  }
  if (!fullName || fullName.length > 200) return { ok: false, error: 'El nombre es obligatorio' }
  if (!EMAIL.test(email) || email.length > 254) return { ok: false, error: 'El correo no es válido' }
  if (jobTitle.length > 100) return { ok: false, error: 'El puesto es demasiado largo' }
  if (departmentId === undefined) return { ok: false, error: 'El departamento no es válido' }
  if (supervisorId === undefined) return { ok: false, error: 'El supervisor no es válido' }

  return {
    ok: true,
    value: {
      employeeNumber,
      fullName,
      email,
      jobTitle: jobTitle || null,
      departmentId,
      supervisorId,
      // Un empleado está activo salvo que se indique lo contrario.
      isActive: data.isActive !== false,
    },
  }
}

export function parseName(body: unknown, max: number): Parsed<string> {
  const data = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
  const name = text(data.name)
  if (!name || name.length > max) return { ok: false, error: 'El nombre es obligatorio' }
  return { ok: true, value: name }
}

/** Fecha AAAA-MM-DD que existe de verdad (no admite 2026-02-30). */
export function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function parseHoliday(body: unknown): Parsed<HolidayInput> {
  const data = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
  const date = text(data.date)
  const name = text(data.name)
  if (!isValidDate(date)) return { ok: false, error: 'La fecha no es válida' }
  if (!name || name.length > 100) return { ok: false, error: 'El nombre del festivo es obligatorio' }
  return { ok: true, value: { date, name } }
}
