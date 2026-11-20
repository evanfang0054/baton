import {
  AppError,
  SupervisorDecision,
  SupervisorMessage,
  SupervisorThread,
  ToolCallRecord,
} from '@baton/protocol'
import { and, desc, eq, inArray, lt, or } from 'drizzle-orm'
import { z } from 'zod'
import { supervisorDecision, supervisorMessage, supervisorThread } from '../db/schema.js'
import type { Db } from '../db/types.js'

type SupervisorMessageValue = z.infer<typeof SupervisorMessage>
type SupervisorThreadValue = z.infer<typeof SupervisorThread>

const messageMeta = z
  .object({ contextNodeIds: z.array(z.string()), targetNodeId: z.string().nullable() })
  .nullable()

const toolCallsSchema = z.array(ToolCallRecord)

export interface SupervisorStoreDeps {
  db: Db
  now: () => number
  newId: () => string
}

export interface InsertUserMessageInput {
  threadId: string
  triggerId: string
  text: string
  meta: z.infer<typeof messageMeta>
}

export interface InsertAssistantTurnInput {
  threadId: string
  triggerId: string
  messageId?: string
  content: string
  toolCalls: z.infer<typeof toolCallsSchema>
  status: 'ok' | 'error'
  error: unknown
  decision: Pick<SupervisorDecision, 'kind' | 'strength' | 'mode' | 'reason' | 'taskId'>
}

export interface SupervisorStore {
  getOrCreateThread(workspaceId: string): SupervisorThreadValue
  findLatestThread(workspaceId: string): SupervisorThreadValue | null
  insertUserMessage(input: InsertUserMessageInput): {
    message: SupervisorMessageValue
    duplicate: boolean
  }
  insertAssistantTurn(input: InsertAssistantTurnInput): {
    message: SupervisorMessageValue
    decision: SupervisorDecision
  }
  /** 观察者消息：assistant 角色、无 decision，用 dedupeKey 保证同一事件只落一次。 */
  insertNotification(input: { threadId: string; dedupeKey: string; content: string }): {
    message: SupervisorMessageValue
    duplicate: boolean
  }
  hasNotification(threadId: string, dedupeKey: string): boolean
  updateNotificationContent(messageId: string, content: string): SupervisorMessageValue | null
  listMessages(
    threadId: string,
    limit: number,
    before?: string,
  ): { messages: SupervisorMessageValue[]; nextBefore?: string }
  getUserMessageByTrigger(threadId: string, triggerId: string): SupervisorMessageValue | null
  getDecisionByTrigger(threadId: string, triggerId: string): SupervisorDecision | null
}

function parseJson<T>(raw: string | null, schema: z.ZodType<T>, fallback: T): T {
  if (!raw) return fallback
  try {
    const parsed = schema.safeParse(JSON.parse(raw) as unknown)
    return parsed.success ? parsed.data : fallback
  } catch {
    return fallback
  }
}

function errorJson(error: unknown): string | null {
  if (error === null || error === undefined) return null
  if (error instanceof Error) {
    return JSON.stringify({ code: 'error', message: error.message })
  }
  return JSON.stringify(error)
}

