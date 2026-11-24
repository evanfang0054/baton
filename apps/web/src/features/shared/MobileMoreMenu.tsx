import { Button } from '@heroui/react/button'
import type { ReactNode } from 'react'

export function MobileMoreMenu({
  open,
  onOpenChange,
  onOpenTask,
  onOpenNodes,
  onCreateWorkspace,
  automationSlot,
  trustSlot,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenTask?: () => void
  onOpenNodes?: () => void
  onCreateWorkspace: () => void
  automationSlot: ReactNode
  trustSlot: ReactNode
}) {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-40 flex flex-col justify-end bg-background/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="更多操作"
    >
      <button
        type="button"
        aria-label="关闭更多操作"
        className="flex-1"
        onClick={() => onOpenChange(false)}
      />
      <div className="shrink-0 rounded-t-2xl border-t border-separator bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium">更多</h2>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="inline-flex h-11 w-11 items-center justify-center rounded-md"
            aria-label="关闭"
          >
            ×
          </button>
        </div>
        <div className="flex flex-col gap-2">
          {onOpenTask ? (
            <Button variant="secondary" onPress={onOpenTask}>
              新建任务
            </Button>
          ) : null}
          {onOpenNodes ? (
            <Button variant="secondary" onPress={onOpenNodes}>
              节点列表
            </Button>
          ) : null}
          <Button variant="secondary" onPress={onCreateWorkspace}>
            创建项目
          </Button>
          <div className="rounded-lg border border-separator p-3">{automationSlot}</div>
          <div className="rounded-lg border border-separator p-3">{trustSlot}</div>
        </div>
      </div>
    </div>
  )
}
