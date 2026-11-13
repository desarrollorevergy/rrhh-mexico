import { describe, expect, it } from 'vitest'
import {
  addDays,
  calculateDay,
  calculateWeek,
  classifyMinutes,
  dayKind,
  formatMinutes,
  minutesToHours,
  weekDates,
  weekStartOf,
  workedMinutes,
  type TimeEntryForHours,
} from './hours.js'

// Semana de referencia: lunes 9 a domingo 15 de noviembre de 2026.
const MON = '2026-11-09'
const TUE = '2026-11-10'
const WED = '2026-11-11'
const THU = '2026-11-12'
const FRI = '2026-11-13'
const SAT = '2026-11-14'
const SUN = '2026-11-15'
// Lunes 16 de noviembre de 2026: Día de la Revolución (festivo oficial).
const HOLIDAY_MON = '2026-11-16'

const NO_HOLIDAYS = new Set<string>()
const HOLIDAYS = new Set([HOLIDAY_MON])

/** Jornada de `hours` horas que empieza a las 08:00 (hora de México, UTC−6). */
function entry(date: string, hours: number | null, perDiem = false): TimeEntryForHours {
  const clockIn = new Date(`${date}T08:00:00-06:00`)
  const clockOut = hours === null ? null : new Date(clockIn.getTime() + hours * 3_600_000)
  return { date, clockIn, clockOut, perDiem }
}

const h = (hours: number) => hours * 60

describe('fechas y semanas', () => {
  it('la semana va de lunes a domingo', () => {
    for (const day of [MON, WED, SAT, SUN]) expect(weekStartOf(day)).toBe(MON)
    expect(weekStartOf(HOLIDAY_MON)).toBe(HOLIDAY_MON)
    expect(weekDates(MON)).toEqual([MON, TUE, WED, THU, FRI, SAT, SUN])
  })

  it('cruza bien los cambios de mes y de año', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(weekStartOf('2027-01-01')).toBe('2026-12-28')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
  })

  it('el tipo de día: el festivo manda sobre el día de la semana', () => {
    expect(dayKind(MON, HOLIDAYS)).toBe('weekday')
    expect(dayKind(SAT, HOLIDAYS)).toBe('saturday')
    expect(dayKind(SUN, HOLIDAYS)).toBe('sunday')
    expect(dayKind(HOLIDAY_MON, HOLIDAYS)).toBe('holiday')
    expect(dayKind(SUN, new Set([SUN]))).toBe('holiday')
    expect(dayKind(SAT, new Set([SAT]))).toBe('holiday')
  })
})

describe('minutos trabajados', () => {
  const at = (time: string) => new Date(`2026-11-09T${time}-06:00`)

  it('es la diferencia entre salida y entrada, sin redondear ni descontar comida', () => {
    expect(workedMinutes(at('08:00:00'), at('17:00:00'))).toBe(540)
    expect(workedMinutes(at('08:07:00'), at('16:52:00'))).toBe(525)
  })

  it('cuenta minutos completos: los segundos sueltos no suman', () => {
    expect(workedMinutes(at('08:00:00'), at('08:00:59'))).toBe(0)
    expect(workedMinutes(at('08:00:30'), at('09:00:29'))).toBe(59)
  })

  it('es 0 si falta la salida o no es posterior a la entrada', () => {
    expect(workedMinutes(at('08:00:00'), null)).toBe(0)
    expect(workedMinutes(at('08:00:00'), at('08:00:00'))).toBe(0)
    expect(workedMinutes(at('09:00:00'), at('08:00:00'))).toBe(0)
  })
})

describe('reparto de un día', () => {
  it('lunes a viernes: hasta 8 h normales, el resto extra', () => {
    expect(classifyMinutes(h(6), 'weekday')).toEqual({ normal: h(6), extra: 0, sunday: 0, holiday: 0, total: h(6) })
    expect(classifyMinutes(h(8), 'weekday')).toMatchObject({ normal: h(8), extra: 0 })
    expect(classifyMinutes(h(8) + 1, 'weekday')).toMatchObject({ normal: h(8), extra: 1 })
    expect(classifyMinutes(h(11.5), 'weekday')).toMatchObject({ normal: h(8), extra: h(3.5), total: h(11.5) })
  })

  it('sábado: todo extra', () => {
    expect(classifyMinutes(h(5), 'saturday')).toEqual({ normal: 0, extra: h(5), sunday: 0, holiday: 0, total: h(5) })
  })

  it('domingo: todo a H. Domingo', () => {
    expect(classifyMinutes(h(10), 'sunday')).toEqual({ normal: 0, extra: 0, sunday: h(10), holiday: 0, total: h(10) })
  })

  it('festivo: todo a Festivo, sin tope de 8 h', () => {
    expect(classifyMinutes(h(10), 'holiday')).toEqual({ normal: 0, extra: 0, sunday: 0, holiday: h(10), total: h(10) })
  })

  it('el total siempre es la suma de las partes', () => {
    for (const kind of ['weekday', 'saturday', 'sunday', 'holiday'] as const) {
      for (const minutes of [0, 1, 479, 480, 481, 900]) {
        const day = classifyMinutes(minutes, kind)
        expect(day.normal + day.extra + day.sunday + day.holiday).toBe(day.total)
        expect(day.total).toBe(minutes)
      }
    }
  })
})

