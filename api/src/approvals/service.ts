import sql from 'mssql'
import type { Actor } from '../auth/employee.js'
import type { DbConfig } from '../config/env.js'
import { getPool } from '../db/pool.js'
import { getRequestType } from './chains.js'
import { logNotifier, type ApprovalEvent, type ApprovalNotifier } from './notifications.js'
import {
  approve,
  cancel,
  isApproverInChain,
  reject,
  resubmit,
  slotsFor,
  startApproval,
  type ActorRelation,
} from './stateMachine.js'
import {
  ApprovalError,
  type ApprovalAction,
  type ApprovalState,
  type ApprovalStatus,
  type ApprovalStep,
} from './types.js'

export type { Actor }

export interface ApprovalHistoryEntry {
  action: ApprovalAction
  actorName: string
  round: number
  step: number | null
  reason: string | null
  at: Date
}

export interface ApprovalRequestView {
  id: number
  type: string
  typeLabel: string
  entityId: string | null
  status: ApprovalStatus
  currentStep: number
  round: number
  steps: ApprovalStep[]
  requesterName: string
  createdAt: Date
  updatedAt: Date
  /** Lo que puede hacer quien consulta. */
  canDecide: boolean
  canResubmit: boolean
  canCancel: boolean
  history?: ApprovalHistoryEntry[]
}

export interface ApprovalServiceOptions {
  db: DbConfig
  /** Admite el tipo de solicitud de prueba. Solo en local. */
  includeDemo: boolean
  notifier?: ApprovalNotifier
}

interface RequestRow {
  id: number
  request_type: string
  entity_id: string | null
  requester_id: number
  requester_name: string
  requester_supervisor_id: number | null
  status: ApprovalStatus
  current_step: number
  round: number
  steps: string
  created_at: Date
  updated_at: Date
}

const REQUEST_COLUMNS = `
  r.id, r.request_type, r.entity_id, r.requester_id, r.status, r.current_step, r.round, r.steps,
  r.created_at, r.updated_at, e.full_name AS requester_name, e.supervisor_id AS requester_supervisor_id`

type Queryable = sql.ConnectionPool | sql.Transaction

function request(target: Queryable): sql.Request {
  return target instanceof sql.Transaction ? new sql.Request(target) : target.request()
}