export function createSupervisorStore(deps: SupervisorStoreDeps): SupervisorStore {
  function toThread(row: typeof supervisorThread.$inferSelect): SupervisorThreadValue {
    return SupervisorThread.parse({
      id: row.id,
      workspaceId: row.workspaceId,
      source: row.source,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })
  }

  function toDecision(row: typeof supervisorDecision.$inferSelect): SupervisorDecision | null {
    const parsed = SupervisorDecision.safeParse({
      id: row.id,
      threadId: row.threadId,
      triggerId: row.triggerId,
      messageId: row.messageId,
      kind: row.kind,
      strength: row.strength,
      mode: row.mode,
      reason: row.reason,
      taskId: row.taskId,
      toolCalls: parseJson(row.toolCallsJson, toolCallsSchema, []),
      createdAt: row.createdAt,
    })
    return parsed.success ? parsed.data : null
  }

  function toMessage(
    row: typeof supervisorMessage.$inferSelect,
    decision: SupervisorDecision | null,
  ): SupervisorMessageValue {
    return SupervisorMessage.parse({
      id: row.id,
      threadId: row.threadId,
      role: row.role === 'assistant' ? 'assistant' : 'user',
      content: row.content,
      toolCalls: parseJson(row.toolCallsJson, toolCallsSchema, []),
      decision,
      meta: parseJson(row.metaJson, messageMeta, null),
      status: row.status === 'error' ? 'error' : 'ok',
      error: parseJson(row.errorJson, AppError, null),
      createdAt: row.createdAt,
    })
  }

  return {
    findLatestThread(workspaceId) {
      const row = deps.db
        .select()
        .from(supervisorThread)
        .where(eq(supervisorThread.workspaceId, workspaceId))
        .orderBy(desc(supervisorThread.updatedAt))
        .limit(1)
        .get()
      return row ? toThread(row) : null
    },

    getOrCreateThread(workspaceId) {
      const existing = this.findLatestThread(workspaceId)
      if (existing) return existing
      const at = deps.now()
      const thread = SupervisorThread.parse({
        id: deps.newId(),
        workspaceId,
        source: 'supervisor-chat',
        createdAt: at,
        updatedAt: at,
      })
      deps.db.insert(supervisorThread).values(thread).run()
      return thread
    },

    insertUserMessage(input) {
      const messageId = deps.newId()
      const at = deps.now()
      deps.db.transaction((tx) => {
        tx.insert(supervisorMessage)
          .values({
            id: messageId,
            threadId: input.threadId,
            role: 'user',
            content: input.text,
            toolCallsJson: null,
            metaJson: input.meta ? JSON.stringify(input.meta) : null,
            triggerId: input.triggerId,
            status: 'ok',
            errorJson: null,
            createdAt: at,
          })
          .onConflictDoNothing()
          .run()
        tx.update(supervisorThread)
          .set({ updatedAt: at })
          .where(eq(supervisorThread.id, input.threadId))
          .run()
      })
      const row = deps.db
        .select()
        .from(supervisorMessage)
        .where(
          and(
            eq(supervisorMessage.threadId, input.threadId),
            eq(supervisorMessage.triggerId, input.triggerId),
          ),
        )
        .get()
      if (!row) throw new Error('failed to persist supervisor message')
      return { message: toMessage(row, null), duplicate: row.id !== messageId }
    },

    insertAssistantTurn(input) {
      const messageId = input.messageId ?? deps.newId()
      const decisionId = deps.newId()
      const at = deps.now()
      const toolCallsJson = JSON.stringify(input.toolCalls)
      const decision = SupervisorDecision.parse({
        id: decisionId,
        threadId: input.threadId,
        triggerId: input.triggerId,
        messageId,
        kind: input.decision.kind,
        strength: input.decision.strength,
        mode: input.decision.mode,
        reason: input.decision.reason,
        taskId: input.decision.taskId,
        toolCalls: input.toolCalls,
        createdAt: at,
      })
      deps.db.transaction((tx) => {
        tx.insert(supervisorMessage)
          .values({
            id: messageId,
            threadId: input.threadId,
            role: 'assistant',
            content: input.content,
            toolCallsJson,
            metaJson: null,
            triggerId: null,
            status: input.status,
            errorJson: errorJson(input.error),
            createdAt: at,
          })
          .run()
        tx.insert(supervisorDecision)
          .values({
            id: decision.id,
            threadId: decision.threadId,
            triggerId: decision.triggerId,
            messageId: decision.messageId,
            kind: decision.kind,
            strength: decision.strength,
            mode: decision.mode,
            reason: decision.reason,
            taskId: decision.taskId,
            toolCallsJson,
            createdAt: decision.createdAt,
          })
          .run()
        tx.update(supervisorThread)
          .set({ updatedAt: at })
          .where(eq(supervisorThread.id, input.threadId))
          .run()
      })
      const row = deps.db
        .select()
        .from(supervisorMessage)
        .where(eq(supervisorMessage.id, messageId))
        .get()
      if (!row) throw new Error('failed to persist supervisor assistant message')
      return { message: toMessage(row, decision), decision }
    },

    insertNotification(input) {
      const messageId = deps.newId()
      const at = deps.now()
      deps.db.transaction((tx) => {
        tx.insert(supervisorMessage)
          .values({
            id: messageId,
            threadId: input.threadId,
            role: 'assistant',
            content: input.content,
            toolCallsJson: null,
            metaJson: null,
            triggerId: input.dedupeKey,
            status: 'ok',
            errorJson: null,
            createdAt: at,
          })
          .onConflictDoNothing()
          .run()
        tx.update(supervisorThread)
          .set({ updatedAt: at })
          .where(eq(supervisorThread.id, input.threadId))
          .run()
      })
      const row = deps.db
        .select()
        .from(supervisorMessage)
        .where(
          and(
            eq(supervisorMessage.threadId, input.threadId),
            eq(supervisorMessage.triggerId, input.dedupeKey),
          ),
        )
        .get()
      if (!row) throw new Error('failed to persist supervisor notification')
      return { message: toMessage(row, null), duplicate: row.id !== messageId }
    },

    hasNotification(threadId, dedupeKey) {
      const row = deps.db
        .select({ id: supervisorMessage.id })
        .from(supervisorMessage)
        .where(
          and(eq(supervisorMessage.threadId, threadId), eq(supervisorMessage.triggerId, dedupeKey)),
        )
        .get()
      return row !== undefined
    },

    updateNotificationContent(messageId, content) {
      const result = deps.db
        .update(supervisorMessage)
        .set({ content })
        .where(and(eq(supervisorMessage.id, messageId), eq(supervisorMessage.role, 'assistant')))
        .run()
      if (result.changes === 0) return null
      const row = deps.db
        .select()
        .from(supervisorMessage)
        .where(eq(supervisorMessage.id, messageId))
        .get()
      return row ? toMessage(row, null) : null
    },

    listMessages(threadId, limit, before) {
      const beforeRow = before
        ? deps.db.select().from(supervisorMessage).where(eq(supervisorMessage.id, before)).get()
        : undefined
      if (before && !beforeRow) return { messages: [] }

      const cursor = beforeRow
        ? or(
            lt(supervisorMessage.createdAt, beforeRow.createdAt),
            and(
              eq(supervisorMessage.createdAt, beforeRow.createdAt),
              lt(supervisorMessage.id, beforeRow.id),
            ),
          )
        : undefined
      const where = cursor
        ? and(eq(supervisorMessage.threadId, threadId), cursor)
        : eq(supervisorMessage.threadId, threadId)
      const rows = deps.db
        .select()
        .from(supervisorMessage)
        .where(where)
        .orderBy(desc(supervisorMessage.createdAt), desc(supervisorMessage.id))
        .limit(limit + 1)
        .all()
      const hasMore = rows.length > limit
      const page = rows.slice(0, limit)
      const nextBefore = hasMore ? page[page.length - 1]?.id : undefined

      const decisions =
        page.length > 0
          ? deps.db
              .select()
              .from(supervisorDecision)
              .where(
                inArray(
                  supervisorDecision.messageId,
                  page.map((row) => row.id),
                ),
              )
              .all()
          : []
      const byMessage = new Map<string, SupervisorDecision>()
      for (const row of decisions) {
        const decision = toDecision(row)
        if (decision) byMessage.set(decision.messageId, decision)
      }
      return {
        messages: page.reverse().map((row) => toMessage(row, byMessage.get(row.id) ?? null)),
        ...(nextBefore ? { nextBefore } : {}),
      }
    },

    getUserMessageByTrigger(threadId, triggerId) {
      const row = deps.db
        .select()
        .from(supervisorMessage)
        .where(
          and(
            eq(supervisorMessage.threadId, threadId),
            eq(supervisorMessage.triggerId, triggerId),
            eq(supervisorMessage.role, 'user'),
          ),
        )
        .get()
      return row ? toMessage(row, null) : null
    },

    getDecisionByTrigger(threadId, triggerId) {
      const row = deps.db
        .select()
        .from(supervisorDecision)
        .where(
          and(
            eq(supervisorDecision.threadId, threadId),
            eq(supervisorDecision.triggerId, triggerId),
          ),
        )
        .get()
      return row ? toDecision(row) : null
    },
  }
}
