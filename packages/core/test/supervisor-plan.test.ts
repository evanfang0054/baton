import type { SupervisorAction } from '@baton/protocol'
import { describe, expect, it } from 'vitest'
import { buildPlan, validatePlanApply } from '../src/supervisor/plan.js'

const source = { nodeIds: ['n1', 'n2'] }

const action: SupervisorAction = {
  id: 'a1',
  workspaceId: 'w1',
  threadId: 'th1',
  taskId: null,
  kind: 'triage_plan',
  status: 'proposed',
  strength: 'inferred',
  mode: 'observe',
  reason: '计划',
  payload: {
    triggerId: 'trigger-1',
    source: { nodeIds: [] },
    templateId: 'bugfix',
    contextDigest: [],
    items: [
      {
        title: '修复登录',
        templateId: 'bugfix',
        targetNodeId: 'missing',
        agentTitle: 'Agent 1',
        contextNodeIds: [],
        engine: null,
        budgetUsd: null,
      },
    ],
  },
  result: null,
  policyVersion: 'p1',
  mandateVersion: null,
  dedupeKey: 'plan:1',
  createdAt: 1,
  updatedAt: 1,
  expiresAt: 100,
  appliedAt: null,
  ignoredAt: null,
}

describe('buildPlan', () => {
  it('dedupes context, excludes source nodes and expires in 24h', () => {
    const built = buildPlan({
      triggerId: 'trigger-1',
      source,
      templateId: 'bugfix',
      items: [
        {
          title: '修复登录',
          templateId: 'bugfix',
          targetNodeId: null,
          agentTitle: 'Agent 1',
          contextNodeIds: ['n1', 'c1', 'c1'],
          engine: null,
          budgetUsd: null,
        },
      ],
      contextDigest: [],
      now: 1,
    })
    expect(built.payload.items[0]?.contextNodeIds).toEqual(['c1'])
    expect(built.payload.triggerId).toBe('trigger-1')
    expect(built.expiresAt).toBe(1 + 24 * 60 * 60 * 1000)
  })

  it('rejects empty, too many, or missing target plans', () => {
    expect(
      validatePlanApply({
        action: { ...action, payload: { items: [] } },
        now: 2,
        currentPolicyVersion: 'p1',
        targetExists: () => true,
      }),
    ).toMatchObject({ ok: false, code: 'plan_invalid' })
    expect(
      validatePlanApply({
        action: { ...action, expiresAt: 1 },
        now: 2,
        currentPolicyVersion: 'p1',
        targetExists: () => true,
      }),
    ).toMatchObject({ ok: false, code: 'plan_expired' })
    expect(
      validatePlanApply({
        action,
        now: 2,
        currentPolicyVersion: 'p2',
        targetExists: () => true,
      }),
    ).toMatchObject({ ok: false, code: 'action_not_applicable' })
    expect(
      validatePlanApply({
        action,
        now: 2,
        currentPolicyVersion: 'p1',
        targetExists: (id) => id !== 'missing',
      }),
    ).toMatchObject({ ok: false, code: 'action_not_applicable' })
  })
})
