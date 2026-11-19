import { Button } from '@heroui/react/button'
import { toast } from '@heroui/react/toast'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AutomationSettingsDialog } from './features/automation/AutomationSettingsDialog'
import { AutomationStatus } from './features/automation/AutomationStatus'
import { ConnectionStatus } from './features/shared/ConnectionStatus'
import { MobileNav } from './features/shared/MobileNav'
import { CanvasPanel, type CanvasPanelHandle } from './features/canvas/CanvasPanel'
import { NodePanel } from './features/canvas/NodePanel'
import { RealtimeProvider } from './features/realtime/RealtimeProvider'
import { RightPanel } from './features/right-panel/RightPanel'
import { DigestCard } from './features/supervisor/DigestCard'
import { SupervisorPanel } from './features/supervisor/SupervisorPanel'
import type { SupervisorTargetAgent } from './features/supervisor/supervisor-model'
import { BoardRail } from './features/tasks/BoardRail'
import { MobileBoardList } from './features/tasks/MobileBoardList'
import { MobileTaskDetail } from './features/tasks/MobileTaskDetail'
import { TaskBoard } from './features/tasks/TaskBoard'
import { TaskDetailPanel } from './features/tasks/TaskDetailPanel'
import { CreateWorkspaceDialog } from './features/workspaces/CreateWorkspaceDialog'
import { WorkspaceSwitcher } from './features/workspaces/WorkspaceSwitcher'
import { WorkspaceTrustBadge } from './features/workspaces/WorkspaceTrustBadge'
import { WorkspaceTrustDialog } from './features/workspaces/WorkspaceTrustDialog'
import {
  getAutomation,
  getCanvas,
  listNotices,
  listTasks,
  listWorkspaces,
  setKillSwitch,
  UnauthorizedError,
} from './lib/api'
import { queryKeys } from './lib/query'
import { readUrlState, writeUrlState } from './lib/url'
import { useViewport } from './lib/use-viewport'
import { useAppStore } from './stores/app'

