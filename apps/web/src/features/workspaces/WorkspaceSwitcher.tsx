import type { Workspace } from '@baton/protocol'

interface WorkspaceSwitcherProps {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  onSelect: (workspaceId: string | null) => void
}

export function WorkspaceSwitcher({
  workspaces,
  activeWorkspaceId,
  onSelect,
}: WorkspaceSwitcherProps) {
  return (
    <select
      aria-label="项目"
      value={activeWorkspaceId ?? ''}
      onChange={(event) => onSelect(event.target.value || null)}
      className="h-8 rounded-lg border border-separator bg-surface px-2 text-sm text-foreground"
    >
      {workspaces.length === 0 ? <option value="">选择项目</option> : null}
      {workspaces.map((workspace) => (
        <option key={workspace.id} value={workspace.id}>
          {workspace.name}
        </option>
      ))}
    </select>
  )
}
