import { describe, expect, it } from 'vitest'
import {
  ArtifactNode,
  DeliveryDetail,
  DeliverySummary,
  DrawingNode,
  GroupNode,
  TaskCreateInput,
  TaskDetail,
} from '../src/index.js'

const stage = {
  key: 'design',
  label: '设计',
  ordinal: 2,
  gate: 'human' as const,
  status: 'waiting_person' as const,
  taskId: 't1',
  taskStatus: 'review' as const,
  attention: 'needs_review' as const,
  waitingSince: 10,
  artifactCount: 2,
  openAnnotationCount: 1,
  skillId: 'hi-fi-design',
  skillStatus: 'ok' as const,
}

describe('delivery entities', () => {
  it('parses a delivery summary', () => {
    const summary = DeliverySummary.parse({
      id: 'd1',
      workspaceId: 'w1',
      canvasId: 'c1',
      title: '优惠券领取页',
      goal: '做一个领取页',
      playbookId: 'standard-delivery',
      playbookVersion: 1,
      status: 'waiting_person',
      currentStageKey: 'design',
      stageProgress: { done: 1, total: 4 },
      attention: 'needs_review',
      waitingSince: 10,
      openAnnotationCount: 1,
      createdAt: 1,
      updatedAt: 2,
      cancelledAt: null,
    })
    expect(summary.currentStageKey).toBe('design')
  })

  it('parses a delivery detail with stages/artifacts/annotations', () => {
    const detail = DeliveryDetail.parse({
      id: 'd1',
      workspaceId: 'w1',
      canvasId: 'c1',
      title: '优惠券领取页',
      goal: '做一个领取页',
      playbookId: 'standard-delivery',
      playbookVersion: 1,
      status: 'waiting_person',
      currentStageKey: 'design',
      stageProgress: { done: 1, total: 4 },
      attention: 'needs_review',
      waitingSince: 10,
      openAnnotationCount: 1,
      createdAt: 1,
      updatedAt: 2,
      cancelledAt: null,
      playbook: {
        id: 'standard-delivery',
        version: 1,
        label: '标准交付',
        stages: [{ key: 'design', label: '设计', gate: 'human' }],
      },
      stages: [stage],
      artifacts: [],
      annotations: [],
    })
    expect(detail.stages[0]?.status).toBe('waiting_person')
  })
})

describe('node additions', () => {
  it('parses artifact and drawing nodes', () => {
    const base = {
      id: 'n1',
      canvasId: 'c1',
      x: 0,
      y: 0,
      w: 320,
      h: 200,
      groupId: null,
      createdAt: 1,
      updatedAt: 1,
    }
    expect(
      ArtifactNode.parse({
        ...base,
        type: 'artifact',
        data: {
          artifactId: 'a1',
          kind: 'spec',
          title: '需求 spec',
          path: '.baton/deliveries/d1/requirement/spec.md',
          status: 'ready',
        },
      }).data.title,
    ).toBe('需求 spec')
    expect(
      DrawingNode.parse({
        ...base,
        type: 'drawing',
        data: { artifactId: 'a2', title: '线框图', status: 'ready' },
      }).data.title,
    ).toBe('线框图')
    expect(
      GroupNode.parse({ ...base, type: 'group', data: { label: '② 设计', stageKey: 'design' } })
        .data.stageKey,
    ).toBe('design')
  })
})

describe('task additions', () => {
  it('parses delivery/stage fields and annotation ids', () => {
    const task = TaskDetail.parse({
      id: 't1',
      workspaceId: 'w1',
      nodeId: 'n1',
      title: '设计',
      prompt: 'p',
      status: 'review',
      waitingReason: null,
      engine: 'claude-sdk',
      workspaceMode: 'main',
      branch: null,
      worktreePath: null,
      verifyCommand: null,
      retryCount: 0,
      dangerouslySkipPermissions: false,
      budgetUsd: null,
      enqueuedAt: null,
      createdAt: 1,
      updatedAt: 1,
      context: null,
      origin: null,
      deliveryId: 'd1',
      stageKey: 'design',
      annotationIds: ['a1'],
    })
    expect(task.annotationIds).toEqual(['a1'])
  })

  it('accepts annotationIds on task create input', () => {
    const input = TaskCreateInput.parse({
      workspaceId: 'w1',
      nodeId: 'n1',
      title: '改设计',
      prompt: '按标注改',
      contextNodeIds: [],
      engine: 'claude-sdk',
      annotationIds: ['a1'],
    })
    expect(input.annotationIds).toEqual(['a1'])
  })
})
