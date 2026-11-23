import { isStale } from '@baton/core'
import type { Node, TaskSummary } from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { ConfirmDialog } from '../overlays/ConfirmDialog'
import { toast } from '@heroui/react/toast'
import { useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { getTask } from '../../lib/api'
import { useCommand } from '../../lib/command-context'
import { invalidateTaskQueries } from '../../lib/query'
import { needsAcceptanceOverride } from './acceptance-gate'
import { BOARD_COLUMNS, groupTasks, statusColumn, type BoardColumnId } from './columns'
import { isDroppable, taskDropAction } from './task-drag'
import { TaskBoardFilters, filterTasks, type TaskFilter } from './TaskBoardFilters'
import { TaskCard } from './TaskCard'

const BATCH_LIMIT = 20
const LONG_PRESS_MS = 320
const PRESS_MOVE_TOLERANCE = 8
const EDGE_SCROLL_PX = 48

const supportsRaf =
  typeof requestAnimationFrame === 'function' && typeof cancelAnimationFrame === 'function'

function scheduleFrame(callback: FrameRequestCallback): number {
  return supportsRaf
    ? requestAnimationFrame(callback)
    : window.setTimeout(() => callback(performance.now()), 16)
}

function cancelFrame(handle: number): void {
  if (supportsRaf) {
    cancelAnimationFrame(handle)
  } else {
    window.clearTimeout(handle)
  }
}

interface DragSession {
  task: TaskSummary
  x: number
  y: number
  target: BoardColumnId | null
}

interface PressSession {
  task: TaskSummary
  startX: number
  startY: number
  pointerId: number
  timer: number
  activated: boolean
}

function columnAtPoint(x: number, y: number): BoardColumnId | null {
  const element =
    typeof document.elementFromPoint === 'function' ? document.elementFromPoint(x, y) : null
  const column = element?.closest<HTMLElement>('[data-column]')?.dataset.column
  return BOARD_COLUMNS.some((item) => item.id === column) ? (column as BoardColumnId) : null
}

interface TaskBoardProps {
  tasks: TaskSummary[]
  agentNodes: Node[]
  selectedTaskId: string | null
  expanded: boolean
  pinned: boolean
  compact?: boolean
  onSelectTask: (taskId: string) => void
  onOpenScene?: (taskId: string) => void
  onClose: () => void
}

export function TaskBoard({
  tasks,
  agentNodes,
  selectedTaskId,
  expanded,
  pinned,
  compact = false,
  onSelectTask,
  onOpenScene,
  onClose,
}: TaskBoardProps) {
  const send = useCommand()
  const queryClient = useQueryClient()
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [batching, setBatching] = useState(false)
  const [filter, setFilter] = useState<TaskFilter>('all')
  const [query, setQuery] = useState('')
  const visibleTasks = useMemo(() => filterTasks(tasks, { filter, query }), [filter, query, tasks])
  const scrollerRef = useRef<HTMLDivElement>(null)
  const scrollKeyRef = useRef<string | null>(null)
  const [drag, setDrag] = useState<DragSession | null>(null)
  const dragRef = useRef<DragSession | null>(null)
  const pressRef = useRef<PressSession | null>(null)
  const cleanupPressRef = useRef<(() => void) | null>(null)
  // 指针移动可达 1000Hz；把预览和命中检测收敛到每帧一次。
  const moveFrameRef = useRef<number | null>(null)
  const pendingMoveRef = useRef<{ x: number; y: number } | null>(null)
  const suppressClickUntilRef = useRef(0)
  const [cancelTarget, setCancelTarget] = useState<TaskSummary | null>(null)
  const [dropPending, setDropPending] = useState(false)

  // 组件卸载时不能留下全局 pointer 监听和长按定时器。
  useEffect(() => () => cleanupPressRef.current?.(), [])

  // 窄屏时 7 列放不下；展开看板后把视口带到“最该看的那一列”，
  // 避免用户只看到一排空列，以为任务丢了。只在打开或切换选中任务时执行，
  // 不跟随任务流更新反复抢横向滚动。
  useEffect(() => {
    if (!expanded && !pinned) {
      scrollKeyRef.current = null
      return
    }
    const key = `${selectedTaskId ?? '__first__'}|${filter}|${query}`
    if (scrollKeyRef.current === key) return
    scrollKeyRef.current = key
    const scroller = scrollerRef.current
    if (!scroller) return
    const preferred = selectedTaskId
      ? visibleTasks.find((task) => task.id === selectedTaskId)
      : visibleTasks[0]
    if (!preferred) {
      scroller.scrollLeft = 0
      return
    }
    const column = statusColumn(preferred.status)
    const target = scroller.querySelector<HTMLElement>(`[data-column="${column}"]`)
    if (!target) return
    const left = Math.max(0, target.offsetLeft - 12)
    if (typeof scroller.scrollTo === 'function') {
      scroller.scrollTo({ left, behavior: 'smooth' })
    } else {
      scroller.scrollLeft = left
    }
  }, [expanded, filter, pinned, query, selectedTaskId, visibleTasks])

  const todoTasks = visibleTasks.filter((task) => task.status === 'todo')
  // 任务列表或 workspace 变化后，选择集里可能留下已不在当前看板的 id；提交前必须收敛。
  const activeSelected = new Set(
    [...selected].filter((id) => todoTasks.some((task) => task.id === id)),
  )

  if (!expanded && !pinned) return null
  const grouped = groupTasks(visibleTasks)
  // “待安排”只跟 agent 是否已有任务有关，不受筛选影响。
  const taskNodeIds = new Set(tasks.map((task) => task.nodeId).filter(Boolean))
  const unplanned = agentNodes.filter((node) => node.type === 'agent' && !taskNodeIds.has(node.id))

  const exitSelection = () => {
    setSelecting(false)
    setSelected(new Set())
  }

  const toggle = (taskId: string) => {
    setSelected((previous) => {
      const next = new Set([...previous].filter((id) => todoTasks.some((task) => task.id === id)))
      if (next.has(taskId)) {
        next.delete(taskId)
      } else if (next.size < BATCH_LIMIT) {
        next.add(taskId)
      }
      return next
    })
  }

  const selectAll = () => {
    setSelected(new Set(todoTasks.slice(0, BATCH_LIMIT).map((task) => task.id)))
  }

  const startBatch = async () => {
    if (batching || activeSelected.size === 0) return
    setBatching(true)
    let started = 0
    let failed = 0
    for (const taskId of activeSelected) {
      try {
        await send({ type: 'task.enqueue', payload: { taskId } })
        started += 1
      } catch {
        failed += 1
      }
    }
    setBatching(false)
    await queryClient.invalidateQueries({ queryKey: ['tasks'] })
    if (failed > 0) {
      toast.danger(`已开工 ${started} 个，${failed} 个失败`)
    } else {
      toast.success(`已开工 ${started} 个`)
    }
    exitSelection()
  }

  const refreshTask = async (task: TaskSummary) => {
    await invalidateTaskQueries(queryClient, task.id, task.workspaceId)
  }

  const applyDrop = async (task: TaskSummary, column: BoardColumnId) => {
    const action = taskDropAction(task, column)
    if (action.kind === 'none') {
      toast.info(action.reason)
      return
    }
    if (action.kind === 'cancel') {
      setCancelTarget(task)
      return
    }
    if (dropPending) return
    setDropPending(true)
    try {
      if (action.kind === 'approve') {
        const detail = await getTask(task.id)
        const review = detail.review
        if (!review) {
          toast.info('没有可验收的记录')
          return
        }
        if (review.verdict) {
          toast.info('该任务已经验收')
          return
        }
        const acceptance = detail.acceptance
        if (needsAcceptanceOverride(review, acceptance)) {
          toast.info('该任务需要填写通过理由，请在任务详情中通过验收')
          onSelectTask(task.id)
          return
        }
        await send({
          type: 'review.decide',
          payload: { reviewId: review.id, decision: 'approve' },
        })
        toast.success('已通过验收')
      } else if (action.kind === 'enqueue') {
        await send({ type: 'task.enqueue', payload: { taskId: task.id } })
        toast.success('已开工')
      } else if (action.kind === 'retry') {
        await send({ type: 'task.retry', payload: { taskId: task.id } })
        toast.success('已重试')
      } else if (action.kind === 'reopen') {
        await send({ type: 'task.reopen', payload: { taskId: task.id } })
        toast.success('已重新打开')
      }
      // 命令已落库；刷新放后台，避免拖完下一张卡时还被上一轮的 pending 拦住。
      void refreshTask(task)
    } catch (cause) {
      toast.danger(cause instanceof Error ? cause.message : '任务状态更新失败')
    } finally {
      setDropPending(false)
    }
  }

  const confirmCancel = async () => {
    if (!cancelTarget || dropPending) return
    const task = cancelTarget
    setDropPending(true)
    try {
      await send({ type: 'task.cancel', payload: { taskId: task.id } })
      toast.success('已取消任务')
      setCancelTarget(null)
      void refreshTask(task)
    } catch (cause) {
      toast.danger(cause instanceof Error ? cause.message : '取消任务失败')
    } finally {
      setDropPending(false)
    }
  }

  const finishDrag = (x: number, y: number) => {
    const current = dragRef.current
    dragRef.current = null
    setDrag(null)
    if (!current) return
    // 拖拽结束后浏览器仍可能补发 click；短暂屏蔽，避免顺手打开任务详情。
    suppressClickUntilRef.current = Date.now() + 500
    const target = columnAtPoint(x, y)
    if (!target || target === statusColumn(current.task.status)) return
    void applyDrop(current.task, target)
  }

  const beginPress = (event: ReactPointerEvent<HTMLDivElement>, task: TaskSummary) => {
    if (selecting || dropPending || cancelTarget || pressRef.current) return
    if (event.pointerType === 'mouse' && event.button !== 0) return
    const pointerId = event.pointerId
    const startX = event.clientX
    const startY = event.clientY
    const timer = window.setTimeout(() => {
      const press = pressRef.current
      if (!press || press.activated) return
      press.activated = true
      const next: DragSession = {
        task,
        x: startX,
        y: startY,
        target: columnAtPoint(startX, startY),
      }
      dragRef.current = next
      setDrag(next)
    }, LONG_PRESS_MS)
    pressRef.current = { task, startX, startY, pointerId, timer, activated: false }

    const cleanup = () => {
      const press = pressRef.current
      if (press) window.clearTimeout(press.timer)
      pressRef.current = null
      if (moveFrameRef.current !== null) {
        cancelFrame(moveFrameRef.current)
        moveFrameRef.current = null
      }
      pendingMoveRef.current = null
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('blur', blur)
      cleanupPressRef.current = null
    }
    const move = (moveEvent: PointerEvent) => {
      const press = pressRef.current
      if (!press || moveEvent.pointerId !== press.pointerId) return
      // pointerup 丢失（拖出窗口、系统手势取消）时的兜底：鼠标移动已无按键即视为松开。
      if (moveEvent.pointerType === 'mouse' && moveEvent.buttons === 0) {
        const wasActive = press.activated
        const { clientX, clientY } = moveEvent
        cleanup()
        if (wasActive) {
          finishDrag(clientX, clientY)
        } else {
          dragRef.current = null
          setDrag(null)
        }
        return
      }
      if (!press.activated) {
        if (
          Math.hypot(moveEvent.clientX - press.startX, moveEvent.clientY - press.startY) >
          PRESS_MOVE_TOLERANCE
        ) {
          cleanup()
        }
        return
      }
      moveEvent.preventDefault()
      pendingMoveRef.current = { x: moveEvent.clientX, y: moveEvent.clientY }
      if (moveFrameRef.current !== null) return
      moveFrameRef.current = scheduleFrame(() => {
        moveFrameRef.current = null
        const point = pendingMoveRef.current
        pendingMoveRef.current = null
        if (!point) return
        const current = dragRef.current
        if (!current) return
        const next: DragSession = {
          ...current,
          x: point.x,
          y: point.y,
          target: columnAtPoint(point.x, point.y),
        }
        dragRef.current = next
        setDrag(next)
        const scroller = scrollerRef.current
        if (!scroller) return
        const rect = scroller.getBoundingClientRect()
        if (point.x < rect.left + EDGE_SCROLL_PX) {
          scroller.scrollLeft -= 18
        } else if (point.x > rect.right - EDGE_SCROLL_PX) {
          scroller.scrollLeft += 18
        }
      })
    }
    const up = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return
      const wasActive = pressRef.current?.activated ?? false
      cleanup()
      if (wasActive) finishDrag(upEvent.clientX, upEvent.clientY)
    }
    const cancel = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId !== pointerId) return
      cleanup()
      dragRef.current = null
      setDrag(null)
    }
    const blur = () => {
      cleanup()
      dragRef.current = null
      setDrag(null)
    }
    cleanupPressRef.current = cleanup
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('blur', blur)
  }

  const selectTask = (taskId: string) => {
    if (Date.now() < suppressClickUntilRef.current) return
    onSelectTask(taskId)
  }

  const openScene = onOpenScene
    ? (taskId: string) => {
        if (Date.now() < suppressClickUntilRef.current) return
        onOpenScene(taskId)
      }
    : undefined

  const board = (
    <>
      <section id="task-board" className="flex h-full min-h-0 flex-col bg-background">
        <header className="flex min-h-11 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-separator px-3 py-1.5">
          <span className="text-sm font-medium">任务看板</span>
          <div className="flex items-center gap-1">
            {selecting ? (
              <>
                <Button
                  variant="tertiary"
                  size="sm"
                  isDisabled={todoTasks.length === 0 || batching}
                  onPress={selectAll}
                >
                  全选待办
                </Button>
                <Button variant="tertiary" size="sm" isDisabled={batching} onPress={exitSelection}>
                  取消
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  isDisabled={
                    activeSelected.size === 0 || activeSelected.size > BATCH_LIMIT || batching
                  }
                  onPress={() => void startBatch()}
                >
                  开工 {activeSelected.size} 个
                </Button>
              </>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                isDisabled={todoTasks.length === 0}
                onPress={() => {
                  setSelecting(true)
                  setSelected(new Set())
                }}
              >
                批量开工
              </Button>
            )}
            <Button variant="ghost" aria-label="关闭看板" onPress={onClose} className="h-8 w-8 p-0">
              <X size={16} />
            </Button>
          </div>
        </header>
        <TaskBoardFilters filter={filter} query={query} onFilter={setFilter} onQuery={setQuery} />
        {selecting ? (
          <p className="shrink-0 border-b border-separator px-3 py-1 text-xs text-muted">
            仅待办任务可开工，已选 {activeSelected.size} / 上限 {BATCH_LIMIT}。
          </p>
        ) : null}
        <div ref={scrollerRef} className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3">
          {BOARD_COLUMNS.map((column) => (
            <BoardColumn
              key={column.id}
              column={column.id}
              label={column.label}
              tasks={column.id === 'unplanned' ? [] : grouped[column.id]}
              unplanned={column.id === 'unplanned' ? unplanned : []}
              selectedTaskId={selectedTaskId}
              selecting={selecting}
              selected={selected}
              onToggle={toggle}
              onSelectTask={selectTask}
              onOpenScene={openScene}
              dragActive={drag !== null}
              dropTarget={drag?.target === column.id}
              canDrop={drag ? isDroppable(drag.task, column.id) : false}
              draggingTaskId={drag?.task.id ?? null}
              draggable={!selecting && !dropPending}
              onDragPointerDown={beginPress}
            />
          ))}
        </div>
      </section>
      {drag ? (
        <div
          data-testid="task-drag-preview"
          className="pointer-events-none fixed z-50 max-w-[260px] rounded-lg border border-accent bg-surface p-3 text-sm shadow-overlay"
          style={{
            left: Math.max(8, Math.min(drag.x + 12, window.innerWidth - 272)),
            top: Math.max(8, Math.min(drag.y + 12, window.innerHeight - 72)),
          }}
        >
          <span className="line-clamp-2 font-medium">{drag.task.title}</span>
          <p className="mt-1 text-xs text-muted">
            {BOARD_COLUMNS.find((item) => item.id === drag.target)?.label ?? '拖到其他列'}
          </p>
        </div>
      ) : null}
      <ConfirmDialog
        open={cancelTarget !== null}
        title="取消任务？"
        description={`将「${cancelTarget?.title ?? ''}」移到已取消。执行中的任务会被中断。`}
        confirmLabel="确认取消"
        onConfirm={confirmCancel}
        onOpenChange={(open) => {
          if (!open && !dropPending) setCancelTarget(null)
        }}
      />
    </>
  )

  if (pinned) {
    return (
      <div
        data-testid="task-board"
        className={
          compact
            ? 'w-[min(420px,72vw)] shrink-0 border-r border-separator'
            : 'w-[560px] shrink-0 border-r border-separator'
        }
      >
        {board}
      </div>
    )
  }

  return (
    <div
      data-testid="task-board-overlay"
      className="fixed top-14 bottom-0 right-0 left-16 z-30 border-t border-separator shadow-overlay"
    >
      {board}
    </div>
  )
}

