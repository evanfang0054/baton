import type { Engine, Node } from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { Input } from '@heroui/react/input'
import { TextArea } from '@heroui/react/textarea'
import { toast } from '@heroui/react/toast'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { getWorkspaceCapabilities, listEngines } from '../../lib/api'
import { useCommand } from '../../lib/command-context'
import { queryKeys } from '../../lib/query'
import { nodeTitle } from '../canvas/node-title'
import { NodePicker } from '../shared/NodePicker'
import { preferredEngine } from './engine-preference'

export function MobileCreateTaskForm({
  workspaceId,
  canvasId,
  workspaceTrusted,
  nodes,
  onCreated,
  onCancel,
}: {
  workspaceId: string
  canvasId: string
  workspaceTrusted: boolean
  nodes: Node[]
  onCreated: (taskId: string) => void
  onCancel: () => void
}) {
  const send = useCommand()
  const queryClient = useQueryClient()
  const engines = useQuery({ queryKey: queryKeys.engines, queryFn: listEngines })
  const capabilities = useQuery({
    queryKey: queryKeys.workspaceCapabilities(workspaceId),
    queryFn: () => getWorkspaceCapabilities(workspaceId),
  })
  const agents = nodes.filter((node) => node.type === 'agent')
  const [agentId, setAgentId] = useState(agents[0]?.id ?? '')
  const [newAgent, setNewAgent] = useState(agents.length === 0)
  const [agentTitle, setAgentTitle] = useState('')
  const [engine, setEngine] = useState<Engine>(agents[0]?.data.engine ?? 'claude-sdk')
  const [contextIds, setContextIds] = useState<string[]>([])
  const [title, setTitle] = useState('')
  const [prompt, setPrompt] = useState('')
  const [verifyCommand, setVerifyCommand] = useState('')
  const [workspaceMode, setWorkspaceMode] = useState<'main' | 'worktree'>('main')
  const [skipPermissions, setSkipPermissions] = useState(false)
  const [createAndStart, setCreateAndStart] = useState(false)
  const [picker, setPicker] = useState<'agent' | 'context' | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const createdTaskId = useRef<string | null>(null)
  const createdAgentNodeId = useRef<string | null>(null)

  const engineOptions = engines.data ?? []
  const defaultEngine = engines.data ? preferredEngine(engines.data) : null
  const effectiveEngine = engineOptions.some((entry) => entry.engine === engine)
    ? engine
    : (defaultEngine ?? 'claude-sdk')
  const selectedEngine = engineOptions.find((entry) => entry.engine === effectiveEngine)
  const disabled =
    !prompt.trim() ||
    pending ||
    !engines.data ||
    engineOptions.length === 0 ||
    engines.isError ||
    selectedEngine?.status === 'unavailable' ||
    (newAgent ? !agentTitle.trim() : !agentId)

  const submit = async () => {
    if (disabled) return
    setPending(true)
    setError(null)
    try {
      let nodeId = agentId
      if (newAgent) {
        if (createdAgentNodeId.current) {
          nodeId = createdAgentNodeId.current
        } else {
          const index = nodes.length
          const result = (await send({
            type: 'node.create',
            payload: {
              canvasId,
              node: {
                type: 'agent',
                x: 80 + (index % 4) * 360,
                y: 80 + Math.floor(index / 4) * 240,
                w: 320,
                h: 200,
                groupId: null,
                data: {
                  title: agentTitle.trim() || '新 Agent',
                  engine: effectiveEngine,
                  taskId: null,
                },
              },
            },
          })) as { nodeId?: string } | undefined
          if (!result?.nodeId) throw new Error('Agent 创建失败')
          createdAgentNodeId.current = result.nodeId
          nodeId = result.nodeId
        }
      }
      let taskId = createdTaskId.current
      if (!taskId) {
        const result = (await send({
          type: 'task.create',
          payload: {
            workspaceId,
            nodeId,
            title: title.trim() || '新任务',
            prompt: prompt.trim(),
            contextNodeIds: contextIds,
            engine: effectiveEngine,
            workspaceMode,
            dangerouslySkipPermissions: skipPermissions && workspaceTrusted,
            ...(verifyCommand.trim() ? { verifyCommand: verifyCommand.trim() } : {}),
          },
        })) as { taskId?: string } | undefined
        if (!result?.taskId) throw new Error('任务创建失败')
        taskId = result.taskId
        createdTaskId.current = taskId
        await queryClient.invalidateQueries({ queryKey: queryKeys.tasks(workspaceId) })
        await queryClient.invalidateQueries({ queryKey: queryKeys.canvas(workspaceId) })
      }
      if (createAndStart) {
        try {
          await send({ type: 'task.enqueue', payload: { taskId } })
        } catch {
          toast.danger('任务已创建，但开工失败，请在看板重试')
        }
      }
      onCreated(taskId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '创建失败')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-separator px-3">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex h-11 min-w-11 items-center justify-center rounded-md text-sm text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          取消
        </button>
        <h2 className="text-sm font-medium">新建任务</h2>
        <span className="w-11" />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 pb-[calc(6rem+env(safe-area-inset-bottom))]">
        <section className="mb-3 rounded-lg border border-separator p-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-medium">Agent</h3>
            <Button size="sm" variant="tertiary" onPress={() => setNewAgent(!newAgent)}>
              {newAgent ? '选择已有' : '新建 Agent'}
            </Button>
          </div>
          {newAgent ? (
            <div className="flex flex-col gap-2">
              <Input
                aria-label="Agent 标题"
                placeholder="Agent 标题"
                value={agentTitle}
                onChange={(event) => setAgentTitle(event.target.value)}
                fullWidth
              />
              <select
                aria-label="Agent 引擎"
                value={effectiveEngine}
                onChange={(event) => setEngine(event.target.value as Engine)}
                className="h-11 rounded-lg border border-separator bg-background px-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                {engineOptions.map((entry) => (
                  <option
                    key={entry.engine}
                    value={entry.engine}
                    disabled={entry.status === 'unavailable'}
                  >
                    {entry.engine}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setPicker('agent')}
              className="min-h-11 w-full rounded-lg border border-separator px-3 text-left text-sm"
            >
              {agents.find((node) => node.id === agentId)?.data.title ?? '选择 Agent'}
            </button>
          )}
        </section>

        <section className="mb-3 rounded-lg border border-separator p-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-medium">上下文</h3>
            <Button size="sm" variant="tertiary" onPress={() => setPicker('context')}>
              选择节点
            </Button>
          </div>
          <p className="text-xs text-muted">
            已选 {contextIds.length} 个；连线依赖自动包含，可在任务详情核对。
          </p>
          {contextIds.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {contextIds.map((id) => {
                const node = nodes.find((item) => item.id === id)
                return (
                  <span key={id} className="rounded-full border border-separator px-2 py-1 text-xs">
                    {node ? nodeTitle(node) : id}
                  </span>
                )
              })}
            </div>
          ) : null}
        </section>

        <div className="flex flex-col gap-2">
          <Input
            aria-label="任务标题"
            placeholder="任务标题"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            fullWidth
          />
          <TextArea
            aria-label="任务 prompt"
            placeholder="要做什么"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            fullWidth
          />
          <Input
            aria-label="verify 命令"
            placeholder="verify 命令（可选）"
            value={verifyCommand}
            onChange={(event) => setVerifyCommand(event.target.value)}
            fullWidth
          />
          <label className="flex items-start gap-2 text-xs text-muted">
            <input
              type="checkbox"
              aria-label="使用独立工作树"
              checked={workspaceMode === 'worktree'}
              onChange={(event) => setWorkspaceMode(event.target.checked ? 'worktree' : 'main')}
              disabled={capabilities.data?.worktree === false}
              className="mt-0.5 size-4 accent-accent"
            />
            <span>
              使用独立工作树
              <br />
              {capabilities.data?.worktree === false
                ? '该工作区不是 git 仓库。'
                : '任务在独立目录执行，结束后保留。'}
            </span>
          </label>
          <select
            aria-label="任务引擎"
            value={effectiveEngine}
            onChange={(event) => setEngine(event.target.value as Engine)}
            className="h-11 rounded-lg border border-separator bg-background px-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {engineOptions.map((entry) => (
              <option
                key={entry.engine}
                value={entry.engine}
                disabled={entry.status === 'unavailable'}
              >
                {entry.engine}
              </option>
            ))}
          </select>
          {engines.isError ? (
            <p role="alert" className="text-sm text-danger">
              引擎状态加载失败，请稍后重试
            </p>
          ) : null}
          {engines.isLoading ? <p className="text-xs text-muted">引擎状态加载中…</p> : null}
          {workspaceTrusted ? (
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={skipPermissions}
                onChange={(event) => setSkipPermissions(event.target.checked)}
              />
              跳过权限审批
            </label>
          ) : null}
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={createAndStart}
              onChange={(event) => setCreateAndStart(event.target.checked)}
            />
            创建后立即开工
          </label>
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
        </div>
      </div>
      <footer className="flex shrink-0 gap-2 border-t border-separator p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <Button variant="tertiary" onPress={onCancel} className="flex-1">
          取消
        </Button>
        <Button
          variant="primary"
          isDisabled={disabled}
          onPress={() => void submit()}
          className="flex-1"
        >
          {createAndStart ? '创建并开工' : '创建'}
        </Button>
      </footer>

      <NodePicker
        open={picker === 'agent'}
        onOpenChange={(open) => setPicker(open ? 'agent' : null)}
        nodes={agents}
        mode="single"
        value={agentId ? [agentId] : []}
        onChange={(ids) => {
          const id = ids[0] ?? ''
          setAgentId(id)
          const agent = agents.find((node) => node.id === id)
          if (agent?.type === 'agent') setEngine(agent.data.engine)
        }}
        title="选择 Agent"
      />
      <NodePicker
        open={picker === 'context'}
        onOpenChange={(open) => setPicker(open ? 'context' : null)}
        nodes={nodes}
        mode="multi"
        value={contextIds}
        onChange={setContextIds}
        excludeIds={agentId ? [agentId] : []}
        title="选择上下文"
      />
    </div>
  )
}
