import { describe, expect, it } from 'vitest'
import {
  anniversary,
  checkVacationRequest,
  entitlementDays,
  isWorkingDay,
  serviceYearOf,
  vacationBalance,
  workingDays,
  type BalanceInput,
} from './balance.js'

const NO_HOLIDAYS = new Set<string>()

describe('entitlementDays (tabla LFT 2023+)', () => {
  it.each([
    [1, 12],
    [2, 14],
    [3, 16],
    [4, 18],
    [5, 20],
    [6, 22],
    [10, 22],
    [11, 24],
    [15, 24],
    [16, 26],
    [20, 26],
    [21, 28],
    [25, 28],
    [26, 30],
    [30, 30],
    [31, 32],
  ])('año de servicio %i: %i días', (year, days) => {
    expect(entitlementDays(year)).toBe(days)
  })

  it('no da días a un año que no existe', () => {
    expect(entitlementDays(0)).toBe(0)
    expect(entitlementDays(1.5)).toBe(0)
  })
})

describe('serviceYearOf (año por aniversario)', () => {
  it('el año 1 va del ingreso a la víspera del primer aniversario', () => {
    expect(serviceYearOf('2026-03-10', '2026-03-10')).toEqual({ number: 1, start: '2026-03-10', end: '2027-03-09' })
    expect(serviceYearOf('2026-03-10', '2027-03-09')?.number).toBe(1)
  })

  it('el día del aniversario empieza el año siguiente', () => {
    expect(serviceYearOf('2026-03-10', '2027-03-10')).toEqual({ number: 2, start: '2027-03-10', end: '2028-03-09' })
    expect(serviceYearOf('2019-03-04', '2026-11-16')).toEqual({ number: 8, start: '2026-03-04', end: '2027-03-03' })
  })

  it('no hay año de servicio antes del ingreso', () => {
    expect(serviceYearOf('2026-03-10', '2026-03-09')).toBeNull()
  })

  it('quien ingresó un 29 de febrero cumple el 28 en años no bisiestos', () => {
    expect(anniversary('2024-02-29', 1)).toBe('2025-02-28')
    expect(anniversary('2024-02-29', 4)).toBe('2028-02-29')
    expect(serviceYearOf('2024-02-29', '2025-02-27')?.number).toBe(1)
    expect(serviceYearOf('2024-02-29', '2025-02-28')).toEqual({ number: 2, start: '2025-02-28', end: '2026-02-27' })
  })
})

describe('días laborables', () => {
  // 2026-11-16 es lunes.
  it('cuenta de lunes a sábado y deja fuera el domingo', () => {
    expect(workingDays('2026-11-16', '2026-11-22', NO_HOLIDAYS)).toEqual([
      '2026-11-16',
      '2026-11-17',
      '2026-11-18',
      '2026-11-19',
      '2026-11-20',
      '2026-11-21',
    ])
    expect(isWorkingDay('2026-11-21', NO_HOLIDAYS)).toBe(true)
    expect(isWorkingDay('2026-11-22', NO_HOLIDAYS)).toBe(false)
  })

  it('deja fuera los festivos', () => {
    const holidays = new Set(['2026-11-16'])
    expect(workingDays('2026-11-14', '2026-11-17', holidays)).toEqual(['2026-11-14', '2026-11-17'])
  })

  it('un rango al revés no tiene días', () => {
    expect(workingDays('2026-11-17', '2026-11-16', NO_HOLIDAYS)).toEqual([])
  })
})

describe('vacationBalance', () => {
  const base: BalanceInput = { hireDate: '2026-03-10', usedDays: [], reservedDays: [], adjustments: [] }

  it('el primer año tiene los 12 días desde el primer día', () => {
    expect(vacationBalance(base, '2026-03-10')).toMatchObject({ number: 1, entitlement: 12, available: 12 })
  })

  it('descuenta los días aprobados y reserva los pendientes', () => {
    const balance = vacationBalance(
      { ...base, usedDays: ['2026-06-01', '2026-06-02'], reservedDays: ['2026-08-03'] },
      '2026-09-01',
    )
    expect(balance).toMatchObject({ used: 2, reserved: 1, available: 9 })
  })

  it('los días no usados caducan: el año siguiente empieza con lo que da la tabla', () => {
    const input = { ...base, usedDays: ['2026-06-01'] }
    expect(vacationBalance(input, '2027-03-09')).toMatchObject({ number: 1, available: 11 })
    expect(vacationBalance(input, '2027-03-10')).toMatchObject({ number: 2, entitlement: 14, used: 0, available: 14 })
  })

  it('aplica los ajustes de RRHH solo a su año de servicio', () => {
    const input = {
      ...base,
      adjustments: [
        { serviceYear: 1, days: 3 },
        { serviceYear: 1, days: -1 },
        { serviceYear: 2, days: 5 },
      ],
    }
    expect(vacationBalance(input, '2026-05-01')).toMatchObject({ adjustment: 2, available: 14 })
  })

  it('no hay saldo antes del ingreso', () => {
    expect(vacationBalance(base, '2026-01-01')).toBeNull()
  })
})

describe('checkVacationRequest', () => {
  const base: BalanceInput = { hireDate: '2026-03-10', usedDays: [], reservedDays: [], adjustments: [] }

  it('acepta si el saldo alcanza', () => {
    const days = workingDays('2026-11-16', '2026-11-21', NO_HOLIDAYS)
    const check = checkVacationRequest(base, days)
    expect(check.ok).toBe(true)
    expect(check.years).toHaveLength(1)
    expect(check.years[0]).toMatchObject({ requested: 6, shortage: 0 })
  })

  it('rechaza si no alcanza, contando lo reservado', () => {
    const reservedDays = workingDays('2026-10-05', '2026-10-14', NO_HOLIDAYS) // 9 días
    const days = workingDays('2026-11-16', '2026-11-19', NO_HOLIDAYS) // 4 días; quedan 3
    const check = checkVacationRequest({ ...base, reservedDays }, days)
    expect(check).toMatchObject({ ok: false, reason: 'insufficient' })
    expect(check.years[0]).toMatchObject({ requested: 4, shortage: 1 })
  })

  it('una solicitud que cruza el aniversario se carga a los dos años', () => {
    // Aniversario el miércoles 2027-03-10: lunes y martes del año 1, miércoles a sábado del año 2.
    const days = workingDays('2027-03-08', '2027-03-13', NO_HOLIDAYS)
    const check = checkVacationRequest(base, days)
    expect(check.ok).toBe(true)
    expect(check.years.map((year) => [year.balance.number, year.requested])).toEqual([
      [1, 2],
      [2, 4],
    ])
  })

  it('rechaza días anteriores al ingreso, repetidos o un rango sin días laborables', () => {
    expect(checkVacationRequest(base, ['2026-03-09'])).toMatchObject({ ok: false, reason: 'before_hire' })
    expect(checkVacationRequest({ ...base, usedDays: ['2026-06-01'] }, ['2026-06-01'])).toMatchObject({
      ok: false,
      reason: 'overlap',
    })
    expect(checkVacationRequest(base, [])).toMatchObject({ ok: false, reason: 'no_days' })
  })
})
