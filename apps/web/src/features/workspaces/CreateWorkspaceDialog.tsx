import { Button } from '@heroui/react/button'
import { Input } from '@heroui/react/input'
import { Modal } from '@heroui/react/modal'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { createWorkspace, ApiError } from '../../lib/api'
import { queryKeys } from '../../lib/query'
import { WorkspaceDirectoryPicker } from './WorkspaceDirectoryPicker'

interface CreateWorkspaceDialogProps {
  onCreated: (workspaceId: string) => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
  mobile?: boolean
}

export function CreateWorkspaceDialog({
  onCreated,
  open: controlledOpen,
  onOpenChange,
  mobile = false,
}: CreateWorkspaceDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = onOpenChange ?? setInternalOpen
  const [name, setName] = useState('')
  const [relPath, setRelPath] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const queryClient = useQueryClient()
  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) setPickerOpen(false)
  }

  const mutation = useMutation({
    mutationFn: () => createWorkspace({ name, relPath }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.workspaces })
      setOpen(false)
      setName('')
      setRelPath('')
      setError(null)
      setPickerOpen(false)
      onCreated(result.workspace.id)
    },
    onError: (cause) => {
      if (cause instanceof ApiError && cause.code === 'invalid_path') {
        setError('路径不存在或不在工作区根目录内')
        return
      }
      if (cause instanceof ApiError && cause.code === 'conflict') {
        setError('同名工作区已存在')
        return
      }
      setError(cause instanceof Error ? cause.message : '创建失败')
    },
  })

  return (
    <Modal isOpen={open} onOpenChange={handleOpenChange}>
      {controlledOpen === undefined ? <Button variant="secondary">新建工作区</Button> : null}
      <Modal.Backdrop>
        <Modal.Container>
          <Modal.Dialog className={mobile ? 'h-dvh w-screen max-w-none rounded-none' : undefined}>
            <Modal.Header>
              <Modal.Heading>新建工作区</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <div className="flex flex-col gap-3">
                <Input
                  aria-label="工作区名称"
                  placeholder="名称，如 baton"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  fullWidth
                />
                <div className="flex flex-col gap-2">
                  <span className="text-sm font-medium text-foreground">工作区目录</span>
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1 rounded-lg border border-separator bg-surface-secondary px-3 py-2 text-sm">
                      {relPath ? (
                        <span className="block truncate text-foreground">{relPath}</span>
                      ) : (
                        <span className="text-muted">尚未选择目录</span>
                      )}
                    </div>
                    <Button
                      variant="secondary"
                      onPress={() => setPickerOpen((current) => !current)}
                    >
                      {pickerOpen ? '收起' : '选择目录'}
                    </Button>
                  </div>
                  {pickerOpen ? (
                    <WorkspaceDirectoryPicker
                      onSelect={(entry) => {
                        setRelPath(entry.relPath)
                        if (!name.trim()) setName(entry.name)
                        setPickerOpen(false)
                      }}
                    />
                  ) : null}
                </div>
                {error ? (
                  <p role="alert" className="text-sm text-danger">
                    {error}
                  </p>
                ) : null}
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" onPress={() => handleOpenChange(false)}>
                取消
              </Button>
              <Button
                variant="primary"
                isDisabled={mutation.isPending || !name.trim() || !relPath.trim()}
                onPress={() => mutation.mutate()}
              >
                创建
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  )
}
