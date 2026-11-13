import type { Role } from '../auth/types.js'
import { ApprovalError, type ApprovalState, type ApprovalStep } from './types.js'

// Reglas del motor de aprobaciones. Funciones puras: no tocan la base de datos ni Express.
// Ninguna modifica el estado que recibe; devuelven uno nuevo.

/** Estado inicial de una solicitud recién enviada. */
export function startApproval(steps: ApprovalStep[]): ApprovalState {
  if (steps.length === 0 || steps.some((step) => step.approvers.length === 0)) {
    throw new ApprovalError('invalid_chain')
  }
  return { status: 'pending', currentStep: 0, round: 1, steps, approvedSlots: [] }
}

/** Aprobadores del paso actual que todavía no han decidido. */
export function pendingSlots(state: ApprovalState): number[] {
  if (state.status !== 'pending') return []
  const step = state.steps[state.currentStep]
  if (!step) return []
  return step.approvers.map((_, slot) => slot).filter((slot) => !state.approvedSlots.includes(slot))
}

function assertPendingSlot(state: ApprovalState, slot: number): void {
  if (state.status !== 'pending') throw new ApprovalError('not_pending')
  if (!pendingSlots(state).includes(slot)) throw new ApprovalError('invalid_slot')
}

export type ApproveOutcome =
  /** Faltan otros aprobadores del mismo paso. */
  | 'waiting'
  /** El paso se completó y la solicitud pasa al siguiente. */
  | 'next_step'
  /** Era el último paso: solicitud aprobada. */
  | 'approved'

export function approve(state: ApprovalState, slot: number): { state: ApprovalState; outcome: ApproveOutcome } {
  assertPendingSlot(state, slot)

  const approvedSlots = [...state.approvedSlots, slot]
  const step = state.steps[state.currentStep]
  if (step && approvedSlots.length < step.approvers.length) {
    return { state: { ...state, approvedSlots }, outcome: 'waiting' }
  }

  if (state.currentStep + 1 < state.steps.length) {
    return {
      state: { ...state, currentStep: state.currentStep + 1, approvedSlots: [] },
      outcome: 'next_step',
    }
  }
  return { state: { ...state, status: 'approved', approvedSlots }, outcome: 'approved' }
}

/** Rechazar exige motivo. Basta un rechazo para rechazar la solicitud entera. */
export function reject(state: ApprovalState, slot: number, reason: string | undefined): ApprovalState {
  assertPendingSlot(state, slot)
  if (!reason?.trim()) throw new ApprovalError('reason_required')
  return { ...state, status: 'rejected' }
}

/** El solicitante corrige y reenvía: la cadena empieza de nuevo desde el primer paso. */
export function resubmit(state: ApprovalState): ApprovalState {
  if (state.status !== 'rejected') throw new ApprovalError('not_rejected')
  return { ...state, status: 'pending', currentStep: 0, round: state.round + 1, approvedSlots: [] }
}

export function cancel(state: ApprovalState): ApprovalState {
  if (state.status !== 'pending') throw new ApprovalError('not_pending')
  return { ...state, status: 'cancelled' }
}

/** Relación de quien actúa con la solicitud. */
export interface ActorRelation {
  isRequester: boolean
  isRequesterSupervisor: boolean
  roles: Role[]
}

/** ¿Encaja esta persona con alguno de los aprobadores de la cadena (en cualquier paso)? */
export function isApproverInChain(steps: ApprovalStep[], actor: ActorRelation): boolean {
  return steps.some((step) => step.approvers.some((spec) => matches(spec, actor)))
}

function matches(spec: ApprovalStep['approvers'][number], actor: ActorRelation): boolean {
  return spec.kind === 'supervisor' ? actor.isRequesterSupervisor : actor.roles.includes(spec.role)
}

/**
 * Decisiones pendientes que le corresponden a esta persona en el paso actual.
 * Nadie decide sobre su propia solicitud, aunque tenga el rol aprobador.
 */
export function slotsFor(state: ApprovalState, actor: ActorRelation): number[] {
  if (actor.isRequester) return []
  const step = state.steps[state.currentStep]
  if (!step) return []
  return pendingSlots(state).filter((slot) => {
    const spec = step.approvers[slot]
    return spec !== undefined && matches(spec, actor)
  })
}
