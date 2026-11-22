import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TaskOriginCard } from './TaskOriginCard'

describe('TaskOriginCard', () => {
  it('shows mandate strength, allowed actions and version', () => {
    render(
      <TaskOriginCard
        invalid={false}
        origin={{
          source: 'supervisor-chat',
          triggerId: 't1',
          threadId: 'th1',
          actor: { id: 'local-user', kind: 'human', source: 'supervisor-chat' },
          workspaceId: 'w1',
          targetNodeId: 'a1',
          contextNodeIds: [],
          policyVersion: 'p1',
          promptVersion: 'v1',
          createdAt: 1,
          scope: 'task',
          strength: 'explicit',
          allowedActions: ['retry', 'enqueue'],
          mandateVersion: 'm12345678901',
        }}
      />,
    )
    expect(screen.getByText('明确授权')).toBeVisible()
    expect(screen.getByText('retry、enqueue')).toBeVisible()
    expect(screen.getByText('m12345678901')).toBeVisible()
  })
})
