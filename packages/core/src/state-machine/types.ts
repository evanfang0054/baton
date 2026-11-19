import type {
  AppError,
  ApprovalDecision,
  DiffStat,
  ReviewVerdict,
  TaskStatus,
  TaskStatusCause,
  WaitingReason,
} from '@baton/protocol'

export interface TransitionContext {
  readonly status: TaskStatus
  readonly retryCount: number
  readonly runningCount: number
  readonly maxConcurrency: number
  readonly autopilot: { readonly enabled: boolean; readonly retryMax: number }
  readonly workspaceTrusted: boolean
  readonly killSwitch: boolean
  readonly waitingReason: WaitingReason | null
}

export type TaskEffect =
  | { type: 'emitTaskStatus'; status: TaskStatus; cause?: TaskStatusCause }
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
  | { type: 'appendReopenNote'; note: string }
  | { type: 'incrementRetry' }
  | { type: 'interruptSession'; reason?: string }
  | { type: 'sendToSession'; text: string }
  | { type: 'appendUserReply'; text: string }

export type TransitionResult =
  | {
      ok: true
      status: TaskStatus
      retryCount: number
      waitingReason: WaitingReason | null
      effects: TaskEffect[]
    }
  | { ok: false; error: AppError }
