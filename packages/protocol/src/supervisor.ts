import { z } from 'zod'
import { Id, Timestamp } from './common.js'
import { Engine } from './enums.js'
import { AppError } from './errors.js'

/** 总管 v0 只有 supervisor-chat 真实可用；其余是给外部 Source 预留的枚举值。 */
export const SourceKind = z.enum(['supervisor-chat', 'canvas', 'github', 'feishu'])
export type SourceKind = z.infer<typeof SourceKind>

export const Actor = z.object({
  id: z.string().min(1),
  kind: z.enum(['human', 'bot', 'system']),
  source: SourceKind,
  displayName: z.string().optional(),
})
export type Actor = z.infer<typeof Actor>

export const Trigger = z.object({
  id: Id,
  source: SourceKind,
  sourceRef: z.string().optional(),
  threadId: Id,
  actor: Actor,
  text: z.string().min(1).max(8000),
  receivedAt: Timestamp,
  meta: z.record(z.string(), z.unknown()).default({}),
})
export type Trigger = z.infer<typeof Trigger>

export const SupervisorThread = z.object({
  id: Id,
  workspaceId: Id,
  source: SourceKind,
  createdAt: Timestamp,
  updatedAt: Timestamp,
})
export type SupervisorThread = z.infer<typeof SupervisorThread>

export const Strength = z.enum(['explicit', 'inferred'])
export type Strength = z.infer<typeof Strength>

export const SupervisorMode = z.enum(['explicit', 'observe', 'auto'])
export type SupervisorMode = z.infer<typeof SupervisorMode>

export const DecisionKind = z.enum(['create_task', 'query_status', 'chat', 'error'])
export type DecisionKind = z.infer<typeof DecisionKind>

export const ToolCallRecord = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  args: z.unknown(),
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z.string().optional(),
})
export type ToolCallRecord = z.infer<typeof ToolCallRecord>

export const SupervisorDecision = z.object({
  id: Id,
  threadId: Id,
  triggerId: Id,
  messageId: Id,
  kind: DecisionKind,
  strength: Strength,
  mode: SupervisorMode,
  reason: z.string(),
  taskId: Id.nullable(),
  toolCalls: z.array(ToolCallRecord),
  createdAt: Timestamp,
})
export type SupervisorDecision = z.infer<typeof SupervisorDecision>

export const SupervisorMessage = z.object({
  id: Id,
  threadId: Id,
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  toolCalls: z.array(ToolCallRecord).default([]),
  decision: SupervisorDecision.nullable().default(null),
  meta: z
    .object({
      contextNodeIds: z.array(Id),
      targetNodeId: Id.nullable(),
    })
    .nullable()
    .default(null),
  status: z.enum(['ok', 'error']).default('ok'),
  error: AppError.nullable().default(null),
  createdAt: Timestamp,
})
export type SupervisorMessage = z.infer<typeof SupervisorMessage>

export const SupervisorSendInput = z
  .object({
    workspaceId: Id,
    threadId: Id.optional(),
    requestId: Id,
    text: z.string().min(1).max(8000),
    contextNodeIds: z.array(Id).max(40).default([]),
    targetNodeId: Id.optional(),
  })
  .strict()
export type SupervisorSendInput = z.infer<typeof SupervisorSendInput>

export const TaskOrigin = z
  .object({
    source: SourceKind,
    triggerId: Id,
    threadId: Id,
    actor: Actor,
    workspaceId: Id,
    targetNodeId: Id,
    contextNodeIds: z.array(Id).max(40),
    policyVersion: z.string().min(1),
    promptVersion: z.string().min(1),
    createdAt: Timestamp,
  })
  .strict()
export type TaskOrigin = z.infer<typeof TaskOrigin>

/** create_task 工具返回的任务卡；web 从 ToolCallRecord.result 读取。 */
export const SupervisorTaskCard = z.object({
  taskId: Id,
  title: z.string().min(1),
  target: z.object({ id: Id, title: z.string().min(1), engine: Engine }),
  contextCount: z.number().int().nonnegative(),
  status: z.literal('todo'),
})
export type SupervisorTaskCard = z.infer<typeof SupervisorTaskCard>

export const SupervisorStatusResponse = z.object({
  configured: z.boolean(),
  model: z.string().optional(),
  mode: SupervisorMode,
  policyVersion: z.string(),
  errorCode: z.string().optional(),
})
export type SupervisorStatusResponse = z.infer<typeof SupervisorStatusResponse>

export const SupervisorMessagesQuery = z.object({
  workspaceId: Id,
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: Id.optional(),
})
export type SupervisorMessagesQuery = z.infer<typeof SupervisorMessagesQuery>

export const SupervisorMessagesResponse = z.object({
  threadId: Id.nullable(),
  messages: z.array(SupervisorMessage),
  nextBefore: Id.optional(),
})
export type SupervisorMessagesResponse = z.infer<typeof SupervisorMessagesResponse>

/** 仅类型/协议预留；v0 不建表、不产生流程。 */
export const Subscription = z.object({
  id: Id,
  threadId: Id,
  taskId: Id,
  kind: z.enum(['canvas', 'external']),
  status: z.enum(['active', 'ended']),
  createdAt: Timestamp,
})
export type Subscription = z.infer<typeof Subscription>

export const Admission = z.object({
  source: SourceKind,
  scope: z.string().min(1),
  mode: z.enum(['explicit', 'inferred', 'ignore']),
  allowedActors: z.array(z.string()),
})
export type Admission = z.infer<typeof Admission>

export const SupervisorPolicy = z.object({
  mode: SupervisorMode,
  allowedTools: z.array(z.string()),
  maxSteps: z.number().int().positive(),
  timeoutMs: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive(),
})
export type SupervisorPolicy = z.infer<typeof SupervisorPolicy>