export function createApprovalService(options: ApprovalServiceOptions) {
  const { db, includeDemo } = options
  const notifier = options.notifier ?? logNotifier

  async function notify(event: ApprovalEvent): Promise<void> {
    try {
      await notifier(event)
    } catch {
      // Un fallo al avisar no debe deshacer una decisión ya guardada.
      console.error(`[aprobaciones] no se pudo notificar la solicitud ${event.requestId}`)
    }
  }

  function relationOf(row: RequestRow, actor: Actor): ActorRelation {
    return {
      isRequester: row.requester_id === actor.employeeId,
      isRequesterSupervisor: row.requester_supervisor_id === actor.employeeId,
      roles: actor.roles,
    }
  }

  function toState(row: RequestRow, approvedSlots: number[]): ApprovalState {
    return {
      status: row.status,
      currentStep: row.current_step,
      round: row.round,
      steps: JSON.parse(row.steps) as ApprovalStep[],
      approvedSlots,
    }
  }

  function toView(row: RequestRow, state: ApprovalState, actor: Actor): ApprovalRequestView {
    const relation = relationOf(row, actor)
    const def = getRequestType(row.request_type, includeDemo)
    return {
      id: row.id,
      type: row.request_type,
      typeLabel: def?.label ?? row.request_type,
      entityId: row.entity_id,
      status: state.status,
      currentStep: state.currentStep,
      round: state.round,
      steps: state.steps,
      requesterName: row.requester_name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      canDecide: slotsFor(state, relation).length > 0,
      canResubmit: relation.isRequester && state.status === 'rejected' && (def?.allowResubmit ?? false),
      canCancel: relation.isRequester && state.status === 'pending' && (def?.allowCancel ?? false),
    }
  }

  async function loadRow(target: Queryable, id: number, lock: boolean): Promise<RequestRow | undefined> {
    const result = await request(target)
      .input('id', sql.Int, id)
      .query<RequestRow>(`
        SELECT ${REQUEST_COLUMNS}
        FROM approval_requests AS r ${lock ? 'WITH (UPDLOCK, ROWLOCK)' : ''}
        JOIN employees AS e ON e.id = r.requester_id
        WHERE r.id = @id`)
    return result.recordset[0]
  }

  async function loadApprovedSlots(target: Queryable, row: RequestRow): Promise<number[]> {
    const result = await request(target)
      .input('id', sql.Int, row.id)
      .input('round', sql.Int, row.round)
      .input('step', sql.Int, row.current_step)
      .query<{ slot: number }>(`
        SELECT slot FROM approval_actions
        WHERE request_id = @id AND round = @round AND step = @step AND action = 'approved'`)
    return result.recordset.map((item) => item.slot)
  }

  async function saveState(tx: sql.Transaction, id: number, state: ApprovalState): Promise<void> {
    await new sql.Request(tx)
      .input('id', sql.Int, id)
      .input('status', sql.NVarChar(20), state.status)
      .input('step', sql.Int, state.currentStep)
      .input('round', sql.Int, state.round)
      .query(`
        UPDATE approval_requests
        SET status = @status, current_step = @step, round = @round, updated_at = SYSUTCDATETIME()
        WHERE id = @id`)
  }

  async function addAction(
    tx: sql.Transaction,
    entry: {
      requestId: number
      round: number
      step: number | null
      slot: number | null
      actorId: number
      action: ApprovalAction
      reason: string | null
    },
  ): Promise<void> {
    await new sql.Request(tx)
      .input('requestId', sql.Int, entry.requestId)
      .input('round', sql.Int, entry.round)
      .input('step', sql.Int, entry.step)
      .input('slot', sql.Int, entry.slot)
      .input('actorId', sql.Int, entry.actorId)
      .input('action', sql.NVarChar(20), entry.action)
      .input('reason', sql.NVarChar(1000), entry.reason)
      .query(`
        INSERT INTO approval_actions (request_id, round, step, slot, actor_id, action, reason)
        VALUES (@requestId, @round, @step, @slot, @actorId, @action, @reason)`)
  }

  /** Ejecuta `work` en una transacción: o se guarda todo (estado e historial) o nada. */
  async function inTransaction<T>(work: (tx: sql.Transaction) => Promise<T>): Promise<T> {
    const pool = await getPool(db)
    const tx = new sql.Transaction(pool)
    await tx.begin()
    try {
      const result = await work(tx)
      await tx.commit()
      return result
    } catch (error) {
      await tx.rollback()
      throw error
    }
  }

  /**
   * Cambia una solicitud existente. La fila se bloquea mientras dura la transacción,
   * así dos decisiones simultáneas no se pisan.
   */
  async function change(
    id: number,
    actor: Actor,
    apply: (context: { row: RequestRow; state: ApprovalState; relation: ActorRelation; tx: sql.Transaction }) => Promise<{
      state: ApprovalState
      /** Qué avisar. null = nada nuevo que avisar. */
      event: ApprovalEvent['kind'] | null
    }>,
  ): Promise<ApprovalRequestView> {
    const { row, state, event } = await inTransaction(async (tx) => {
      const current = await loadRow(tx, id, true)
      if (!current) throw new ApprovalError('not_found')
      const before = toState(current, await loadApprovedSlots(tx, current))
      const after = await apply({ row: current, state: before, relation: relationOf(current, actor), tx })
      await saveState(tx, id, after.state)
      return { row: current, state: after.state, event: after.event }
    })

    if (event) {
      await notify({
        kind: event,
        requestId: id,
        requestType: row.request_type,
        status: state.status,
        currentStep: state.currentStep,
      })
    }
    return toView(row, state, actor)
  }

  return {
    /** Crea una solicitud. La llama el módulo dueño del registro (parte de horas, contratación...). */
    async create(input: { type: string; entityId?: string; requesterId: number }): Promise<number> {
      const def = getRequestType(input.type, includeDemo)
      if (!def) throw new ApprovalError('unknown_type')
      const state = startApproval(def.steps)

      const id = await inTransaction(async (tx) => {
        const inserted = await new sql.Request(tx)
          .input('type', sql.NVarChar(50), input.type)
          .input('entityId', sql.NVarChar(50), input.entityId ?? null)
          .input('requesterId', sql.Int, input.requesterId)
          .input('status', sql.NVarChar(20), state.status)
          .input('steps', sql.NVarChar(sql.MAX), JSON.stringify(state.steps))
          .query<{ id: number }>(`
            INSERT INTO approval_requests (request_type, entity_id, requester_id, status, steps)
            OUTPUT INSERTED.id
            VALUES (@type, @entityId, @requesterId, @status, @steps)`)
        const newId = inserted.recordset[0]?.id
        if (newId === undefined) throw new Error('No se pudo crear la solicitud')
        await addAction(tx, {
          requestId: newId,
          round: state.round,
          step: null,
          slot: null,
          actorId: input.requesterId,
          action: 'submitted',
          reason: null,
        })
        return newId
      })

      await notify({ kind: 'submitted', requestId: id, requestType: input.type, status: 'pending', currentStep: 0 })
      return id
    },

    /** Última solicitud de un registro de un módulo (por ejemplo, la semana de un colaborador). */
    async findLatest(type: string, entityId: string): Promise<{ id: number; status: ApprovalStatus } | undefined> {
      const pool = await getPool(db)
      const result = await pool
        .request()
        .input('type', sql.NVarChar(50), type)
        .input('entityId', sql.NVarChar(50), entityId)
        .query<{ id: number; status: ApprovalStatus }>(`
          SELECT TOP 1 id, status FROM approval_requests
          WHERE request_type = @type AND entity_id = @entityId
          ORDER BY id DESC`)
      return result.recordset[0]
    },

    /** Aprueba o rechaza. Solo puede hacerlo quien tiene una decisión pendiente en el paso actual. */
    decide(id: number, actor: Actor, decision: 'approve' | 'reject', reason?: string): Promise<ApprovalRequestView> {
      return change(id, actor, async ({ state, relation, tx }) => {
        if (state.status !== 'pending') throw new ApprovalError('not_pending')
        const slot = slotsFor(state, relation)[0]
        if (slot === undefined) throw new ApprovalError('not_allowed')

        const entry = { requestId: id, round: state.round, step: state.currentStep, slot, actorId: actor.employeeId }
        if (decision === 'reject') {
          const next = reject(state, slot, reason)
          await addAction(tx, { ...entry, action: 'rejected', reason: reason?.trim() ?? null })
          return { state: next, event: 'rejected' }
        }

        const { state: next, outcome } = approve(state, slot)
        await addAction(tx, { ...entry, action: 'approved', reason: reason?.trim() || null })
        // Mientras falten aprobadores del mismo paso no hay a quién avisar de nuevo.
        const event = outcome === 'approved' ? 'approved' : outcome === 'next_step' ? 'step_pending' : null
        return { state: next, event }
      })
    },

    /** El solicitante corrige y reenvía una solicitud rechazada (si su tipo lo permite). */
    resubmit(id: number, actor: Actor): Promise<ApprovalRequestView> {
      return change(id, actor, async ({ row, state, relation, tx }) => {
        const def = getRequestType(row.request_type, includeDemo)
        if (!relation.isRequester || !def?.allowResubmit) throw new ApprovalError('not_allowed')
        const next = resubmit(state)
        await addAction(tx, {
          requestId: id,
          round: next.round,
          step: null,
          slot: null,
          actorId: actor.employeeId,
          action: 'resubmitted',
          reason: null,
        })
        return { state: next, event: 'resubmitted' }
      })
    },

    /** El solicitante cancela una solicitud pendiente (si su tipo lo permite). */
    cancel(id: number, actor: Actor): Promise<ApprovalRequestView> {
      return change(id, actor, async ({ row, state, relation, tx }) => {
        const def = getRequestType(row.request_type, includeDemo)
        if (!relation.isRequester || !def?.allowCancel) throw new ApprovalError('not_allowed')
        const next = cancel(state)
        await addAction(tx, {
          requestId: id,
          round: state.round,
          step: null,
          slot: null,
          actorId: actor.employeeId,
          action: 'cancelled',
          reason: null,
        })
        return { state: next, event: 'cancelled' }
      })
    },

    /** Detalle con historial. Solo para el solicitante y para los aprobadores de su cadena. */
    async get(id: number, actor: Actor): Promise<ApprovalRequestView> {
      const pool = await getPool(db)
      const row = await loadRow(pool, id, false)
      if (!row) throw new ApprovalError('not_found')

      const state = toState(row, await loadApprovedSlots(pool, row))
      const relation = relationOf(row, actor)
      // A quien no le corresponde verla se le responde igual que si no existiera.
      if (!relation.isRequester && !isApproverInChain(state.steps, relation)) throw new ApprovalError('not_found')

      const history = await pool
        .request()
        .input('id', sql.Int, id)
        .query<{ action: ApprovalAction; actor_name: string; round: number; step: number | null; reason: string | null; created_at: Date }>(`
          SELECT a.action, e.full_name AS actor_name, a.round, a.step, a.reason, a.created_at
          FROM approval_actions AS a
          JOIN employees AS e ON e.id = a.actor_id
          WHERE a.request_id = @id
          ORDER BY a.id`)

      return {
        ...toView(row, state, actor),
        history: history.recordset.map((item) => ({
          action: item.action,
          actorName: item.actor_name,
          round: item.round,
          step: item.step,
          reason: item.reason,
          at: item.created_at,
        })),
      }
    },

    /** Solicitudes pendientes en las que a esta persona le toca decidir ahora. */
    async listPending(actor: Actor): Promise<ApprovalRequestView[]> {
      const pool = await getPool(db)
      const rows = await pool.request().query<RequestRow>(`
        SELECT ${REQUEST_COLUMNS}
        FROM approval_requests AS r
        JOIN employees AS e ON e.id = r.requester_id
        WHERE r.status = 'pending'
        ORDER BY r.created_at`)
      const approved = await pool.request().query<{ request_id: number; slot: number }>(`
        SELECT a.request_id, a.slot
        FROM approval_actions AS a
        JOIN approval_requests AS r ON r.id = a.request_id
        WHERE r.status = 'pending' AND a.round = r.round AND a.step = r.current_step AND a.action = 'approved'`)

      return rows.recordset
        .map((row) => {
          const slots = approved.recordset.filter((item) => item.request_id === row.id).map((item) => item.slot)
          return toView(row, toState(row, slots), actor)
        })
        .filter((view) => view.canDecide)
    },

    /** Solicitudes creadas por esta persona, de la más reciente a la más antigua. */
    async listMine(actor: Actor): Promise<ApprovalRequestView[]> {
      const pool = await getPool(db)
      const rows = await pool
        .request()
        .input('requesterId', sql.Int, actor.employeeId)
        .query<RequestRow>(`
          SELECT ${REQUEST_COLUMNS}
          FROM approval_requests AS r
          JOIN employees AS e ON e.id = r.requester_id
          WHERE r.requester_id = @requesterId
          ORDER BY r.created_at DESC, r.id DESC`)
      // Para el solicitante no hace falta saber qué aprobadores ya decidieron.
      return rows.recordset.map((row) => toView(row, toState(row, []), actor))
    },
  }
}

export type ApprovalService = ReturnType<typeof createApprovalService>
