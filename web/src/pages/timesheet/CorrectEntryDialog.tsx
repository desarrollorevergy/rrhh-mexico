import { useEffect, useState } from 'react'
import { ProjectPicker } from './ProjectPicker.tsx'
import {
  buildSchedule,
  parseDateKey,
  SHIFT_TYPES,
  timesheetApi,
  toTimeInput,
  type EntryCorrection,
  type Project,
  type ShiftType,
  type WeekDay,
} from './api.ts'

interface Props {
  day: WeekDay
  /** Aviso sobre el formulario, por ejemplo el motivo del rechazo. */
  notice?: string | null
  saving: boolean
  error: string | null
  onSave: (changes: EntryCorrection) => void
  onClose: () => void
}

const LABEL = 'mb-1 block text-xs font-semibold text-secondary'
const INPUT =
  'h-11 w-full rounded-lg border border-border bg-surface px-3 text-[15px] text-text focus-visible:outline-2 focus-visible:outline-accent'

// Corrección manual de una jornada: horario, analítica, tipo y dieta.
export function CorrectEntryDialog({ day, notice, saving, error, onSave, onClose }: Props) {
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState<number | null>(day.projectId)
  const [shiftType, setShiftType] = useState<ShiftType>(day.shiftType)
  const [perDiem, setPerDiem] = useState(day.perDiem)
  const initialIn = toTimeInput(day.clockIn)
  const initialOut = toTimeInput(day.clockOut)
  const [timeIn, setTimeIn] = useState(initialIn)
  const [timeOut, setTimeOut] = useState(initialOut)

  useEffect(() => {
    let cancelled = false
    timesheetApi.projects().then(
      (list) => {
        if (!cancelled) setProjects(list)
      },
      () => undefined,
    )
    return () => {
      cancelled = true
    }
  }, [])

  const schedule = timeIn ? buildSchedule(day.workDate, timeIn, timeOut) : null
  // Una corrección no puede dejar una jornada que ya tenía salida sin ella.
  const valid = Boolean(timeIn) && projectId !== null && !(initialOut && !timeOut)

  const save = () => {
    if (!schedule || projectId === null) return
    const changes: EntryCorrection = {}
    if (projectId !== day.projectId) changes.projectId = projectId
    if (shiftType !== day.shiftType) changes.shiftType = shiftType
    if (perDiem !== day.perDiem) changes.perDiem = perDiem
    // Las horas solo se envían si se tocaron, para no perder los segundos del fichaje original.
    if (timeIn !== initialIn) changes.clockIn = schedule.clockIn.toISOString()
    if (timeOut !== initialOut && schedule.clockOut) changes.clockOut = schedule.clockOut.toISOString()
    // Si cambia la entrada y la salida cae al día siguiente, la salida también se recoloca.
    if (timeIn !== initialIn && timeOut && schedule.clockOut) changes.clockOut = schedule.clockOut.toISOString()
    onSave(changes)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/40 p-3 min-[520px]:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="correct-title"
        className="w-full max-w-md rounded-2xl border border-border bg-surface p-4 text-text shadow-xl"
      >
        <h2 id="correct-title" className="text-lg font-bold">Corregir jornada</h2>
        <p className="text-sm text-muted first-letter:uppercase">
          {parseDateKey(day.workDate).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>

        {notice && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{notice}</p>}

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className={LABEL} htmlFor="fix-in">Entrada</label>
            <input id="fix-in" type="time" required className={INPUT} value={timeIn} onChange={(event) => setTimeIn(event.target.value)} />
          </div>
          <div>
            <label className={LABEL} htmlFor="fix-out">Salida</label>
            <input id="fix-out" type="time" className={INPUT} value={timeOut} onChange={(event) => setTimeOut(event.target.value)} />
          </div>
          {schedule?.nextDay && <p className="col-span-2 -mt-1 text-xs text-muted">La jornada termina al día siguiente.</p>}

          <div className="col-span-2">
            <label className={LABEL} htmlFor="fix-project">Analítica / Proyecto</label>
            <ProjectPicker id="fix-project" projects={projects} value={projectId} onChange={setProjectId} disabled={projects.length === 0} />
          </div>
          <div>
            <label className={LABEL} htmlFor="fix-shift">Tipo de jornada</label>
            <select id="fix-shift" className={INPUT} value={shiftType} onChange={(event) => setShiftType(event.target.value as ShiftType)}>
              {SHIFT_TYPES.map((type) => (
                <option key={type.id} value={type.id}>{type.label}</option>
              ))}
            </select>
          </div>
          <label className="flex cursor-pointer items-end gap-2 pb-2.5 text-sm font-semibold">
            <input id="fix-per-diem" type="checkbox" className="size-4" checked={perDiem} onChange={(event) => setPerDiem(event.target.checked)} />
            Aplicar dieta
          </label>
        </div>

        {error && (
          <p role="alert" className="mt-3 rounded-lg bg-red-100 px-3 py-2 text-sm font-medium text-red-800">
            {error}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="h-10 cursor-pointer rounded-lg border border-border px-4 text-sm font-semibold text-text"
            onClick={onClose}
            disabled={saving}
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={!valid || saving}
            className="h-10 cursor-pointer rounded-lg bg-brand-blue px-4 text-sm font-semibold text-white disabled:cursor-default disabled:opacity-50"
            onClick={save}
          >
            {saving ? 'Guardando…' : 'Guardar corrección'}
          </button>
        </div>
      </div>
    </div>
  )
}
