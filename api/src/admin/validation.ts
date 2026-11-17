// Validación de lo que envía RRHH desde las pantallas de administración. Funciones puras.

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

export const MARITAL_STATUSES = ['soltero', 'casado', 'union_libre', 'divorciado', 'viudo'] as const
export const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const
export const CONTRACT_TYPES = ['indefinido', 'proyecto'] as const

export type MaritalStatus = (typeof MARITAL_STATUSES)[number]
export type BloodType = (typeof BLOOD_TYPES)[number]
export type ContractType = (typeof CONTRACT_TYPES)[number]

/** Expediente del empleado tal como lo captura RRHH. Todo es opcional salvo número, nombre y correo. */
export interface EmployeeInput {
  employeeNumber: string
  fullName: string
  /** Correo de empresa: con él se enlaza la cuenta con la ficha. */
  email: string
  jobTitle: string | null
  /** Alta IMSS Revergy (AAAA-MM-DD). De ella sale la antigüedad para las vacaciones. */
  hireDate: string | null
  /** Baja IMSS (AAAA-MM-DD). */
  imssEndDate: string | null
  departmentId: number | null
  supervisorId: number | null
  /** Analítica con la que se contrató al empleado. */
  projectId: number | null
  /** Estatus: Activo / Baja. */
  isActive: boolean
  rfc: string | null
  nss: string | null
  curp: string | null
  personalEmail: string | null
  personalPhone: string | null
  workPhone: string | null
  maritalStatus: MaritalStatus | null
  emergencyContactName: string | null
  emergencyContactPhone: string | null
  bloodType: BloodType | null
  homeAddress: string | null
  sizePants: string | null
  sizeTshirt: string | null
  sizeShoes: string | null
  sizeJacket: string | null
  sizeShirt: string | null
  contractType: ContractType | null
  contractStart: string | null
  contractEnd: string | null
  /** ¿Entregó la carta de no antecedentes penales? */
  criminalRecordLetter: boolean
}

