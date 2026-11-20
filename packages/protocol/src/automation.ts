import { z } from 'zod'
import { Id, Timestamp } from './common.js'
import { ApprovalDecision, Attention, RiskLevel, TaskStatus } from './enums.js'
import { PolicySchema } from './policy.js'

/** 只允许 UI 编辑的四个字段；allow/deny/verify/digestCron 保持只读。 */
export const AutomationPolicyPatch = z
  .object({
    autopilot: z
      .object({
        enabled: z.boolean().optional(),
        retryMax: z.number().int().min(0).max(10).optional(),
        delegatedAuthority: z.boolean().optional(),
      })
      .strict()
      .optional(),
    approval: z
      .object({
        // high 永不自动批准，不提供该选项，避免误导。
        autoApproveMaxRisk: z.enum(['low', 'medium']).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
export type AutomationPolicyPatch = z.infer<typeof AutomationPolicyPatch>

export const AutomationSummary = z.object({
  workspaceId: Id,
  trusted: z.boolean(),
  policy: PolicySchema,
  policyVersion: z.string().min(1),
  killSwitch: z.boolean(),
  killSwitchForced: z.boolean(),
  digestCronUnsupported: z.boolean().default(false),
})
export type AutomationSummary = z.infer<typeof AutomationSummary>

export const DigestTaskRef = z.object({
  id: Id,
  title: z.string(),
  status: TaskStatus,
  attention: Attention,
  waitingSince: Timestamp.nullable(),
  retryCount: z.number().int().nonnegative(),
})
export type DigestTaskRef = z.infer<typeof DigestTaskRef>

export const DigestReport = z.object({
  workspaceId: Id,
  windowStart: Timestamp,
  windowEnd: Timestamp,
  generatedAt: Timestamp,
  policyVersion: z.string().min(1),
  snapshot: z.object({
    total: z.number().int().nonnegative(),
    unplanned: z.number().int().nonnegative(),
    todo: z.number().int().nonnegative(),
    running: z.number().int().nonnegative(),
    waiting: z.number().int().nonnegative(),
    review: z.number().int().nonnegative(),
    done: z.number().int().nonnegative(),
    closed: z.number().int().nonnegative(),
    attention: z.object({
      needsApproval: z.number().int().nonnegative(),
      needsReply: z.number().int().nonnegative(),
      needsAttention: z.number().int().nonnegative(),
      needsReview: z.number().int().nonnegative(),
    }),
  }),
  ready: z.array(DigestTaskRef).max(20),
  blocked: z.array(DigestTaskRef).max(20),
  dropped: z.array(DigestTaskRef).max(20),
  changes: z.object({
    created: z.number().int().nonnegative(),
    updated: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    cancelled: z.number().int().nonnegative(),
    retried: z.number().int().nonnegative(),
    autoAllowed: z.number().int().nonnegative(),
    autoDenied: z.number().int().nonnegative(),
  }),
  oldestWaiting: DigestTaskRef.nullable(),
})
export type DigestReport = z.infer<typeof DigestReport>

export const TaskAutomationDecision = z.object({
  approvalId: Id,
  decision: ApprovalDecision,
  toolName: z.string().min(1),
  risk: RiskLevel,
  decidedAt: Timestamp,
  policyVersion: z.string().min(1).nullable(),
})
export type TaskAutomationDecision = z.infer<typeof TaskAutomationDecision>

export const TaskAutomationSummary = z.object({
  taskId: Id,
  retryCount: z.number().int().nonnegative(),
  lastVerifyExitCode: z.number().int().nullable(),
  lastPolicyVersion: z.string().min(1).nullable(),
  autoDecisions: z.array(TaskAutomationDecision),
})
export type TaskAutomationSummary = z.infer<typeof TaskAutomationSummary>
