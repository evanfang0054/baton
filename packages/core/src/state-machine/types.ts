import type {
  AppError,
  ApprovalDecision,
  DiffStat,
  ReviewVerdict,
  TaskStatus,
} from '@baton/protocol'

export interface TransitionContext {
  readonly status: TaskStatus
  readonly retryCount: number
  readonly runningCount: number
  readonly maxConcurrency: number
  readonly autopilot: { readonly enabled: boolean; readonly retryMax: number }
}

export type TaskEffect =
  | { type: 'emitTaskStatus'; status: TaskStatus }
  | { type: 'enqueueTask' }
  | { type: 'startSession' }
  | { type: 'requestApproval'; approvalId: string }
  | { type: 'resolveApproval'; approvalId: string; decision: ApprovalDecision; note?: string }
  | { type: 'runVerify' }
  | {
      type: 'persistVerifyResult'
      reviewId: string
      exitCode: number
      output: string
      diffStat: DiffStat
    }
  | { type: 'persistReviewVerdict'; reviewId: string; verdict: ReviewVerdict }
  | { type: 'appendFeedback'; feedback: string }
  | { type: 'incrementRetry' }
  | { type: 'interruptSession'; reason?: string }

export type TransitionResult =
  | { ok: true; status: TaskStatus; retryCount: number; effects: TaskEffect[] }
  | { ok: false; error: AppError }
