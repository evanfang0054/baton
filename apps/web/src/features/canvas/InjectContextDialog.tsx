import { canInjectContext } from '@baton/core'
import type { Node, TaskSummary } from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { Modal } from '@heroui/react/modal'
import { TextArea } from '@heroui/react/textarea'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useCommand } from '../../lib/command-context'
import { nodeTitle } from './node-title'

const NODE_TYPE_LABELS: Record<Node['type'], string> = {
  text: '文本',
  file: '文件',
  image: '图片',
  agent: 'Agent',
  review: '验收',
  group: '分组',
}

export function InjectContextDialog({
  open,
  nodes,
  tasks,
  defaultTaskId,
  onOpenChange,
  onDone,
}: {
  open: boolean
  nodes: Node[]
  tasks: TaskSummary[]
  defaultTaskId: string | null
  onOpenChange: (open: boolean) => void
  onDone: () => void
}) {
  const send = useCommand()
  const injectable = useMemo(
    () =>
      tasks.filter(
        (task) => canInjectContext({ status: task.status, waitingReason: task.waitingReason }).ok,
      ),
    [tasks],
  )
  const [taskId, setTaskId] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const wasOpen = useRef(false)

  useEffect(() => {
    if (!open) {
      wasOpen.current = false
      return
    }
    // 只在打开时初始化；任务列表刷新不能清掉用户已输入的说明或重开提交。
    if (wasOpen.current) return
    wasOpen.current = true
    const fallback =
      defaultTaskId === null
        ? (injectable[0]?.id ?? '')
        : injectable.some((task) => task.id === defaultTaskId)
          ? defaultTaskId
          : ''
    setTaskId(fallback)
    setNote('')
    setError(null)
    setPending(false)
  }, [open, defaultTaskId, injectable])

  const estimatedChars =
    note.trim().length +
    nodes.reduce((sum, node) => sum + (node.type === 'text' ? node.data.content.length : 0), 0)

  const submit = async () => {
    if (!taskId || nodes.length === 0) return
    setPending(true)
    setError(null)
    try {
      await send({
        type: 'context.inject',
        payload: {
          taskId,
          nodeIds: nodes.map((node) => node.id),
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      })
      onDone()
      onOpenChange(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '投喂失败')
    } finally {
      setPending(false)
    }
  }

  return (
    <Modal isOpen={open} onOpenChange={onOpenChange}>
      <Modal.Backdrop>
        <Modal.Container>
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>投喂给任务</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <div className="flex flex-col gap-3">
                <label className="flex flex-col gap-1 text-sm">
                  目标任务
                  <select
                    aria-label="目标任务"
                    className="rounded border border-separator bg-background p-2 text-sm"
                    value={taskId}
                    onChange={(event) => setTaskId(event.target.value)}
                  >
                    {taskId === '' ? <option value="">请选择任务</option> : null}
                    {injectable.map((task) => (
                      <option key={task.id} value={task.id}>
                        {task.title}（{task.status}）
                      </option>
                    ))}
                  </select>
                </label>
                <div className="text-xs text-muted">
                  节点 {nodes.length} 个 · 预计至少 {estimatedChars} 字；超预算会被服务端拒绝
                </div>
                <ul className="flex flex-col gap-1 text-xs">
                  {nodes.map((node) => (
                    <li key={node.id} className="flex justify-between gap-2">
                      <span>{nodeTitle(node)}</span>
                      <span className="text-muted">{NODE_TYPE_LABELS[node.type]}</span>
                    </li>
                  ))}
                </ul>
                <label className="flex flex-col gap-1 text-sm">
                  投喂说明
                  <TextArea
                    aria-label="投喂说明"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="为什么补这几个节点（可选）"
                    fullWidth
                  />
                </label>
                {error ? (
                  <p role="alert" className="text-sm text-danger">
                    {error}
                  </p>
                ) : null}
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" onPress={() => onOpenChange(false)}>
                取消
              </Button>
              <Button
                variant="primary"
                isDisabled={pending || !taskId || nodes.length === 0}
                onPress={() => void submit()}
              >
                投喂
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  )
}
