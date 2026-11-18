import type { Workspace } from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { Chip } from '@heroui/react/chip'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { updateWorkspaceTrust } from '../../lib/api'
import { queryKeys } from '../../lib/query'

export function WorkspaceTrustBadge({
  workspace,
  onTrust,
}: {
  workspace: Workspace
  onTrust: () => void
}) {
  const queryClient = useQueryClient()
  const revoke = useMutation({
    mutationFn: () => updateWorkspaceTrust(workspace.id, { trusted: false }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.workspaces })
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
      <Button
        variant="ghost"
        isDisabled={revoke.isPending}
        aria-label="撤销信任"
        onPress={() => revoke.mutate()}
      >
        撤销
      </Button>
    </div>
  )
}
