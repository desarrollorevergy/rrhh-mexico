import { useEffect, useState } from 'react'
import { EmployeeFileView } from './EmployeeFilePage.tsx'
import { employeesApi, type EmployeeFile } from './employees.ts'
import { ERROR_BOX, messageOf } from './ui.ts'

// «Mi ficha»: el expediente propio, completo y en solo lectura. Lo corrige RRHH.
export function MyFileTab() {
  const [employee, setEmployee] = useState<EmployeeFile | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    employeesApi
      .mine()
      .then((file) => {
        if (!cancelled) setEmployee(file)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(messageOf(cause))
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (error) return <p className={ERROR_BOX}>{error}</p>
  if (!employee) return null

  return (
    <>
      <EmployeeFileView employee={employee} canEdit={false} />
      <p className="mt-4 text-sm text-muted">Si algún dato es incorrecto, avisa a Recursos Humanos para que lo corrija.</p>
    </>
  )
}
