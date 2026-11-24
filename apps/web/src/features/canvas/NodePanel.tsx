import type { Node as ProtocolNode, TaskSummary } from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { Chip } from '@heroui/react/chip'
import { Input } from '@heroui/react/input'
import { TextArea } from '@heroui/react/textarea'
import { toast } from '@heroui/react/toast'
import { useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useCommand } from '../../lib/command-context'
import { queryKeys } from '../../lib/query'
import { CommandError } from '../../lib/ws'
import { CreateTaskForm } from '../tasks/CreateTaskForm'
import { TaskSummaryCard } from '../tasks/TaskSummaryCard'
import { nodeTitle } from './node-title'

const typeLabels: Record<ProtocolNode['type'], string> = {
  text: '文本',
  file: '文件',
  agent: 'Agent',
  image: '图片',
  review: '验收',
  group: '分组',
  artifact: '产物',
  drawing: '画板',
}

const TERMINAL_STATUSES = new Set<TaskSummary['status']>(['done', 'failed', 'cancelled'])

const panelClass = 'flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4'

export function NodePanel({
  node,
  task,
  workspaceId,
  workspaceTrusted,
  contextNodes,
  groupChildCount = 0,
  deliveryId = null,
  stageKey = null,
  onOpenTask,
  onDeleted,
  onClose,
}: {
  node: ProtocolNode
  task: TaskSummary | null
  workspaceId: string
  workspaceTrusted: boolean
  contextNodes: ProtocolNode[]
  groupChildCount?: number
  deliveryId?: string | null
  stageKey?: string | null
  onOpenTask: (taskId: string) => void
  onDeleted: () => void
  onClose: () => void
}) {
  const send = useCommand()
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const editableValue =
    node.type === 'text'
      ? node.data.content
      : node.type === 'agent'
        ? node.data.title
        : node.type === 'image'
          ? (node.data.alt ?? '')
          : node.type === 'group'
            ? node.data.label
            : ''
  const [draft, setDraft] = useState(editableValue)
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const taskActive = task ? !TERMINAL_STATUSES.has(task.status) : false

  // 节点切换或服务端快照更新时，用最新值重置草稿，避免把上一个节点的内容带过来。
  useEffect(() => {
    setDraft(editableValue)
    setEditError(null)
  }, [node.id, editableValue])

  // 节点切换时清掉上一个节点的删除确认，避免误删新选中的节点。
  useEffect(() => {
    setConfirming(false)
    setError(null)
  }, [node.id])

  const saveEdit = async () => {
    if (node.type === 'agent') {
      const next = draft.trim()
      if (!next || next === editableValue || saving) return
      setSaving(true)
      setEditError(null)
      try {
        await send({
          type: 'node.update',
          payload: { nodeId: node.id, patch: { data: { title: next } } },
        })
        await queryClient.invalidateQueries({ queryKey: queryKeys.deliveryCanvases })
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : '节点更新失败'
        setEditError(message)
        toast.danger(message)
      } finally {
        setSaving(false)
      }
      return
    }
    if (node.type === 'text') {
      const next = draft.trim()
      if (!next || next === editableValue || saving) return
      setSaving(true)
      setEditError(null)
      try {
        await send({
          type: 'node.update',
          payload: { nodeId: node.id, patch: { data: { content: draft } } },
        })
        await queryClient.invalidateQueries({ queryKey: queryKeys.deliveryCanvases })
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : '节点更新失败'
        setEditError(message)
        toast.danger(message)
      } finally {
        setSaving(false)
      }
      return
    }
    if (node.type === 'image' || node.type === 'group') {
      const next = draft.trim()
      if ((node.type === 'group' && !next) || next === editableValue || saving) return
      setSaving(true)
      setEditError(null)
      try {
        await send({
          type: 'node.update',
          payload: {
            nodeId: node.id,
            patch: { data: node.type === 'image' ? { alt: draft } : { label: next } },
          },
        })
        await queryClient.invalidateQueries({ queryKey: queryKeys.deliveryCanvases })
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : '节点更新失败'
        setEditError(message)
        toast.danger(message)
      } finally {
        setSaving(false)
      }
    }
  }

  const toggleCollapsed = async () => {
    if (node.type !== 'group' || saving) return
    setSaving(true)
    setEditError(null)
    try {
      await send({
        type: 'node.update',
        payload: { nodeId: node.id, patch: { data: { collapsed: !node.data.collapsed } } },
      })
      await queryClient.invalidateQueries({ queryKey: queryKeys.deliveryCanvases })
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '分组更新失败'
      setEditError(message)
      toast.danger(message)
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    setPending(true)
    setError(null)
    try {
      await send({ type: 'node.delete', payload: { nodeId: node.id } })
      await queryClient.invalidateQueries({ queryKey: queryKeys.deliveryCanvases })
      onDeleted()
    } catch (cause) {
      const message =
        cause instanceof CommandError && cause.code === 'node_in_use'
          ? '节点被任务引用，先处理任务'
          : cause instanceof Error
            ? cause.message
            : '节点删除失败'
      setError(message)
      toast.danger(message)
    } finally {
      setPending(false)
      setConfirming(false)
    }
  }

  return (
    <div data-testid="node-detail" className={panelClass}>
      <header className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs text-muted">{typeLabels[node.type]}</p>
          <h2 className="mt-1 text-base font-medium text-foreground">{nodeTitle(node)}</h2>
        </div>
        <Button variant="ghost" aria-label="关闭节点详情" onPress={onClose} className="h-8 w-8 p-0">
          <X size={16} />
        </Button>
      </header>

      {node.type === 'text' ? (
        <div className="flex flex-col gap-2 rounded-lg border border-separator bg-background p-3">
          <TextArea
            aria-label="文本内容"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={4}
            fullWidth
          />
          <div className="flex justify-end">
            <Button
              variant="secondary"
              isDisabled={saving || !draft.trim() || draft === node.data.content}
              onPress={() => void saveEdit()}
            >
              保存修改
            </Button>
          </div>
          {editError ? (
            <p role="alert" className="text-sm text-danger">
              {editError}
            </p>
          ) : null}
        </div>
      ) : null}
      {node.type === 'file' ? (
        <div className="rounded-lg border border-separator bg-background p-3">
          <p className="text-sm text-foreground">{node.data.name}</p>
          <p className="mt-1 font-mono text-xs text-muted">{node.data.path}</p>
        </div>
      ) : null}
      {node.type === 'image' ? (
        <div className="flex flex-col gap-2 rounded-lg border border-separator bg-background p-3">
          <div>
            <p className="text-sm text-foreground">{node.data.alt || '图片'}</p>
            <p className="mt-1 break-all font-mono text-xs text-muted">{node.data.src}</p>
          </div>
          <Input
            aria-label="图片描述"
            value={draft}
            maxLength={200}
            onChange={(event) => setDraft(event.target.value)}
            fullWidth
          />
          <div className="flex justify-end">
            <Button
              variant="secondary"
              isDisabled={saving || draft === editableValue}
              onPress={() => void saveEdit()}
            >
              保存修改
            </Button>
          </div>
          {editError ? (
            <p role="alert" className="text-sm text-danger">
              {editError}
            </p>
          ) : null}
        </div>
      ) : null}
      {node.type === 'group' ? (
        <div className="flex flex-col gap-2 rounded-lg border border-separator bg-background p-3">
          <p className="text-xs text-muted">{groupChildCount} 个节点</p>
          <Input
            aria-label="分组名称"
            value={draft}
            maxLength={80}
            onChange={(event) => setDraft(event.target.value)}
            fullWidth
          />
          <div className="flex justify-between gap-2">
            <Button variant="tertiary" isDisabled={saving} onPress={() => void toggleCollapsed()}>
              {node.data.collapsed ? '展开分组' : '折叠分组'}
            </Button>
            <Button
              variant="secondary"
              isDisabled={saving || !draft.trim() || draft === editableValue}
              onPress={() => void saveEdit()}
            >
              保存修改
            </Button>
          </div>
          {editError ? (
            <p role="alert" className="text-sm text-danger">
              {editError}
            </p>
          ) : null}
          <p className="text-xs text-muted">删除分组只解绑子节点，不删除内容。</p>
        </div>
      ) : null}
      {node.type === 'agent' ? (
        <>
          <div className="flex items-center gap-2">
            <Chip size="sm" variant="soft" color="default">
              {task?.engine ?? '未创建任务'}
            </Chip>
          </div>
          <div className="flex flex-col gap-2 rounded-lg border border-separator bg-background p-3">
            <Input
              aria-label="节点标题"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              fullWidth
            />
            <div className="flex justify-end">
              <Button
                variant="secondary"
                isDisabled={saving || !draft.trim() || draft === node.data.title}
                onPress={() => void saveEdit()}
              >
                保存修改
              </Button>
            </div>
            {editError ? (
              <p role="alert" className="text-sm text-danger">
                {editError}
              </p>
            ) : null}
          </div>
        </>
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

      {node.type === 'agent' && !taskActive ? (
        <CreateTaskForm
          key={task?.id ?? 'new-task'}
          nodeId={node.id}
          workspaceId={workspaceId}
          workspaceTrusted={workspaceTrusted}
          defaultTitle={node.data.title}
          contextNodes={contextNodes}
          deliveryId={deliveryId}
          stageKey={stageKey}
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
    </div>
  )
}
