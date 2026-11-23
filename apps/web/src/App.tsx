import { needsMe } from '@baton/core'
import { Button } from '@heroui/react/button'
import { toast } from '@heroui/react/toast'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AutomationSettingsDialog } from './features/automation/AutomationSettingsDialog'
import { AutomationStatus } from './features/automation/AutomationStatus'
import { CanvasPanel } from './features/canvas/CanvasPanel'
import { MobileNodeManager } from './features/canvas/MobileNodeManager'
import { NodePanel } from './features/canvas/NodePanel'
import { CreateDeliveryDialog } from './features/deliveries/CreateDeliveryDialog'
import { DeliveryBoard } from './features/deliveries/DeliveryBoard'
import { DeliveryCanvas } from './features/deliveries/DeliveryCanvas'
import { DeliveryRail } from './features/deliveries/DeliveryRail'
import { AnnotationListOverlay } from './features/overlays/AnnotationListOverlay'
import { AcceptanceMatrixOverlay } from './features/overlays/AcceptanceMatrixOverlay'
import { ArtifactViewerOverlay } from './features/overlays/ArtifactViewerOverlay'
import { DrawingEditorOverlay } from './features/overlays/DrawingEditorOverlay'
import { Overlay } from './features/overlays/Overlay'
import { StageSceneOverlay } from './features/overlays/StageSceneOverlay'
import { RealtimeProvider } from './features/realtime/RealtimeProvider'
import { RightPanel } from './features/right-panel/RightPanel'
import { ConnectionStatus } from './features/shared/ConnectionStatus'
import { MobileMoreMenu } from './features/shared/MobileMoreMenu'
import { MobileNav } from './features/shared/MobileNav'
import { DigestCard } from './features/supervisor/DigestCard'
import { SupervisorPanel } from './features/supervisor/SupervisorPanel'
import type { SupervisorTargetAgent } from './features/supervisor/supervisor-model'
import { MobileBoardList } from './features/tasks/MobileBoardList'
import { MobileCreateTaskForm } from './features/tasks/MobileCreateTaskForm'
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
  getDelivery,
  cancelDelivery as cancelDeliveryRequest,
  createArtifactDraft,
  listArtifacts,
  listDeliveries,
  listNotices,
  listTasks,
  listWorkspaces,
  setKillSwitch,
  UnauthorizedError,
  updateAnnotation,
} from './lib/api'
import { useCommand } from './lib/command-context'
import { queryKeys } from './lib/query'
import { readUrlState, writeUrlState } from './lib/url'
import { useViewport } from './lib/use-viewport'
import { useAppStore } from './stores/app'

const authBannerClass = [
  'flex shrink-0 items-center gap-2 border-b border-warning bg-warning/10',
  'px-4 py-2 text-sm text-warning',
].join(' ')

const viewButtonClass = [
  'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
].join(' ')

