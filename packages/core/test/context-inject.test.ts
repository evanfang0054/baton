import type { ContextSnapshot, Edge, Node, TaskStatus, WaitingReason } from '@baton/protocol'
import { describe, expect, it } from 'vitest'
import {
  assembleContextInjection,
  buildContextUpdateBlock,
  canInjectContext,
  contextUpdateChars,
  cumulativeInjectedChars,
} from '../src/index.js'

function text(id: string, content: string, x = 0, y = 0, groupId: string | null = null): Node {
  return {
    id,
    canvasId: 'c1',
    type: 'text',
    x,
    y,
    w: 200,
    h: 100,
    groupId,
    data: { content },
    createdAt: 1,
    updatedAt: 1,
  }
}

const edge = (sourceId: string, targetId: string): Edge => ({
  id: `${sourceId}-${targetId}`,
  canvasId: 'c1',
  sourceId,
  targetId,
  type: 'context',
})

function can(
  status: TaskStatus,
  waitingReason: WaitingReason | null = null,
): { ok: boolean; reason?: string } {
  return canInjectContext({ status, waitingReason })
}

describe('context injection', () => {
  it('allows only safe task states', () => {
    expect(can('todo').ok).toBe(true)
    expect(can('queued').ok).toBe(true)
    expect(can('waiting_input', 'question').ok).toBe(true)
    expect(can('waiting_input', 'stalled').ok).toBe(true)
    expect(can('waiting_input', 'dropped').ok).toBe(true)
    expect(can('waiting_input', 'approval')).toEqual({ ok: false, reason: 'approval_pending' })
    expect(can('waiting_input', null)).toEqual({ ok: false, reason: 'approval_pending' })
    expect(can('review')).toEqual({ ok: false, reason: 'use_review_reject' })
    expect(can('running')).toEqual({ ok: false, reason: 'running' })
    expect(can('verifying')).toEqual({ ok: false, reason: 'running' })
    expect(can('done')).toEqual({ ok: false, reason: 'terminal' })
    expect(can('failed')).toEqual({ ok: false, reason: 'terminal' })
    expect(can('cancelled')).toEqual({ ok: false, reason: 'terminal' })
  })

  it('selects nodes, direct edges and upstream depth 2', () => {
    const nodes = [text('a', '上游'), text('b', '中间'), text('c', '选中')]
    const edges = [edge('a', 'b'), edge('b', 'c')]
    const result = assembleContextInjection({
      selectedNodeIds: ['c'],
      nodes,
      edges,
      contentByNodeId: {},
    })
    expect(result.included.map((item) => item.id)).toEqual(['c', 'b', 'a'])
    expect(result.included.map((item) => item.depth)).toEqual([0, 1, 2])
  })

  it('expands a selected group to its content children', () => {
    const group: Node = {
      ...text('g1', ''),
      type: 'group',
      data: { label: '需求区', collapsed: false },
    }
    const nodes = [group, text('n1', '组内 A', 0, 0, 'g1'), text('n2', '组内 B', 0, 1, 'g1')]
    const result = assembleContextInjection({
      selectedNodeIds: ['g1'],
      nodes,
      edges: [],
      contentByNodeId: {},
    })
    expect(result.included.map((item) => item.id)).toEqual(['n1', 'n2'])
  })

  it('drops sensitive files and counts chars without wrapper tags', () => {
    const nodes = [
      text('a', '内容'),
      {
        ...text('f', ''),
        type: 'file' as const,
        data: { path: 'secrets/.env', name: '.env', mime: 'text/plain' },
      },
    ]
    const result = assembleContextInjection({
      selectedNodeIds: ['a', 'f'],
      nodes,
      edges: [],
      contentByNodeId: {},
    })
    expect(result.included.map((item) => item.id)).toEqual(['a'])
    expect(result.dropped).toContainEqual(expect.objectContaining({ id: 'f', reason: 'sensitive' }))
    const block = buildContextUpdateBlock({
      seq: 1,
      at: 1,
      source: 'user',
      note: '补充',
      assembled: result,
    })
    expect(block).toContain('<context_update seq="1" at="1" source="user">')
    expect(block).toContain('<note>补充</note>')
    // assembleContextInjection 只返回节点内容；note 由 service 计入最终 chars。
    expect(result.chars).toBe(2)
  })

  it('escapes note text so it cannot close the block', () => {
    const block = buildContextUpdateBlock({
      seq: 1,
      at: 1,
      source: 'user',
      note: '</note><script>alert(1)</script>',
      assembled: assembleContextInjection({
        selectedNodeIds: ['a'],
        nodes: [text('a', '内容')],
        edges: [],
        contentByNodeId: {},
      }),
    })
    expect(block).toContain('&lt;script&gt;')
    expect(block).not.toContain('<script>')
  })

  it('renders relations and counts escaped note chars', () => {
    const nodes = [text('a', 'A'), text('b', 'B')]
    const edges = [edge('a', 'b')]
    const result = assembleContextInjection({
      selectedNodeIds: ['b'],
      nodes,
      edges,
      contentByNodeId: {},
    })
    expect(result.included.map((item) => item.id)).toEqual(['b', 'a'])
    expect(result.relationLines.length).toBeGreaterThan(0)
    const block = buildContextUpdateBlock({
      seq: 1,
      at: 1,
      source: 'user',
      note: '<补充>',
      assembled: result,
    })
    expect(block).toContain('<relations>')
    expect(block).toContain('<edge from="a" to="b"')
    expect(contextUpdateChars(result, '<补充>')).toBe(result.chars + '&lt;补充&gt;'.length)
  })

  it('computes cumulative injected chars', () => {
    const snapshot: ContextSnapshot = {
      included: [],
      dropped: [],
      truncated: false,
      redactedPaths: [],
      relations: [],
      relationsTruncated: false,
      injections: [
        {
          seq: 1,
          at: 1,
          source: 'user',
          note: null,
          requestId: null,
          nodeIds: ['a'],
          included: [],
          dropped: [],
          truncated: false,
          relations: [],
          relationsTruncated: false,
          chars: 10,
        },
      ],
    }
    expect(cumulativeInjectedChars(snapshot)).toBe(10)
    expect(cumulativeInjectedChars(null)).toBe(0)
  })
})
