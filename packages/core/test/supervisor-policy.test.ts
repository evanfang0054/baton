import { describe, expect, it } from 'vitest'
import { buildTaskOrigin } from '../src/supervisor/origin.js'
import { SUPERVISOR_POLICY, supervisorPolicyVersion } from '../src/supervisor/policy.js'

describe('supervisor policy', () => {
  it('locks the tool whitelist and explicit mode', () => {
    expect(SUPERVISOR_POLICY.mode).toBe('explicit')
    expect(SUPERVISOR_POLICY.allowedTools).toEqual([
      'list_canvas',
      'list_tasks',
      'get_task',
      'get_task_history',
      'get_task_failure',
      'create_task',
      'create_tasks',
      'enqueue_task',
      'retry_task',
      'reopen_task',
      'cancel_task',
      'reply_task',
      'handoff_task',
      'create_text',
      'create_agent',
      'create_edge',
      'update_node',
      'inject_context',
    ])
    expect(supervisorPolicyVersion(SUPERVISOR_POLICY, 'v1')).toMatch(/^[a-f0-9]{12}$/)
  })

  it('changes the version when the prompt version changes', () => {
    expect(supervisorPolicyVersion(SUPERVISOR_POLICY, 'v1')).not.toBe(
      supervisorPolicyVersion(SUPERVISOR_POLICY, 'v2'),
    )
  })

  it('builds an immutable task origin from trusted host fields', () => {
    const origin = buildTaskOrigin({
      source: 'supervisor-chat',
      triggerId: 'r1',
      threadId: 'th1',
      workspaceId: 'w1',
      targetNodeId: 'a1',
      contextNodeIds: ['n1'],
      policyVersion: 'p1',
      promptVersion: 'v1',
      createdAt: 1,
    })
    expect(origin.actor).toEqual({
      id: 'local-user',
      kind: 'human',
      source: 'supervisor-chat',
    })
  })

  it('marks verifier tasks as system actors tied to the reviewed attempt', () => {
    const origin = buildTaskOrigin({
      source: 'supervisor-review',
      triggerId: 'r1',
      threadId: 'th1',
      workspaceId: 'w1',
      targetNodeId: 'a2',
      contextNodeIds: [],
      policyVersion: 'p1',
      promptVersion: 'v1',
      createdAt: 2,
      actorKind: 'system',
      reviewOfTaskId: 't1',
      reviewOfReviewId: 'rv1',
    })
    expect(origin.actor).toEqual({
      id: 'local-user',
      kind: 'system',
      source: 'supervisor-review',
    })
    expect(origin.reviewOfTaskId).toBe('t1')
    expect(origin.reviewOfReviewId).toBe('rv1')
  })
})
