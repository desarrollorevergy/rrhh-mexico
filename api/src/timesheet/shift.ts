import { addDays, type DateKey } from './hours.js'

// Reglas para saber a qué día pertenece un fichaje. Funciones puras.

/**
 * Hora local hasta la que una jornada del día anterior sigue siendo la jornada activa:
 * quien entra de noche y sale de madrugada ficha la salida sobre la jornada de ayer.
 */
export const CUTOFF_HOUR = 8

export function isValidTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== 'string' || timeZone.length === 0 || timeZone.length > 64) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return true
  } catch {
    return false
  }
}

/** Fecha y hora local de un instante en una zona horaria. */
export function localParts(instant: Date, timeZone: string): { date: DateKey; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) }
}

/** Lo que hace falta saber de una jornada para decidir cuál es la activa. */
export interface ShiftRef {
  clockOut: Date | null
}

export interface ActiveShift {
  /** Día de la jornada que se muestra y sobre la que se ficha. */
  workDate: DateKey
  /** true si es la de ayer (aún abierta o cerrada de madrugada). */
  isYesterday: boolean
}

/**
 * Jornada activa en este momento para el colaborador.
 * Antes de la hora de corte, si no ha fichado hoy y la jornada de ayer sigue abierta o se
 * cerró pasada la medianoche, la activa es la de ayer. En cualquier otro caso, la de hoy.
 */
export function resolveActiveShift(input: {
  now: Date
  timeZone: string
  today: ShiftRef | undefined
  yesterday: ShiftRef | undefined
}): ActiveShift {
  const { date: today, hour } = localParts(input.now, input.timeZone)
  const isToday: ActiveShift = { workDate: today, isYesterday: false }

  if (input.today || hour >= CUTOFF_HOUR || !input.yesterday) return isToday

  const asYesterday: ActiveShift = { workDate: addDays(today, -1), isYesterday: true }
  if (!input.yesterday.clockOut) return asYesterday
  // Cerrada después de medianoche: se sigue mostrando como completada hasta la hora de corte.
  return localParts(input.yesterday.clockOut, input.timeZone).date === today ? asYesterday : isToday
}
