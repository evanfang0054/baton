import type { Engine, EngineStatus, Node as ProtocolNode } from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { Input } from '@heroui/react/input'
import { TextArea } from '@heroui/react/textarea'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FileText, Folder, Image as ImageIcon, Type } from 'lucide-react'
import { useEffect, useState } from 'react'
import { listEngines } from '../../lib/api'
import { useCommand } from '../../lib/command-context'
import { queryKeys } from '../../lib/query'
import { useAppStore } from '../../stores/app'
import { nodeTitle } from '../canvas/node-title'
import { preferredEngine } from './engine-preference'

const engineNames: Record<Engine, string> = {
  'claude-sdk': 'Claude Code',
  fake: '演示引擎（fake）',
  pty: 'PTY',
}

const statusLabels: Record<EngineStatus['status'], string> = {
  available: '可用',
  unknown: '未知（将尝试本机登录）',
  unavailable: '不可用',
}

function engineReasonText(reason: string | undefined): string {
  if (!reason) return ''
  if (reason.includes('Keychain cannot be probed')) {
    return '复用本机 Claude Code 登录态（Keychain 无法探测）'
  }
  if (reason.includes('credential found in environment')) return '已检测到环境变量凭据'
  if (reason.includes('Claude Code credentials found')) return '已检测到本机 Claude Code 凭据'
  if (reason.includes('Claude Agent SDK is not installed')) return '未安装 Claude Agent SDK'
  if (reason.includes('not supported in v1')) return 'v1 不支持此引擎'
  return reason
}

function ContextIcon({ type }: { type: ProtocolNode['type'] }) {
  switch (type) {
    case 'text':
      return <Type size={12} />
    case 'file':
      return <FileText size={12} />
    case 'image':
      return <ImageIcon size={12} />
    case 'group':
      return <Folder size={12} />
    default:
      return null
  }
}

