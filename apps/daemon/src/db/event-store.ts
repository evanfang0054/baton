import type { AgentEvent, ServerMessage } from '@baton/protocol'
import { asc, desc, gt } from 'drizzle-orm'
import { event, wsEvent } from './schema.js'
import type { Db, Tx } from './types.js'

export interface EventStoreDeps {
  now: () => number
  newId: () => string
}

type PayloadOf<K extends ServerMessage['type']> = Extract<ServerMessage, { type: K }>['payload']

/** 从协议联合类型派生，避免手写 payload 镜像类型。 */
export type WsEventDraft = {
  [K in ServerMessage['type']]: { type: K; payload: PayloadOf<K>; ts: number }
}[ServerMessage['type']]

export interface BroadcastEvent {
  ordinal: number
  id: string
  type: ServerMessage['type']
  payload: unknown
  payloadJson: string
  ts: number
}

export type WsEventRow = BroadcastEvent

export interface ReplayResult {
  rows: WsEventRow[]
  hasMore: boolean
}

const REPLAY_LIMIT = 5000
const TOOL_PAYLOAD_LIMIT = 16 * 1024
const TEXT_PAYLOAD_LIMIT = 64 * 1024
const TRUNCATED_MARKER = '\n…[truncated]'

function truncateUtf8(
  value: string,
  maxBytes: number,
): { value: string; truncated: boolean; originalBytes: number } {
  const bytes = Buffer.from(value, 'utf8')
  if (bytes.length <= maxBytes) {
    return { value, truncated: false, originalBytes: bytes.length }
  }
  let end = maxBytes
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) {
    end -= 1
  }
  return {
    value: `${bytes.subarray(0, end).toString('utf8')}${TRUNCATED_MARKER}`,
    truncated: true,
    originalBytes: bytes.length,
  }
}

/**
 * 单条事件上限：tool args/result 16KB，text 64KB。
 * 截断标记与原始字节数保留在 `_baton`，UI 可提示，不会静默丢数据。
 */
export function truncateSessionEvent(event: AgentEvent): AgentEvent {
  if (event.type === 'TEXT_MESSAGE_CONTENT') {
    const result = truncateUtf8(event.delta, TEXT_PAYLOAD_LIMIT)
    if (!result.truncated) return event
    return {
      ...event,
      delta: result.value,
      _baton: { truncated: true, originalBytes: result.originalBytes },
    } as AgentEvent
  }
  if (event.type === 'TOOL_CALL_ARGS') {
    const result = truncateUtf8(event.delta, TOOL_PAYLOAD_LIMIT)
    if (!result.truncated) return event
    return {
      ...event,
      delta: result.value,
      _baton: { truncated: true, originalBytes: result.originalBytes },
    } as AgentEvent
  }
  if (event.type === 'TOOL_CALL_RESULT' && typeof event.content === 'string') {
    const result = truncateUtf8(event.content, TOOL_PAYLOAD_LIMIT)
    if (!result.truncated) return event
    return {
      ...event,
      content: result.value,
      _baton: { truncated: true, originalBytes: result.originalBytes },
    } as AgentEvent
  }
  return event
}

function toRow(row: typeof wsEvent.$inferSelect): WsEventRow {
  return {
    ordinal: row.ordinal,
    id: row.id,
    type: row.type as ServerMessage['type'],
    payload: JSON.parse(row.payloadJson) as unknown,
    payloadJson: row.payloadJson,
    ts: row.ts,
  }
}

/**
 * 追加写日志：ws_event 是客户端重放的唯一来源，event 是 session 的 AG-UI 明细。
 * appendWs 必须在调用方的事务里使用；appendSessionEvent 自己开事务。
 */
export function createEventStore(db: Db, deps: EventStoreDeps) {
  function appendWsJson(
    tx: Tx,
    input: {
      type: ServerMessage['type']
      payload: unknown
      payloadJson: string
      ts: number
      taskId?: string | null
    },
  ): BroadcastEvent {
    const id = deps.newId()
    const result = tx
      .insert(wsEvent)
      .values({
        id,
        type: input.type,
        payloadJson: input.payloadJson,
        ts: input.ts,
        taskId: input.taskId ?? null,
      })
      .run()
    return {
      id,
      ordinal: Number(result.lastInsertRowid),
      type: input.type,
      payload: input.payload,
      payloadJson: input.payloadJson,
      ts: input.ts,
    }
  }

  function appendWs(tx: Tx, input: WsEventDraft): BroadcastEvent {
    const taskId =
      input.type === 'task.status' && 'taskId' in input.payload ? input.payload.taskId : null
    return appendWsJson(tx, {
      type: input.type,
      payload: input.payload,
      payloadJson: JSON.stringify(input.payload),
      ts: input.ts,
      taskId,
    })
  }

  function appendSessionEvent(input: {
    sessionId: string
    seq: number
    event: AgentEvent
    ts?: number
  }): BroadcastEvent {
    return db.transaction((tx) => {
      const ts = input.ts ?? deps.now()
      const truncated = truncateSessionEvent(input.event)
      const eventJson = JSON.stringify(truncated)
      // 一次序列化 event，再拼出 ws payload；避免同一份大 payload 序列化两次。
      const payloadJson = `{"sessionId":${JSON.stringify(input.sessionId)},"seq":${input.seq},"event":${eventJson}}`
      const payload = { sessionId: input.sessionId, seq: input.seq, event: truncated }
      const ws = appendWsJson(tx, {
        type: 'session.event',
        payloadJson,
        payload,
        ts,
      })
      tx.insert(event)
        .values({
          id: deps.newId(),
          sessionId: input.sessionId,
          ordinal: ws.ordinal,
          seq: input.seq,
          type: truncated.type,
          payloadJson: eventJson,
          ts,
        })
        .run()
      return ws
    })
  }

  function appendTaskStatus(tx: Tx, input: PayloadOf<'task.status'>): BroadcastEvent {
    return appendWs(tx, {
      type: 'task.status',
      payload: input,
      ts: input.updatedAt,
    })
  }

  function appendApprovalRequest(
    tx: Tx,
    input: PayloadOf<'approval.request'> & { ts: number },
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
    input: PayloadOf<'verify.result'> & { ts: number },
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
