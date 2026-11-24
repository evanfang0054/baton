import type {
  AttentionInboxItem,
  AttentionInboxResponse,
  DeliverySummary,
  Workspace,
} from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { useQueries } from '@tanstack/react-query'
import { ChevronRight, LayoutDashboard, Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { listDeliveries } from '../../lib/api'
import { queryKeys } from '../../lib/query'
import type { DeliveryView } from '../../stores/app'
import { DeliveryCard } from '../deliveries/DeliveryCard'
import { formatWaiting } from '../deliveries/delivery-labels'

export function ProjectTree({
  workspaces,
  attention,
  activeWorkspaceId,
  activeDeliveryId,
  deliveryView,
  onCreateProject,
  onCreateDelivery,
  onOpenBoard,
  onOpenDelivery,
  onOpenAttention,
}: {
  workspaces: Workspace[]
  attention: AttentionInboxResponse | null
  activeWorkspaceId: string | null
  activeDeliveryId: string | null
  deliveryView: DeliveryView
  onCreateProject: () => void
  onCreateDelivery: (workspaceId: string) => void
  onOpenBoard: (workspaceId: string) => void
  onOpenDelivery: (workspaceId: string, deliveryId: string) => void
  onOpenAttention: (item: AttentionInboxItem) => void
}) {
  const [expanded, setExpanded] = useState<string[]>(() =>
    activeWorkspaceId ? [activeWorkspaceId] : [],
  )
  const [notificationsOpen, setNotificationsOpen] = useState(true)

  useEffect(() => {
    if (!activeWorkspaceId) return
    setExpanded((prev) => (prev.includes(activeWorkspaceId) ? prev : [...prev, activeWorkspaceId]))
  }, [activeWorkspaceId])

  const deliveryQueries = useQueries({
    queries: workspaces.map((workspace) => ({
      queryKey: queryKeys.deliveries(workspace.id),
      queryFn: () => listDeliveries(workspace.id),
      enabled: expanded.includes(workspace.id),
    })),
  })

  const items = attention?.items ?? []
  const total = attention?.total ?? 0
  const attentionCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of items) {
      counts.set(item.workspaceId, (counts.get(item.workspaceId) ?? 0) + 1)
    }
    return counts
  }, [items])

  const toggle = (workspaceId: string) => {
    setExpanded((prev) =>
      prev.includes(workspaceId)
        ? prev.filter((id) => id !== workspaceId)
        : [...prev, workspaceId],
    )
  }

  return (
    <aside
      aria-label="项目与需求"
      className="flex w-72 shrink-0 flex-col border-r border-separator bg-surface"
    >
      <div className="border-b border-separator">
        <button
          type="button"
          onClick={() => setNotificationsOpen((open) => !open)}
          aria-expanded={notificationsOpen}
          aria-label={`通知 ${total}`}
          className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-default/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <span className="flex-1 text-xs font-medium text-muted">通知 {total}</span>
          <ChevronRight
            size={14}
            aria-hidden="true"
            className={`text-muted transition-transform ${notificationsOpen ? 'rotate-90' : ''}`}
          />
        </button>
        {notificationsOpen ? (
          attention === null ? (
            <p className="px-3 pb-3 text-xs text-muted">正在加载通知…</p>
          ) : items.length === 0 ? (
            <p className="px-3 pb-3 text-xs text-muted">没有需要你处理的</p>
          ) : (
            <ul className="max-h-[40vh] space-y-1 overflow-y-auto px-2 pb-2">
              {items.map((item) => (
                <li key={item.taskId}>
                  <button
                    type="button"
                    onClick={() => onOpenAttention(item)}
                    className="w-full rounded-md border border-separator bg-default/30 px-2 py-1.5 text-left hover:border-accent/50 hover:bg-default/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    aria-label={`${item.workspaceName} ${item.deliveryTitle} ${item.title}`}
                  >
                    <span className="block truncate text-xs text-foreground">
                      {item.deliveryTitle} · {item.title}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-muted">
                      {item.workspaceName}
                      {item.waitingSince ? ` · 等待 ${formatWaiting(item.waitingSince)}` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>

      <div className="flex items-center gap-2 border-b border-separator px-3 py-2">
        <span className="text-xs font-medium text-muted">项目</span>
        <Button
          size="sm"
          variant="primary"
          isIconOnly
          aria-label="新建项目"
          className="ml-auto"
          onPress={onCreateProject}
        >
          <Plus size={14} aria-hidden="true" />
        </Button>
      </div>

      <div aria-label="项目树" className="min-h-0 flex-1 overflow-y-auto p-2">
        {workspaces.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted">还没有项目</p>
        ) : (
          workspaces.map((workspace, index) => {
            const isExpanded = expanded.includes(workspace.id)
            const query = deliveryQueries[index]
            const deliveries: DeliverySummary[] = query?.data ?? []
            const boardActive = deliveryView === 'board' && activeWorkspaceId === workspace.id
            return (
              <div key={workspace.id} className="rounded-lg">
                <button
                  type="button"
                  onClick={() => toggle(workspace.id)}
                  aria-expanded={isExpanded}
                  className="flex w-full items-center gap-1 rounded-md px-1.5 py-1.5 text-left hover:bg-default/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  aria-label={`${isExpanded ? '收起' : '展开'}项目 ${workspace.name}${
                    attentionCounts.get(workspace.id)
                      ? `，${attentionCounts.get(workspace.id)} 条通知`
                      : ''
                  }`}
                >
                  <ChevronRight
                    size={14}
                    aria-hidden="true"
                    className={`shrink-0 text-muted transition-transform ${
                      isExpanded ? 'rotate-90' : ''
                    }`}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                    {workspace.name}
                  </span>
                  {attentionCounts.get(workspace.id) ? (
                    <span
                      aria-hidden="true"
                      className="flex shrink-0 items-center gap-1 text-[10px] text-warning"
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-warning" />
                      {attentionCounts.get(workspace.id)}
                    </span>
                  ) : null}
                </button>

                {isExpanded ? (
                  <div className="ml-4 border-l border-separator pb-2 pl-2">
                    <button
                      type="button"
                      onClick={() => onOpenBoard(workspace.id)}
                      className={`flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                        boardActive
                          ? 'bg-accent/10 text-accent'
                          : 'text-muted hover:bg-default/40 hover:text-foreground'
                      }`}
                    >
                      <LayoutDashboard size={12} aria-hidden="true" />
                      需求看板
                    </button>

                    {query?.isLoading ? (
                      <p className="px-2 py-1 text-[11px] text-muted">加载需求…</p>
                    ) : null}
                    {deliveries.map((delivery) => (
                      <div
                        key={delivery.id}
                        className={`mt-1 rounded-lg ${
                          activeDeliveryId === delivery.id ? 'ring-1 ring-accent' : ''
                        }`}
                      >
                        <DeliveryCard
                          delivery={delivery}
                          compact
                          onSelect={() => onOpenDelivery(workspace.id, delivery.id)}
                        />
                      </div>
                    ))}
                    {!query?.isLoading && deliveries.length === 0 ? (
                      <p className="px-2 py-1 text-[11px] text-muted">还没有需求</p>
                    ) : null}

                    <button
                      type="button"
                      onClick={() => onCreateDelivery(workspace.id)}
                      className="mt-1 flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left text-xs text-muted hover:bg-default/40 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    >
                      <Plus size={12} aria-hidden="true" />
                      新建需求
                    </button>
                  </div>
                ) : null}
              </div>
            )
          })
        )}
      </div>
    </aside>
  )
}
