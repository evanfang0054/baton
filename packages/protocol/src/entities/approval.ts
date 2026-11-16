import { z } from 'zod'
import { Id, Timestamp } from '../common.js'
import { ApprovalDecision, RiskLevel } from '../enums.js'

export const ApprovalRequest = z.object({
  toolName: z.string().min(1),
  input: z.unknown(),
  risk: RiskLevel,
  reason: z.string().optional(),
})
export type ApprovalRequest = z.infer<typeof ApprovalRequest>

export const Approval = z.object({
  id: Id,
  sessionId: Id,
  request: ApprovalRequest,
  /** 待审批时为 null；用户或自动策略决定后写入 allow/deny。 */
  decision: ApprovalDecision.nullable(),
  /** 待审批时为 null；记录决定者（user/auto）。 */
  decidedBy: z.string().nullable(),
  decidedAt: Timestamp.nullable(),
})
export type Approval = z.infer<typeof Approval>
