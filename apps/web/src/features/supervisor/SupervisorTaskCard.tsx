import type { SupervisorTaskCard as SupervisorTaskCardData } from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { Chip } from '@heroui/react/chip'
import { useAppStore } from '../../stores/app'

export function SupervisorTaskCard({ card }: { card: SupervisorTaskCardData }) {
  const openTask = () => {
    useAppStore.getState().openStage(card.taskId)
  }
  return (
    <section
      aria-label={`任务 ${card.title}`}
      className="rounded-lg border border-separator bg-background p-3"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 text-sm font-medium text-foreground">{card.title}</h3>
        <Chip size="sm" variant="soft" color={card.status === 'queued' ? 'accent' : 'default'}>
          {card.status === 'queued' ? '已开工' : '待办'}
        </Chip>
      </div>
      <p className="mt-1 text-xs text-muted">
        目标 Agent：{card.target.title} · 上下文 {card.contextCount} 个
      </p>
      <p className="mt-2 text-xs text-warning">
        {card.status === 'queued'
          ? '任务已开工，完成后回到验收；验收仍由你决定。'
          : '需要你点「立即开工」，总管不会自动开始。'}
      </p>
      <Button variant="secondary" size="sm" className="mt-2" onPress={openTask}>
        打开任务
      </Button>
    </section>
  )
}
