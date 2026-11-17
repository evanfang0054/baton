import type { Node as ProtocolNode, TaskSummary } from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { Chip } from '@heroui/react/chip'
import { useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useState } from 'react'
import { useCommand } from '../../lib/command-context'
import { queryKeys } from '../../lib/query'
import { CommandError } from '../../lib/ws'
import { CreateTaskForm } from '../tasks/CreateTaskForm'
import { TaskSummaryCard } from '../tasks/TaskSummaryCard'

const typeLabels: Record<ProtocolNode['type'], string> = {
  text: '文本',
  file: '文件',
  agent: 'Agent',
  image: '图片',
  review: '验收',
  group: '分组',
}

function titleOf(node: ProtocolNode): string {
  if (node.type === 'agent') return node.data.title
  if (node.type === 'file') return node.data.name
  if (node.type === 'text') return '文本节点'
  return node.type
}

export function NodePanel({
  node,
  task,
  workspaceId,
  onOpenTask,
  onDeleted,
  onClose,
}: {
  node: ProtocolNode
  task: TaskSummary | null
  workspaceId: string
  onOpenTask: (taskId: string) => void
  onDeleted: () => void
  onClose: () => void
}) {
  const send = useCommand()
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const remove = async () => {
    setPending(true)
    setError(null)
    try {
      await send({ type: 'node.delete', payload: { nodeId: node.id } })
      await queryClient.invalidateQueries({ queryKey: queryKeys.canvas(workspaceId) })
      onDeleted()
    } catch (cause) {
      if (cause instanceof CommandError && cause.code === 'node_in_use') {
        setError('节点被任务引用，先处理任务')
      } else {
        setError(cause instanceof Error ? cause.message : '节点删除失败')
      }
    } finally {
      setPending(false)
      setConfirming(false)
    }
  }

  return (
    <aside
      data-testid="node-detail"
      className="flex min-h-0 w-[380px] shrink-0 flex-col gap-3 overflow-y-auto border-l border-separator bg-surface p-4"
    >
      <header className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs text-muted">{typeLabels[node.type]}</p>
          <h2 className="mt-1 text-base font-medium text-foreground">{titleOf(node)}</h2>
        </div>
        <Button variant="ghost" aria-label="关闭节点详情" onPress={onClose} className="h-8 w-8 p-0">
          <X size={16} />
        </Button>
      </header>

      {node.type === 'text' ? (
        <p className="rounded-lg border border-separator bg-background p-3 text-sm whitespace-pre-wrap text-foreground">
          {node.data.content}
        </p>
      ) : null}
      {node.type === 'file' ? (
        <div className="rounded-lg border border-separator bg-background p-3">
          <p className="text-sm text-foreground">{node.data.name}</p>
          <p className="mt-1 font-mono text-xs text-muted">{node.data.path}</p>
        </div>
      ) : null}
      {node.type === 'agent' ? (
        <div className="flex items-center gap-2">
          <Chip size="sm" variant="soft" color="default">
            {node.data.engine}
          </Chip>
        </div>
      ) : null}

      {node.type === 'agent' && task ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">已创建任务</h3>
          <TaskSummaryCard task={task} />
          <Button variant="secondary" onPress={() => onOpenTask(task.id)}>
            打开任务
          </Button>
        </section>
      ) : null}

      {node.type === 'agent' && !task ? (
        <CreateTaskForm
          nodeId={node.id}
          workspaceId={workspaceId}
          defaultTitle={node.data.title}
          onCreated={onOpenTask}
        />
      ) : null}

      <section className="mt-auto border-t border-separator pt-3">
        {confirming ? (
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-warning">确认删除这个节点？</p>
            <div className="flex gap-2">
              <Button variant="tertiary" onPress={() => setConfirming(false)}>
                返回
              </Button>
              <Button variant="danger" isDisabled={pending} onPress={() => void remove()}>
                确认删除
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="danger-soft" onPress={() => setConfirming(true)}>
            删除节点
          </Button>
        )}
        {error ? (
          <p role="alert" className="mt-2 text-sm text-danger">
            {error}
          </p>
        ) : null}
      </section>
    </aside>
  )
}
