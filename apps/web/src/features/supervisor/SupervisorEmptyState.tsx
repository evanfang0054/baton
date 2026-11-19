import { Button } from '@heroui/react/button'
import { Sparkles } from 'lucide-react'

const QUICK_PROMPTS = [
  '看一下当前所有任务的状态，有哪些需要我处理？',
  '把当前选中的上下文整理成一个待办任务。',
]

export function SupervisorEmptyState({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-dashed border-separator p-4">
      <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
        <Sparkles size={16} className="text-accent" aria-hidden="true" />
        把画布上的上下文交给总管
      </p>
      <p className="text-xs text-muted">
        总管可以创建文本/Agent
        节点、建任务并按你的要求开工；验收仍由你决定。开启工作区自动化后，低/中风险操作会按策略自动批准。
      </p>
      <div className="flex flex-wrap gap-2">
        {QUICK_PROMPTS.map((prompt) => (
          <Button key={prompt} variant="secondary" size="sm" onPress={() => onPick(prompt)}>
            {prompt}
          </Button>
        ))}
      </div>
    </div>
  )
}
