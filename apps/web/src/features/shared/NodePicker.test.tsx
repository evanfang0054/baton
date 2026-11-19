import type { Node } from '@baton/protocol'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { NodePicker } from './NodePicker'

function node(id: string, title: string, type: Node['type'] = 'text'): Node {
  const data =
    type === 'agent'
      ? { title, engine: 'fake', taskId: null }
      : type === 'file'
        ? { name: title, path: 'src/file.txt' }
        : type === 'text'
          ? { content: title }
          : { content: title }
  return {
    id,
    canvasId: 'c1',
    type,
    x: 0,
    y: 0,
    w: 320,
    h: 200,
    groupId: null,
    createdAt: 1,
    updatedAt: 1,
    data,
  } as Node
}

describe('NodePicker', () => {
  it('filters and selects one node', async () => {
    const onChange = vi.fn()
    render(
      <NodePicker
        open
        onOpenChange={() => {}}
        nodes={[node('n1', '需求'), node('n2', '接口', 'file')]}
        mode="single"
        value={[]}
        onChange={onChange}
        title="选择 Agent"
      />,
    )

    await userEvent.type(screen.getByLabelText('搜索节点'), '接口')
    expect(screen.queryByRole('button', { name: /需求/ })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /接口/ }))
    await userEvent.click(screen.getByRole('button', { name: '确定' }))
    expect(onChange).toHaveBeenCalledWith(['n2'])
  })

  it('selects multiple nodes', async () => {
    const onChange = vi.fn()
    render(
      <NodePicker
        open
        onOpenChange={() => {}}
        nodes={[node('n1', 'A'), node('n2', 'B')]}
        mode="multi"
        value={[]}
        onChange={onChange}
        title="选择上下文"
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /A/ }))
    await userEvent.click(screen.getByRole('button', { name: /B/ }))
    await userEvent.click(screen.getByRole('button', { name: '确定' }))
    expect(onChange).toHaveBeenCalledWith(['n1', 'n2'])
  })

  it('keeps the draft while the parent rerenders with a new value array', async () => {
    const { rerender } = render(
      <NodePicker
        open
        onOpenChange={() => {}}
        nodes={[node('n1', 'A'), node('n2', 'B')]}
        mode="multi"
        value={[]}
        onChange={() => {}}
        title="选择上下文"
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: /A/ }))
    rerender(
      <NodePicker
        open
        onOpenChange={() => {}}
        nodes={[node('n1', 'A'), node('n2', 'B')]}
        mode="multi"
        value={[]}
        onChange={() => {}}
        title="选择上下文"
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: '确定' }))

    expect(screen.getByRole('button', { name: /A/ })).toHaveAttribute('aria-pressed', 'true')
  })
})
