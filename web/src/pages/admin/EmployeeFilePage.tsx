import { ArrowLeft, Pencil } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Avatar, StatusBadge } from './EmployeesTab.tsx'
import {
  CONTRACT_TYPE_LABELS,
  employeesApi,
  formatDate,
  MARITAL_STATUS_LABELS,
  projectLabel,
  seniorityLabel,
  type EmployeeFile,
} from './employees.ts'
import { BUTTON_SECONDARY, ERROR_BOX, messageOf } from './ui.ts'

const CARD = 'rounded-2xl border border-border bg-surface shadow-sm'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="border-b border-border pb-3 text-xs font-bold tracking-wider text-secondary uppercase">{title}</h2>
      <dl>{children}</dl>
    </section>
  )
}

/** Fila etiqueta–valor. Sin valor muestra una raya, como en un expediente en papel sin rellenar. */
function Row({ label, value, mono = false }: { label: string; value: ReactNode; mono?: boolean }) {
  const empty = value === null || value === undefined || value === ''
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-3 last:border-0">
      <dt className="shrink-0 text-sm text-muted">{label}</dt>
      <dd className={`min-w-0 text-right text-sm font-medium break-words ${empty ? 'text-faint' : 'text-text'} ${mono ? 'font-mono' : ''}`}>
        {empty ? '—' : value}
      </dd>
    </div>
  )
}

const date = (value: string | null) => (value ? formatDate(value) : null)

// Expediente del empleado: todos sus datos, en solo lectura. Se edita desde el botón «Editar».
export default function EmployeeFilePage() {
  const id = Number(useParams().id)
  const [loaded, setLoaded] = useState<{ id: number; employee: EmployeeFile } | null>(null)
  const [failed, setFailed] = useState<{ id: number; message: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    employeesApi
      .get(id)
      .then((employee) => {
        if (!cancelled) setLoaded({ id, employee })
      })
      .catch((cause: unknown) => {
        if (!cancelled) setFailed({ id, message: messageOf(cause) })
      })
    return () => {
      cancelled = true
    }
  }, [id])

  const employee = loaded?.id === id ? loaded.employee : null
  const error = failed?.id === id ? failed.message : null

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 text-text min-[700px]:px-8">
      <div className="flex items-center gap-3">
        <Link
          to="/empleados"
          aria-label="Volver a empleados"
          title="Volver a empleados"
          className="rounded-lg p-2 text-secondary hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-accent"
        >
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-xl font-bold">Expediente del empleado</h1>
      </div>

      {error && <p className={`${ERROR_BOX} mt-4`}>{error}</p>}

      {employee && (
        <>
          <header className={`${CARD} mt-4 flex flex-wrap items-center gap-4 p-5`}>
            <Avatar name={employee.fullName} size="size-16 text-xl" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="rounded-md border border-border px-2 py-0.5 font-mono text-xs font-semibold">
                  {employee.employeeNumber}
                </span>
                <span className="text-xl font-bold">{employee.fullName}</span>
                <StatusBadge isActive={employee.isActive} />
              </div>
              <p className="mt-1.5 text-sm text-muted">
                {[employee.jobTitle, employee.departmentName, projectLabel(employee)].filter(Boolean).join('  ·  ') ||
                  'Sin puesto ni departamento registrados'}
              </p>
            </div>
            <Link to={`/empleados/${employee.id}/editar`} className={`${BUTTON_SECONDARY} flex items-center gap-2`}>
              <Pencil size={16} aria-hidden="true" /> Editar
            </Link>
          </header>

          <div className="mt-4 grid grid-cols-1 gap-4 min-[1000px]:grid-cols-3">
            <div className={`${CARD} grid grid-cols-1 gap-x-10 gap-y-8 p-6 min-[700px]:grid-cols-2 min-[1000px]:col-span-2`}>
              <Section title="Datos laborales">
                <Row label="Puesto de trabajo" value={employee.jobTitle} />
                <Row label="Departamento" value={employee.departmentName} />
                <Row label="Analítica" value={projectLabel(employee)} />
                <Row label="Supervisor" value={employee.supervisorName} />
                <Row label="Email empresa" value={employee.email} />
                <Row label="Teléfono empresa" value={employee.workPhone} />
              </Section>

              <Section title="Contrato e IMSS">
                <Row label="Tipo de contrato" value={employee.contractType && CONTRACT_TYPE_LABELS[employee.contractType]} />
                <Row label="Inicio de contrato" value={date(employee.contractStart)} />
                <Row
                  label="Fin de contrato"
                  value={employee.contractType === 'indefinido' ? 'Sin fecha de fin' : date(employee.contractEnd)}
                />
                <Row label="Alta IMSS Revergy" value={date(employee.hireDate)} />
                <Row label="Antigüedad" value={employee.hireDate && seniorityLabel(employee.hireDate)} />
                <Row label="Baja IMSS" value={date(employee.imssEndDate)} />
              </Section>

              <Section title="Identificación">
                <Row label="RFC" value={employee.rfc} mono />
                <Row label="NSS" value={employee.nss} mono />
                <Row label="CURP" value={employee.curp} mono />
                <Row label="Carta de no antecedentes penales" value={employee.criminalRecordLetter ? 'Entregada' : 'No entregada'} />
              </Section>

              <Section title="Datos personales">
                <Row label="Email personal" value={employee.personalEmail} />
                <Row label="Teléfono personal" value={employee.personalPhone} />
                <Row label="Estado civil" value={employee.maritalStatus && MARITAL_STATUS_LABELS[employee.maritalStatus]} />
                <Row label="Tipo de sangre" value={employee.bloodType} />
                <Row label="Domicilio particular" value={employee.homeAddress} />
              </Section>
            </div>

            <div className="flex flex-col gap-4">
              <div className={`${CARD} p-6`}>
                <h2 className="text-xs font-bold tracking-wider text-secondary uppercase">En caso de emergencia</h2>
                <p className={`mt-3 text-base font-bold ${employee.emergencyContactName ? '' : 'text-faint'}`}>
                  {employee.emergencyContactName ?? 'Sin contacto registrado'}
                </p>
                <dl className="mt-2 border-t border-border">
                  <Row label="Teléfono" value={employee.emergencyContactPhone} />
                  <Row label="Tipo de sangre" value={employee.bloodType} />
                </dl>
              </div>

              <div className={`${CARD} p-6`}>
                <Section title="Tallas">
                  <Row label="Pantalón" value={employee.sizePants} />
                  <Row label="Playera" value={employee.sizeTshirt} />
                  <Row label="Camisa" value={employee.sizeShirt} />
                  <Row label="Calzado" value={employee.sizeShoes} />
                  <Row label="Rompevientos y chamarra" value={employee.sizeJacket} />
                </Section>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
