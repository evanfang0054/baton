import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { ConnectionStatus } from './features/shared/ConnectionStatus'
import { CreateWorkspaceDialog } from './features/workspaces/CreateWorkspaceDialog'
import { WorkspaceSwitcher } from './features/workspaces/WorkspaceSwitcher'
import { listWorkspaces } from './lib/api'
import { queryKeys } from './lib/query'
import { readUrlState, writeUrlState } from './lib/url'
import { createWsClient } from './lib/ws'
import { useAppStore } from './stores/app'

export function App() {
  const activeWorkspaceId = useAppStore((state) => state.activeWorkspaceId)
  const setWorkspace = useAppStore((state) => state.setWorkspace)
  const setWsStatus = useAppStore((state) => state.setWsStatus)
  const queryClient = useQueryClient()
  const workspaces = useQuery({ queryKey: queryKeys.workspaces, queryFn: listWorkspaces })

  useEffect(() => {
    if (activeWorkspaceId) return
    const url = readUrlState()
    if (url.workspaceId) {
      setWorkspace(url.workspaceId)
    } else if (workspaces.data?.[0]) {
      setWorkspace(workspaces.data[0].id)
    }
  }, [activeWorkspaceId, setWorkspace, workspaces.data])

  useEffect(() => {
    if (activeWorkspaceId) writeUrlState({ workspaceId: activeWorkspaceId })
  }, [activeWorkspaceId])

  useEffect(() => {
    if (!activeWorkspaceId) {
      setWsStatus('offline')
      return
    }
    const client = createWsClient({
      onStatus: setWsStatus,
      onEvent: () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.tasks(activeWorkspaceId) })
        void queryClient.invalidateQueries({ queryKey: ['task'] })
      },
    })
    return () => client.close()
  }, [activeWorkspaceId, queryClient, setWsStatus])

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-separator px-4">
        <span className="text-sm font-semibold">baton</span>
        <WorkspaceSwitcher
          workspaces={workspaces.data ?? []}
          activeWorkspaceId={activeWorkspaceId}
          onSelect={(id) => {
            setWorkspace(id)
            writeUrlState({ workspaceId: id, taskId: null })
          }}
        />
        <ConnectionStatus />
        <div className="ml-auto flex items-center gap-2">
          <CreateWorkspaceDialog
            onCreated={(id) => {
              setWorkspace(id)
              writeUrlState({ workspaceId: id, taskId: null })
            }}
          />
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside
          data-testid="board-rail"
          className="flex w-16 shrink-0 flex-col items-center gap-3 border-r border-separator py-3"
        >
          <span className="text-[10px] text-muted">任务</span>
        </aside>
        <main className="relative min-w-0 flex-1">
          <section
            data-testid="canvas"
            className="flex h-full items-center justify-center bg-background text-sm text-muted"
          >
            画布将在 Plan 4 接入
          </section>
        </main>
        <aside
          data-testid="task-detail"
          className="w-[380px] shrink-0 border-l border-separator bg-surface p-4"
        >
          <p className="text-sm text-muted">
            {activeWorkspaceId ? '选择一个任务' : '尚未选择工作区'}
          </p>
        </aside>
      </div>
    </div>
  )
}
