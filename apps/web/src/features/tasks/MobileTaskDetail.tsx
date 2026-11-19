import { ArrowLeft } from 'lucide-react'
import type { ReactNode } from 'react'

export function MobileTaskDetail({
  children,
  onClose,
}: {
  children: ReactNode
  onClose: () => void
}) {
  return (
    <div
      data-testid="mobile-task-detail"
      className="fixed inset-0 z-40 flex flex-col bg-background"
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-separator px-3">
        <button
          type="button"
          aria-label="返回看板"
          onClick={onClose}
          className="inline-flex h-11 w-11 items-center justify-center rounded-md focus-visible:outline-2 focus-visible:outline-accent"
        >
          <ArrowLeft size={18} />
        </button>
        <span className="text-sm font-medium">任务详情</span>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  )
}
