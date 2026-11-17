import { apiGet, apiPost, apiPut } from '../../api/client.ts'

// Tipos, etiquetas y llamadas de la Ficha de Empleado (lista, expediente y formulario).

/** Lo que trae la lista: sin datos sensibles. */
export interface EmployeeSummary {
  id: number
  employeeNumber: string
  fullName: string
  email: string
  jobTitle: string | null
  departmentId: number | null
  departmentName: string | null
  supervisorId: number | null
  supervisorName: string | null
  projectId: number | null
  projectCode: string | null
  projectName: string | null
  /** Alta IMSS Revergy (AAAA-MM-DD). */
  hireDate: string | null
  isActive: boolean
}

/** Expediente completo. */
export interface EmployeeFile extends EmployeeSummary {
  imssEndDate: string | null
  rfc: string | null
  nss: string | null
  curp: string | null
  personalEmail: string | null
  personalPhone: string | null
  workPhone: string | null
  maritalStatus: string | null
  emergencyContactName: string | null
  emergencyContactPhone: string | null
  bloodType: string | null
  homeAddress: string | null
  sizePants: string | null
  sizeTshirt: string | null
  sizeShoes: string | null
  sizeJacket: string | null
  sizeShirt: string | null
  contractType: string | null
  contractStart: string | null
  contractEnd: string | null
  criminalRecordLetter: boolean
}

export interface Department {
  id: number
  name: string
}

export interface Project {
  id: number
  code: string
  name: string | null
  detail: string | null
}

export const MARITAL_STATUS_LABELS: Record<string, string> = {
  soltero: 'Soltero(a)',
  casado: 'Casado(a)',
  union_libre: 'Unión libre',
  divorciado: 'Divorciado(a)',
  viudo: 'Viudo(a)',
}

export const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']

export const CONTRACT_TYPE_LABELS: Record<string, string> = {
  indefinido: 'Indefinido',
  proyecto: 'Por proyecto',
}

/** «4 mar 2019» a partir de AAAA-MM-DD, sin depender de la zona horaria. */
export function formatDate(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Iniciales para el avatar mientras no haya fotografía: primera letra de las dos primeras palabras. */
export function initialsOf(fullName: string): string {
  const words = fullName.trim().split(/\s+/).filter(Boolean)
  return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? '')).toUpperCase() || '?'
}

/** «MX0011000 · GERENCIA». */
export function projectLabel(employee: Pick<EmployeeSummary, 'projectCode' | 'projectName'>): string | null {
  if (!employee.projectCode) return null
  return employee.projectName ? `${employee.projectCode} · ${employee.projectName}` : employee.projectCode
}

/** Antigüedad a partir del alta: «7 años y 8 meses». */
export function seniorityLabel(hireDate: string, today = new Date()): string {
  const start = new Date(`${hireDate}T00:00:00`)
  let months = (today.getFullYear() - start.getFullYear()) * 12 + today.getMonth() - start.getMonth()
  if (today.getDate() < start.getDate()) months -= 1
  if (months < 0) return 'Aún no ingresa'
  const years = Math.floor(months / 12)
  const rest = months % 12
  const yearsText = years === 1 ? '1 año' : `${years} años`
  const monthsText = rest === 1 ? '1 mes' : `${rest} meses`
  if (years === 0) return monthsText
  return rest === 0 ? yearsText : `${yearsText} y ${monthsText}`
}

export const employeesApi = {
  list: () => apiGet<EmployeeSummary[]>('/api/employees'),
  get: (id: number) => apiGet<EmployeeFile>(`/api/employees/${id}`),
  create: (body: unknown) => apiPost<EmployeeFile>('/api/employees', body),
  update: (id: number, body: unknown) => apiPut<EmployeeFile>(`/api/employees/${id}`, body),
  departments: () => apiGet<Department[]>('/api/departments'),
  createDepartment: (name: string) => apiPost<Department>('/api/departments', { name }),
  projects: () => apiGet<Project[]>('/api/projects'),
}