export function App() {
  const activeWorkspaceId = useAppStore((state) => state.activeWorkspaceId)
  const activeTaskId = useAppStore((state) => state.activeTaskId)
  const activeDeliveryId = useAppStore((state) => state.activeDeliveryId)
  const overlay = useAppStore((state) => state.overlay)
  const rightPanelCollapsed = useAppStore((state) => state.rightPanelCollapsed)
  const selectedNodeId = useAppStore((state) => state.selectedNodeId)
  const selectedNodeIds = useAppStore((state) => state.selectedNodeIds)
  const contextNodeIds = useAppStore((state) => state.contextNodeIds)
  const mobileTab = useAppStore((state) => state.mobileTab)
  const wsStatus = useAppStore((state) => state.wsStatus)
  const setWorkspace = useAppStore((state) => state.setWorkspace)
  const setTask = useAppStore((state) => state.setTask)
  const setDelivery = useAppStore((state) => state.setDelivery)
  const setOverlay = useAppStore((state) => state.setOverlay)
  const setRightPanelCollapsed = useAppStore((state) => state.setRightPanelCollapsed)
  const setSelectedNode = useAppStore((state) => state.setSelectedNode)
  const setSelection = useAppStore((state) => state.setSelection)
  const setMobileTab = useAppStore((state) => state.setMobileTab)
  const viewport = useViewport()
  const isMobile = viewport === 'mobile'
  const queryClient = useQueryClient()
  const send = useCommand()
  const canvasRef = useRef<import('./features/canvas/CanvasPanel').CanvasPanelHandle>(null)
  const [trustDialogOpen, setTrustDialogOpen] = useState(false)
  const [trustPromptedFor, setTrustPromptedFor] = useState<string | null>(null)
  const [automationSettingsOpen, setAutomationSettingsOpen] = useState(false)
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false)
  const [mobileTaskFormOpen, setMobileTaskFormOpen] = useState(false)
  const [mobileNodesOpen, setMobileNodesOpen] = useState(false)
  const [createWorkspaceOpen, setCreateWorkspaceOpen] = useState(false)
  const [deliveryDialogOpen, setDeliveryDialogOpen] = useState(false)
  const [showTasks, setShowTasks] = useState(false)
  const [showWorkspace, setShowWorkspace] = useState(false)

  const workspaces = useQuery({ queryKey: queryKeys.workspaces, queryFn: listWorkspaces })
  const tasks = useQuery({
    queryKey: queryKeys.tasks(activeWorkspaceId ?? ''),
    queryFn: () => listTasks(activeWorkspaceId!),
    enabled: Boolean(activeWorkspaceId),
  })
  const deliveries = useQuery({
    queryKey: queryKeys.deliveries(activeWorkspaceId ?? ''),
    queryFn: () => listDeliveries(activeWorkspaceId!),
    enabled: Boolean(activeWorkspaceId),
  })
  const delivery = useQuery({
    queryKey: queryKeys.delivery(activeDeliveryId ?? ''),
    queryFn: () => getDelivery(activeDeliveryId!),
    enabled: Boolean(activeDeliveryId),
  })
  const deliveryCanvas = useQuery({
    queryKey: queryKeys.deliveryCanvas(activeWorkspaceId ?? '', activeDeliveryId ?? ''),
    queryFn: () => getCanvas(activeWorkspaceId!, activeDeliveryId!),
    enabled: Boolean(activeWorkspaceId && activeDeliveryId),
  })
  const artifacts = useQuery({
    queryKey: queryKeys.artifacts(activeDeliveryId ?? ''),
    queryFn: () => listArtifacts(activeDeliveryId!),
    enabled: Boolean(activeDeliveryId),
  })
  const workspaceCanvas = useQuery({
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

  const hasNoDeliveries =
    Boolean(activeWorkspaceId) && !deliveries.isLoading && (deliveries.data?.length ?? 0) === 0
  const canvasForContext = showWorkspace || hasNoDeliveries ? workspaceCanvas : deliveryCanvas
  const canvasNodes = canvasForContext.data?.nodes ?? []
  const contextNodes = useMemo(
    () => canvasNodes.filter((node) => contextNodeIds.includes(node.id)),
    [canvasNodes, contextNodeIds],
  )
  const targetAgent = useMemo<SupervisorTargetAgent | null>(() => {
    const nodes = canvasNodes.filter((node) => selectedNodeIds.includes(node.id))
    const agents = nodes.filter((node) => node.type === 'agent')
    const agent = agents.length === 1 ? agents[0] : null
    if (!agent || agent.type !== 'agent') return null
    return { id: agent.id, title: agent.data.title }
  }, [canvasNodes, selectedNodeIds])
  const counts = useMemo(() => {
    const list = tasks.data ?? []
    return {
      needs_me: list.filter((task) =>
        needsMe({
          status: task.status,
          attention: task.attention,
          acceptance: task.acceptance,
        }),
      ).length,
      needs_approval: list.filter((task) => task.attention === 'needs_approval').length,
      needs_reply: list.filter((task) => task.attention === 'needs_reply').length,
      needs_review: list.filter((task) => task.attention === 'needs_review').length,
      needs_attention: list.filter((task) => task.attention === 'needs_attention').length,
      total: list.length,
    }
  }, [tasks.data])

  const selectedNode = canvasNodes.find((node) => node.id === selectedNodeId) ?? null
  const activeWorkspace =
    workspaces.data?.find((workspace) => workspace.id === activeWorkspaceId) ?? null
  const nodeTask = selectedNode && tasks.data?.find((task) => task.nodeId === selectedNode.id)
  const unauthorized =
    wsStatus === 'unauthorized' ||
    [workspaces.error, tasks.error, deliveries.error].some(
      (error) => error instanceof UnauthorizedError,
    )
  const deliveryTasks = (tasks.data ?? []).filter(
    (task) => activeDeliveryId && task.deliveryId === activeDeliveryId,
  )

  useEffect(() => {
    if (activeWorkspaceId) return
    const url = readUrlState()
    if (url.workspaceId) {
      setWorkspace(url.workspaceId)
      if (url.deliveryId) setDelivery(url.deliveryId)
      if (url.deliveryId && url.artifactId) {
        setOverlay({ kind: 'artifact', deliveryId: url.deliveryId, artifactId: url.artifactId })
      } else if (url.deliveryId && url.annotationId) {
        setOverlay({ kind: 'annotations', deliveryId: url.deliveryId })
      }
      if (url.taskId) {
        setTask(url.taskId)
        setOverlay({ kind: 'stage', taskId: url.taskId })
      }
    } else if (workspaces.data?.[0]) {
      setWorkspace(workspaces.data[0].id)
    }
  }, [activeWorkspaceId, setDelivery, setOverlay, setTask, setWorkspace, workspaces.data])

  useEffect(() => {
    if (!activeWorkspaceId) return
    writeUrlState({
      workspaceId: activeWorkspaceId,
      deliveryId: activeDeliveryId,
      taskId: overlay?.kind === 'stage' ? overlay.taskId : activeTaskId,
      artifactId: overlay?.kind === 'artifact' ? overlay.artifactId : null,
    })
  }, [activeDeliveryId, activeTaskId, activeWorkspaceId, overlay])

  useEffect(() => {
    if (!activeWorkspace || activeWorkspace.trusted) return
    if (trustPromptedFor === activeWorkspace.id) return
    setTrustPromptedFor(activeWorkspace.id)
    setTrustDialogOpen(true)
  }, [activeWorkspace, trustPromptedFor])

  const pauseAutomation = async () => {
    try {
      await setKillSwitch(true)
      await queryClient.invalidateQueries({ queryKey: ['automation'] })
      toast.success('自动化已暂停')
    } catch (cause) {
      toast.danger(cause instanceof Error ? cause.message : '暂停自动化失败')
    }
  }

  const openTask = (taskId: string) => {
    setTask(taskId)
    setOverlay({ kind: 'stage', taskId })
  }
  const openArtifact = (artifactId: string) => {
    if (activeDeliveryId) setOverlay({ kind: 'artifact', deliveryId: activeDeliveryId, artifactId })
  }
  const openAnnotations = () => {
    if (activeDeliveryId) setOverlay({ kind: 'annotations', deliveryId: activeDeliveryId })
  }
  const createDrawing = async () => {
    if (!activeDeliveryId || !deliveryCanvas.data) return
    const stageKey = delivery.data?.currentStageKey ?? delivery.data?.stages[0]?.key
    if (!stageKey) return
    try {
      const artifact = await createArtifactDraft(activeDeliveryId, stageKey, {
        stageKey,
        kind: 'drawing',
        name: `drawing-${Date.now()}.png`,
      })
      const group = deliveryCanvas.data.nodes.find(
        (node) => node.type === 'group' && node.data.stageKey === stageKey,
      )
      await send({
        type: 'node.create',
        payload: {
          canvasId: deliveryCanvas.data.canvas.id,
          node: {
            type: 'drawing',
            x: (group?.x ?? 0) + 40,
            y: (group?.y ?? 0) + 80,
            w: 320,
            h: 200,
            groupId: group?.id ?? null,
            data: {
              artifactId: artifact.id,
              title: artifact.name,
              thumbnailPath: null,
              status: 'draft',
            },
          },
        },
      })
      await queryClient.invalidateQueries({
        queryKey: queryKeys.deliveryCanvas(activeWorkspaceId ?? '', activeDeliveryId),
      })
      await queryClient.invalidateQueries({ queryKey: queryKeys.artifacts(activeDeliveryId) })
      setOverlay({ kind: 'drawing', deliveryId: activeDeliveryId, artifactId: artifact.id })
    } catch (cause) {
      toast.danger(cause instanceof Error ? cause.message : '创建画板失败')
    }
  }
  const selectDelivery = (deliveryId: string) => {
    setDelivery(deliveryId)
    setShowTasks(false)
    setShowWorkspace(false)
    setOverlay(null)
  }
  const stopDelivery = async (deliveryId: string) => {
    if (!window.confirm('停止交付会取消整条交付和当前阶段任务，确认吗？')) return
    try {
      await cancelDeliveryRequest(deliveryId)
      toast.success('交付已停止')
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.deliveries(activeWorkspaceId ?? ''),
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.delivery(deliveryId) }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.deliveryCanvas(activeWorkspaceId ?? '', deliveryId),
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.tasks(activeWorkspaceId ?? '') }),
      ])
    } catch (cause) {
      toast.danger(cause instanceof Error ? cause.message : '停止交付失败')
    }
  }
  const goBoard = () => {
    setDelivery(null)
    setShowTasks(false)
    setShowWorkspace(false)
  }

  const headerClass =
    viewport === 'compact'
      ? 'flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b border-separator px-3 py-2'
      : 'flex h-14 shrink-0 items-center gap-3 border-b border-separator px-4'

  return (
    <RealtimeProvider workspaceId={activeWorkspaceId}>
      <div
        className="flex h-screen flex-col bg-background text-foreground"
        data-viewport={viewport}
      >
        <header className={headerClass}>
          <span className="text-sm font-semibold">baton</span>
          <WorkspaceSwitcher
            workspaces={workspaces.data ?? []}
            activeWorkspaceId={activeWorkspaceId}
            onSelect={(id) => {
              setWorkspace(id)
              writeUrlState({ workspaceId: id })
            }}
          />
          {activeWorkspaceId ? <ConnectionStatus compact={isMobile} /> : null}
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
                mobile={isMobile}
              />
            </>
          ) : null}
          {activeWorkspaceId ? (
            <AutomationSettingsDialog
              key={activeWorkspaceId}
              workspaceId={activeWorkspaceId}
              open={automationSettingsOpen}
              onOpenChange={setAutomationSettingsOpen}
              mobile={isMobile}
            />
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            {!isMobile ? (
              <div className="flex items-center gap-1 rounded-lg border border-separator p-0.5">
                <button
                  type="button"
                  className={`${viewButtonClass} ${!showTasks && !showWorkspace ? 'bg-default text-foreground' : 'text-muted'}`}
                  onClick={goBoard}
                  aria-pressed={!showTasks && !showWorkspace}
                >
                  交付
                </button>
                <button
                  type="button"
                  className={`${viewButtonClass} ${showTasks ? 'bg-default text-foreground' : 'text-muted'}`}
                  onClick={() => setShowTasks(true)}
                  aria-pressed={showTasks}
                >
                  任务
                </button>
                <button
                  type="button"
                  className={`${viewButtonClass} ${showWorkspace ? 'bg-default text-foreground' : 'text-muted'}`}
                  onClick={() => {
                    setShowWorkspace(true)
                    setShowTasks(false)
                  }}
                  aria-pressed={showWorkspace}
                >
                  工作区画布
                </button>
              </div>
            ) : null}
            {isMobile ? (
              <Button variant="secondary" onPress={() => setMobileMoreOpen(true)}>
                更多
              </Button>
            ) : null}
            {activeWorkspaceId ? (
              <AutomationStatus
                compact={isMobile}
                summary={automation.data ?? null}
                onPause={() => void pauseAutomation()}
                onOpenSettings={() => setAutomationSettingsOpen(true)}
              />
            ) : null}
            {!isMobile ? (
              <CreateWorkspaceDialog
                onCreated={(id) => {
                  setWorkspace(id)
                  writeUrlState({ workspaceId: id })
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
                  writeUrlState({ workspaceId: activeWorkspaceId, taskId: id })
                }}
                onOpenSupervisor={() => setMobileTab('supervisor')}
                onCreateTask={() => setMobileTaskFormOpen(true)}
              />
            ) : null}
            {mobileTab === 'supervisor' ? (
              <div className="min-h-0 flex-1 pb-[calc(4rem+env(safe-area-inset-bottom))]">
                <SupervisorPanel
                  workspaceId={activeWorkspaceId}
                  contextNodes={contextNodes}
                  targetAgent={targetAgent}
                  mobile
                  nodes={canvasNodes}
                />
              </div>
            ) : null}
            {mobileTab === 'digest' ? (
              <div className="min-h-0 flex-1 overflow-y-auto p-3 pb-[calc(6rem+env(safe-area-inset-bottom))]">
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
              attentionCount={
                counts.needs_approval +
                counts.needs_reply +
                counts.needs_review +
                counts.needs_attention
              }
              unread={notices.data?.notices[0]?.readAt === null}
            />
            {activeTaskId ? (
              <MobileTaskDetail
                onClose={() => {
                  setTask(null)
                  setMobileTab('supervisor')
                  writeUrlState({ workspaceId: activeWorkspaceId })
                }}
              >
                <TaskDetailPanel mobile />
              </MobileTaskDetail>
            ) : null}
            <MobileMoreMenu
              open={mobileMoreOpen}
              onOpenChange={setMobileMoreOpen}
              onOpenTask={() => {
                setMobileMoreOpen(false)
                setMobileTaskFormOpen(true)
              }}
              onOpenNodes={() => {
                setMobileMoreOpen(false)
                setMobileNodesOpen(true)
              }}
              onCreateWorkspace={() => {
                setMobileMoreOpen(false)
                setCreateWorkspaceOpen(true)
              }}
              automationSlot={
                <AutomationStatus
                  summary={automation.data ?? null}
                  onPause={() => void pauseAutomation()}
                  onOpenSettings={() => {
                    setMobileMoreOpen(false)
                    setAutomationSettingsOpen(true)
                  }}
                />
              }
              trustSlot={
                activeWorkspace ? (
                  <WorkspaceTrustBadge
                    workspace={activeWorkspace}
                    onTrust={() => {
                      setMobileMoreOpen(false)
                      setTrustDialogOpen(true)
                    }}
                    onRevoked={() => setTrustPromptedFor(activeWorkspace.id)}
                  />
                ) : (
                  <p className="text-xs text-muted">尚未选择工作区</p>
                )
              }
            />
            {mobileTaskFormOpen && activeWorkspaceId && workspaceCanvas.data ? (
              <MobileCreateTaskForm
                workspaceId={activeWorkspaceId}
                canvasId={workspaceCanvas.data.canvas.id}
                workspaceTrusted={activeWorkspace?.trusted ?? false}
                nodes={workspaceCanvas.data.nodes}
                onCreated={(taskId) => {
                  setMobileTaskFormOpen(false)
                  setTask(taskId)
                  writeUrlState({ workspaceId: activeWorkspaceId, taskId })
                }}
                onCancel={() => setMobileTaskFormOpen(false)}
              />
            ) : null}
            {mobileNodesOpen && workspaceCanvas.data ? (
              <MobileNodeManager
                canvasId={workspaceCanvas.data.canvas.id}
                nodes={workspaceCanvas.data.nodes}
                onClose={() => setMobileNodesOpen(false)}
              />
            ) : null}
            <CreateWorkspaceDialog
              onCreated={(id) => {
                setWorkspace(id)
                writeUrlState({ workspaceId: id })
              }}
              open={createWorkspaceOpen}
              onOpenChange={setCreateWorkspaceOpen}
              mobile
            />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1">
            <DeliveryRail
              deliveries={deliveries.data ?? []}
              activeDeliveryId={activeDeliveryId}
              onCreate={() => setDeliveryDialogOpen(true)}
              onSelect={selectDelivery}
              onOpenBoard={goBoard}
            />
            <main className="relative flex min-h-0 min-w-0 flex-1 flex-col">
              {showTasks ? (
                <TaskBoard
                  tasks={tasks.data ?? []}
                  agentNodes={workspaceCanvas.data?.nodes ?? []}
                  selectedTaskId={activeTaskId}
                  expanded
                  pinned={false}
                  onSelectTask={openTask}
                  onOpenScene={openTask}
                  onClose={() => setShowTasks(false)}
                />
              ) : showWorkspace || hasNoDeliveries ? (
                <CanvasPanel
                  ref={canvasRef}
                  canvas={workspaceCanvas.data ?? null}
                  tasks={tasks.data ?? []}
                  selectedNodeId={selectedNodeId}
                  onSelectNode={(id) => setSelectedNode(id)}
                  onSelectNodes={setSelection}
                  onOpenTask={openTask}
                />
              ) : activeDeliveryId && delivery.data ? (
                <DeliveryCanvas
                  workspaceId={activeWorkspaceId ?? ''}
                  delivery={delivery.data}
                  canvas={deliveryCanvas.data ?? null}
                  tasks={deliveryTasks}
                  artifacts={artifacts.data ?? []}
                  selectedNodeId={selectedNodeId}
                  onSelectNode={setSelectedNode}
                  onSelectNodes={setSelection}
                  onOpenTask={openTask}
                  onOpenArtifact={(artifact) => openArtifact(artifact.id)}
                  onOpenDrawing={(artifact) =>
                    setOverlay({
                      kind: 'drawing',
                      deliveryId: artifact.deliveryId,
                      artifactId: artifact.id,
                    })
                  }
                  onOpenAnnotations={openAnnotations}
                  onOpenAcceptance={() => {
                    if (activeDeliveryId) {
                      setOverlay({ kind: 'acceptance', deliveryId: activeDeliveryId })
                    }
                  }}
                  onCreateDrawing={() => void createDrawing()}
                  onCancelDelivery={(deliveryId) => void stopDelivery(deliveryId)}
                  onAnnotationsChanged={() => {
                    if (!activeDeliveryId) return
                    void queryClient.invalidateQueries({
                      queryKey: queryKeys.delivery(activeDeliveryId),
                    })
                    void queryClient.invalidateQueries({
                      queryKey: queryKeys.deliveries(activeWorkspaceId ?? ''),
                    })
                  }}
                />
              ) : (
                <DeliveryBoard
                  deliveries={deliveries.data ?? []}
                  onSelect={selectDelivery}
                  onCancelDelivery={(deliveryId) => void stopDelivery(deliveryId)}
                  onOpenTaskView={() => setShowTasks(true)}
                />
              )}
            </main>
            <RightPanel
              compact={viewport === 'compact'}
              collapsed={rightPanelCollapsed}
              onToggleCollapsed={() => setRightPanelCollapsed(!rightPanelCollapsed)}
              hasUnreadNotice={notices.data?.notices[0]?.readAt === null}
              supervisor={
                <SupervisorPanel
                  workspaceId={activeWorkspaceId}
                  contextNodes={contextNodes}
                  targetAgent={targetAgent}
                  nodes={canvasNodes}
                />
              }
            />
          </div>
        )}
        <CreateDeliveryDialog
          workspaceId={activeWorkspaceId ?? ''}
          open={deliveryDialogOpen && Boolean(activeWorkspaceId)}
          onOpenChange={setDeliveryDialogOpen}
          onCreated={selectDelivery}
        />
        {!isMobile && overlay?.kind === 'stage' ? (
          <StageSceneOverlay taskId={overlay.taskId} onClose={() => setOverlay(null)} />
        ) : null}
        {overlay?.kind === 'artifact'
          ? (() => {
              const artifact = (artifacts.data ?? []).find((item) => item.id === overlay.artifactId)
              return artifact ? (
                <ArtifactViewerOverlay
                  deliveryId={overlay.deliveryId}
                  artifact={artifact}
                  onClose={() => setOverlay(null)}
                />
              ) : null
            })()
          : null}
        {overlay?.kind === 'drawing'
          ? (() => {
              const artifact = (artifacts.data ?? []).find((item) => item.id === overlay.artifactId)
              return artifact ? (
                <DrawingEditorOverlay
                  deliveryId={overlay.deliveryId}
                  artifact={artifact}
                  onClose={() => setOverlay(null)}
                  onSaved={() => {
                    void queryClient.invalidateQueries({
                      queryKey: queryKeys.artifacts(overlay.deliveryId),
                    })
                    void queryClient.invalidateQueries({
                      queryKey: queryKeys.delivery(overlay.deliveryId),
                    })
                  }}
                />
              ) : null
            })()
          : null}
        {overlay?.kind === 'acceptance' && delivery.data ? (
          <AcceptanceMatrixOverlay delivery={delivery.data} onClose={() => setOverlay(null)} />
        ) : null}
        {overlay?.kind === 'annotations' && delivery.data ? (
          <AnnotationListOverlay
            annotations={delivery.data.annotations}
            onClose={() => setOverlay(null)}
            onLocate={(annotation) => {
              const nodeId = annotation.targetNodeIds[0]
              if (nodeId) setSelectedNode(nodeId)
              setOverlay(null)
            }}
            onDismiss={(annotation) => {
              if (!delivery.data) return
              void updateAnnotation(annotation.deliveryId, annotation.id, { status: 'dismissed' })
                .then(() =>
                  queryClient.invalidateQueries({
                    queryKey: queryKeys.delivery(annotation.deliveryId),
                  }),
                )
                .catch((cause: unknown) =>
                  toast.danger(cause instanceof Error ? cause.message : '忽略标注失败'),
                )
            }}
          />
        ) : null}
        {(showWorkspace || hasNoDeliveries) && selectedNode && activeWorkspaceId ? (
          <Overlay title="节点" onClose={() => setSelectedNode(null)} width="min(720px, 92vw)">
            <NodePanel
              key={selectedNode.id}
              node={selectedNode}
              task={nodeTask ?? null}
              workspaceId={activeWorkspaceId}
              workspaceTrusted={activeWorkspace?.trusted ?? false}
              contextNodes={contextNodes}
              groupChildCount={
                canvasNodes.filter((node) => node.groupId === selectedNode.id).length
              }
              onOpenTask={(id) => {
                setSelectedNode(null)
                openTask(id)
              }}
              onDeleted={() => setSelectedNode(null)}
              onClose={() => setSelectedNode(null)}
            />
          </Overlay>
        ) : null}
      </div>
    </RealtimeProvider>
  )
}
