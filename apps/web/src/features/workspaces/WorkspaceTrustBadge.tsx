import type { Workspace } from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { Chip } from '@heroui/react/chip'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { updateWorkspaceTrust } from '../../lib/api'
import { queryKeys } from '../../lib/query'

export function WorkspaceTrustBadge({
  workspace,
  onTrust,
  onRevoked,
}: {
  workspace: Workspace
  onTrust: () => void
  onRevoked?: () => void
}) {
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const revoke = useMutation({
    mutationFn: () => updateWorkspaceTrust(workspace.id, { trusted: false }),
    onSuccess: async () => {
      setConfirming(false)
      await queryClient.invalidateQueries({ queryKey: queryKeys.workspaces })
      onRevoked?.()
    },
  })

  if (!workspace.trusted) {
    return (
      <div className="flex items-center gap-2">
        <Chip size="sm" variant="soft" color="warning">
          未信任
        </Chip>
        <Button variant="secondary" onPress={onTrust}>
          信任工作区
        </Button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <Chip size="sm" variant="soft" color="success">
        已信任
      </Chip>
      {confirming ? (
        <>
          <span className="text-xs text-warning">确认撤销信任？</span>
          <Button
            variant="tertiary"
            isDisabled={revoke.isPending}
            onPress={() => setConfirming(false)}
          >
            返回
          </Button>
          <Button variant="danger" isDisabled={revoke.isPending} onPress={() => revoke.mutate()}>
            确认撤销
          </Button>
        </>
      ) : (
        <Button
          variant="ghost"
          isDisabled={revoke.isPending}
          aria-label="撤销信任"
          onPress={() => setConfirming(true)}
        >
          撤销
        </Button>
      )}
    </div>
  )
}
