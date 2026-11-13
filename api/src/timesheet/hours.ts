// Cálculo de horas del Parte de Horas. Funciones puras: no tocan la base de datos ni Express.
//
// Reglas (CLAUDE.md, confirmadas el 2026-11-12):
//   Festivo   : todas las horas de un día del calendario de festivos, caiga en el día que caiga.
//   H. Domingo: todas las horas del domingo.
//   H. Extra  : todas las horas del sábado, y lo que pase de 8 h de lunes a viernes.
//   H. Normal : lunes a viernes no festivo, hasta 8 h por día.
//   Dietas    : número de días con dieta marcada.
// Sin redondeo y sin descontar comida: tiempo = salida − entrada, en minutos completos.
// Una jornada cuenta entera para el día en que se fichó la entrada, aunque termine pasada
// la medianoche. El tipo de jornada (Activa / Inactiva) no cambia el cálculo.

/** Minutos normales máximos por día, de lunes a viernes. */
export const NORMAL_MINUTES_PER_DAY = 8 * 60

/** Día en formato AAAA-MM-DD. */
export type DateKey = string

export type DayKind = 'weekday' | 'saturday' | 'sunday' | 'holiday'

export interface TimeEntryForHours {
  /** Día de la jornada: aquel en que se fichó la entrada. */
  date: DateKey
  clockIn: Date
  /** null mientras la jornada sigue abierta. */
  clockOut: Date | null
  /** ¿Aplica dieta ese día? */
  perDiem: boolean
}

/** Minutos de cada tipo. `total` es siempre la suma de los otros cuatro. */
export interface HoursBreakdown {
  normal: number
  extra: number
  sunday: number
  holiday: number
  total: number
}

export interface DayHours extends HoursBreakdown {
  date: DateKey
  kind: DayKind
  /** false si falta la salida: la jornada aún no suma horas. */
  complete: boolean
}

export interface WeekHours extends HoursBreakdown {
  /** Días con dieta marcada. */
  perDiems: number
  days: DayHours[]
}

const EMPTY: HoursBreakdown = { normal: 0, extra: 0, sunday: 0, holiday: 0, total: 0 }

// Las fechas AAAA-MM-DD se tratan siempre en UTC para que el resultado no dependa de la
// zona horaria del servidor.
function toUtc(date: DateKey): Date {
  return new Date(`${date}T00:00:00Z`)
}

function toDateKey(date: Date): DateKey {
  return date.toISOString().slice(0, 10)
}

export function addDays(date: DateKey, days: number): DateKey {
  const result = toUtc(date)
  result.setUTCDate(result.getUTCDate() + days)
  return toDateKey(result)
}

/** Lunes de la semana a la que pertenece el día. Las semanas van de lunes a domingo. */
export function weekStartOf(date: DateKey): DateKey {
  const weekday = toUtc(date).getUTCDay() // 0 = domingo
  return addDays(date, weekday === 0 ? -6 : 1 - weekday)
}

/** Los siete días de la semana, de lunes a domingo. */
export function weekDates(weekStart: DateKey): DateKey[] {
  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index))
}

/** Tipo de día. El festivo manda sobre el día de la semana. */
export function dayKind(date: DateKey, holidays: ReadonlySet<DateKey>): DayKind {
  if (holidays.has(date)) return 'holiday'
  const weekday = toUtc(date).getUTCDay()
  if (weekday === 0) return 'sunday'
  if (weekday === 6) return 'saturday'
  return 'weekday'
}

/** Minutos completos entre la entrada y la salida. 0 si falta la salida o no es posterior. */
export function workedMinutes(clockIn: Date, clockOut: Date | null): number {
  if (!clockOut) return 0
  const minutes = Math.floor((clockOut.getTime() - clockIn.getTime()) / 60_000)
  return Number.isFinite(minutes) && minutes > 0 ? minutes : 0
}

/** Reparte los minutos trabajados de un día según su tipo. */
export function classifyMinutes(total: number, kind: DayKind): HoursBreakdown {
  switch (kind) {
    case 'holiday':
      return { ...EMPTY, holiday: total, total }
    case 'sunday':
      return { ...EMPTY, sunday: total, total }
    case 'saturday':
      return { ...EMPTY, extra: total, total }
    case 'weekday': {
      const normal = Math.min(total, NORMAL_MINUTES_PER_DAY)
      return { ...EMPTY, normal, extra: total - normal, total }
    }
  }
}

export function calculateDay(entry: TimeEntryForHours, holidays: ReadonlySet<DateKey>): DayHours {
  const kind = dayKind(entry.date, holidays)
  return {
    date: entry.date,
    kind,
    complete: entry.clockOut !== null,
    ...classifyMinutes(workedMinutes(entry.clockIn, entry.clockOut), kind),
  }
}

/**
 * Consolidado de un conjunto de jornadas (normalmente, las de una semana de un colaborador):
 * H. Normal, H. Extra, H. Domingo, Festivo, Dietas y Total. Hay como mucho una jornada por día.
 */
export function calculateWeek(entries: readonly TimeEntryForHours[], holidays: ReadonlySet<DateKey>): WeekHours {
  const days = entries.map((entry) => calculateDay(entry, holidays)).sort((a, b) => a.date.localeCompare(b.date))

  const totals = days.reduce<HoursBreakdown>(
    (sum, day) => ({
      normal: sum.normal + day.normal,
      extra: sum.extra + day.extra,
      sunday: sum.sunday + day.sunday,
      holiday: sum.holiday + day.holiday,
      total: sum.total + day.total,
    }),
    EMPTY,
  )

  return { ...totals, perDiems: entries.filter((entry) => entry.perDiem).length, days }
}

/** Minutos a horas con dos decimales, para nómina (ej. 510 → 8.5). */
export function minutesToHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100
}

/** Minutos a «h:mm», para mostrar (ej. 510 → «8:30»). */
export function formatMinutes(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`
}
