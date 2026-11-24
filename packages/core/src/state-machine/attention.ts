import type { Attention, TaskStatus, WaitingReason } from '@baton/protocol'

export function attentionFor(status: TaskStatus, waitingReason: WaitingReason | null): Attention {
  if (status === 'waiting_input') {
    if (waitingReason === 'approval' || waitingReason === null) {
      return 'needs_approval'
    }
    return waitingReason === 'stalled' ? 'needs_attention' : 'needs_reply'
  }
  return status === 'review' ? 'needs_review' : 'none'
}

/** 用户能否直接回复等待中的会话；审批与旧数据必须走专用命令。 */
export function canAcceptUserInput(waitingReason: WaitingReason | null): boolean {
  return waitingReason !== null && waitingReason !== 'approval'
}
