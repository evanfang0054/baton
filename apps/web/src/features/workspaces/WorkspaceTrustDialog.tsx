import type { Workspace } from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { Modal } from '@heroui/react/modal'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { updateWorkspaceTrust } from '../../lib/api'
import { queryKeys } from '../../lib/query'

export function WorkspaceTrustDialog({
  workspace,
  open,
  onOpenChange,
}: {
  workspace: Workspace
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [hooks, setHooks] = useState(workspace.projectHooks === 'on')

  useEffect(() => {
    setHooks(workspace.projectHooks === 'on')
  }, [workspace.id, workspace.projectHooks, open])

  const mutation = useMutation({
    mutationFn: () =>
      updateWorkspaceTrust(workspace.id, {
        trusted: true,
        projectHooks: hooks ? 'on' : 'off',
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.workspaces })
      await queryClient.invalidateQueries({ queryKey: queryKeys.automation(workspace.id) })
      onOpenChange(false)
    },
  })

  return (
    <Modal isOpen={open} onOpenChange={onOpenChange}>
      <Modal.Backdrop>
        <Modal.Container>
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>信任此工作区？</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <div className="flex flex-col gap-3 text-sm text-foreground">
                <p>
                  信任后，baton 会加载当前工作区的 <code>CLAUDE.md</code>、项目 skills、
                  <code>.mcp.json</code> 以及项目 settings 中启用的 plugins。
                </p>
                <p className="text-muted">来源：当前 workspace 目录。撤销信任只影响新会话。</p>
                <label className="flex items-start gap-2 rounded-lg border border-separator p-3">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 accent-accent"
                    checked={hooks}
                    onChange={(event) => setHooks(event.target.checked)}
                  />
                  <span>
                    允许项目 hooks（默认关闭）
                    <span className="mt-1 block text-xs text-warning">
                      开启后，项目 hooks 可能在 baton 审批之前放行工具，审批卡不再是最终闸门。
                    </span>
                  </span>
                </label>
                {mutation.error ? (
                  <p role="alert" className="text-sm text-danger">
                    {mutation.error instanceof Error ? mutation.error.message : '信任失败'}
                  </p>
                ) : null}
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" onPress={() => onOpenChange(false)}>
                取消
              </Button>
              <Button
                variant="primary"
                isDisabled={mutation.isPending}
                onPress={() => mutation.mutate()}
              >
                信任并加载
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  )
}
