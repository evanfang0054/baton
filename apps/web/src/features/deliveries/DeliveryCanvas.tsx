import type { Artifact, CanvasResponse, DeliveryDetail, Node, TaskSummary } from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { useMemo, useRef } from 'react'
import { CanvasPanel, type CanvasPanelHandle } from '../canvas/CanvasPanel'
import { DELIVERY_STATUS_LABELS, STAGE_STATUS_LABELS, formatWaiting } from './delivery-labels'

function stageStatusTone(status: string): string {
  if (status === 'done') return 'text-success'
  if (status === 'running') return 'text-accent'
  if (status === 'waiting_person') return 'text-warning'
  if (status === 'failed') return 'text-danger'
  return 'text-muted'
}

export function DeliveryCanvas({
  workspaceId,
  delivery,
  canvas,
  tasks,
  artifacts,
  selectedNodeId,
  onSelectNode,
  onSelectNodes,
  onOpenTask,
  onOpenArtifact,
  onOpenAnnotations,
}: {
  workspaceId: string
  delivery: DeliveryDetail
  canvas: CanvasResponse | null
  tasks: TaskSummary[]
  artifacts: Artifact[]
  selectedNodeId: string | null
  onSelectNode: (nodeId: string | null) => void
  onSelectNodes: (nodes: Array<Pick<Node, 'id' | 'type'>>) => void
  onOpenTask: (taskId: string) => void
  onOpenArtifact: (artifact: Artifact) => void
  onOpenAnnotations: () => void
}) {
  const canvasRef = useRef<CanvasPanelHandle>(null)
  const currentStage = useMemo(
    () => delivery.stages.find((stage) => stage.key === delivery.currentStageKey) ?? null,
    [delivery.currentStageKey, delivery.stages],
  )
  const groupByStage = useMemo(() => {
    const map = new Map<string, string>()
    for (const node of canvas?.nodes ?? []) {
      if (node.type === 'group' && node.data.stageKey) map.set(node.data.stageKey, node.id)
    }
    return map
  }, [canvas?.nodes])

  const focusStage = (stageKey: string) => {
    const groupId = groupByStage.get(stageKey)
    if (groupId) canvasRef.current?.focusNode(groupId)
  }

  return (
    <section className="relative min-h-0 flex-1" aria-label={`交付画布 ${delivery.title}`}>
      <CanvasPanel
        ref={canvasRef}
        canvas={canvas}
        tasks={tasks}
        selectedNodeId={selectedNodeId}
        onSelectNode={onSelectNode}
        onSelectNodes={onSelectNodes}
        onOpenTask={onOpenTask}
        onOpenNode={(node) => {
          if (node.type === 'artifact') {
            const artifact = artifacts.find((item) => item.id === node.data.artifactId)
            if (artifact) onOpenArtifact(artifact)
            return
          }
          if (node.type === 'agent') {
            const task = tasks.find((item) => item.nodeId === node.id)
            if (task) onOpenTask(task.id)
          }
        }}
        delivery={delivery}
        stages={delivery.stages}
        artifacts={artifacts}
      />
      <div className="pointer-events-none absolute left-4 top-4 z-10 w-[min(420px,calc(100%-2rem))]">
        <div className="pointer-events-auto rounded-xl border border-separator bg-surface/95 p-3 shadow-overlay backdrop-blur">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-sm font-semibold text-foreground">{delivery.title}</h1>
              <p className="mt-1 line-clamp-2 text-xs text-muted">{delivery.goal}</p>
            </div>
            <span className="shrink-0 text-xs text-muted">
              {DELIVERY_STATUS_LABELS[delivery.status]}
            </span>
          </div>
          <div className="mt-2 grid grid-cols-4 gap-1">
            {delivery.stages.map((stage) => (
              <button
                key={stage.key}
                type="button"
                onClick={() => focusStage(stage.key)}
                className={`rounded border border-separator px-1.5 py-1 text-left text-[10px] transition-colors hover:border-accent/60 ${stageStatusTone(stage.status)}`}
                aria-label={`定位阶段 ${stage.ordinal} ${stage.label}`}
              >
                <span className="block truncate">
                  {stage.ordinal} {stage.label}
                </span>
                <span className="block text-[9px] text-muted">
                  {STAGE_STATUS_LABELS[stage.status]}
                </span>
              </button>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-muted">
            <span>
              阶段 {delivery.stageProgress.done}/{delivery.stageProgress.total}
            </span>
            {currentStage ? (
              <span>
                当前 {currentStage.ordinal} {currentStage.label} · {currentStage.gate}
              </span>
            ) : null}
            {delivery.waitingSince ? (
              <span className="text-warning">等待 {formatWaiting(delivery.waitingSince)}</span>
            ) : null}
            <Button size="sm" variant="tertiary" onPress={onOpenAnnotations}>
              标注 {delivery.openAnnotationCount}
            </Button>
          </div>
          <p className="mt-1 text-[10px] text-muted">工作区 {workspaceId.slice(0, 8)}</p>
        </div>
      </div>
    </section>
  )
}
