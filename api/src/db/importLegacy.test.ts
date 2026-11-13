import { describe, expect, it } from 'vitest'
import { parseCsv, parseInstant, planImport } from './importLegacy.js'

describe('parseCsv', () => {
  it('lee cabecera y filas, con comillas, comas y saltos de línea dentro de una celda', () => {
    const rows = parseCsv('﻿id,nombre,nota\r\n1,"PÉREZ, ANA","dijo ""hola""\ny se fue"\r\n2,LUIS,\r\n')
    expect(rows).toEqual([
      { id: '1', nombre: 'PÉREZ, ANA', nota: 'dijo "hola"\ny se fue' },
      { id: '2', nombre: 'LUIS', nota: '' },
    ])
  })
})

describe('parseInstant', () => {
  it('entiende el formato de Supabase y devuelve null si está vacío', () => {
    expect(parseInstant('2026-10-12 14:32:54.186+00')?.toISOString()).toBe('2026-10-12T14:32:54.186Z')
    expect(parseInstant('2026-11-04 22:03:50.606828+00')?.toISOString()).toBe('2026-11-04T22:03:50.606Z')
    expect(parseInstant('')).toBeNull()
    expect(() => parseInstant('ayer')).toThrow('no reconocida')
  })
})

describe('planImport', () => {
  const users = [
    { id: 'aaaaaaaa-1111-2222-3333-444444444444', nombre: 'ANA PÉREZ', puesto_trabajo: 'Técnico', rfc: 'XXXX000000XX0', email_personal: 'ana@personal.test', email_empresa: 'Ana@Example.test ', departamento: 'PV O&M' },
    { id: 'bbbbbbbb-1111-2222-3333-444444444444', nombre: 'LUIS SIN CORREO', puesto_trabajo: 'Técnico', rfc: 'YYYY000000YY0', email_personal: 'luis@personal.test', email_empresa: '', departamento: 'STR' },
  ]
  const record = (overrides: Record<string, string> = {}) => ({
    id: 'r1',
    titulo: 'ana@example.test',
    tipo_jornada: 'Ordinaria',
    analitica: 'MX0011000',
    dieta: 'true',
    hora_entrada: '2026-10-12 14:00:00+00',
    hora_salida: '2026-10-12 23:00:00+00',
    fecha: '2026-10-12',
    comentario: '',
    estado_validacion: 'pending',
    motivo_rechazo: '',
    validado_por: '',
    validado_at: '',
    horas_corregidas: 'false',
    correccion_enviada_at: '',
    nota_correccion: '',
    created_at: '2026-10-12 14:00:01+00',
    ...overrides,
  })

  it('solo importa a quien tiene correo de empresa, sin RFC ni correo personal', () => {
    const plan = planImport(users, [])
    expect(plan.usersWithoutEmail).toBe(1)
    expect(plan.employees).toEqual([
      { number: 'MIG-aaaaaaaa', name: 'ANA PÉREZ', email: 'ana@example.test', jobTitle: 'Técnico', department: 'PV O&M' },
    ])
    expect(JSON.stringify(plan)).not.toMatch(/XXXX000000XX0|personal\.test/)
  })

  it('convierte un registro y conserva el rechazo', () => {
    const plan = planImport(users, [
      record({ estado_validacion: 'rejected', motivo_rechazo: ' Falta la salida ', validado_por: 'JEFA@example.test', validado_at: '2026-10-30 16:15:34.295+00', horas_corregidas: 'true', hora_salida: '' }),
    ])
    expect(plan.entries).toHaveLength(1)
    expect(plan.entries[0]).toMatchObject({
      email: 'ana@example.test',
      workDate: '2026-10-12',
      projectCode: 'MX0011000',
      perDiem: true,
      comment: null,
      clockOut: null,
      status: 'rejected',
      rejectReason: 'Falta la salida',
      reviewedByEmail: 'jefa@example.test',
      hoursEdited: true,
    })
    expect(plan.entries[0]!.clockIn.toISOString()).toBe('2026-10-12T14:00:00.000Z')
  })

  it('deja fuera los registros de cuentas que no se importan', () => {
    const plan = planImport(users, [
      record(),
      record({ id: 'r2', titulo: 'pruebas@otro.test' }),
      record({ id: 'r3', titulo: 'pruebas@otro.test', fecha: '2026-10-13' }),
      record({ id: 'r4', titulo: 'luis@personal.test' }),
    ])
    expect(plan.entries).toHaveLength(1)
    expect(plan.entriesOfUnknownPeople).toBe(3)
    expect(plan.unknownPeople).toBe(2)
  })

  it('un estado desconocido entra como pendiente', () => {
    expect(planImport(users, [record({ estado_validacion: 'raro' })]).entries[0]!.status).toBe('pending')
  })
})
