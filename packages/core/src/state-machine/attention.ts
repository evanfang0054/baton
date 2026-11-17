import type { Attention, TaskStatus, WaitingReason } from '@baton/protocol'

export function attentionFor(status: TaskStatus, waitingReason: WaitingReason | null): Attention {
  if (status === 'waiting_input') {
    return waitingReason === 'approval' || waitingReason === null ? 'needs_approval' : 'needs_reply'
  }
  return status === 'review' ? 'needs_review' : 'none'
}
