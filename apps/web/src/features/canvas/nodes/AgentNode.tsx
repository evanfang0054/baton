import { Bot } from 'lucide-react'
import { Chip } from '@heroui/react/chip'
import { StatusChip } from '../../tasks/StatusChip'
import { NodeShell, type CanvasFlowNodeProps } from './NodeShell'

export function AgentNode({ data, selected }: CanvasFlowNodeProps) {
  const agent = data.node.type === 'agent' ? data.node.data : null
  return (
    <NodeShell selected={selected}>
      <div className="flex items-center gap-2 text-xs text-muted">
        <Bot size={14} />
        Agent
      </div>
      <p className="mt-2 line-clamp-2 text-sm font-medium text-foreground">{agent?.title ?? ''}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Chip size="sm" variant="soft" color="default">
          {data.task?.engine ?? '未创建任务'}
        </Chip>
        {data.task ? <StatusChip status={data.task.status} /> : null}
      </div>
    </NodeShell>
  )
}
