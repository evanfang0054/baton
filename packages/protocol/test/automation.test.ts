import { describe, expect, it } from 'vitest'
import {
  AuditListQuery,
  AutomationPolicyPatch,
  AutomationSummary,
  DigestReport,
  Notice,
  NoticeEvent,
  NoticeListQuery,
  PolicySchema,
  ServerMessage,
  TaskAutomationSummary,
} from '../src/index.js'

describe('automation protocol', () => {
  it('parses notice with nullable workspaceId', () => {
    const notice = Notice.parse({ id: 'n1', ts: 1, kind: 'digest', payload: {}, readAt: null })
    expect(notice.workspaceId).toBeNull()
  })

  it('accepts only the three editable policy fields', () => {
    expect(
      AutomationPolicyPatch.safeParse({
        autopilot: { enabled: true, retryMax: 3 },
        approval: { autoApproveMaxRisk: 'low' },
      }).success,
    ).toBe(true)
    expect(
      AutomationPolicyPatch.safeParse({ autopilot: { enabled: true, extra: 1 } }).success,
    ).toBe(false)
    expect(
      AutomationPolicyPatch.safeParse({ approval: { autoApproveMaxRisk: 'high' } }).success,
    ).toBe(false)
    expect(
      AutomationPolicyPatch.safeParse({ approval: { allow: ['Bash:rm -rf *'] } }).success,
    ).toBe(false)
    expect(AutomationPolicyPatch.safeParse({ verify: { command: 'pnpm test' } }).success).toBe(
      false,
    )
  })

  it('coerces query strings and constrains audit prefixes', () => {
    expect(NoticeListQuery.parse({ before: '123', limit: '10' })).toEqual({
      before: 123,
      limit: 10,
    })
    expect(AuditListQuery.safeParse({ actionPrefix: 'automation.' }).success).toBe(true)
    expect(AuditListQuery.safeParse({ actionPrefix: 'approval.auto_allow' }).success).toBe(true)
    expect(AuditListQuery.safeParse({ actionPrefix: 'Automation' }).success).toBe(false)
    expect(AuditListQuery.safeParse({ actionPrefix: 'a/b' }).success).toBe(false)
    expect(AuditListQuery.parse({ before: '9' }).before).toBe(9)
  })

  it('parses notice event through ServerMessage', () => {
    const event = ServerMessage.parse({
      v: 1,
      ts: 1,
      seq: 1,
      type: 'notice',
      payload: {
        id: 'n1',
        workspaceId: 'w1',
        ts: 1,
        kind: 'digest',
        payload: { ready: 1 },
        readAt: null,
      },
    })
    expect(event.type).toBe('notice')
    expect(NoticeEvent.safeParse(event).success).toBe(true)
  })

  it('requires digest snapshot fields', () => {
    const parsed = DigestReport.safeParse({
      workspaceId: 'w1',
      windowStart: 0,
      windowEnd: 1,
      generatedAt: 1,
      policyVersion: 'abc123abc123',
      snapshot: {
        total: 0,
        unplanned: 0,
        todo: 0,
        running: 0,
        waiting: 0,
        review: 0,
        done: 0,
        closed: 0,
        attention: { needsApproval: 0, needsReply: 0, needsAttention: 0, needsReview: 0 },
      },
      ready: [],
      blocked: [],
      dropped: [],
      changes: {
        created: 0,
        updated: 0,
        completed: 0,
        failed: 0,
        cancelled: 0,
        retried: 0,
        autoAllowed: 0,
        autoDenied: 0,
      },
      oldestWaiting: null,
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects oversized digest lists and parses summaries', () => {
    const ref = {
      id: 't1',
      title: '任务',
      status: 'review' as const,
      attention: 'needs_review' as const,
      waitingSince: 1,
      retryCount: 0,
    }
    const report = {
      workspaceId: 'w1',
      windowStart: 0,
      windowEnd: 1,
      generatedAt: 1,
      policyVersion: 'abc123abc123',
      snapshot: {
        total: 0,
        unplanned: 0,
        todo: 0,
        running: 0,
        waiting: 0,
        review: 0,
        done: 0,
        closed: 0,
        attention: { needsApproval: 0, needsReply: 0, needsAttention: 0, needsReview: 0 },
      },
      ready: Array.from({ length: 21 }, (_, index) => ({ ...ref, id: `t${index}` })),
      blocked: [],
      dropped: [],
      changes: {
        created: 0,
        updated: 0,
        completed: 0,
        failed: 0,
        cancelled: 0,
        retried: 0,
        autoAllowed: 0,
        autoDenied: 0,
      },
      oldestWaiting: null,
    }
    expect(DigestReport.safeParse(report).success).toBe(false)

    expect(
      AutomationSummary.parse({
        workspaceId: 'w1',
        trusted: true,
        policy: PolicySchema.parse({}),
        policyVersion: 'abc123abc123',
        killSwitch: false,
        killSwitchForced: false,
      }),
    ).toMatchObject({ digestCronUnsupported: false })

    expect(
      TaskAutomationSummary.parse({
        taskId: 't1',
        retryCount: 1,
        lastVerifyExitCode: 1,
        lastPolicyVersion: null,
        autoDecisions: [],
      }),
    ).toMatchObject({ retryCount: 1 })
  })
})