function BoardColumn({
  column,
  label,
  tasks,
  unplanned,
  selectedTaskId,
  selecting,
  selected,
  onToggle,
  onSelectTask,
  onOpenScene,
  dragActive,
  dropTarget,
  canDrop,
  draggingTaskId,
  draggable,
  onDragPointerDown,
}: {
  column: BoardColumnId
  label: string
  tasks: TaskSummary[]
  unplanned: Node[]
  selectedTaskId: string | null
  selecting: boolean
  selected: Set<string>
  onToggle: (taskId: string) => void
  onSelectTask: (taskId: string) => void
  onOpenScene?: (taskId: string) => void
  dragActive: boolean
  dropTarget: boolean
  canDrop: boolean
  draggingTaskId: string | null
  draggable: boolean
  onDragPointerDown: (event: ReactPointerEvent<HTMLDivElement>, task: TaskSummary) => void
}) {
  const columnClass = [
    'flex min-w-[168px] flex-1 flex-col gap-2 rounded-lg transition-colors',
    dragActive && canDrop ? 'ring-1 ring-accent/30' : '',
    dropTarget && canDrop ? 'bg-accent/10 ring-2 ring-accent' : '',
    dropTarget && !canDrop ? 'bg-danger/5 ring-2 ring-danger/40' : '',
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <div
      className={columnClass}
      data-column={column}
      data-drop-target={dropTarget ? (canDrop ? 'valid' : 'invalid') : undefined}
    >
      <div className="flex items-center justify-between text-xs text-muted">
        <span className="font-medium text-foreground">{label}</span>
        <span>{tasks.length + unplanned.length}</span>
      </div>
      {tasks.map((task) => (
        <TaskCard
          key={task.id}
          task={task}
          selected={selecting ? selected.has(task.id) : task.id === selectedTaskId}
          selectable={selecting}
          stale={isStale(task.waitingSince, Date.now())}
          draggable={draggable}
          dragging={draggingTaskId === task.id}
          onSelect={onSelectTask}
          onToggle={onToggle}
          onDragPointerDown={onDragPointerDown}
          {...(onOpenScene ? { onOpenScene } : {})}
        />
      ))}
      {unplanned.map((node) => (
        <div
          key={node.id}
          className="rounded-lg border border-dashed border-separator p-3 text-xs text-muted"
        >
          {node.type === 'agent' ? node.data.title : node.id}
        </div>
      ))}
      {tasks.length === 0 && unplanned.length === 0 ? (
        <div className="rounded-lg border border-dashed border-separator p-3 text-xs text-muted">
          暂无任务
        </div>
      ) : null}
    </div>
  )
}
