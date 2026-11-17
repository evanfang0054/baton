import { Button } from '@heroui/react/button'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef } from 'react'
import { ConnectionStatus } from './features/shared/ConnectionStatus'
import { CanvasPanel, type CanvasPanelHandle } from './features/canvas/CanvasPanel'
import { NodePanel } from './features/canvas/NodePanel'
import { RealtimeProvider } from './features/realtime/RealtimeProvider'
import { BoardRail } from './features/tasks/BoardRail'
import { TaskBoard } from './features/tasks/TaskBoard'
import { TaskDetailPanel } from './features/tasks/TaskDetailPanel'
import { CreateWorkspaceDialog } from './features/workspaces/CreateWorkspaceDialog'
import { WorkspaceSwitcher } from './features/workspaces/WorkspaceSwitcher'
import { getCanvas, listTasks, listWorkspaces } from './lib/api'
import { queryKeys } from './lib/query'
import { readUrlState, writeUrlState } from './lib/url'
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
  const selectedNodeId = useAppStore((state) => state.selectedNodeId)
  const boardExpanded = useAppStore((state) => state.boardExpanded)
  const boardPinned = useAppStore((state) => state.boardPinned)
  const setWorkspace = useAppStore((state) => state.setWorkspace)
  const setTask = useAppStore((state) => state.setTask)
  const setSelectedNode = useAppStore((state) => state.setSelectedNode)
  const setBoardExpanded = useAppStore((state) => state.setBoardExpanded)
  const setBoardPinned = useAppStore((state) => state.setBoardPinned)
  const canvasRef = useRef<CanvasPanelHandle>(null)

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
      total: list.length,
    }
  }, [tasks.data])

  const selectedNode = canvas.data?.nodes.find((node) => node.id === selectedNodeId) ?? null
  const nodeTask = selectedNode && tasks.data?.find((task) => task.nodeId === selectedNode.id)

  useEffect(() => {
    if (activeWorkspaceId) return
    const url = readUrlState()
    if (url.workspaceId) {
      setWorkspace(url.workspaceId)
      if (url.taskId) setTask(url.taskId)
    } else if (workspaces.data?.[0]) {
      setWorkspace(workspaces.data[0].id)
    }
  }, [activeWorkspaceId, setTask, setWorkspace, workspaces.data])

  useEffect(() => {
    if (!activeWorkspaceId) return
    writeUrlState({
      workspaceId: activeWorkspaceId,
      taskId: useAppStore.getState().activeTaskId,
    })
  }, [activeWorkspaceId])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'b' && !isEditableTarget(event.target)) {
        const state = useAppStore.getState()
        if (state.boardPinned) {
          setBoardPinned(false)
          setBoardExpanded(false)
        } else {
          setBoardExpanded(!state.boardExpanded)
        }
      }
      if (event.key === 'Escape') {
        setBoardExpanded(false)
        setBoardPinned(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [setBoardExpanded, setBoardPinned])

  return (
    <RealtimeProvider workspaceId={activeWorkspaceId}>
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
            <Button
              variant="secondary"
              isDisabled={!canvas.data}
              onPress={() => canvasRef.current?.addNode('agent')}
            >
              新建 Agent 节点
            </Button>
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
            total={counts.total}
            expanded={boardExpanded}
            onToggle={() => {
              if (boardPinned) {
                setBoardPinned(false)
                setBoardExpanded(false)
              } else {
                setBoardExpanded(!boardExpanded)
              }
            }}
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
              setSelectedNode(null)
              setTask(id)
              setBoardExpanded(false)
              writeUrlState({ workspaceId: activeWorkspaceId, taskId: id })
            }}
            onClose={() => {
              setBoardExpanded(false)
              setBoardPinned(false)
            }}
          />
          <main className="relative min-w-0 flex-1">
            <CanvasPanel
              ref={canvasRef}
              canvas={canvas.data ?? null}
              tasks={tasks.data ?? []}
              selectedNodeId={selectedNodeId}
              onSelectNode={(id) => {
                setSelectedNode(id)
                if (id) setTask(null)
              }}
            />
          </main>
          {selectedNode && activeWorkspaceId ? (
            <NodePanel
              node={selectedNode}
              task={nodeTask ?? null}
              workspaceId={activeWorkspaceId}
              onOpenTask={(id) => {
                setSelectedNode(null)
                setTask(id)
                writeUrlState({ workspaceId: activeWorkspaceId, taskId: id })
              }}
              onDeleted={() => setSelectedNode(null)}
              onClose={() => setSelectedNode(null)}
            />
          ) : (
            <TaskDetailPanel />
          )}
        </div>
      </div>
    </RealtimeProvider>
  )
}
