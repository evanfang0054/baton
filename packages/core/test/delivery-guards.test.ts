import { describe, expect, it } from 'vitest'
import {
  resolveAnnotationsOnApprove,
  validateAnnotationTargets,
} from '../src/annotation/resolve.js'
import { artifactPath } from '../src/artifact/path.js'
import { canCancelDelivery, canEnqueueDelivery } from '../src/delivery/guards.js'

describe('artifactPath', () => {
  it('builds a safe workspace-relative path', () => {
    expect(artifactPath({ deliveryId: 'd1', stageKey: 'design', name: 'spec.md' })).toBe(
      '.baton/deliveries/d1/design/spec.md',
    )
  })

  it('rejects traversal and unsafe names', () => {
    expect(artifactPath({ deliveryId: '../d1', stageKey: 'design', name: 'spec.md' })).toBeNull()
    expect(artifactPath({ deliveryId: 'd1', stageKey: 'Design', name: 'spec.md' })).toBeNull()
    expect(artifactPath({ deliveryId: 'd1', stageKey: 'design', name: '../spec.md' })).toBeNull()
  })
})

describe('delivery guards', () => {
  it('enqueues only the current todo stage', () => {
    expect(
      canEnqueueDelivery({
        cancelledAt: null,
        stages: [
          { key: 'requirement', taskStatus: 'done' },
          { key: 'design', taskStatus: 'todo' },
        ],
      }),
    ).toEqual({ ok: true, stageKey: 'design' })
    expect(
      canEnqueueDelivery({
        cancelledAt: null,
        stages: [{ key: 'requirement', taskStatus: 'running' }],
      }),
    ).toEqual({ ok: false, reason: 'not_todo' })
  })

  it('does not cancel a cancelled or completed delivery', () => {
    expect(canCancelDelivery({ cancelledAt: 1, statuses: ['done'] })).toEqual({
      ok: false,
      reason: 'cancelled',
    })
    expect(canCancelDelivery({ cancelledAt: null, statuses: ['done', 'done'] })).toEqual({
      ok: false,
      reason: 'done',
    })
    expect(canCancelDelivery({ cancelledAt: null, statuses: ['running', 'todo'] })).toEqual({
      ok: true,
    })
  })
})

describe('annotation resolution', () => {
  const annotations = [
    { id: 'a1', status: 'open' as const, taskId: 't1' },
    { id: 'a2', status: 'open' as const, taskId: 't2' },
    { id: 'a3', status: 'resolved' as const, taskId: 't1' },
  ]

  it('validates node and artifact targets', () => {
    expect(
      validateAnnotationTargets({
        targetNodeIds: ['n1', 'n2'],
        targetArtifactId: 'a1',
        nodeIds: new Set(['n1']),
        artifactIds: new Set(['a1']),
      }),
    ).toEqual(['node_not_found:n2'])
  })

  it('resolves only open annotations for the approved task', () => {
    expect(resolveAnnotationsOnApprove(annotations, 't1')).toEqual(['a1'])
  })
})
