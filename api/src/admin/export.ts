import ExcelJS from 'exceljs'
import type { EmployeeRow } from './repository.js'

// Descarga en Excel de todos los datos de los empleados activos (Ficha de Empleado, etapa 6).
// Lleva datos sensibles (RFC, NSS, CURP, domicilio...): solo la descarga RRHH.

const MARITAL_STATUS: Record<string, string> = {
  soltero: 'Soltero(a)',
  casado: 'Casado(a)',
  union_libre: 'Unión libre',
  divorciado: 'Divorciado(a)',
  viudo: 'Viudo(a)',
}

const CONTRACT_TYPE: Record<string, string> = { indefinido: 'Indefinido', proyecto: 'Por proyecto' }

type Value = string | number | Date | null

/** AAAA-MM-DD → fecha de Excel, sin desfase por zona horaria. */
function excelDate(value: string | null): Date | null {
  if (!value) return null
  const [year, month, day] = value.split('-').map(Number)
  return new Date(Date.UTC(year!, month! - 1, day!))
}

const DATE_FORMAT = 'dd/mm/yyyy'

/** Columnas del archivo, en el orden del expediente. */
const COLUMNS: { header: string; width: number; value: (row: EmployeeRow) => Value; date?: boolean }[] = [
  { header: 'Núm. empleado', width: 14, value: (row) => row.employeeNumber },
  { header: 'Nombre', width: 32, value: (row) => row.fullName },
  { header: 'Puesto', width: 24, value: (row) => row.jobTitle },
  { header: 'Departamento', width: 20, value: (row) => row.departmentName },
  { header: 'Supervisor', width: 28, value: (row) => row.supervisorName },
  { header: 'Analítica', width: 12, value: (row) => row.projectCode },
  { header: 'Nombre analítica', width: 24, value: (row) => row.projectName },
  { header: 'Email empresa', width: 30, value: (row) => row.email },
  { header: 'Teléfono empresa', width: 16, value: (row) => row.workPhone },
  { header: 'Alta IMSS Revergy', width: 14, value: (row) => excelDate(row.hireDate), date: true },
  { header: 'Baja IMSS', width: 12, value: (row) => excelDate(row.imssEndDate), date: true },
  { header: 'Tipo de contrato', width: 15, value: (row) => (row.contractType ? CONTRACT_TYPE[row.contractType] ?? row.contractType : null) },
  { header: 'Inicio de contrato', width: 14, value: (row) => excelDate(row.contractStart), date: true },
  { header: 'Fin de contrato', width: 14, value: (row) => excelDate(row.contractEnd), date: true },
  { header: 'RFC', width: 16, value: (row) => row.rfc },
  { header: 'NSS', width: 14, value: (row) => row.nss },
  { header: 'CURP', width: 21, value: (row) => row.curp },
  { header: 'Email personal', width: 30, value: (row) => row.personalEmail },
  { header: 'Teléfono personal', width: 16, value: (row) => row.personalPhone },
  { header: 'Estado civil', width: 13, value: (row) => (row.maritalStatus ? MARITAL_STATUS[row.maritalStatus] ?? row.maritalStatus : null) },
  { header: 'Tipo de sangre', width: 10, value: (row) => row.bloodType },
  { header: 'Domicilio particular', width: 40, value: (row) => row.homeAddress },
  { header: 'Contacto de emergencia', width: 28, value: (row) => row.emergencyContactName },
  { header: 'Teléfono de emergencia', width: 16, value: (row) => row.emergencyContactPhone },
  { header: 'Talla pantalón', width: 10, value: (row) => row.sizePants },
  { header: 'Talla playera', width: 10, value: (row) => row.sizeTshirt },
  { header: 'Talla camisa', width: 10, value: (row) => row.sizeShirt },
  { header: 'Talla calzado', width: 10, value: (row) => row.sizeShoes },
  { header: 'Talla rompevientos y chamarra', width: 14, value: (row) => row.sizeJacket },
  { header: 'Carta de no antecedentes', width: 12, value: (row) => (row.criminalRecordLetter ? 'Sí' : 'No') },
]

export const EXPORT_HEADERS = COLUMNS.map((column) => column.header)

/** Libro con una hoja «Empleados activos»: encabezado fijo, con filtros y un renglón por empleado. */
export async function buildEmployeesWorkbook(rows: EmployeeRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Plataforma RRHH Revergy México'
  const sheet = workbook.addWorksheet('Empleados activos', { views: [{ state: 'frozen', xSplit: 2, ySplit: 1 }] })

  sheet.columns = COLUMNS.map((column) => ({
    header: column.header,
    width: column.width,
    ...(column.date ? { style: { numFmt: DATE_FORMAT } } : {}),
  }))
  // Los valores se guardan siempre como texto, fecha o número: nunca como fórmula.
  for (const row of rows) sheet.addRow(COLUMNS.map((column) => column.value(row)))

  const header = sheet.getRow(1)
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF456099' } }
  header.alignment = { vertical: 'middle', wrapText: true }
  header.height = 30
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNS.length } }

  return Buffer.from(await workbook.xlsx.writeBuffer())
}
