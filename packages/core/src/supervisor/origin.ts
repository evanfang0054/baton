import type { Actor, Strength, TaskAction, TaskOrigin } from '@baton/protocol'
import { buildMandate, DEFAULT_TASK_ACTIONS } from './mandate.js'

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
  strength?: Strength
  allowedActions?: TaskAction[]
  reviewOfTaskId?: string
  reviewOfReviewId?: string
  templateId?: TaskOrigin['templateId']
  acceptanceSeed?: TaskOrigin['acceptanceSeed']
}

/** actor/source 由 host 注入；调用方不能从 LLM 参数里拼出来。 */
export function buildTaskOrigin(input: BuildTaskOriginInput): TaskOrigin {
  const {
    actorKind = 'human',
    strength = 'explicit',
    allowedActions = DEFAULT_TASK_ACTIONS,
    reviewOfTaskId,
    reviewOfReviewId,
    templateId,
    acceptanceSeed,
    ...origin
  } = input
  const mandate = buildMandate({
    strength,
    allowedActions,
    policyVersion: input.policyVersion,
    promptVersion: input.promptVersion,
  })
  return {
    ...origin,
    ...mandate,
    actor: { id: 'local-user', kind: actorKind, source: input.source },
    ...(reviewOfTaskId ? { reviewOfTaskId } : {}),
    ...(reviewOfReviewId ? { reviewOfReviewId } : {}),
    ...(templateId ? { templateId } : {}),
    ...(acceptanceSeed ? { acceptanceSeed } : {}),
  }
}
