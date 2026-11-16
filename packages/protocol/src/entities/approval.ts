import { z } from 'zod'
import { Id, Timestamp } from '../common.js'
import { ApprovalDecision } from '../enums.js'

export const ApprovalRequest = z.object({
  toolName: z.string().min(1),
  input: z.unknown(),
  risk: z.enum(['low', 'medium', 'high']),
  reason: z.string().optional(),
})
export type ApprovalRequest = z.infer<typeof ApprovalRequest>

export const Approval = z.object({
  id: Id,
  sessionId: Id,
  request: ApprovalRequest,
  decision: ApprovalDecision.nullable(),
  decidedBy: z.string().nullable(),
  decidedAt: Timestamp.nullable(),
})
export type Approval = z.infer<typeof Approval>