export interface HolidayInput {
  date: string
  name: string
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// RFC de persona física: 4 letras, fecha AAMMDD y homoclave de 3.
const RFC = /^[A-ZÑ&]{4}\d{6}[A-Z0-9]{3}$/
// CURP: 4 letras, fecha AAMMDD, sexo, 5 letras (entidad y consonantes), homoclave y dígito.
const CURP = /^[A-Z]{4}\d{6}[HMX][A-Z]{5}[A-Z0-9]\d$/
const NSS = /^\d{11}$/
const PHONE = /^[0-9+()\-. ]{7,30}$/

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function optionalId(value: unknown): number | null | undefined {
  if (value === null || value === undefined || value === '') return null
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : undefined
}

/** Error de validación interno de parseEmployee: se convierte en { ok: false }. */
class Invalid extends Error {}

export function parseEmployee(body: unknown): Parsed<EmployeeInput> {
  const data = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>

  /** Texto opcional con longitud máxima. */
  const optional = (key: string, max: number, label: string): string | null => {
    const value = text(data[key])
    if (value.length > max) throw new Invalid(`${label}: máximo ${max} caracteres`)
    return value || null
  }
  /** Identificador oficial opcional; se guarda en mayúsculas y sin espacios ni guiones. */
  const code = (key: string, pattern: RegExp, error: string): string | null => {
    const value = text(data[key]).toUpperCase().replace(/[\s-]/g, '')
    if (value && !pattern.test(value)) throw new Invalid(error)
    return value || null
  }
  const date = (key: string, label: string): string | null => {
    const value = text(data[key])
    if (value && !isValidDate(value)) throw new Invalid(`${label} no es una fecha válida`)
    return value || null
  }
  const phone = (key: string, label: string): string | null => {
    const value = text(data[key])
    if (value && !PHONE.test(value)) throw new Invalid(`${label} no es válido`)
    return value || null
  }
  const choice = <T extends string>(key: string, allowed: readonly T[], label: string): T | null => {
    const value = text(data[key])
    if (!value) return null
    if (!allowed.includes(value as T)) throw new Invalid(`${label} no es válido`)
    return value as T
  }
  const id = (key: string, error: string): number | null => {
    const value = optionalId(data[key])
    if (value === undefined) throw new Invalid(error)
    return value
  }

  try {
    const employeeNumber = text(data.employeeNumber)
    const fullName = text(data.fullName)
    const email = text(data.email).toLowerCase()
    const personalEmail = text(data.personalEmail).toLowerCase()

    if (!employeeNumber || employeeNumber.length > 20) {
      throw new Invalid('El número de empleado es obligatorio (máximo 20 caracteres)')
    }
    if (!fullName || fullName.length > 200) throw new Invalid('El nombre es obligatorio')
    if (!EMAIL.test(email) || email.length > 254) throw new Invalid('El correo de empresa no es válido')
    if (personalEmail && (!EMAIL.test(personalEmail) || personalEmail.length > 254)) {
      throw new Invalid('El correo personal no es válido')
    }

    const contractType = choice('contractType', CONTRACT_TYPES, 'El tipo de contrato')
    const contractStart = date('contractStart', 'El inicio del contrato')
    // Un contrato indefinido no tiene fecha de fin.
    const contractEnd = contractType === 'indefinido' ? null : date('contractEnd', 'El fin del contrato')
    if (contractStart && contractEnd && contractEnd < contractStart) {
      throw new Invalid('El fin del contrato no puede ser anterior al inicio')
    }

    const hireDate = date('hireDate', 'El alta IMSS')
    const imssEndDate = date('imssEndDate', 'La baja IMSS')
    if (hireDate && imssEndDate && imssEndDate < hireDate) {
      throw new Invalid('La baja IMSS no puede ser anterior al alta')
    }

    return {
      ok: true,
      value: {
        employeeNumber,
        fullName,
        email,
        jobTitle: optional('jobTitle', 100, 'El puesto'),
        hireDate,
        imssEndDate,
        departmentId: id('departmentId', 'El departamento no es válido'),
        supervisorId: id('supervisorId', 'El supervisor no es válido'),
        projectId: id('projectId', 'La analítica no es válida'),
        // Un empleado está activo salvo que se indique lo contrario.
        isActive: data.isActive !== false,
        rfc: code('rfc', RFC, 'El RFC no es válido (13 caracteres, persona física)'),
        nss: code('nss', NSS, 'El NSS no es válido (11 dígitos)'),
        curp: code('curp', CURP, 'La CURP no es válida (18 caracteres)'),
        personalEmail: personalEmail || null,
        personalPhone: phone('personalPhone', 'El teléfono personal'),
        workPhone: phone('workPhone', 'El teléfono de empresa'),
        maritalStatus: choice('maritalStatus', MARITAL_STATUSES, 'El estado civil'),
        emergencyContactName: optional('emergencyContactName', 200, 'El contacto de emergencia'),
        emergencyContactPhone: phone('emergencyContactPhone', 'El teléfono de emergencia'),
        bloodType: choice('bloodType', BLOOD_TYPES, 'El tipo de sangre'),
        homeAddress: optional('homeAddress', 500, 'El domicilio'),
        sizePants: optional('sizePants', 20, 'La talla de pantalón'),
        sizeTshirt: optional('sizeTshirt', 20, 'La talla de playera'),
        sizeShoes: optional('sizeShoes', 20, 'La talla de calzado'),
        sizeJacket: optional('sizeJacket', 20, 'La talla de rompevientos y chamarra'),
        sizeShirt: optional('sizeShirt', 20, 'La talla de camisa'),
        contractType,
        contractStart,
        contractEnd,
        criminalRecordLetter: data.criminalRecordLetter === true,
      },
    }
  } catch (error) {
    if (!(error instanceof Invalid)) throw error
    return { ok: false, error: error.message }
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
