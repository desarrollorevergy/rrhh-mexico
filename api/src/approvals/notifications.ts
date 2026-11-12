import type { ApprovalStatus } from './types.js'

/** Lo que ha pasado con una solicitud. Sin datos personales: solo identificadores. */
export interface ApprovalEvent {
  kind: 'submitted' | 'step_pending' | 'approved' | 'rejected' | 'resubmitted' | 'cancelled'
  requestId: number
  requestType: string
  status: ApprovalStatus
  /** Paso en el que queda la solicitud. */
  currentStep: number
}

/**
 * Punto de enganche para avisar a quien corresponda (aprobadores, solicitante).
 * El envío de correo real por Microsoft Graph se conectará aquí más adelante.
 */
export type ApprovalNotifier = (event: ApprovalEvent) => void | Promise<void>

/** Por ahora solo deja constancia en el registro, sin nombres ni correos. */
export const logNotifier: ApprovalNotifier = (event) => {
  console.log(
    `[aprobaciones] solicitud ${event.requestId} (${event.requestType}): ${event.kind}, paso ${event.currentStep}`,
  )
}
