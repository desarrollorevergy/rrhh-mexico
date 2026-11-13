import type { GroupRole } from '../config/env.js'

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'

/** Qué queda registrado en el historial. */
export type ApprovalAction = 'submitted' | 'approved' | 'rejected' | 'resubmitted' | 'cancelled'

/** Quién debe decidir: el supervisor del solicitante o alguien con un rol. */
export type ApproverSpec = { kind: 'supervisor' } | { kind: 'role'; role: GroupRole }

/**
 * Un paso de la cadena. Normalmente tiene un solo aprobador; si tiene varios,
 * deciden en paralelo y TODOS deben aprobar para pasar al siguiente paso.
 */
export interface ApprovalStep {
  approvers: ApproverSpec[]
}

/** Estado de una solicitud. Las reglas de stateMachine.ts trabajan solo con esto. */
export interface ApprovalState {
  status: ApprovalStatus
  /** Índice del paso actual dentro de `steps`. */
  currentStep: number
  /** Vuelta: empieza en 1 y sube cada vez que el solicitante reenvía tras un rechazo. */
  round: number
  steps: ApprovalStep[]
  /** Aprobadores del paso actual que ya aprobaron en esta vuelta (posición en `approvers`). */
  approvedSlots: number[]
}

export type ApprovalErrorCode =
  | 'not_found'
  | 'not_allowed'
  | 'not_pending'
  | 'not_rejected'
  | 'reason_required'
  | 'invalid_chain'
  | 'invalid_slot'
  | 'unknown_type'

const MESSAGES: Record<ApprovalErrorCode, string> = {
  not_found: 'Solicitud no encontrada',
  not_allowed: 'No te corresponde esta acción',
  not_pending: 'La solicitud ya no está pendiente',
  not_rejected: 'Solo se puede reenviar una solicitud rechazada',
  reason_required: 'El motivo del rechazo es obligatorio',
  invalid_chain: 'La cadena de aprobación no es válida',
  invalid_slot: 'Ese aprobador no tiene una decisión pendiente',
  unknown_type: 'Tipo de solicitud desconocido',
}

export class ApprovalError extends Error {
  code: ApprovalErrorCode

  constructor(code: ApprovalErrorCode) {
    super(MESSAGES[code])
    this.name = 'ApprovalError'
    this.code = code
  }
}
