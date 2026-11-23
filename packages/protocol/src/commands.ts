import { z } from 'zod'
import { Id, Timestamp } from './common.js'
import {
  AcceptanceItemStatus,
  AgentNode,
  ArtifactNode,
  DrawingNode,
  FileNode,
  GroupNode,
  ImageNode,
  ReviewNode,
  TextNode,
} from './entities/index.js'
import { ApprovalDecision, EdgeType, Engine, WorkspaceMode } from './enums.js'
import { SupervisorSendInput } from './supervisor.js'
import { SupervisorActionDecideInput, TaskReauthorizeInput } from './supervisor-action.js'

export const ResumeInput = z.object({
  sinceSeq: z.number().int().nonnegative().optional(),
})
export type ResumeInput = z.infer<typeof ResumeInput>

export const TaskCreateInput = z.object({
  workspaceId: Id,
  nodeId: Id,
  title: z.string().min(1),
  prompt: z.string().min(1),
  contextNodeIds: z.array(Id),
  engine: Engine,
  workspaceMode: WorkspaceMode.default('main'),
  verifyCommand: z.string().min(1).optional(),
  dangerouslySkipPermissions: z.boolean().default(false),
  deliveryId: Id.optional(),
  stageKey: z.string().min(1).max(32).optional(),
  annotationIds: z.array(Id).max(20).optional(),
})
export type TaskCreateInput = z.infer<typeof TaskCreateInput>

export const TaskEnqueueInput = z.object({ taskId: Id })
export type TaskEnqueueInput = z.infer<typeof TaskEnqueueInput>

export const TaskCancelInput = z.object({
  taskId: Id,
  reason: z.string().min(1).optional(),
})
export type TaskCancelInput = z.infer<typeof TaskCancelInput>

export const TaskRetryInput = z.object({
  taskId: Id,
  note: z.string().min(1).max(16_384).optional(),
})
export type TaskRetryInput = z.infer<typeof TaskRetryInput>

export const TaskReopenInput = z.object({
  taskId: Id,
  note: z.string().min(1).max(16_384).optional(),
})
export type TaskReopenInput = z.infer<typeof TaskReopenInput>

export const TaskHandoffInput = z.object({
  taskId: Id,
  /** 当前 workspace；用于任务归属校验，防止跨 workspace 交接。 */
  workspaceId: Id,
})
export type TaskHandoffInput = z.infer<typeof TaskHandoffInput>

export const SessionReplyInput = z.object({
  taskId: Id,
  text: z.string().min(1).max(16_384),
})
export type SessionReplyInput = z.infer<typeof SessionReplyInput>

export const ContextInjectInput = z
  .object({
    taskId: Id,
    nodeIds: z.array(Id).min(1).max(40),
    note: z.string().max(2000).optional(),
    /** 客户端生成的幂等键；断线重试复用同一个值。 */
    requestId: z.string().min(1).max(100).optional(),
  })
  .strict()
export type ContextInjectInput = z.infer<typeof ContextInjectInput>

export const ApprovalDecideInput = z.object({
  approvalId: Id,
  decision: ApprovalDecision,
  note: z.string().min(1).optional(),
  /** AskUserQuestion：question text → 选项 label（多选逗号分隔）。 */
  answers: z.record(z.string(), z.string()).optional(),
  /** AskUserQuestion：用户输入的自由文本。 */
  response: z.string().optional(),
})
export type ApprovalDecideInput = z.infer<typeof ApprovalDecideInput>

export const ReviewDecideInput = z
  .discriminatedUnion('decision', [
    z
      .object({
        reviewId: Id,
        decision: z.literal('approve'),
        reason: z.string().max(2000).optional(),
        /** AC fail/pending/缺失时必填；daemon 校验并写审计。 */
        overrideReason: z.string().max(2000).optional(),
      })
      .strict(),
    z
      .object({
        reviewId: Id,
        decision: z.literal('reject'),
        feedback: z.string().max(16_384).optional(),
        contextNodeIds: z.array(Id).min(1).max(40).optional(),
        contextNote: z.string().max(2000).optional(),
      })
      .strict(),
  ])
  .refine(
    (value) =>
      value.decision !== 'reject' ||
      Boolean(value.feedback?.trim()) ||
      (value.contextNodeIds?.length ?? 0) > 0,
    { message: 'feedback or contextNodeIds is required' },
  )
export type ReviewDecideInput = z.infer<typeof ReviewDecideInput>

const AcceptanceItemInput = z
  .object({
    id: Id.optional(),
    text: z.string().min(1).max(200),
    status: AcceptanceItemStatus,
    evidence: z.string().max(200).nullable().optional(),
  })
  .strict()

export const AcceptanceUpdateInput = z
  .object({
    taskId: Id,
    contractId: Id,
    expectedRevision: z.number().int().nonnegative(),
    items: z.array(AcceptanceItemInput).max(8),
  })
  .strict()
export type AcceptanceUpdateInput = z.infer<typeof AcceptanceUpdateInput>

const NodeCreateBase = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number().positive().default(320),
  h: z.number().positive().default(200),
  groupId: Id.nullable().default(null),
})