const authBannerClass = [
  'flex shrink-0 items-center gap-2 border-b border-warning bg-warning/10',
  'px-4 py-2 text-sm text-warning',
].join(' ')

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
  const selectedNodeIds = useAppStore((state) => state.selectedNodeIds)
  const contextNodeIds = useAppStore((state) => state.contextNodeIds)
  const boardExpanded = useAppStore((state) => state.boardExpanded)
  const boardPinned = useAppStore((state) => state.boardPinned)
  const rightPanel = useAppStore((state) => state.rightPanel)
  const mobileTab = useAppStore((state) => state.mobileTab)
  const wsStatus = useAppStore((state) => state.wsStatus)
  const setWorkspace = useAppStore((state) => state.setWorkspace)
  const setTask = useAppStore((state) => state.setTask)
  const setSelectedNode = useAppStore((state) => state.setSelectedNode)
  const setSelection = useAppStore((state) => state.setSelection)
  const setBoardExpanded = useAppStore((state) => state.setBoardExpanded)
  const setBoardPinned = useAppStore((state) => state.setBoardPinned)
  const setRightPanel = useAppStore((state) => state.setRightPanel)
  const setMobileTab = useAppStore((state) => state.setMobileTab)
  const viewport = useViewport()
  const isMobile = viewport === 'mobile'
  const queryClient = useQueryClient()
  const canvasRef = useRef<CanvasPanelHandle>(null)
  const [trustDialogOpen, setTrustDialogOpen] = useState(false)
  const [trustPromptedFor, setTrustPromptedFor] = useState<string | null>(null)
  const [automationSettingsOpen, setAutomationSettingsOpen] = useState(false)

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
  const automation = useQuery({
    queryKey: queryKeys.automation(activeWorkspaceId ?? ''),
    queryFn: () => getAutomation(activeWorkspaceId!),
    enabled: Boolean(activeWorkspaceId),
  })
  const notices = useQuery({
    queryKey: queryKeys.notices(activeWorkspaceId ?? ''),
    queryFn: () => listNotices(activeWorkspaceId!, { kind: 'digest', limit: 5 }),
    enabled: Boolean(activeWorkspaceId),
  })
  const contextNodes = useMemo(
    () => (canvas.data?.nodes ?? []).filter((node) => contextNodeIds.includes(node.id)),
    [canvas.data?.nodes, contextNodeIds],
  )
  // 选中里恰好一个 Agent 时作为默认目标；纯 Agent 或多 Agent 交给总管追问。
  const targetAgent = useMemo<SupervisorTargetAgent | null>(() => {
    const nodes = (canvas.data?.nodes ?? []).filter((node) => selectedNodeIds.includes(node.id))
    const agents = nodes.filter((node) => node.type === 'agent')
    const agent = agents.length === 1 ? agents[0] : null
    if (!agent || agent.type !== 'agent') return null
    return { id: agent.id, title: agent.data.title }
  }, [canvas.data?.nodes, selectedNodeIds])
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
  const activeWorkspace =
    workspaces.data?.find((workspace) => workspace.id === activeWorkspaceId) ?? null
  const nodeTask = selectedNode && tasks.data?.find((task) => task.nodeId === selectedNode.id)
  const unauthorized =
    wsStatus === 'unauthorized' ||
    [workspaces.error, tasks.error, canvas.error].some(
      (error) => error instanceof UnauthorizedError,
    )

  useEffect(() => {
    if (activeWorkspaceId) return
    const url = readUrlState()
    if (url.workspaceId) {
      setWorkspace(url.workspaceId)
      if (url.taskId) {
        setTask(url.taskId)
        setRightPanel('task')
      }
    } else if (workspaces.data?.[0]) {
      setWorkspace(workspaces.data[0].id)
    }
  }, [activeWorkspaceId, setRightPanel, setTask, setWorkspace, workspaces.data])

  useEffect(() => {
    if (!activeWorkspaceId) return
    writeUrlState({
      workspaceId: activeWorkspaceId,
      taskId: activeTaskId,
    })
  }, [activeWorkspaceId, activeTaskId])

  useEffect(() => {
    if (!activeWorkspace || activeWorkspace.trusted) return
    if (trustPromptedFor === activeWorkspace.id) return
    setTrustPromptedFor(activeWorkspace.id)
    setTrustDialogOpen(true)
  }, [activeWorkspace, trustPromptedFor])

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

  const pauseAutomation = async () => {
    try {
      await setKillSwitch(true)
      // kill switch 是全局开关，所有工作区的自动化摘要都可能变化。
      await queryClient.invalidateQueries({ queryKey: ['automation'] })
      toast.success('自动化已暂停')
    } catch (cause) {
      toast.danger(cause instanceof Error ? cause.message : '暂停自动化失败')
    }
  }

  return (
    <RealtimeProvider workspaceId={activeWorkspaceId}>
      <div
        className="flex h-screen flex-col bg-background text-foreground"
        data-viewport={viewport}
      >
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
          {activeWorkspaceId ? <ConnectionStatus /> : null}
          {activeWorkspace ? (
            <>
              {!isMobile ? (
                <WorkspaceTrustBadge
                  workspace={activeWorkspace}
                  onTrust={() => setTrustDialogOpen(true)}
                  onRevoked={() => setTrustPromptedFor(activeWorkspace.id)}
                />
              ) : null}
              <WorkspaceTrustDialog
                key={activeWorkspace.id}
                workspace={activeWorkspace}
                open={trustDialogOpen}
                onOpenChange={setTrustDialogOpen}
              />
            </>
          ) : null}
          {activeWorkspaceId && !isMobile ? (
            <AutomationSettingsDialog
              key={activeWorkspaceId}
              workspaceId={activeWorkspaceId}
              open={automationSettingsOpen}
              onOpenChange={setAutomationSettingsOpen}
            />
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            {activeWorkspaceId && !isMobile ? (
              <AutomationStatus
                summary={automation.data ?? null}
                onPause={() => void pauseAutomation()}
                onOpenSettings={() => setAutomationSettingsOpen(true)}
              />
            ) : null}
            {!isMobile ? (
              <Button
                variant="secondary"
                isDisabled={!canvas.data}
                onPress={() => canvasRef.current?.addNode('agent')}
              >
                新建 Agent 节点
              </Button>
            ) : null}
            {!isMobile ? (
              <CreateWorkspaceDialog
                onCreated={(id) => {
                  setWorkspace(id)
                  writeUrlState({ workspaceId: id, taskId: null })
                }}
              />
            ) : null}
          </div>
        </header>
        {unauthorized ? (
          <div role="alert" className={authBannerClass}>
            未认证。请通过
            <a
              href="/auth"
              className="underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-accent"
            >
              /auth?token=...
            </a>
            登录后刷新页面。
          </div>
        ) : null}
        {isMobile ? (
          <div className="flex min-h-0 flex-1 flex-col">
            {mobileTab === 'board' ? (
              <MobileBoardList
                tasks={tasks.data ?? []}
                selectedTaskId={activeTaskId}
                onSelectTask={(id) => {
                  setTask(id)
                  setRightPanel('task')
                  writeUrlState({ workspaceId: activeWorkspaceId, taskId: id })
                }}
                onOpenSupervisor={() => setMobileTab('supervisor')}
              />
            ) : null}

            {mobileTab === 'supervisor' ? (
              <div className="min-h-0 flex-1 pb-16">
                <SupervisorPanel
                  workspaceId={activeWorkspaceId}
                  contextNodes={contextNodes}
                  targetAgent={targetAgent}
                />
              </div>
            ) : null}

            {mobileTab === 'digest' ? (
              <div className="min-h-0 flex-1 overflow-y-auto p-3 pb-24">
                <DigestCard
                  workspaceId={activeWorkspaceId ?? undefined}
                  onOpenTask={(id) => {
                    setTask(id)
                    writeUrlState({ workspaceId: activeWorkspaceId, taskId: id })
                  }}
                />
              </div>
            ) : null}

            <MobileNav
              tab={mobileTab}
              onChange={setMobileTab}
              attentionCount={counts.needs_approval + counts.needs_reply + counts.needs_review}
              unread={notices.data?.notices[0]?.readAt === null}
            />

            {activeTaskId ? (
              <MobileTaskDetail
                onClose={() => {
                  setTask(null)
                  setRightPanel('supervisor')
                  writeUrlState({ workspaceId: activeWorkspaceId, taskId: null })
                }}
              >
                <TaskDetailPanel />
              </MobileTaskDetail>
            ) : null}
          </div>
        ) : (
          <div
            className={
              viewport === 'compact' ? 'relative flex min-h-0 flex-1' : 'flex min-h-0 flex-1'
            }
          >
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
              compact={viewport === 'compact'}
              onSelectTask={(id) => {
                setSelectedNode(null)
                setTask(id)
                setRightPanel('task')
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
                  setRightPanel(id ? 'node' : 'supervisor')
                  if (id) setTask(null)
                }}
                onSelectNodes={setSelection}
              />
            </main>
            <RightPanel
              compact={viewport === 'compact'}
              mode={rightPanel}
              onModeChange={setRightPanel}
              hasTask={Boolean(activeTaskId)}
              hasNode={Boolean(selectedNode)}
              hasUnreadNotice={notices.data?.notices[0]?.readAt === null}
              supervisor={
                <SupervisorPanel
                  workspaceId={activeWorkspaceId}
                  contextNodes={contextNodes}
                  targetAgent={targetAgent}
                />
              }
              task={<TaskDetailPanel />}
              node={
                selectedNode && activeWorkspaceId ? (
                  <NodePanel
                    key={selectedNode.id}
                    node={selectedNode}
                    task={nodeTask ?? null}
                    workspaceId={activeWorkspaceId}
                    workspaceTrusted={activeWorkspace?.trusted ?? false}
                    contextNodes={contextNodes}
                    onOpenTask={(id) => {
                      setSelectedNode(null)
                      setTask(id)
                      setRightPanel('task')
                      writeUrlState({ workspaceId: activeWorkspaceId, taskId: id })
                    }}
                    onDeleted={() => {
                      setSelectedNode(null)
                      setRightPanel('supervisor')
                    }}
                    onClose={() => {
                      setSelectedNode(null)
                      setRightPanel('supervisor')
                    }}
                  />
                ) : null
              }
            />
          </div>
        )}
      </div>
    </RealtimeProvider>
  )
}
