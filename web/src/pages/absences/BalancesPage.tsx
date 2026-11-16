import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { BUTTON_PRIMARY, BUTTON_SECONDARY, ERROR_BOX, INPUT, LABEL, messageOf } from '../admin/ui.ts'
import { absencesApi, formatDate, type EmployeeBalance } from './api.ts'

interface AdjustForm {
  employee: EmployeeBalance
  /** «add» suma días al saldo; «remove» los quita. */
  direction: 'add' | 'remove'
  days: string
  reason: string
}

// Saldos de vacaciones de todos los empleados, con ajuste manual. Solo RRHH.
export default function BalancesPage() {
  const [rows, setRows] = useState<EmployeeBalance[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [form, setForm] = useState<AdjustForm | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    absencesApi
      .balances()
      .then((result) => {
        if (!cancelled) setRows(result)
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
    if (!term) return rows ?? []
    return (rows ?? []).filter((row) =>
      `${row.employeeName} ${row.employeeNumber} ${row.departmentName ?? ''}`.toLowerCase().includes(term),
    )
  }, [rows, search])

  const openForm = (employee: EmployeeBalance) => {
    setFormError(null)
    setForm({ employee, direction: 'add', days: '1', reason: '' })
  }

  const days = form ? Number(form.days) : 0
  const daysValid = Number.isInteger(days) && days > 0 && days <= 60

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!form || !daysValid) return
    setSaving(true)
    setFormError(null)
    try {
      await absencesApi.adjust(form.employee.employeeId, form.direction === 'add' ? days : -days, form.reason)
      setRows(await absencesApi.balances())
      setForm(null)
    } catch (cause) {
      setFormError(messageOf(cause))
    } finally {
      setSaving(false)
    }
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-5xl px-3 py-4">
        <p className={ERROR_BOX}>{loadError}</p>
      </div>
    )
  }
  if (!rows) return null

  const missingHireDate = rows.filter((row) => !row.hireDate).length

  return (
    <div className="mx-auto max-w-5xl px-3 py-4 text-text min-[700px]:px-8">
      <p className="text-[13px] font-bold text-accent">VACACIONES / AUSENTISMOS</p>
      <h1 className="text-2xl font-bold">Saldos de vacaciones</h1>
      <p className="mt-0.5 text-sm text-muted">
        Saldo de cada empleado en su año de servicio en curso (de aniversario a aniversario).
        {missingHireDate > 0 &&
          ` ${missingHireDate} empleado(s) no tienen fecha de ingreso: regístrala en «Ficha de Empleado» para que tengan saldo.`}
      </p>

      <input
        type="search"
        aria-label="Buscar empleado"
        placeholder="Buscar por nombre, número o departamento"
        className={`${INPUT} mt-3 max-w-md`}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />

      <div className="mt-3 overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b border-border text-xs text-muted">
            <tr>
              <th className="px-3 py-2 font-semibold">Empleado</th>
              <th className="px-3 py-2 font-semibold">Ingreso</th>
              <th className="px-3 py-2 font-semibold">Año de servicio</th>
              <th className="px-3 py-2 text-right font-semibold">Del año</th>
              <th className="px-3 py-2 text-right font-semibold">Ajuste</th>
              <th className="px-3 py-2 text-right font-semibold">Usados</th>
              <th className="px-3 py-2 text-right font-semibold">En trámite</th>
              <th className="px-3 py-2 text-right font-semibold">Disponibles</th>
              <th className="px-3 py-2" aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.employeeId} className="border-b border-border last:border-0">
                <td className="px-3 py-2">
                  <div className="font-semibold">{row.employeeName}</div>
                  <div className="text-xs text-muted">
                    {row.employeeNumber}
                    {row.departmentName && ` · ${row.departmentName}`}
                  </div>
                </td>
                <td className="px-3 py-2">{row.hireDate ? formatDate(row.hireDate) : '—'}</td>
                {row.balance ? (
                  <>
                    <td className="px-3 py-2">
                      <div>{row.balance.number}</div>
                      <div className="text-xs text-muted">hasta {formatDate(row.balance.end)}</div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.balance.entitlement}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.balance.adjustment > 0 ? '+' : ''}
                      {row.balance.adjustment}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.balance.used}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.balance.reserved}</td>
                    <td className="px-3 py-2 text-right font-bold tabular-nums text-accent">{row.balance.available}</td>
                    <td className="px-3 py-2 text-right">
                      <button type="button" className="cursor-pointer text-xs font-semibold text-accent hover:underline" onClick={() => openForm(row)}>
                        Ajustar
                      </button>
                    </td>
                  </>
                ) : (
                  <td colSpan={7} className="px-3 py-2 text-muted">
                    Sin saldo: falta la fecha de ingreso.
                  </td>
                )}
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-muted">
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
            aria-label="Ajustar saldo"
            className="mt-10 w-full max-w-md rounded-2xl border border-border bg-surface p-5 text-text shadow-xl"
          >
            <h2 className="text-lg font-bold">Ajustar saldo</h2>
            <p className="mt-1 text-sm text-muted">
              {form.employee.employeeName}: {form.employee.balance?.available} día(s) disponibles en su año de servicio{' '}
              {form.employee.balance?.number}. El ajuste solo afecta a ese año.
            </p>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <label className={LABEL} htmlFor="adj-direction">Ajuste</label>
                <select
                  id="adj-direction"
                  className={INPUT}
                  value={form.direction}
                  onChange={(event) => setForm({ ...form, direction: event.target.value as AdjustForm['direction'] })}
                >
                  <option value="add">Sumar días</option>
                  <option value="remove">Quitar días</option>
                </select>
              </div>
              <div>
                <label className={LABEL} htmlFor="adj-days">Días</label>
                <input id="adj-days" type="number" required min={1} max={60} step={1} className={INPUT} value={form.days} onChange={(event) => setForm({ ...form, days: event.target.value })} />
              </div>
              <div className="col-span-2">
                <label className={LABEL} htmlFor="adj-reason">Motivo</label>
                <textarea id="adj-reason" required maxLength={1000} rows={2} className={`${INPUT} h-auto py-2`} value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} />
              </div>
            </div>

            {form.employee.adjustments.length > 0 && (
              <div className="mt-4">
                <h3 className="text-xs font-semibold text-secondary">Ajustes anteriores de este año</h3>
                <ul className="mt-1 flex flex-col gap-1 text-xs text-muted">
                  {form.employee.adjustments.map((item, index) => (
                    <li key={index}>
                      <strong className="text-text">
                        {item.days > 0 ? '+' : ''}
                        {item.days}
                      </strong>{' '}
                      · {item.reason} · {item.byName}, {new Date(item.at).toLocaleDateString('es-MX')}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {formError && <p role="alert" className={`${ERROR_BOX} mt-3`}>{formError}</p>}

            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className={BUTTON_SECONDARY} onClick={() => setForm(null)} disabled={saving}>
                Cerrar
              </button>
              <button type="submit" className={BUTTON_PRIMARY} disabled={saving || !daysValid || !form.reason.trim()}>
                {saving ? 'Guardando…' : 'Guardar ajuste'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
