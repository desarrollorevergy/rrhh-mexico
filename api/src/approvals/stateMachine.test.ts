import { describe, expect, it } from 'vitest'
import { getRequestType } from './chains.js'
import {
  approve,
  cancel,
  isApproverInChain,
  pendingSlots,
  reject,
  resubmit,
  slotsFor,
  startApproval,
  type ActorRelation,
} from './stateMachine.js'
import type { ApprovalStep } from './types.js'

const SUPERVISOR: ApprovalStep = { approvers: [{ kind: 'supervisor' }] }
const RRHH: ApprovalStep = { approvers: [{ kind: 'role', role: 'rrhh' }] }
const ADEUDOS: ApprovalStep = {
  approvers: [
    { kind: 'role', role: 'controlling' },
    { kind: 'role', role: 'almacen' },
  ],
}

const actor = (overrides: Partial<ActorRelation> = {}): ActorRelation => ({
  isRequester: false,
  isRequesterSupervisor: false,
  roles: ['colaborador'],
  ...overrides,
})

describe('startApproval', () => {
  it('empieza pendiente en el primer paso', () => {
    expect(startApproval([SUPERVISOR])).toMatchObject({ status: 'pending', currentStep: 0, round: 1 })
  })

  it('rechaza una cadena vacía o con un paso sin aprobadores', () => {
    expect(() => startApproval([])).toThrow('cadena')
    expect(() => startApproval([{ approvers: [] }])).toThrow('cadena')
  })
})

describe('aprobar', () => {
  it('con un solo paso, la solicitud queda aprobada', () => {
    const { state, outcome } = approve(startApproval([SUPERVISOR]), 0)
    expect(outcome).toBe('approved')
    expect(state.status).toBe('approved')
  })

  it('con dos pasos, pasa al siguiente y luego se aprueba', () => {
    const first = approve(startApproval([SUPERVISOR, RRHH]), 0)
    expect(first.outcome).toBe('next_step')
    expect(first.state).toMatchObject({ status: 'pending', currentStep: 1, approvedSlots: [] })

    const second = approve(first.state, 0)
    expect(second.outcome).toBe('approved')
  })

  it('en un paso en paralelo, espera a que aprueben todos', () => {
    const first = approve(startApproval([ADEUDOS, RRHH]), 1)
    expect(first.outcome).toBe('waiting')
    expect(first.state.currentStep).toBe(0)
    expect(pendingSlots(first.state)).toEqual([0])

    const second = approve(first.state, 0)
    expect(second.outcome).toBe('next_step')
    expect(second.state.currentStep).toBe(1)
  })

  it('el mismo aprobador no puede decidir dos veces', () => {
    const { state } = approve(startApproval([ADEUDOS]), 0)
    expect(() => approve(state, 0)).toThrow('decisión pendiente')
  })

  it('no modifica el estado recibido', () => {
    const initial = startApproval([ADEUDOS])
    approve(initial, 0)
    expect(initial.approvedSlots).toEqual([])
  })
})

describe('rechazar', () => {
  it('exige motivo', () => {
    const state = startApproval([SUPERVISOR])
    expect(() => reject(state, 0, undefined)).toThrow('motivo')
    expect(() => reject(state, 0, '   ')).toThrow('motivo')
  })

  it('con motivo, la solicitud queda rechazada', () => {
    expect(reject(startApproval([SUPERVISOR]), 0, 'Falta la salida del martes').status).toBe('rejected')
  })

  it('un rechazo en un paso en paralelo rechaza toda la solicitud', () => {
    const { state } = approve(startApproval([ADEUDOS]), 0)
    expect(reject(state, 1, 'Tiene material pendiente').status).toBe('rejected')
  })
})

describe('solicitud ya resuelta', () => {
  it('no admite más decisiones', () => {
    const approved = approve(startApproval([SUPERVISOR]), 0).state
    const rejected = reject(startApproval([SUPERVISOR]), 0, 'motivo')
    for (const state of [approved, rejected]) {
      expect(() => approve(state, 0)).toThrow('pendiente')
      expect(() => reject(state, 0, 'motivo')).toThrow('pendiente')
      expect(() => cancel(state)).toThrow('pendiente')
      expect(pendingSlots(state)).toEqual([])
    }
  })
})

