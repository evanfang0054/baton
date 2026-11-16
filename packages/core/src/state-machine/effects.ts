import type { DiffStat, TaskStatus } from '@baton/protocol'
import type { TaskEffect } from './types.js'

export const effects = {
  emitTaskStatus: (status: TaskStatus): TaskEffect => ({ type: 'emitTaskStatus', status }),
  enqueueTask: (): TaskEffect => ({ type: 'enqueueTask' }),
  startSession: (): TaskEffect => ({ type: 'startSession' }),
  requestApproval: (approvalId: string): TaskEffect => ({ type: 'requestApproval', approvalId }),
  resolveApproval: (approvalId: string, decision: 'allow' | 'deny', note?: string): TaskEffect => ({
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
  persistReviewVerdict: (reviewId: string, verdict: 'approved' | 'rejected'): TaskEffect => ({
    type: 'persistReviewVerdict',
    reviewId,
    verdict,
  }),
  appendFeedback: (feedback: string): TaskEffect => ({ type: 'appendFeedback', feedback }),
  incrementRetry: (): TaskEffect => ({ type: 'incrementRetry' }),
  interruptSession: (reason?: string): TaskEffect => ({
    type: 'interruptSession',
    ...(reason ? { reason } : {}),
  }),
}
