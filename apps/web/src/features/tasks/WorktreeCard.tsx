import { Button } from '@heroui/react/button'
import { useState } from 'react'
import { cleanupWorktree } from '../../lib/api'

export function WorktreeCard({
  taskId,
  worktreePath,
  canCleanup,
  onDone,
}: {
  taskId: string
  worktreePath: string | null
  canCleanup: boolean
  onDone: () => Promise<void> | void
}) {
  const [confirming, setConfirming] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!worktreePath) {
    return null
  }

  const clean = async () => {
    setPending(true)
    setError(null)
    try {
      await cleanupWorktree(taskId)
      await onDone()
      setConfirming(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '清理工作树失败')
    } finally {
      setPending(false)
    }
  }

  return (
    <section
      data-testid="worktree-card"
      className="shrink-0 rounded-lg border border-separator bg-surface p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">独立工作树</h3>
        <span className="font-mono text-xs text-muted">baton/{taskId.slice(0, 8)}</span>
      </div>
      <p className="mt-1 text-xs text-muted">
        任务在独立目录执行；清理只移除工作树，分支会保留，未提交改动会丢弃。
      </p>
      {canCleanup ? (
        confirming ? (
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-xs text-warning">确认清理工作树？分支会保留，未提交改动会丢弃。</p>
            <div className="flex gap-2">
              <Button size="sm" variant="tertiary" onPress={() => setConfirming(false)}>
                返回
              </Button>
              <Button size="sm" variant="danger" isDisabled={pending} onPress={() => void clean()}>
                确认清理
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-2 flex justify-end">
            <Button size="sm" variant="tertiary" onPress={() => setConfirming(true)}>
              清理工作树
            </Button>
          </div>
        )
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      ) : null}
    </section>
  )
}