export function CreateTaskForm({
  nodeId,
  workspaceId,
  workspaceTrusted,
  defaultTitle,
  contextNodes = [],
  onCreated,
}: {
  nodeId: string
  workspaceId: string
  workspaceTrusted: boolean
  defaultTitle: string
  contextNodes?: ProtocolNode[]
  onCreated: (taskId: string) => void
}) {
  const send = useCommand()
  const queryClient = useQueryClient()
  const removeContextNode = useAppStore((state) => state.removeContextNode)
  const clearContext = useAppStore((state) => state.clearContext)
  const engines = useQuery({ queryKey: queryKeys.engines, queryFn: listEngines })
  const [engine, setEngine] = useState<Engine | null>(null)
  const [title, setTitle] = useState(defaultTitle)
  const [titleEdited, setTitleEdited] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [verifyCommand, setVerifyCommand] = useState('')
  const [skipPermissions, setSkipPermissions] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (engine || !engines.data) return
    setEngine(preferredEngine(engines.data))
  }, [engine, engines.data])

  // 重命名 Agent 节点后，未手动改过任务标题时跟随新标题。
  useEffect(() => {
    if (!titleEdited) setTitle(defaultTitle)
  }, [defaultTitle, titleEdited])

  const selectedEngine = engines.data?.find((entry) => entry.engine === engine)

  const contextNodeIds = contextNodes.filter((node) => node.id !== nodeId).map((node) => node.id)

  const submit = async () => {
    if (!title.trim() || !prompt.trim() || pending || !engine) return
    setPending(true)
    setError(null)
    try {
      const result = (await send({
        type: 'task.create',
        payload: {
          workspaceId,
          nodeId,
          title: title.trim(),
          prompt: prompt.trim(),
          contextNodeIds,
          engine,
          workspaceMode: 'main',
          dangerouslySkipPermissions: skipPermissions && workspaceTrusted,
          ...(verifyCommand.trim() ? { verifyCommand: verifyCommand.trim() } : {}),
        },
      })) as { taskId?: string } | undefined
      await queryClient.invalidateQueries({ queryKey: queryKeys.tasks(workspaceId) })
      if (result?.taskId) onCreated(result.taskId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '任务创建失败')
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="rounded-lg border border-separator bg-background p-3">
      <h3 className="text-sm font-medium">创建任务</h3>
      <div className="mt-2 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2" data-testid="context-chips">
          {contextNodes.length > 0 ? (
            <>
              <span className="text-xs text-muted">已选 {contextNodes.length} 个</span>
              <button
                type="button"
                className="text-xs text-muted underline-offset-2 hover:text-foreground hover:underline"
                onClick={clearContext}
              >
                清空
              </button>
              {contextNodes.map((node) => (
                <span
                  key={node.id}
                  className="inline-flex items-center gap-1 rounded-full border border-separator px-2 py-1 text-xs"
                >
                  <ContextIcon type={node.type} />
                  {nodeTitle(node)}
                  <button
                    type="button"
                    aria-label={`移除 ${nodeTitle(node)}`}
                    className="text-muted hover:text-danger"
                    onClick={() => removeContextNode(node.id)}
                  >
                    ×
                  </button>
                </span>
              ))}
            </>
          ) : (
            <p className="text-xs text-muted">按住 Shift 框选画布节点，或在打开面板前先多选。</p>
          )}
        </div>
        {contextNodes.length > 0 ? (
          <p className="text-xs text-muted">连线依赖会自动包含，可在任务详情核对。</p>
        ) : null}
        <Input
          aria-label="任务标题"
          placeholder="任务标题"
          value={title}
          onChange={(event) => {
            setTitleEdited(true)
            setTitle(event.target.value)
          }}
          fullWidth
        />
        <TextArea
          aria-label="任务说明"
          placeholder="告诉 Agent 要做什么"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          fullWidth
        />
        <Input
          aria-label="验收命令"
          placeholder="验收命令（可选）"
          value={verifyCommand}
          onChange={(event) => setVerifyCommand(event.target.value)}
          fullWidth
        />
        <label className="flex flex-col gap-1 text-xs text-muted">
          <span>执行引擎</span>
          <select
            aria-label="执行引擎"
            value={engine ?? ''}
            onChange={(event) => setEngine(event.target.value as Engine)}
            className="h-8 rounded-lg border border-separator bg-background px-2 text-sm text-foreground"
            disabled={!engines.data || engines.isError}
          >
            {!engine ? <option value="">加载引擎…</option> : null}
            {(engines.data ?? []).map((entry) => (
              <option
                key={entry.engine}
                value={entry.engine}
                disabled={entry.status === 'unavailable'}
              >
                {engineNames[entry.engine]} · {statusLabels[entry.status]}
              </option>
            ))}
          </select>
          {selectedEngine?.reason ? <span>{engineReasonText(selectedEngine.reason)}</span> : null}
        </label>
        <label className="flex items-start gap-2 text-xs text-muted">
          <input
            type="checkbox"
            aria-label="跳过权限确认"
            checked={skipPermissions}
            onChange={(event) => setSkipPermissions(event.target.checked)}
            disabled={!workspaceTrusted}
            className="mt-0.5 size-4 accent-accent"
          />
          <span>
            跳过权限确认（--dangerously-skip-permissions）
            <br />
            {workspaceTrusted
              ? '仅对本任务生效；需服务端开启 BATON_ALLOW_BYPASS_PERMISSIONS。'
              : '仅已信任的工作区可用；先在顶部信任此工作区。'}
          </span>
        </label>
        {engines.isError ? (
          <p role="alert" className="text-sm text-danger">
            引擎状态加载失败
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <Button
          variant="primary"
          isDisabled={!title.trim() || !prompt.trim() || pending || !engine}
          onPress={() => void submit()}
        >
          创建任务
        </Button>
      </div>
    </section>
  )
}
