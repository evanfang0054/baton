import { describe, expect, it } from 'vitest'
import { PolicySchema, type TaskOrigin } from '@baton/protocol'
import { buildMandate, DEFAULT_TASK_ACTIONS, validateMandate } from '../src/supervisor/mandate.js'

function origin(overrides: Partial<TaskOrigin> = {}): TaskOrigin {
  const mandate = buildMandate({
    strength: 'explicit',
    allowedActions: ['retry', 'reopen'],
    policyVersion: 'policy-1',
    promptVersion: 'prompt-1',
  })
  return {
    source: 'supervisor-chat',
    triggerId: 'trigger-1',
    threadId: 'thread-1',
    actor: { id: 'local-user', kind: 'human', source: 'supervisor-chat' },
    workspaceId: 'w1',
    targetNodeId: 'a1',
    contextNodeIds: [],
    createdAt: 1,
    ...mandate,
    ...overrides,
  }
}

const policy = PolicySchema.parse({})
const gate = {
  workspaceTrusted: true,
  killSwitch: false,
  autonomy: 'auto' as const,
  capability: 'auto' as const,
}

describe('validateMandate', () => {
  it('allows an explicit action listed in allowedActions', () => {
    expect(
      validateMandate({
        origin: origin(),
        requestedAction: 'retry',
        requestedStrength: 'explicit',
        currentPolicyVersion: 'policy-1',
        gate,
      }),
    ).toEqual({ ok: true })
  })

  it('rejects an action not in allowedActions without touching the task', () => {
    const result = validateMandate({
      origin: origin(),
      requestedAction: 'cancel',
      requestedStrength: 'explicit',
      currentPolicyVersion: 'policy-1',
      gate,
    })
    expect(result).toMatchObject({
      ok: false,
      code: 'mandate_revoked',
      detail: { reason: 'action_not_allowed' },
    })
  })

  it('rejects explicit retries after the policy changes', () => {
    expect(
      validateMandate({
        origin: origin(),
        requestedAction: 'retry',
        requestedStrength: 'explicit',
        currentPolicyVersion: 'policy-2',
        gate,
      }),
    ).toMatchObject({ ok: false, detail: { reason: 'policy_changed' } })
  })

  it('rejects inferred actions when policy changed or autonomy is not auto', () => {
    expect(
      validateMandate({
        origin: origin(),
        requestedAction: 'retry',
        requestedStrength: 'inferred',
        currentPolicyVersion: 'policy-2',
        gate,
      }),
    ).toMatchObject({ ok: false, detail: { reason: 'policy_changed' } })

    expect(
      validateMandate({
        origin: origin(),
        requestedAction: 'retry',
        requestedStrength: 'inferred',
        currentPolicyVersion: 'policy-1',
        gate: { ...gate, capability: 'observe' },
      }),
    ).toMatchObject({ ok: false, detail: { reason: 'autonomy_not_auto' } })
  })

  it('requires a mandate for inferred actions and tolerates legacy origin for explicit ones', () => {
    expect(
      validateMandate({
        origin: null,
        requestedAction: 'retry',
        requestedStrength: 'inferred',
        currentPolicyVersion: 'policy-1',
        gate,
      }),
    ).toMatchObject({ ok: false, detail: { reason: 'missing_mandate' } })

    expect(
      validateMandate({
        origin: null,
        requestedAction: 'retry',
        requestedStrength: 'explicit',
        currentPolicyVersion: 'policy-1',
        gate,
      }),
    ).toEqual({ ok: true })
  })

  it('accepts the default action set', () => {
    expect(DEFAULT_TASK_ACTIONS).toContain('enqueue')
    expect(DEFAULT_TASK_ACTIONS).toContain('apply_plan')
    expect(policy.autonomy.mode).toBe('observe')
  })
})
