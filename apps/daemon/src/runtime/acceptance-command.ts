import { acceptanceSummary } from '@baton/core'
import type { AcceptanceUpdateInput, AppError } from '@baton/protocol'
import {
  getAcceptanceBundle,
  replaceAcceptanceItems,
  type ReplaceAcceptanceItemsResult,
} from '../db/acceptance-repository.js'
import { getTask, insertAudit } from '../db/repositories.js'
import type { Db } from '../db/types.js'
import type { EventStore } from '../db/event-store.js'
import { appError } from '../errors.js'
import { buildWsFrame } from '../ws/hub.js'

export interface AcceptanceCommandDeps {
  db: Db
  eventStore: EventStore
  now: () => number
  newId: () => string
  broadcastRaw?: (frame: string) => void
}

export type AcceptanceUpdateResult =
  | { ok: true; ack: { taskId: string; contractId: string; revision: number } }
  | { ok: false; error: AppError }

class AcceptanceCommandError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly index?: number,
  ) {
    super(message)
  }
}

export function handleAcceptanceUpdate(
  deps: AcceptanceCommandDeps,
  input: AcceptanceUpdateInput,
): AcceptanceUpdateResult {
  const task = getTask(deps.db, input.taskId)
  if (!task) {
    return { ok: false, error: appError('task_not_found', 'task not found', { taskId: input.taskId }) }
  }
  if (task.status !== 'review') {
    return {
      ok: false,
      error: appError('invalid_state', 'only tasks in review can edit acceptance', {
        taskId: input.taskId,
        status: task.status,
      }),
    }
  }
  const bundle = getAcceptanceBundle(deps.db, input.taskId)
  if (!bundle || bundle.contract.id !== input.contractId) {
    return {
      ok: false,
      error: appError('acceptance_not_found', 'acceptance contract not found', {
        taskId: input.taskId,
        contractId: input.contractId,
      }),
    }
  }
  if (bundle.contract.status !== 'draft') {
    return {
      ok: false,
      error: appError('invalid_state', 'acceptance contract is frozen', {
        contractId: input.contractId,
      }),
    }
  }

  const now = deps.now()
  const items = input.items.map((item, index) => ({
    id: item.id ?? deps.newId(),
    contractId: bundle.contract.id,
    ordinal: index + 1,
    text: item.text,
    status: item.status,
    evidence: item.evidence ?? null,
    source: 'human' as const,
    updatedAt: now,
  }))

  let event: ReturnType<EventStore['appendWs']>
  try {
    event = deps.db.transaction((tx) => {
      const replaced: ReplaceAcceptanceItemsResult = replaceAcceptanceItems(tx, {
        contractId: bundle.contract.id,
        expectedRevision: input.expectedRevision,
        items,
      })
      if (!replaced.ok) {
        throw new AcceptanceCommandError(replaced.code, replaced.message, replaced.index)
      }
      const after = getAcceptanceBundle(tx, input.taskId)
      if (!after) throw new AcceptanceCommandError('not_found', 'acceptance contract disappeared')
      const { counts, verdict } = acceptanceSummary(after.items)
      insertAudit(tx, {
        id: deps.newId(),
        ts: now,
        actor: 'human',
        action: 'task.acceptance.update',
        detail: {
          taskId: input.taskId,
          contractId: after.contract.id,
          version: after.contract.version,
          revision: after.contract.revision,
          counts,
          verdict,
        },
      })
      return deps.eventStore.appendWs(tx, {
        type: 'acceptance.updated',
        ts: now,
        payload: {
          taskId: input.taskId,
          contractId: after.contract.id,
          version: after.contract.version,
          revision: after.contract.revision,
          status: after.contract.status,
          counts,
          verdict,
        },
      })
    })
  } catch (error) {
    if (error instanceof AcceptanceCommandError) {
      return {
        ok: false,
        error: appError(
          error.code,
          error.message,
          error.index === undefined ? undefined : { index: error.index },
        ),
      }
    }
    throw error
  }

  deps.broadcastRaw?.(buildWsFrame(event))
  return {
    ok: true,
    ack: {
      taskId: input.taskId,
      contractId: input.contractId,
      revision: (event.payload as { revision: number }).revision,
    },
  }
}