export const NodeCreateValue = z.discriminatedUnion('type', [
  NodeCreateBase.extend({
    type: z.literal('text'),
    data: TextNode.shape.data,
  }),
  NodeCreateBase.extend({
    type: z.literal('image'),
    data: ImageNode.shape.data,
  }),
  NodeCreateBase.extend({
    type: z.literal('file'),
    data: FileNode.shape.data,
  }),
  NodeCreateBase.extend({
    type: z.literal('agent'),
    data: AgentNode.shape.data.extend({ taskId: Id.nullable().default(null) }),
  }),
  NodeCreateBase.extend({
    type: z.literal('review'),
    data: ReviewNode.shape.data,
  }),
  NodeCreateBase.extend({
    type: z.literal('group'),
    data: GroupNode.shape.data,
  }),
  NodeCreateBase.extend({
    type: z.literal('artifact'),
    data: ArtifactNode.shape.data,
  }),
  NodeCreateBase.extend({
    type: z.literal('drawing'),
    data: DrawingNode.shape.data,
  }),
])
export type NodeCreateValue = z.infer<typeof NodeCreateValue>

export const NodeCreateInput = z.object({
  canvasId: Id,
  node: NodeCreateValue,
})
export type NodeCreateInput = z.infer<typeof NodeCreateInput>

export const NodeUpdateInput = z.object({
  nodeId: Id,
  patch: z
    .object({
      x: z.number().optional(),
      y: z.number().optional(),
      w: z.number().positive().optional(),
      h: z.number().positive().optional(),
      groupId: Id.nullable().optional(),
      data: z.unknown().optional(),
    })
    .strict(),
})
export type NodeUpdateInput = z.infer<typeof NodeUpdateInput>

export const NodeMoveManyInput = z.object({
  canvasId: Id,
  moves: z
    .array(z.object({ nodeId: Id, x: z.number(), y: z.number() }).strict())
    .min(1)
    .max(200),
})
export type NodeMoveManyInput = z.infer<typeof NodeMoveManyInput>

export const GroupCreateInput = z.object({
  canvasId: Id,
  x: z.number(),
  y: z.number(),
  w: z.number().positive(),
  h: z.number().positive(),
  label: z.string().min(1).max(120),
  childIds: z.array(Id).min(1).max(50),
})
export type GroupCreateInput = z.infer<typeof GroupCreateInput>

export const NodeDeleteInput = z.object({ nodeId: Id })
export type NodeDeleteInput = z.infer<typeof NodeDeleteInput>

export const EdgeCreateInput = z.object({
  sourceId: Id,
  targetId: Id,
  type: EdgeType.default('context'),
})
export type EdgeCreateInput = z.infer<typeof EdgeCreateInput>

export const EdgeDeleteInput = z.object({ edgeId: Id })
export type EdgeDeleteInput = z.infer<typeof EdgeDeleteInput>

const CommandBase = z.object({
  v: z.literal(1),
  id: Id,
  ts: Timestamp,
})

export const ClientMessage = z.discriminatedUnion('type', [
  CommandBase.extend({ type: z.literal('resume'), payload: ResumeInput }),
  CommandBase.extend({ type: z.literal('task.create'), payload: TaskCreateInput }),
  CommandBase.extend({ type: z.literal('task.enqueue'), payload: TaskEnqueueInput }),
  CommandBase.extend({ type: z.literal('task.cancel'), payload: TaskCancelInput }),
  CommandBase.extend({ type: z.literal('task.retry'), payload: TaskRetryInput }),
  CommandBase.extend({ type: z.literal('task.reopen'), payload: TaskReopenInput }),
  CommandBase.extend({ type: z.literal('task.handoff'), payload: TaskHandoffInput }),
  CommandBase.extend({ type: z.literal('session.reply'), payload: SessionReplyInput }),
  CommandBase.extend({ type: z.literal('context.inject'), payload: ContextInjectInput }),
  CommandBase.extend({ type: z.literal('acceptance.update'), payload: AcceptanceUpdateInput }),
  CommandBase.extend({ type: z.literal('approval.decide'), payload: ApprovalDecideInput }),
  CommandBase.extend({ type: z.literal('review.decide'), payload: ReviewDecideInput }),
  CommandBase.extend({ type: z.literal('node.create'), payload: NodeCreateInput }),
  CommandBase.extend({ type: z.literal('node.update'), payload: NodeUpdateInput }),
  CommandBase.extend({ type: z.literal('node.move_many'), payload: NodeMoveManyInput }),
  CommandBase.extend({ type: z.literal('group.create'), payload: GroupCreateInput }),
  CommandBase.extend({ type: z.literal('node.delete'), payload: NodeDeleteInput }),
  CommandBase.extend({ type: z.literal('edge.create'), payload: EdgeCreateInput }),
  CommandBase.extend({ type: z.literal('edge.delete'), payload: EdgeDeleteInput }),
  CommandBase.extend({ type: z.literal('supervisor.send'), payload: SupervisorSendInput }),
  CommandBase.extend({
    type: z.literal('supervisor.action.decide'),
    payload: SupervisorActionDecideInput,
  }),
  CommandBase.extend({ type: z.literal('task.reauthorize'), payload: TaskReauthorizeInput }),
])
export type ClientMessage = z.infer<typeof ClientMessage>
