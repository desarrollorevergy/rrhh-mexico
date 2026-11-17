import type { GroupRole } from '../config/env.js'
import type { ApprovalStep, ApproverSpec } from './types.js'

/** Definición de un tipo de solicitud: su cadena de aprobadores y qué puede hacer el solicitante. */
export interface RequestTypeDef {
  label: string
  steps: ApprovalStep[]
  /** Tras un rechazo, ¿el solicitante puede corregir y reenviar? Si no, el rechazo es definitivo. */
  allowResubmit: boolean
  /** ¿El solicitante puede cancelar mientras está pendiente? */
  allowCancel: boolean
}

const supervisor: ApproverSpec = { kind: 'supervisor' }
const role = (name: GroupRole): ApproverSpec => ({ kind: 'role', role: name })
const step = (...approvers: ApproverSpec[]): ApprovalStep => ({ approvers })

// Cada módulo registra aquí su tipo cuando se construye. Solo están los ya confirmados
// por el documento funcional y la Power App.
const REQUEST_TYPES: Record<string, RequestTypeDef> = {
  // Módulo 01: el supervisor valida la semana; si rechaza, vuelve al colaborador para corregir.
  timesheet_week: {
    label: 'Parte de horas semanal',
    steps: [step(supervisor)],
    allowResubmit: true,
    allowCancel: false,
  },
  // Módulo 02: visto bueno de RRHH y autorización final de Dirección. El rechazo es definitivo.
  hiring_request: {
    label: 'Solicitud de contratación',
    steps: [step(role('rrhh')), step(role('direccion'))],
    allowResubmit: false,
    allowCancel: false,
  },
  // Módulo 08: supervisor y después RRHH, también la incapacidad. El rechazo es definitivo y el
  // colaborador puede cancelar mientras está pendiente. Quien no tiene supervisor va directo a
  // RRHH: el módulo crea la solicitud solo con el segundo paso (ver ABSENCE_STEPS_NO_SUPERVISOR).
  absence_request: {
    label: 'Solicitud de ausencia',
    steps: [step(supervisor), step(role('rrhh'))],
    allowResubmit: false,
    allowCancel: true,
  },
}

export const ABSENCE_TYPE = 'absence_request'
/** Cadena de una ausencia de quien no tiene supervisor: directa a RRHH. */
export const ABSENCE_STEPS_NO_SUPERVISOR: ApprovalStep[] = [step(role('rrhh'))]

/** Tipo de PRUEBA, solo en local: recorre un paso simple, uno en paralelo y otro final. */
export const DEMO_TYPE = 'demo'
const DEMO_DEF: RequestTypeDef = {
  label: 'Solicitud de prueba',
  steps: [step(supervisor), step(role('controlling'), role('almacen')), step(role('rrhh'))],
  allowResubmit: true,
  allowCancel: true,
}

export function getRequestType(type: string, includeDemo: boolean): RequestTypeDef | undefined {
  if (type === DEMO_TYPE) return includeDemo ? DEMO_DEF : undefined
  return Object.hasOwn(REQUEST_TYPES, type) ? REQUEST_TYPES[type] : undefined
}
