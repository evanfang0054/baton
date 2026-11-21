import type {
  ApprovalDecision,
  ContextInjection,
  DiffStat,
  ReviewVerdict,
  TaskStatus,
  TaskStatusCause,
} from '@baton/protocol'
import type { TaskEffect } from './types.js'

export const effects = {
  emitTaskStatus: (status: TaskStatus, cause?: TaskStatusCause): TaskEffect => ({
    type: 'emitTaskStatus',
    status,
    ...(cause ? { cause } : {}),
  }),
  enqueueTask: (): TaskEffect => ({ type: 'enqueueTask' }),
  startSession: (): TaskEffect => ({ type: 'startSession' }),
  requestApproval: (approvalId: string): TaskEffect => ({ type: 'requestApproval', approvalId }),
  resolveApproval: (approvalId: string, decision: ApprovalDecision, note?: string): TaskEffect => ({
    type: 'resolveApproval',
    approvalId,
    decision,
    ...(note ? { note } : {}),
  }),
  runVerify: (): TaskEffect => ({ type: 'runVerify' }),
  persistVerifyResult: (
    reviewId: string,
    exitCode: number,
    output: string,
    diffStat: DiffStat,
  ): TaskEffect => ({ type: 'persistVerifyResult', reviewId, exitCode, output, diffStat }),
  persistReviewVerdict: (reviewId: string, verdict: ReviewVerdict): TaskEffect => ({
    type: 'persistReviewVerdict',
    reviewId,
    verdict,
  }),
  auditReviewOverride: (
    reviewId: string,
    verifyExitCode: number,
    reasonProvided: boolean,
  ): TaskEffect => ({ type: 'auditReviewOverride', reviewId, verifyExitCode, reasonProvided }),
  appendFeedback: (feedback: string): TaskEffect => ({ type: 'appendFeedback', feedback }),
  appendReopenNote: (note: string): TaskEffect => ({ type: 'appendReopenNote', note }),
  appendContextInjection: (injection: ContextInjection, block?: string): TaskEffect => ({
    type: 'appendContextInjection',
    injection,
    ...(block ? { block } : {}),
  }),
  incrementRetry: (): TaskEffect => ({ type: 'incrementRetry' }),
  interruptSession: (reason?: string): TaskEffect => ({
    type: 'interruptSession',
    ...(reason ? { reason } : {}),
  }),
  sendToSession: (text: string): TaskEffect => ({ type: 'sendToSession', text }),
  appendUserReply: (text: string): TaskEffect => ({ type: 'appendUserReply', text }),
}
