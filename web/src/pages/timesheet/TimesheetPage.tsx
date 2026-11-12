import { MessageSquare } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useAuth } from '../../auth/authContext.ts'
import { CommentDialog } from './CommentDialog.tsx'
import { ProjectPicker } from './ProjectPicker.tsx'
import { formatTime, SHIFT_TYPES, timesheetApi, type Project, type ShiftType, type TodayView } from './api.ts'

const CARD = 'rounded-2xl border border-border bg-surface shadow-sm'
const LABEL = 'mb-1.5 block text-[15px] font-semibold text-text'
const CLOCK_BUTTON =
  'h-[52px] w-full cursor-pointer rounded-lg text-lg font-bold text-white shadow-md active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-gray-300 disabled:shadow-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

function initials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase() || 'U'
  )
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Ha ocurrido un error'
}

/** Reloj de pantalla. Es solo informativo: la hora del fichaje la pone el servidor. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])
  return now
}

function Clock() {
  const now = useNow()
  return (
    <section className={`${CARD} px-4 pt-6 pb-5 text-center`} aria-label="Fecha y hora">
      <p className="text-xl font-light text-text first-letter:uppercase">
        {now.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })}
      </p>
      <p className="mt-1 text-[3.4rem] leading-none font-bold text-text tabular-nums">
        {now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
      </p>
    </section>
  )
}

export default function TimesheetPage() {
  const user = useAuth()
  const [projects, setProjects] = useState<Project[]>([])
  const [today, setToday] = useState<TodayView | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Borrador: lo que se elige antes de fichar la entrada.
  const [projectId, setProjectId] = useState<number | null>(null)
  const [shiftType, setShiftType] = useState<ShiftType | ''>('')
  const [perDiem, setPerDiem] = useState(false)
  const [draftComment, setDraftComment] = useState('')

  const [commentOpen, setCommentOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([timesheetApi.projects(), timesheetApi.today()])
      .then(([projectList, todayView]) => {
        if (cancelled) return
        setProjects(projectList)
        setToday(todayView)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setLoadError(messageOf(cause))
      })
    return () => {
      cancelled = true
    }
  }, [])

  const run = async (action: () => Promise<TodayView>) => {
    setSaving(true)
    setActionError(null)
    try {
      setToday(await action())
      return true
    } catch (cause) {
      setActionError(messageOf(cause))
      // El estado real puede haber cambiado (por ejemplo, fichado desde otro dispositivo).
      timesheetApi.today().then(setToday, () => undefined)
      return false
    } finally {
      setSaving(false)
    }
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-md px-4 py-10 text-center">
        <p role="alert" className="rounded-lg bg-red-100 px-3 py-3 text-sm font-medium text-red-800">
          {loadError}
        </p>
      </div>
    )
  }

  const entry = today?.entry ?? null
  const state = !today ? 'loading' : !entry ? 'pending' : entry.clockOut ? 'done' : 'open'
  const locked = state !== 'pending' || saving
  const approved = entry?.status === 'approved'
  const comment = entry ? (entry.comment ?? '') : draftComment
  const canClockIn = projectId !== null && shiftType !== '' && !saving

  const saveComment = async (text: string) => {
    if (entry) {
      if (!(await run(() => timesheetApi.setComment(text)))) return
    } else {
      setDraftComment(text)
    }
    setCommentOpen(false)
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-3 px-3 py-4">
      <section className={`${CARD} flex items-center gap-3 px-3.5 py-2.5`} aria-label="Usuario">
        <span className="bg-brand-gradient flex size-12 shrink-0 items-center justify-center rounded-full font-bold text-white">
          {initials(user.name)}
        </span>
        <div className="min-w-0">
          <p className="truncate font-semibold text-text">{user.name}</p>
          <p className="truncate text-sm text-muted">{user.email}</p>
        </div>
      </section>

      <Clock />

      <section className={`${CARD} px-4 pt-4 pb-5`} aria-labelledby="registro-title">
        <h1 id="registro-title" className="mb-4 text-xl font-semibold text-text">
          Detalles del Registro
        </h1>

        <div className="mb-4">
          <label className={LABEL} htmlFor="ts-project">Analítica / Proyecto:</label>
          {entry ? (
            <p className="rounded-lg border border-border bg-bg px-3 py-2.5 text-[15px] text-text">
              {[entry.projectCode, entry.projectName].filter(Boolean).join(' · ')}
            </p>
          ) : (
            <ProjectPicker id="ts-project" projects={projects} value={projectId} onChange={setProjectId} disabled={locked} />
          )}
        </div>

        <div className="mb-4">
          <label className={LABEL} htmlFor="ts-shift">Tipo de jornada:</label>
          <select
            id="ts-shift"
            disabled={locked}
            value={entry ? entry.shiftType : shiftType}
            onChange={(event) => setShiftType(event.target.value as ShiftType | '')}
            className="h-11 w-full rounded-lg border border-border bg-surface px-3 text-[15px] text-text disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-accent"
          >
            <option value="">Seleccionar…</option>
            {SHIFT_TYPES.map((type) => (
              <option key={type.id} value={type.id}>{type.label}</option>
            ))}
          </select>
        </div>

        <label className={`mb-4 flex items-center justify-between gap-3 ${locked ? 'opacity-60' : 'cursor-pointer'}`}>
          <span className="text-[15px] font-semibold text-text">Aplicar Dieta</span>
          <input
            id="ts-per-diem"
            type="checkbox"
            role="switch"
            disabled={locked}
            checked={entry ? entry.perDiem : perDiem}
            onChange={(event) => setPerDiem(event.target.checked)}
            className="peer sr-only"
          />
          <span className="relative h-7 w-12 rounded-full bg-gray-300 transition-colors peer-checked:bg-brand-green peer-focus-visible:outline-2 peer-focus-visible:outline-accent after:absolute after:top-0.5 after:left-0.5 after:size-6 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-5" />
        </label>

        <button
          type="button"
          disabled={saving || state === 'loading' || (approved && !comment)}
          onClick={() => setCommentOpen(true)}
          className={`mb-5 flex h-10 w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-medium text-accent disabled:cursor-default disabled:opacity-60 ${
            comment ? 'border border-accent bg-accent-soft-strong' : 'border border-dashed border-border bg-bg'
          }`}
        >
          <MessageSquare size={15} aria-hidden="true" />
          {comment ? 'Ver comentario' : 'Comentario'}
        </button>

        <div className="text-center">
          {state === 'loading' && <p className="py-3 text-muted">Cargando registro…</p>}

          {state === 'pending' && (
            <>
              <button
                id="btn-clock-in"
                type="button"
                disabled={!canClockIn}
                onClick={() => {
                  if (projectId === null || shiftType === '') return
                  void run(() => timesheetApi.clockIn({ projectId, shiftType, perDiem, comment: draftComment }))
                }}
                className={`${CLOCK_BUTTON} bg-brand-green`}
              >
                {saving ? 'Guardando…' : 'Fichar entrada'}
              </button>
              {(projectId === null || shiftType === '') && (
                <p className="mt-1.5 text-[13px] text-muted">Selecciona proyecto y tipo de jornada para fichar.</p>
              )}
            </>
          )}

          {state === 'open' && entry && (
            <>
              <button
                id="btn-clock-out"
                type="button"
                disabled={saving}
                onClick={() => void run(() => timesheetApi.clockOut())}
                className={`${CLOCK_BUTTON} bg-brand-blue`}
              >
                {saving ? 'Guardando…' : 'Fichar salida'}
              </button>
              <p className="mt-1.5 text-[13px] text-muted">
                Entrada registrada {today?.isYesterday ? 'ayer ' : ''}a las {formatTime(entry.clockIn)}
              </p>
            </>
          )}

          {state === 'done' && entry?.clockOut && (
            <>
              <p className="text-lg font-semibold text-accent">
                {today?.isYesterday ? 'Jornada de ayer completada' : 'Jornada completada por hoy'}
              </p>
              <p className="mt-1.5 text-[13px] text-muted">
                Entrada {formatTime(entry.clockIn)} · Salida {formatTime(entry.clockOut)}
              </p>
            </>
          )}

          {actionError && (
            <p role="alert" className="mt-3 rounded-lg bg-red-100 px-3 py-2 text-sm font-medium text-red-800">
              {actionError}
            </p>
          )}
        </div>
      </section>

      {commentOpen && (
        <CommentDialog
          initialText={comment}
          readOnly={approved}
          saving={saving}
          onSave={(text) => void saveComment(text)}
          onClose={() => setCommentOpen(false)}
        />
      )}
    </div>
  )
}
