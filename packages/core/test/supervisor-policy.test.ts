import { describe, expect, it } from 'vitest'
import { buildTaskOrigin } from '../src/supervisor/origin.js'
import { SUPERVISOR_POLICY, supervisorPolicyVersion } from '../src/supervisor/policy.js'

describe('supervisor policy', () => {
  it('locks the v0 tool whitelist and explicit mode', () => {
    expect(SUPERVISOR_POLICY.mode).toBe('explicit')
    expect(SUPERVISOR_POLICY.allowedTools).toEqual(['list_tasks', 'get_task', 'create_task'])
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
})
