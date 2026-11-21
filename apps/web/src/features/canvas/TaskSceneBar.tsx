import { canInjectContext } from '@baton/core'
import type { TaskScene } from '@baton/core'
import type { TaskDetailResponse } from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { StatusChip } from '../tasks/StatusChip'
import { WaitingTime } from '../tasks/WaitingTime'

export function TaskSceneBar({
  scene,
  detail,
  onExit,
  onInject,
}: {
  scene: TaskScene
  detail: TaskDetailResponse
  onExit: () => void
  onInject: () => void
}) {
  const task = detail.task
  const injectionCount = detail.task.context?.injections.length ?? 0
  const injectable = canInjectContext(task).ok
  return (
    <div
      data-testid="task-scene-bar"
      className="absolute top-3 left-1/2 z-20 flex max-w-[calc(100%-2rem)] -translate-x-1/2 flex-wrap items-center gap-3 rounded-lg border border-accent bg-surface px-4 py-2 text-xs shadow-overlay"
      role="region"
      aria-label="任务现场"
    >
      <span className="font-medium text-foreground">{task.title}</span>
      <StatusChip status={task.status} />
      {detail.waitingSince ? <WaitingTime since={detail.waitingSince} /> : null}
      <span className="text-muted">
        上下文 {detail.task.context?.included.length ?? 0} 个{' · '}已注入 {injectionCount} 次
        {scene.missingNodeIds.length > 0 ? ` · ${scene.missingNodeIds.length} 个已失效` : ''}
      </span>
      {detail.review ? (
        <span className="text-muted">verify {detail.review.verifyExitCode}</span>
      ) : null}
      <span title={injectable ? undefined : '当前状态不能投喂；review 请用打回'}>
        <Button size="sm" variant="tertiary" isDisabled={!injectable} onPress={onInject}>
          投喂
        </Button>
      </span>
      <Button size="sm" variant="tertiary" onPress={onExit}>
        回到全局
      </Button>
    </div>
  )
}
