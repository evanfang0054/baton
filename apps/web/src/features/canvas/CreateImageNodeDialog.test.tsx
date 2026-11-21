import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { uploadWorkspaceFile } from '../../lib/api'
import { CreateImageNodeDialog } from './CreateImageNodeDialog'

vi.mock('../../lib/api', () => ({ uploadWorkspaceFile: vi.fn() }))

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

  it('ignores an upload that resolves after the dialog is reopened', async () => {
    let resolveUpload!: (value: {
      name: string
      path: string
      mime: string | null
      size: number
    }) => void
    vi.mocked(uploadWorkspaceFile).mockReturnValue(
      new Promise((resolve) => {
        resolveUpload = resolve
      }),
    )
    const view = (open: boolean) => (
      <CreateImageNodeDialog
        open={open}
        onOpenChange={() => {}}
        onCreate={() => {}}
        workspaceId="w1"
      />
    )
    const { rerender } = render(view(true))
    await userEvent.upload(
      screen.getByLabelText('选择要上传的图片'),
      new File(['x'], 'a.png', { type: 'image/png' }),
    )
    await waitFor(() => expect(uploadWorkspaceFile).toHaveBeenCalled())

    rerender(view(false))
    rerender(view(true))
    await act(async () => {
      resolveUpload({ path: '.baton/uploads/old.png', name: 'old.png', mime: 'image/png', size: 1 })
    })
    expect(screen.queryByText('.baton/uploads/old.png')).not.toBeInTheDocument()
  })
})