describe('calculateDay', () => {
  it('una jornada sin salida no suma horas y queda marcada como incompleta', () => {
    expect(calculateDay(entry(MON, null), NO_HOLIDAYS)).toMatchObject({ complete: false, total: 0, kind: 'weekday' })
  })

  it('una jornada que cruza la medianoche cuenta entera para el día de la entrada', () => {
    // Viernes 22:00 → sábado 06:00: son 8 h de viernes (normales), no horas de sábado.
    const night: TimeEntryForHours = {
      date: FRI,
      clockIn: new Date(`${FRI}T22:00:00-06:00`),
      clockOut: new Date(`${SAT}T06:00:00-06:00`),
      perDiem: false,
    }
    expect(calculateDay(night, NO_HOLIDAYS)).toMatchObject({ date: FRI, kind: 'weekday', normal: h(8), extra: 0 })

    // Sábado 20:00 → domingo 04:00: todo cuenta como sábado (extra).
    const saturdayNight: TimeEntryForHours = {
      date: SAT,
      clockIn: new Date(`${SAT}T20:00:00-06:00`),
      clockOut: new Date(`${SUN}T04:00:00-06:00`),
      perDiem: false,
    }
    expect(calculateDay(saturdayNight, NO_HOLIDAYS)).toMatchObject({ kind: 'saturday', extra: h(8), sunday: 0 })
  })

  it('el día lo decide la fecha de la jornada, no la zona horaria del servidor', () => {
    // Domingo 23:30 en México ya es lunes en UTC: sigue siendo domingo.
    const late: TimeEntryForHours = {
      date: SUN,
      clockIn: new Date(`${SUN}T21:30:00-06:00`),
      clockOut: new Date(`${SUN}T23:30:00-06:00`),
      perDiem: false,
    }
    expect(calculateDay(late, NO_HOLIDAYS)).toMatchObject({ kind: 'sunday', sunday: h(2) })
  })
})

describe('consolidado semanal', () => {
  it('semana estándar de 5 días de 8 h: 40 h normales', () => {
    const week = calculateWeek([MON, TUE, WED, THU, FRI].map((day) => entry(day, 8)), NO_HOLIDAYS)
    expect(week).toMatchObject({ normal: h(40), extra: 0, sunday: 0, holiday: 0, total: h(40), perDiems: 0 })
  })

  it('las horas normales nunca pasan de 40 a la semana', () => {
    const week = calculateWeek([MON, TUE, WED, THU, FRI, SAT, SUN].map((day) => entry(day, 14)), NO_HOLIDAYS)
    expect(week.normal).toBe(h(40))
    // 6 h extra cada día de lunes a viernes + las 14 del sábado
    expect(week.extra).toBe(h(5 * 6 + 14))
    expect(week.sunday).toBe(h(14))
    expect(week.total).toBe(h(7 * 14))
  })

  it('un día corto no se compensa con otro largo', () => {
    // 4 h el lunes y 12 h el martes: 12 normales y 4 extra, no 16 normales.
    const week = calculateWeek([entry(MON, 4), entry(TUE, 12)], NO_HOLIDAYS)
    expect(week).toMatchObject({ normal: h(12), extra: h(4), total: h(16) })
  })

  it('semana mixta con sábado, domingo, festivo y dietas', () => {
    const week = calculateWeek(
      [
        entry(HOLIDAY_MON, 9, true), // festivo
        entry('2026-11-17', 8.5, true), // martes
        entry('2026-11-18', 7), // miércoles
        entry('2026-11-21', 5), // sábado
        entry('2026-11-22', 6, true), // domingo
        entry('2026-11-20', null), // viernes sin salida
      ],
      HOLIDAYS,
    )
    expect(week).toMatchObject({
      normal: h(15),
      extra: h(5.5),
      sunday: h(6),
      holiday: h(9),
      total: h(35.5),
      perDiems: 3,
    })
    expect(week.days.map((day) => day.date)).toEqual([
      HOLIDAY_MON, '2026-11-17', '2026-11-18', '2026-11-20', '2026-11-21', '2026-11-22',
    ])
    expect(week.days.find((day) => day.date === '2026-11-20')?.complete).toBe(false)
  })

  it('la dieta de un día sin salida también cuenta', () => {
    expect(calculateWeek([entry(MON, null, true)], NO_HOLIDAYS).perDiems).toBe(1)
  })

  it('una semana sin jornadas da todo a cero', () => {
    expect(calculateWeek([], NO_HOLIDAYS)).toEqual({
      normal: 0, extra: 0, sunday: 0, holiday: 0, total: 0, perDiems: 0, days: [],
    })
  })

  it('no modifica las jornadas recibidas', () => {
    const entries = [entry(TUE, 8), entry(MON, 8)]
    calculateWeek(entries, NO_HOLIDAYS)
    expect(entries.map((item) => item.date)).toEqual([TUE, MON])
  })
})

describe('presentación', () => {
  it('convierte minutos a horas con dos decimales', () => {
    expect(minutesToHours(510)).toBe(8.5)
    expect(minutesToHours(525)).toBe(8.75)
    expect(minutesToHours(100)).toBe(1.67)
    expect(minutesToHours(0)).toBe(0)
  })

  it('formatea minutos como h:mm', () => {
    expect(formatMinutes(510)).toBe('8:30')
    expect(formatMinutes(5)).toBe('0:05')
    expect(formatMinutes(2400)).toBe('40:00')
  })
})
