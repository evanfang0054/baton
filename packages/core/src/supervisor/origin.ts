import type { Actor, TaskOrigin } from '@baton/protocol'

export interface BuildTaskOriginInput {
  source: TaskOrigin['source']
  triggerId: string
  threadId: string
  workspaceId: string
  targetNodeId: string
  contextNodeIds: string[]
  policyVersion: string
  promptVersion: string
  createdAt: number
  /** 默认 human；验收员等系统派发的任务传 system。 */
  actorKind?: Actor['kind']
  reviewOfTaskId?: string
  reviewOfReviewId?: string
}

/** actor/source 由 host 注入；调用方不能从 LLM 参数里拼出来。 */
export function buildTaskOrigin(input: BuildTaskOriginInput): TaskOrigin {
  const { actorKind = 'human', reviewOfTaskId, reviewOfReviewId, ...origin } = input
  return {
    ...origin,
    actor: { id: 'local-user', kind: actorKind, source: input.source },
    ...(reviewOfTaskId ? { reviewOfTaskId } : {}),
    ...(reviewOfReviewId ? { reviewOfReviewId } : {}),
  }
}
