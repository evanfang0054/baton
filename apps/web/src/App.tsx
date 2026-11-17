import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { ConnectionStatus } from './features/shared/ConnectionStatus'
import { CanvasPanel } from './features/canvas/CanvasPanel'
import { BoardRail } from './features/tasks/BoardRail'
import { TaskBoard } from './features/tasks/TaskBoard'
import { TaskDetailPanel } from './features/tasks/TaskDetailPanel'
import { CreateWorkspaceDialog } from './features/workspaces/CreateWorkspaceDialog'
import { WorkspaceSwitcher } from './features/workspaces/WorkspaceSwitcher'
import { getCanvas, listTasks, listWorkspaces } from './lib/api'
import { queryKeys } from './lib/query'
import { readUrlState, writeUrlState } from './lib/url'
import { createWsClient } from './lib/ws'
import { useAppStore } from './stores/app'

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  )
}

export function App() {
  const activeWorkspaceId = useAppStore((state) => state.activeWorkspaceId)
  const activeTaskId = useAppStore((state) => state.activeTaskId)
  const boardExpanded = useAppStore((state) => state.boardExpanded)
  const boardPinned = useAppStore((state) => state.boardPinned)
  const setWorkspace = useAppStore((state) => state.setWorkspace)
  const setTask = useAppStore((state) => state.setTask)
  const setBoardExpanded = useAppStore((state) => state.setBoardExpanded)
  const setBoardPinned = useAppStore((state) => state.setBoardPinned)
  const setWsStatus = useAppStore((state) => state.setWsStatus)
  const queryClient = useQueryClient()

  const workspaces = useQuery({ queryKey: queryKeys.workspaces, queryFn: listWorkspaces })
  const tasks = useQuery({
    queryKey: queryKeys.tasks(activeWorkspaceId ?? ''),
    queryFn: () => listTasks(activeWorkspaceId!),
    enabled: Boolean(activeWorkspaceId),
  })
  const canvas = useQuery({
    queryKey: queryKeys.canvas(activeWorkspaceId ?? ''),
    queryFn: () => getCanvas(activeWorkspaceId!),
    enabled: Boolean(activeWorkspaceId),
  })
  const counts = useMemo(() => {
    const list = tasks.data ?? []
    return {
      needs_approval: list.filter((task) => task.attention === 'needs_approval').length,
      needs_reply: list.filter((task) => task.attention === 'needs_reply').length,
      needs_review: list.filter((task) => task.attention === 'needs_review').length,
    }
  }, [tasks.data])

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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'b' && !isEditableTarget(event.target)) {
        setBoardExpanded(!useAppStore.getState().boardExpanded)
      }
      if (event.key === 'Escape') setBoardExpanded(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [setBoardExpanded])

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
        <BoardRail
          counts={counts}
          expanded={boardExpanded}
          onToggle={() => setBoardExpanded(!boardExpanded)}
          pinned={boardPinned}
          onTogglePin={() => setBoardPinned(!boardPinned)}
        />
        <TaskBoard
          tasks={tasks.data ?? []}
          agentNodes={canvas.data?.nodes ?? []}
          selectedTaskId={activeTaskId}
          expanded={boardExpanded}
          pinned={boardPinned}
          onSelectTask={(id) => {
            setTask(id)
            setBoardExpanded(false)
            writeUrlState({ workspaceId: activeWorkspaceId, taskId: id })
          }}
          onClose={() => setBoardExpanded(false)}
        />
        <main className="relative min-w-0 flex-1">
          <CanvasPanel />
        </main>
        <TaskDetailPanel />
      </div>
    </div>
  )
}
