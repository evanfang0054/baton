import { describe, expect, it } from 'vitest'
import { PolicySchema } from '@baton/protocol'
import {
  canDelegatedAcceptance,
  effectiveAutopilot,
  evaluateApproval,
  transition,
  type TransitionContext,
} from '../src/index.js'

const policy = PolicySchema.parse({
  approval: { allow: ['Bash:pnpm test'], autoApproveMaxRisk: 'low' },
  autopilot: { enabled: true, retryMax: 2 },
})
const request = {
  toolName: 'Bash',
  input: { command: 'pnpm test' },
  risk: 'low' as const,
}

describe('effective autopilot', () => {
  it.each([
    { enabled: true, trusted: true, killSwitch: false, expected: true },
    { enabled: false, trusted: true, killSwitch: false, expected: false },
    { enabled: true, trusted: false, killSwitch: false, expected: false },
    { enabled: true, trusted: true, killSwitch: true, expected: false },
    { enabled: true, trusted: false, killSwitch: true, expected: false },
  ])('enabled=$expected when policy=$enabled trusted=$trusted killSwitch=$killSwitch', (c) => {
    const effective = effectiveAutopilot(
      { ...policy, autopilot: { ...policy.autopilot, enabled: c.enabled } },
      { workspaceTrusted: c.trusted, killSwitch: c.killSwitch },
    )
    expect(effective.enabled).toBe(c.expected)
    expect(effective.retryMax).toBe(policy.autopilot.retryMax)
  })

  it('does not auto-approve in an untrusted workspace', () => {
    const decision = evaluateApproval(policy, request, {
      killSwitch: false,
      workspaceTrusted: false,
    })
    expect(decision.decision).toBe('ask')
    expect(decision.autoApproved).toBe(false)
  })

  it('only allows delegated acceptance when explicitly enabled and safe', () => {
    const acceptancePolicy = {
      ...policy,
      autopilot: { ...policy.autopilot, enabled: true, delegatedAcceptance: true },
    }
    expect(
      canDelegatedAcceptance(acceptancePolicy, { workspaceTrusted: true, killSwitch: false }),
    ).toBe(true)
    expect(
      canDelegatedAcceptance(acceptancePolicy, { workspaceTrusted: false, killSwitch: false }),
    ).toBe(false)
    expect(
      canDelegatedAcceptance(acceptancePolicy, { workspaceTrusted: true, killSwitch: true }),
    ).toBe(false)
    expect(
      canDelegatedAcceptance(
        { ...acceptancePolicy, autopilot: { ...acceptancePolicy.autopilot, enabled: false } },
        { workspaceTrusted: true, killSwitch: false },
      ),
    ).toBe(false)
    expect(
      canDelegatedAcceptance(
        {
          ...acceptancePolicy,
          autopilot: { ...acceptancePolicy.autopilot, delegatedAcceptance: false },
        },
        { workspaceTrusted: true, killSwitch: false },
      ),
    ).toBe(false)
  })

  it('never auto-approves high risk', () => {
    const decision = evaluateApproval(
      policy,
      { ...request, risk: 'high' },
      { killSwitch: false, workspaceTrusted: true },
    )
    expect(decision.decision).toBe('ask')
    expect(decision.autoApproved).toBe(false)
  })

  it('retries verify_fail only when trusted and kill switch is off', () => {
    const ctx: TransitionContext = {
      status: 'verifying',
      retryCount: 0,
      runningCount: 0,
      maxConcurrency: 1,
      autopilot: { enabled: true, retryMax: 2 },
      workspaceTrusted: true,
      killSwitch: false,
      waitingReason: null,
    }
    const event = {
      type: 'verify_fail' as const,
      reviewId: 'r1',
      exitCode: 1,
      output: 'fail',
      diffStat: { filesChanged: 1, insertions: 1, deletions: 0 },
    }
    expect(transition(ctx, event)).toMatchObject({ ok: true, status: 'queued' })
    expect(transition({ ...ctx, workspaceTrusted: false }, event)).toMatchObject({
      status: 'review',
    })
    expect(transition({ ...ctx, killSwitch: true }, event)).toMatchObject({ status: 'review' })
  })
})
