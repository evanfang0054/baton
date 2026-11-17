import { Button } from '@heroui/react/button'
import { Input } from '@heroui/react/input'
import { Modal } from '@heroui/react/modal'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { createWorkspace } from '../../lib/api'
import { queryKeys } from '../../lib/query'

interface CreateWorkspaceDialogProps {
  onCreated: (workspaceId: string) => void
}

export function CreateWorkspaceDialog({ onCreated }: CreateWorkspaceDialogProps) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [relPath, setRelPath] = useState('')
  const [error, setError] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: () => createWorkspace({ name, relPath }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.workspaces })
      setOpen(false)
      setName('')
      setRelPath('')
      setError(null)
      onCreated(result.workspace.id)
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : '创建失败'),
  })

  return (
    <Modal isOpen={open} onOpenChange={setOpen}>
      <Button variant="secondary">新建工作区</Button>
      <Modal.Backdrop>
        <Modal.Container>
          <Modal.Dialog>
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
                <Input
                  aria-label="工作区相对路径"
                  placeholder="相对路径，如 baton"
                  value={relPath}
                  onChange={(event) => setRelPath(event.target.value)}
                  fullWidth
                />
                {error ? (
                  <p role="alert" className="text-sm text-danger">
                    {error}
                  </p>
                ) : null}
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" onPress={() => setOpen(false)}>
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
