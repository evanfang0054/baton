import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CreateImageNodeDialog } from './CreateImageNodeDialog'

describe('CreateImageNodeDialog', () => {
  it('rejects non-https external image url', async () => {
    render(
      <CreateImageNodeDialog open onOpenChange={() => {}} onCreate={() => {}} workspaceId="w1" />,
    )
    await userEvent.click(screen.getByRole('button', { name: '外链' }))
    await userEvent.type(screen.getByLabelText('图片 URL'), 'http://example.com/a.png')
    await userEvent.click(screen.getByRole('button', { name: '添加' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('只支持 https')
  })

  it('creates an external image with alt text', async () => {
    const onCreate = vi.fn()
    render(
      <CreateImageNodeDialog open onOpenChange={() => {}} onCreate={onCreate} workspaceId="w1" />,
    )
    await userEvent.click(screen.getByRole('button', { name: '外链' }))
    await userEvent.type(screen.getByLabelText('图片 URL'), 'https://example.com/a.png')
    await userEvent.type(screen.getByLabelText('图片描述'), '设计稿')
    await userEvent.click(screen.getByRole('button', { name: '添加' }))
    expect(onCreate).toHaveBeenCalledWith({
      src: 'https://example.com/a.png',
      alt: '设计稿',
    })
  })
})