describe('reenviar', () => {
  it('tras un rechazo, vuelve a empezar desde el primer paso en una vuelta nueva', () => {
    const afterFirstStep = approve(startApproval([SUPERVISOR, RRHH]), 0).state
    const rejected = reject(afterFirstStep, 0, 'motivo')
    expect(resubmit(rejected)).toMatchObject({ status: 'pending', currentStep: 0, round: 2, approvedSlots: [] })
  })

  it('solo se puede reenviar una solicitud rechazada', () => {
    expect(() => resubmit(startApproval([SUPERVISOR]))).toThrow('rechazada')
  })
})

describe('cancelar', () => {
  it('una solicitud pendiente se puede cancelar', () => {
    expect(cancel(startApproval([SUPERVISOR])).status).toBe('cancelled')
  })
})

describe('a quién le toca decidir', () => {
  it('al supervisor del solicitante en el paso de supervisor', () => {
    const state = startApproval([SUPERVISOR, RRHH])
    expect(slotsFor(state, actor({ isRequesterSupervisor: true }))).toEqual([0])
    expect(slotsFor(state, actor({ roles: ['colaborador', 'rrhh'] }))).toEqual([])
    expect(slotsFor(state, actor())).toEqual([])
  })

  it('a quien tiene el rol cuando llega su paso', () => {
    const state = approve(startApproval([SUPERVISOR, RRHH]), 0).state
    expect(slotsFor(state, actor({ roles: ['colaborador', 'rrhh'] }))).toEqual([0])
    expect(slotsFor(state, actor({ isRequesterSupervisor: true }))).toEqual([])
  })

  it('en paralelo, a cada rol solo su parte y solo mientras no haya decidido', () => {
    const state = startApproval([ADEUDOS])
    const almacen = actor({ roles: ['colaborador', 'almacen'] })
    expect(slotsFor(state, almacen)).toEqual([1])
    expect(slotsFor(approve(state, 1).state, almacen)).toEqual([])
  })

  it('nadie decide sobre su propia solicitud aunque tenga el rol', () => {
    const state = startApproval([RRHH])
    expect(slotsFor(state, actor({ isRequester: true, roles: ['colaborador', 'rrhh'] }))).toEqual([])
  })

  it('el administrador decide en cualquier paso, pero no sobre su propia solicitud', () => {
    const admin = actor({ roles: ['colaborador', 'admin'] })
    expect(slotsFor(startApproval([SUPERVISOR]), admin)).toEqual([0])
    expect(slotsFor(startApproval([RRHH]), admin)).toEqual([0])
    expect(isApproverInChain([SUPERVISOR, RRHH], admin)).toBe(true)
    expect(slotsFor(startApproval([SUPERVISOR]), { ...admin, isRequester: true })).toEqual([])
  })

  it('isApproverInChain reconoce a los aprobadores de cualquier paso', () => {
    const steps = [SUPERVISOR, RRHH]
    expect(isApproverInChain(steps, actor({ roles: ['colaborador', 'rrhh'] }))).toBe(true)
    expect(isApproverInChain(steps, actor({ isRequesterSupervisor: true }))).toBe(true)
    expect(isApproverInChain(steps, actor({ roles: ['colaborador', 'it'] }))).toBe(false)
  })
})

describe('tipos de solicitud', () => {
  it('parte de horas: supervisor, con reenvío', () => {
    expect(getRequestType('timesheet_week', false)).toMatchObject({ steps: [SUPERVISOR], allowResubmit: true })
  })

  it('contratación: RRHH y luego Dirección', () => {
    expect(getRequestType('hiring_request', false)?.steps).toEqual([
      RRHH,
      { approvers: [{ kind: 'role', role: 'direccion' }] },
    ])
  })

  it('el tipo de prueba solo existe en local', () => {
    expect(getRequestType('demo', false)).toBeUndefined()
    expect(getRequestType('demo', true)).toBeDefined()
  })

  it('un tipo desconocido no existe', () => {
    expect(getRequestType('constructor', true)).toBeUndefined()
  })
})
