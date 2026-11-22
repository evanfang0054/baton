import { describe, expect, it } from 'vitest'
import { buildTaskContextDigest } from '../src/supervisor/context-digest.js'

describe('buildTaskContextDigest', () => {
  it('dedupes tasks, keeps max 5 and prefers higher-value sources', () => {
    const digest = buildTaskContextDigest({
      candidates: [
        { taskId: 't1', title: 'A', status: 'done', source: 'same_agent', failure: null },
        { taskId: 't1', title: 'A', status: 'done', source: 'title', failure: null },
        {
          taskId: 't2',
          title: 'B',
          status: 'failed',
          source: 'recent_failure',
          failure: 'run: exit 1',
        },
        { taskId: 't3', title: 'C', status: 'review', source: 'handoff', failure: null },
        { taskId: 't4', title: 'D', status: 'todo', source: 'context_node', failure: null },
        { taskId: 't5', title: 'E', status: 'todo', source: 'title', failure: null },
        { taskId: 't6', title: 'F', status: 'todo', source: 'same_agent', failure: null },
      ],
    })
    expect(digest).toHaveLength(5)
    expect(digest.map((item) => item.taskId)).toEqual(['t1', 't6', 't3', 't4', 't2'])
    expect(digest.find((item) => item.taskId === 't2')?.failure).toBe('run: exit 1')
  })
})
