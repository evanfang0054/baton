import type { ReactNode } from 'react'
import type { RightPanelMode } from '../../stores/app'

const TABS: Array<{ mode: RightPanelMode; label: string }> = [
  { mode: 'supervisor', label: '总管' },
  { mode: 'task', label: '任务' },
  { mode: 'node', label: '节点' },
]

const tabClass = [
  'inline-flex items-center rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
].join(' ')

export function RightPanel({
  mode,
  onModeChange,
  hasTask,
  hasNode,
  hasUnreadNotice = false,
  supervisor,
  task,
  node,
}: {
  mode: RightPanelMode
  onModeChange: (mode: RightPanelMode) => void
  hasTask: boolean
  hasNode: boolean
  hasUnreadNotice?: boolean
  supervisor: ReactNode
  task: ReactNode
  node: ReactNode
}) {
  const isAvailable = (candidate: RightPanelMode) =>
    candidate === 'supervisor' ||
    (candidate === 'task' && hasTask) ||
    (candidate === 'node' && hasNode)
  // 选中的任务/节点被关闭后，右栏不能停在空白页。
  const effectiveMode = isAvailable(mode) ? mode : 'supervisor'
  const content = effectiveMode === 'task' ? task : effectiveMode === 'node' ? node : supervisor

  return (
    <aside
      data-testid="right-panel"
      aria-label="右栏"
      className="flex min-h-0 w-[400px] shrink-0 flex-col border-l border-separator bg-surface"
    >
      <div
        role="tablist"
        aria-label="右栏视图"
        className="flex shrink-0 items-center gap-1 border-b border-separator px-2 py-2"
      >
        {TABS.filter((tab) => isAvailable(tab.mode)).map((tab) => {
          const selected = effectiveMode === tab.mode
          return (
            <button
              key={tab.mode}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onModeChange(tab.mode)}
              className={`${tabClass} ${
                selected ? 'bg-default text-default-foreground' : 'text-muted hover:text-foreground'
              }`}
            >
              {tab.label}
              {tab.mode === 'supervisor' && hasUnreadNotice ? (
                <span className="ml-1 inline-flex items-center">
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent" />
                  <span className="sr-only">有未读汇报</span>
                </span>
              ) : null}
            </button>
          )
        })}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">{content}</div>
    </aside>
  )
}
