import { z } from 'zod'
import { Id, Timestamp } from './common.js'
import { Engine } from './enums.js'
import { Strength } from './supervisor.js'
import { TaskTemplateId } from './task-template.js'

export const SupervisorActionKind = z.enum([
  'triage_plan',
  'retry',
  'reopen',
  'attention_reminder',
  'batch_enqueue',
  'batch_retry',
  'batch_cancel',
])
export type SupervisorActionKind = z.infer<typeof SupervisorActionKind>

export const SupervisorActionStatus = z.enum([
  'proposed',
  'applied',
  'ignored',
  'failed',
  'expired',
])
export type SupervisorActionStatus = z.infer<typeof SupervisorActionStatus>

export const PlanItem = z
  .object({
    title: z.string().min(1).max(80),
    templateId: TaskTemplateId.nullable().default(null),
    targetNodeId: Id.nullable().default(null),
    agentTitle: z.string().min(1).max(80).nullable().default(null),
    contextNodeIds: z.array(Id).max(40).default([]),
    engine: Engine.nullable().default(null),
    budgetUsd: z.number().finite().nonnegative().nullable().default(null),
  })
  .strict()
export type PlanItem = z.infer<typeof PlanItem>

export const PlanContextItem = z
  .object({
    taskId: Id,
    title: z.string().min(1).max(200),
    status: z.string().min(1),
    source: z.enum(['same_agent', 'handoff', 'context_node', 'recent_failure', 'title']),
    failure: z.string().max(200).nullable().default(null),
  })
  .strict()
export type PlanContextItem = z.infer<typeof PlanContextItem>

export const PlanPayload = z
  .object({
    items: z.array(PlanItem).min(1).max(6),
    templateId: TaskTemplateId.nullable().default(null),
    contextDigest: z.array(PlanContextItem).max(5).default([]),
    source: z
      .object({
        nodeIds: z.array(Id).max(40).default([]),
      })
      .strict(),
    triggerId: Id,
  })
  .strict()
export type PlanPayload = z.infer<typeof PlanPayload>

export const PlanApplyResult = z
  .object({
    createdTaskIds: z.array(Id).default([]),
    failed: z
      .array(
        z
          .object({
            index: z.number().int().nonnegative(),
            code: z.string().min(1),
            message: z.string().min(1),
          })
          .strict(),
      )
      .default([]),
  })
  .strict()
export type PlanApplyResult = z.infer<typeof PlanApplyResult>

export const PlanToolResult = z
  .object({
    actionId: Id,
    status: SupervisorActionStatus,
    plan: PlanPayload,
  })
  .strict()
export type PlanToolResult = z.infer<typeof PlanToolResult>

export const SupervisorAction = z
  .object({
    id: Id,
    workspaceId: Id,
    threadId: Id.nullable(),
    taskId: Id.nullable(),
    kind: SupervisorActionKind,
    status: SupervisorActionStatus,
    strength: Strength,
    mode: z.enum(['observe', 'auto']),
    reason: z.string().min(1).max(2000),
    payload: z.unknown(),
    result: z.unknown().nullable(),
    policyVersion: z.string().min(1),
    mandateVersion: z.string().min(1).nullable(),
    dedupeKey: z.string().min(1).max(300),
    createdAt: Timestamp,
    updatedAt: Timestamp,
    expiresAt: Timestamp,
    appliedAt: Timestamp.nullable(),
    ignoredAt: Timestamp.nullable(),
  })
  .strict()
export type SupervisorAction = z.infer<typeof SupervisorAction>

export const SupervisorActionListQuery = z.object({
  workspaceId: Id,
  status: SupervisorActionStatus.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})
export type SupervisorActionListQuery = z.infer<typeof SupervisorActionListQuery>

export const SupervisorActionListResponse = z.object({
  actions: z.array(SupervisorAction),
})
export type SupervisorActionListResponse = z.infer<typeof SupervisorActionListResponse>

export const SupervisorActionResponse = z.object({
  action: SupervisorAction,
})
export type SupervisorActionResponse = z.infer<typeof SupervisorActionResponse>

export const SupervisorActionDecideInput = z
  .object({
    workspaceId: Id,
    actionId: Id,
    decision: z.enum(['apply', 'ignore']),
  })
  .strict()
export type SupervisorActionDecideInput = z.infer<typeof SupervisorActionDecideInput>

export const TaskReauthorizeInput = z.object({ taskId: Id }).strict()
export type TaskReauthorizeInput = z.infer<typeof TaskReauthorizeInput>
