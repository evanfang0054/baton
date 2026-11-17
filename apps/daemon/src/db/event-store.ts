import type { AgentEvent, ServerMessage, TaskStatus } from '@baton/protocol'
import { asc, desc, gt } from 'drizzle-orm'
import { event, wsEvent } from './schema.js'
import type { Db, Tx } from './types.js'

export interface EventStoreDeps {
  now: () => number
  newId: () => string
}

export interface WsEventDraft {
  type: ServerMessage['type']
  payload: unknown
  ts: number
}

export interface BroadcastEvent {
  ordinal: number
  id: string
  type: ServerMessage['type']
  payload: unknown
  ts: number
}

export type WsEventRow = BroadcastEvent

export interface ReplayResult {
  rows: WsEventRow[]
  hasMore: boolean
}

const REPLAY_LIMIT = 5000

function toRow(row: typeof wsEvent.$inferSelect): WsEventRow {
  return {
    ordinal: row.ordinal,
    id: row.id,
    type: row.type as ServerMessage['type'],
    payload: JSON.parse(row.payloadJson) as unknown,
    ts: row.ts,
  }
}

/**
 * 追加写日志：ws_event 是客户端重放的唯一来源，event 是 session 的 AG-UI 明细。
 * appendWs 必须在调用方的事务里使用；appendSessionEvent 自己开事务。
 */
export function createEventStore(db: Db, deps: EventStoreDeps) {
  function appendWs(tx: Tx, input: WsEventDraft): BroadcastEvent {
    const id = deps.newId()
    const result = tx
      .insert(wsEvent)
      .values({
        id,
        type: input.type,
        payloadJson: JSON.stringify(input.payload),
        ts: input.ts,
      })
      .run()
    return {
      id,
      ordinal: Number(result.lastInsertRowid),
      type: input.type,
      payload: input.payload,
      ts: input.ts,
    }
  }

  function appendSessionEvent(input: {
    sessionId: string
    seq: number
    event: AgentEvent
    ts?: number
  }): BroadcastEvent {
    return db.transaction((tx) => {
      const ts = input.ts ?? deps.now()
      const ws = appendWs(tx, {
        type: 'session.event',
        payload: { sessionId: input.sessionId, event: input.event },
        ts,
      })
      tx.insert(event)
        .values({
          id: deps.newId(),
          sessionId: input.sessionId,
          ordinal: ws.ordinal,
          seq: input.seq,
          type: input.event.type,
          payloadJson: JSON.stringify(input.event),
          ts,
        })
        .run()
      return ws
    })
  }

  function appendTaskStatus(
    tx: Tx,
    input: {
      taskId: string
      status: TaskStatus
      previousStatus: TaskStatus
      retryCount: number
      updatedAt: number
    },
  ): BroadcastEvent {
    return appendWs(tx, {
      type: 'task.status',
      payload: {
        taskId: input.taskId,
        status: input.status,
        previousStatus: input.previousStatus,
        retryCount: input.retryCount,
        updatedAt: input.updatedAt,
      },
      ts: input.updatedAt,
    })
  }

  function appendApprovalRequest(
    tx: Tx,
    input: {
      approvalId: string
      sessionId: string
      request: unknown
      ts: number
    },
  ): BroadcastEvent {
    return appendWs(tx, {
      type: 'approval.request',
      payload: {
        approvalId: input.approvalId,
        sessionId: input.sessionId,
        request: input.request,
      },
      ts: input.ts,
    })
  }

  function appendVerifyResult(
    tx: Tx,
    input: {
      taskId: string
      reviewId: string
      exitCode: number
      output: string
      diffStat: unknown
      durationMs: number
      ts: number
    },
  ): BroadcastEvent {
    return appendWs(tx, {
      type: 'verify.result',
      payload: {
        taskId: input.taskId,
        reviewId: input.reviewId,
        exitCode: input.exitCode,
        output: input.output,
        diffStat: input.diffStat,
        durationMs: input.durationMs,
      },
      ts: input.ts,
    })
  }

  function replay(sinceOrdinal: number, limit = REPLAY_LIMIT): ReplayResult {
    const rows = db
      .select()
      .from(wsEvent)
      .where(gt(wsEvent.ordinal, sinceOrdinal))
      .orderBy(asc(wsEvent.ordinal))
      .limit(limit + 1)
      .all()
    return {
      rows: rows.slice(0, limit).map(toRow),
      hasMore: rows.length > limit,
    }
  }

  function maxOrdinal(): number {
    const row = db
      .select({ ordinal: wsEvent.ordinal })
      .from(wsEvent)
      .orderBy(desc(wsEvent.ordinal))
      .limit(1)
      .get()
    return row?.ordinal ?? 0
  }

  return {
    appendWs,
    appendSessionEvent,
    appendTaskStatus,
    appendApprovalRequest,
    appendVerifyResult,
    replay,
    maxOrdinal,
  }
}

export type EventStore = ReturnType<typeof createEventStore>
