// Saldo de vacaciones. Funciones puras: no tocan la base de datos ni Express.
//
// Reglas (CLAUDE.md, confirmadas el 2026-11-16):
//   - El saldo sale de la fecha de ingreso, con la tabla de la LFT 2023+.
//   - El año se cuenta por ANIVERSARIO de ingreso («año de servicio»). El año 1 va del
//     ingreso al primer aniversario, y sus días están disponibles completos desde el primer día.
//   - Los días no usados caducan al terminar el año de servicio: no se acumulan.
//   - Cuentan los días laborables: lunes a sábado que no sean festivos. No hay medios días.
//   - Los días de una solicitud pendiente quedan reservados.
//   - Cada día se descuenta del año de servicio en el que cae.

/** Día en formato AAAA-MM-DD. */
export type DateKey = string

export interface ServiceYear {
  /** 1 = del ingreso al primer aniversario. */
  number: number
  /** Primer día del año de servicio (el ingreso o un aniversario). */
  start: DateKey
  /** Último día: la víspera del siguiente aniversario. */
  end: DateKey
}

/** Ajuste manual de RRHH sobre un año de servicio. */
export interface BalanceAdjustment {
  serviceYear: number
  days: number
}

export interface VacationBalance extends ServiceYear {
  /** Días que da la tabla de la LFT para ese año de servicio. */
  entitlement: number
  /** Suma de los ajustes manuales de RRHH. */
  adjustment: number
  /** Días de solicitudes aprobadas. */
  used: number
  /** Días de solicitudes aún pendientes. */
  reserved: number
  /** entitlement + adjustment − used − reserved. Puede quedar negativo tras un ajuste. */
  available: number
}

export interface BalanceInput {
  hireDate: DateKey
  /** Días de vacaciones de solicitudes aprobadas. */
  usedDays: DateKey[]
  /** Días de vacaciones de solicitudes pendientes. */
  reservedDays: DateKey[]
  adjustments: BalanceAdjustment[]
}

// Las fechas AAAA-MM-DD se tratan siempre en UTC para que el resultado no dependa de la
// zona horaria del servidor.
function toUtc(date: DateKey): Date {
  return new Date(`${date}T00:00:00Z`)
}

function toKey(date: Date): DateKey {
  return date.toISOString().slice(0, 10)
}

function addDays(date: DateKey, days: number): DateKey {
  const utc = toUtc(date)
  utc.setUTCDate(utc.getUTCDate() + days)
  return toKey(utc)
}

/**
 * Días de vacaciones del año de servicio `serviceYear` (tabla LFT 2023+):
 * 12, 14, 16, 18 y 20 los cinco primeros años; después 2 más por cada cinco años
 * (6-10: 22, 11-15: 24, ... 26-30: 30). Pasados los 30 años la progresión sigue igual.
 */
export function entitlementDays(serviceYear: number): number {
  if (!Number.isInteger(serviceYear) || serviceYear < 1) return 0
  if (serviceYear <= 5) return 10 + 2 * serviceYear
  return 20 + 2 * Math.ceil((serviceYear - 5) / 5)
}

/**
 * Aniversario número `years` del ingreso (0 = el propio ingreso).
 * Quien ingresó un 29 de febrero cumple el 28 en los años no bisiestos.
 */
export function anniversary(hireDate: DateKey, years: number): DateKey {
  const hired = toUtc(hireDate)
  const year = hired.getUTCFullYear() + years
  const month = hired.getUTCMonth()
  const lastDayOfMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return toKey(new Date(Date.UTC(year, month, Math.min(hired.getUTCDate(), lastDayOfMonth))))
}

/** Año de servicio en el que cae `date`, o null si es anterior al ingreso. */
export function serviceYearOf(hireDate: DateKey, date: DateKey): ServiceYear | null {
  if (date < hireDate) return null
  // Primera aproximación por diferencia de años; se corrige si aún no llegó el aniversario.
  let completed = toUtc(date).getUTCFullYear() - toUtc(hireDate).getUTCFullYear()
  if (anniversary(hireDate, completed) > date) completed -= 1
  return {
    number: completed + 1,
    start: anniversary(hireDate, completed),
    end: addDays(anniversary(hireDate, completed + 1), -1),
  }
}

/** ¿Es día laborable? Lunes a sábado que no sea festivo. */
export function isWorkingDay(date: DateKey, holidays: ReadonlySet<DateKey>): boolean {
  return toUtc(date).getUTCDay() !== 0 && !holidays.has(date)
}

/** Días laborables entre dos fechas, ambas incluidas. Vacío si el rango está al revés. */
export function workingDays(start: DateKey, end: DateKey, holidays: ReadonlySet<DateKey>): DateKey[] {
  const days: DateKey[] = []
  for (let day = start; day <= end; day = addDays(day, 1)) {
    if (isWorkingDay(day, holidays)) days.push(day)
  }
  return days
}

function countInYear(days: DateKey[], year: ServiceYear): number {
  return days.filter((day) => day >= year.start && day <= year.end).length
}

function balanceOfYear(input: BalanceInput, year: ServiceYear): VacationBalance {
  const entitlement = entitlementDays(year.number)
  const adjustment = input.adjustments
    .filter((item) => item.serviceYear === year.number)
    .reduce((sum, item) => sum + item.days, 0)
  const used = countInYear(input.usedDays, year)
  const reserved = countInYear(input.reservedDays, year)
  return { ...year, entitlement, adjustment, used, reserved, available: entitlement + adjustment - used - reserved }
}

/** Saldo del año de servicio en el que cae `date`. null si `date` es anterior al ingreso. */
export function vacationBalance(input: BalanceInput, date: DateKey): VacationBalance | null {
  const year = serviceYearOf(input.hireDate, date)
  return year ? balanceOfYear(input, year) : null
}

export interface YearCheck {
  balance: VacationBalance
  /** Días que la solicitud pide de ese año de servicio. */
  requested: number
  /** Días que faltan (0 si alcanza). */
  shortage: number
}

export type VacationCheck =
  | { ok: true; years: YearCheck[] }
  | { ok: false; reason: 'no_days' | 'before_hire' | 'overlap' | 'insufficient'; years: YearCheck[] }

/**
 * ¿Se pueden pedir estos días de vacaciones? `requestedDays` son los días laborables de la
 * solicitud. Cada día se carga al año de servicio en el que cae, así que una solicitud que
 * cruza un aniversario se comprueba contra los dos años.
 */
export function checkVacationRequest(input: BalanceInput, requestedDays: DateKey[]): VacationCheck {
  if (requestedDays.length === 0) return { ok: false, reason: 'no_days', years: [] }
  if (requestedDays.some((day) => day < input.hireDate)) return { ok: false, reason: 'before_hire', years: [] }

  const taken = new Set([...input.usedDays, ...input.reservedDays])
  if (requestedDays.some((day) => taken.has(day))) return { ok: false, reason: 'overlap', years: [] }

  const byYear = new Map<number, YearCheck>()
  for (const day of requestedDays) {
    const year = serviceYearOf(input.hireDate, day)
    if (!year) continue
    const check = byYear.get(year.number) ?? { balance: balanceOfYear(input, year), requested: 0, shortage: 0 }
    check.requested += 1
    byYear.set(year.number, check)
  }

  const years = [...byYear.values()].sort((a, b) => a.balance.number - b.balance.number)
  for (const check of years) check.shortage = Math.max(0, check.requested - check.balance.available)
  return years.some((check) => check.shortage > 0) ? { ok: false, reason: 'insufficient', years } : { ok: true, years }
}
