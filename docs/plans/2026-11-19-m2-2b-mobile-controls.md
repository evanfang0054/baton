---
spec_ref: ../specs/2026-11-19-m2-2b-mobile-console-design.md
spec_topic: m2-2b-mobile-console
task_count: 7
estimated_phases: [tests, implementation, verification]
dod: "移动端可建任务、建/编辑节点、总管带目标/上下文、自动化设置与 kill switch、workspace 信任/创建、固定节点位置；桌面/平板回归"
depends_on: [2026-11-19-m2-2b-mobile-foundation.md, 2026-11-19-m2-2b-mobile-tasks.md]
status: active
---

# M2-2b 移动端响应式控制台：控制面实施计划（Plan 3/4）

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`（推荐）或 `executing-plans` 逐任务执行。步骤用 `- [ ]` 勾选。

**Goal:** 把移动端从“能看任务”补成“能完整控制”：建任务、建/编辑节点、总管带目标/上下文、自动化设置与 kill switch、workspace 信任/创建。

**Architecture:** 复用现有 `node.create` / `node.update` / `task.create` / `supervisor.send` / 自动化 REST；新增共享 `NodePicker`、移动任务表单、移动节点管理、更多菜单。所有写操作仍走现有命令与审计，不新增协议。

**Tech Stack:** React 19、HeroUI v3、TanStack Query、Zustand、vitest + Testing Library、Playwright。

> GDD 显式跳过：本 plan 无后端/状态机变更；测试由 contract DoD 5-11 与 spec §10 移动用例承担。

---

## File Structure

**Create**

- `apps/web/src/features/shared/NodePicker.tsx` + `.test.tsx` — 节点单选/多选。
- `apps/web/src/features/tasks/MobileCreateTaskForm.tsx` + `.test.tsx` — 移动建任务。
- `apps/web/src/features/canvas/MobileNodeManager.tsx` + `.test.tsx` — 节点列表与表单。
- `apps/web/src/features/shared/MobileMoreMenu.tsx` + `.test.tsx` — 移动更多菜单。

**Modify**

- `apps/web/src/features/tasks/MobileBoardList.tsx` — 新建任务入口。
- `apps/web/src/features/supervisor/SupervisorComposer.tsx` — 移动目标/上下文选择器。
- `apps/web/src/features/supervisor/SupervisorPanel.tsx` — 透传 `mobile` / `nodes`。
- `apps/web/src/features/automation/AutomationSettingsDialog.tsx` — `mobile` 全屏。
- `apps/web/src/features/workspaces/WorkspaceTrustDialog.tsx` — `mobile` 全屏。
- `apps/web/src/features/workspaces/CreateWorkspaceDialog.tsx` — 受控 open + `mobile`。
- `apps/web/src/App.tsx` — 更多菜单、任务表单、节点管理、移动 dialogs。

---

## Task 1: `NodePicker`

Blocking: Plan 1
Slice type: tracer-bullet
Seam: 搜索、单选/多选、确认回调

**Files:**

- Create: `apps/web/src/features/shared/NodePicker.tsx`
- Create: `apps/web/src/features/shared/NodePicker.test.tsx`

**Interfaces:**

- Consumes: `Node[]`、`nodeTitle`。
- Produces: `NodePicker({ open, onOpenChange, nodes, mode, value, onChange, excludeIds?, title })`。

- [ ] **Step 1: 写失败测试**

```tsx
import type { Node } from '@baton/protocol'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { NodePicker } from './NodePicker'

function node(id: string, title: string, type: Node['type'] = 'text'): Node {
  return {
    id,
    canvasId: 'c1',
    type,
    x: 0,
    y: 0,
    w: 320,
    h: 200,
    groupId: null,
    createdAt: 1,
    updatedAt: 1,
    data: type === 'agent' ? { title, engine: 'fake', taskId: null } : { content: title },
  } as Node
}

describe('NodePicker', () => {
  it('filters and selects one node', async () => {
    const onChange = vi.fn()
    render(
      <NodePicker
        open
        onOpenChange={() => {}}
        nodes={[node('n1', '需求'), node('n2', '接口', 'file')]}
        mode="single"
        value={[]}
        onChange={onChange}
        title="选择 Agent"
      />,
    )

    await userEvent.type(screen.getByLabelText('搜索节点'), '接口')
    await userEvent.click(screen.getByRole('button', { name: /接口/ }))
    await userEvent.click(screen.getByRole('button', { name: '确定' }))
    expect(onChange).toHaveBeenCalledWith(['n2'])
  })

  it('selects multiple nodes', async () => {
    const onChange = vi.fn()
    render(
      <NodePicker
        open
        onOpenChange={() => {}}
        nodes={[node('n1', 'A'), node('n2', 'B')]}
        mode="multi"
        value={[]}
        onChange={onChange}
        title="选择上下文"
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /A/ }))
    await userEvent.click(screen.getByRole('button', { name: /B/ }))
    await userEvent.click(screen.getByRole('button', { name: '确定' }))
    expect(onChange).toHaveBeenCalledWith(['n1', 'n2'])
  })
})
```

- [ ] **Step 2: 实现**

```tsx
import type { Node } from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { Input } from '@heroui/react/input'
import { useEffect, useMemo, useState } from 'react'
import { nodeTitle } from '../canvas/node-title'

const TYPE_LABELS: Record<string, string> = {
  text: '文本',
  file: '文件',
  agent: 'Agent',
}

export function NodePicker({
  open,
  onOpenChange,
  nodes,
  mode,
  value,
  onChange,
  excludeIds = [],
  title,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  nodes: Node[]
  mode: 'single' | 'multi'
  value: string[]
  onChange: (ids: string[]) => void
  excludeIds?: string[]
  title: string
}) {
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState<string[]>(value)

  useEffect(() => {
    if (!open) return
    setDraft(value)
    setSearch('')
  }, [open, value])

  const available = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return nodes.filter((node) => {
      if (!['text', 'file', 'agent'].includes(node.type)) return false
      if (excludeIds.includes(node.id)) return false
      if (!keyword) return true
      return nodeTitle(node).toLowerCase().includes(keyword)
    })
  }, [nodes, excludeIds, search])

  if (!open) return null

  const toggle = (id: string) => {
    if (mode === 'single') {
      setDraft([id])
      return
    }
    setDraft((previous) =>
      previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id],
    )
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex flex-col bg-background"
    >
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-separator px-3">
        <h2 className="text-sm font-medium">{title}</h2>
        <button
          type="button"
          aria-label="关闭"
          onClick={() => onOpenChange(false)}
          className="inline-flex h-11 w-11 items-center justify-center rounded-md focus-visible:outline-2 focus-visible:outline-accent"
        >
          ×
        </button>
      </header>
      <div className="shrink-0 p-3">
        <Input
          aria-label="搜索节点"
          placeholder="搜索节点标题"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          fullWidth
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {available.length === 0 ? (
          <p className="p-3 text-sm text-muted">没有可选节点</p>
        ) : (
          <div className="flex flex-col gap-2">
            {available.map((node) => {
              const selected = draft.includes(node.id)
              return (
                <button
                  key={node.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => toggle(node.id)}
                  className={`flex min-h-11 items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left ${
                    selected ? 'border-accent bg-surface' : 'border-separator bg-background'
                  }`}
                >
                  <span className="min-w-0 truncate text-sm">{nodeTitle(node)}</span>
                  <span className="shrink-0 text-xs text-muted">{TYPE_LABELS[node.type]}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>
      <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-separator p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <Button variant="tertiary" onPress={() => onOpenChange(false)}>
          取消
        </Button>
        <Button
          variant="primary"
          isDisabled={mode === 'single' ? draft.length !== 1 : draft.length === 0}
          onPress={() => {
            onChange(draft)
            onOpenChange(false)
          }}
        >
          确定
        </Button>
      </footer>
    </div>
  )
}
```

- [ ] **Step 3: 跑测试**

Run: `pnpm --filter @baton/web test -- NodePicker`

Expected: PASS（2 tests）。

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/features/shared/NodePicker.tsx apps/web/src/features/shared/NodePicker.test.tsx
git commit -m "feat(web): 增加移动节点选择器"
```

---

## Task 2: `MobileCreateTaskForm`

Blocking: Task 1
Slice type: tracer-bullet
Seam: 已有/新建 Agent、上下文多选、创建并开工

**Files:**

- Create: `apps/web/src/features/tasks/MobileCreateTaskForm.tsx`
- Create: `apps/web/src/features/tasks/MobileCreateTaskForm.test.tsx`

**Interfaces:**

- Consumes: `workspaceId`、`canvasId`、`workspaceTrusted`、`Node[]`、`listEngines`、`useCommand`。
- Produces: `MobileCreateTaskForm({ workspaceId, canvasId, workspaceTrusted, nodes, onCreated, onCancel })`。

- [ ] **Step 1: 写测试**

```tsx
import type { Node } from '@baton/protocol'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandProvider } from '../../lib/command-context'
import { MobileCreateTaskForm } from './MobileCreateTaskForm'

const { send } = vi.hoisted(() => ({ send: vi.fn() }))

const agent = {
  id: 'a1', canvasId: 'c1', type: 'agent', x: 0, y: 0, w: 320, h: 200, groupId: null,
  createdAt: 1, updatedAt: 1, data: { title: '主 Agent', engine: 'fake', taskId: null },
} as Node

beforeEach(() => {
  send.mockReset()
  send.mockResolvedValue({ taskId: 't1' })
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === '/api/engines') {
      return Response.json({ engines: [{ engine: 'fake', status: 'available' }] })
    }
    return Response.json({})
  }))
})

function renderForm() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onCreated = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <CommandProvider send={send}>
        <MobileCreateTaskForm
          workspaceId="w1"
          canvasId="c1"
          workspaceTrusted
          nodes={[agent]}
          onCreated={onCreated}
          onCancel={() => {}}
        />
      </CommandProvider>
    </QueryClientProvider>,
  )
  return onCreated
}

describe('MobileCreateTaskForm', () => {
  it('creates a task for an existing agent', async () => {
    const onCreated = renderForm()
    await screen.findByLabelText('任务标题')
    await userEvent.type(screen.getByLabelText('任务标题'), '移动任务')
    await userEvent.type(screen.getByLabelText('任务 prompt'), '做一件事')
    await userEvent.click(screen.getByRole('button', { name: '创建' }))

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'task.create',
          payload: expect.objectContaining({ nodeId: 'a1', title: '移动任务' }),
        }),
      ),
    )
    expect(onCreated).toHaveBeenCalledWith('t1')
  })
})
```

- [ ] **Step 2: 实现**

```tsx
import type { Engine, EngineStatus, Node } from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { Input } from '@heroui/react/input'
import { TextArea } from '@heroui/react/textarea'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { listEngines } from '../../lib/api'
import { useCommand } from '../../lib/command-context'
import { queryKeys } from '../../lib/query'
import { NodePicker } from '../shared/NodePicker'
import { nodeTitle } from '../canvas/node-title'

function preferredEngine(engines: EngineStatus[]): Engine | null {
  const claude = engines.find((entry) => entry.engine === 'claude-sdk' && entry.status !== 'unavailable')
  if (claude) return claude.engine
  return engines.find((entry) => entry.engine === 'fake')?.engine ?? null
}

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
  const agents = nodes.filter((node) => node.type === 'agent')
  const [agentId, setAgentId] = useState(agents[0]?.id ?? '')
  const [newAgent, setNewAgent] = useState(agents.length === 0)
  const [agentTitle, setAgentTitle] = useState('')
  const [engine, setEngine] = useState<Engine>('fake')
  const [contextIds, setContextIds] = useState<string[]>([])
  const [title, setTitle] = useState('')
  const [prompt, setPrompt] = useState('')
  const [verifyCommand, setVerifyCommand] = useState('')
  const [skipPermissions, setSkipPermissions] = useState(false)
  const [createAndStart, setCreateAndStart] = useState(false)
  const [picker, setPicker] = useState<'agent' | 'context' | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedEngine = engines.data?.find((entry) => entry.engine === engine)
  const disabled =
    !prompt.trim() ||
    pending ||
    selectedEngine?.status === 'unavailable' ||
    (newAgent ? !agentTitle.trim() : !agentId)

  const submit = async () => {
    if (disabled) return
    setPending(true)
    setError(null)
    try {
      let nodeId = agentId
      if (newAgent) {
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
              data: { title: agentTitle.trim() || '新 Agent', engine, taskId: null },
            },
          },
        })) as { nodeId?: string } | undefined
        if (!result?.nodeId) throw new Error('Agent 创建失败')
        nodeId = result.nodeId
      }
      const result = (await send({
        type: 'task.create',
        payload: {
          workspaceId,
          nodeId,
          title: title.trim() || '新任务',
          prompt: prompt.trim(),
          contextNodeIds: contextIds,
          engine,
          workspaceMode: 'main',
          dangerouslySkipPermissions: skipPermissions && workspaceTrusted,
          ...(verifyCommand.trim() ? { verifyCommand: verifyCommand.trim() } : {}),
        },
      })) as { taskId?: string } | undefined
      await queryClient.invalidateQueries({ queryKey: queryKeys.tasks(workspaceId) })
      await queryClient.invalidateQueries({ queryKey: queryKeys.canvas(workspaceId) })
      if (!result?.taskId) throw new Error('任务创建失败')
      if (createAndStart) {
        await send({ type: 'task.enqueue', payload: { taskId: result.taskId } })
      }
      onCreated(result.taskId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '创建失败')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-separator px-3">
        <button type="button" onClick={onCancel} className="text-sm text-muted">
          取消
        </button>
        <h2 className="text-sm font-medium">新建任务</h2>
        <span className="w-10" />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 pb-24">
        <section className="mb-3 rounded-lg border border-separator p-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-medium">Agent</h3>
            <Button size="sm" variant="tertiary" onPress={() => setNewAgent(!newAgent)}>
              {newAgent ? '选择已有' : '新建 Agent'}
            </Button>
          </div>
          {newAgent ? (
            <div className="flex flex-col gap-2">
              <Input aria-label="Agent 标题" placeholder="Agent 标题" value={agentTitle} onChange={(e) => setAgentTitle(e.target.value)} fullWidth />
              <select
                aria-label="Agent 引擎"
                value={engine}
                onChange={(event) => setEngine(event.target.value as Engine)}
                className="h-10 rounded-lg border border-separator bg-background px-2 text-sm"
              >
                {(engines.data ?? []).map((entry) => (
                  <option key={entry.engine} value={entry.engine} disabled={entry.status === 'unavailable'}>
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
          <p className="text-xs text-muted">已选 {contextIds.length} 个；连线依赖自动包含，可在任务详情核对。</p>
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
          <Input aria-label="任务标题" placeholder="任务标题" value={title} onChange={(e) => setTitle(e.target.value)} fullWidth />
          <TextArea aria-label="任务 prompt" placeholder="要做什么" value={prompt} onChange={(e) => setPrompt(e.target.value)} fullWidth />
          <Input aria-label="verify 命令" placeholder="verify 命令（可选）" value={verifyCommand} onChange={(e) => setVerifyCommand(e.target.value)} fullWidth />
          <select
            aria-label="任务引擎"
            value={engine}
            onChange={(event) => setEngine(event.target.value as Engine)}
            className="h-10 rounded-lg border border-separator bg-background px-2 text-sm"
          >
            {(engines.data ?? []).map((entry) => (
              <option key={entry.engine} value={entry.engine} disabled={entry.status === 'unavailable'}>
                {entry.engine}
              </option>
            ))}
          </select>
          {workspaceTrusted ? (
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" checked={skipPermissions} onChange={(e) => setSkipPermissions(e.target.checked)} />
              跳过权限审批
            </label>
          ) : null}
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" checked={createAndStart} onChange={(e) => setCreateAndStart(e.target.checked)} />
            创建后立即开工
          </label>
          {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
        </div>
      </div>
      <footer className="flex shrink-0 gap-2 border-t border-separator p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <Button variant="tertiary" onPress={onCancel} className="flex-1">取消</Button>
        <Button variant="primary" isDisabled={disabled} onPress={() => void submit()} className="flex-1">
          {createAndStart ? '创建并开工' : '创建'}
        </Button>
      </footer>

      <NodePicker
        open={picker === 'agent'}
        onOpenChange={(open) => setPicker(open ? 'agent' : null)}
        nodes={agents}
        mode="single"
        value={agentId ? [agentId] : []}
        onChange={(ids) => setAgentId(ids[0] ?? '')}
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
```

- [ ] **Step 3: 跑测试**

Run: `pnpm --filter @baton/web test -- MobileCreateTaskForm`

Expected: PASS。

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/features/tasks/MobileCreateTaskForm.tsx apps/web/src/features/tasks/MobileCreateTaskForm.test.tsx
git commit -m "feat(web): 增加移动建任务表单"
```

---

## Task 3: `MobileNodeManager`

Blocking: Task 1
Slice type: tracer-bullet
Seam: 节点列表/搜索/新建/编辑 text、file、agent

**Files:**

- Create: `apps/web/src/features/canvas/MobileNodeManager.tsx`
- Create: `apps/web/src/features/canvas/MobileNodeManager.test.tsx`

**Interfaces:**

- Consumes: `canvasId`、`Node[]`、`useCommand`。
- Produces: `MobileNodeManager({ canvasId, nodes, onClose })`。

- [ ] **Step 1: 写测试**

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandProvider } from '../../lib/command-context'
import { MobileNodeManager } from './MobileNodeManager'

const { send } = vi.hoisted(() => ({ send: vi.fn() }))

beforeEach(() => {
  send.mockReset()
  send.mockResolvedValue({ nodeId: 'n1' })
})

it('creates a text node', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <CommandProvider send={send}>
        <MobileNodeManager canvasId="c1" nodes={[]} onClose={() => {}} />
      </CommandProvider>
    </QueryClientProvider>,
  )

  await userEvent.click(screen.getByRole('button', { name: '新建文本' }))
  await userEvent.type(screen.getByLabelText('文本内容'), '一条上下文')
  await userEvent.click(screen.getByRole('button', { name: '保存' }))

  await waitFor(() =>
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'node.create',
        payload: expect.objectContaining({
          canvasId: 'c1',
          node: expect.objectContaining({ type: 'text', data: { content: '一条上下文' } }),
        }),
      }),
    ),
  )
})
```

- [ ] **Step 2: 实现**

```tsx
import type { Engine, Node } from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { Input } from '@heroui/react/input'
import { TextArea } from '@heroui/react/textarea'
import { useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useCommand } from '../../lib/command-context'
import { nodeTitle } from './node-title'

type Draft =
  | { type: 'text'; node?: Node; content: string }
  | { type: 'file'; node?: Node; name: string; path: string }
  | { type: 'agent'; node?: Node; title: string; engine: Engine }

const TYPE_LABELS: Record<string, string> = { text: '文本', file: '文件', agent: 'Agent' }

export function MobileNodeManager({
  canvasId,
  nodes,
  onClose,
}: {
  canvasId: string
  nodes: Node[]
  onClose: () => void
}) {
  const send = useCommand()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return nodes.filter((node) => {
      if (!['text', 'file', 'agent'].includes(node.type)) return false
      return !keyword || nodeTitle(node).toLowerCase().includes(keyword)
    })
  }, [nodes, search])

  const edit = (node: Node) => {
    if (node.type === 'text') setDraft({ type: 'text', node, content: node.data.content })
    if (node.type === 'file') setDraft({ type: 'file', node, name: node.data.name, path: node.data.path })
    if (node.type === 'agent') setDraft({ type: 'agent', node, title: node.data.title, engine: node.data.engine })
  }

  const save = async () => {
    if (!draft) return
    setPending(true)
    setError(null)
    try {
      if (draft.node) {
        const data =
          draft.type === 'text'
            ? { content: draft.content }
            : draft.type === 'file'
              ? { name: draft.name, path: draft.path }
              : { title: draft.title }
        await send({ type: 'node.update', payload: { nodeId: draft.node.id, patch: { data } } })
      } else {
        const index = nodes.length
        const position = { x: 80 + (index % 4) * 360, y: 80 + Math.floor(index / 4) * 240, w: 320, h: 200 }
        const node =
          draft.type === 'text'
            ? { type: 'text' as const, ...position, data: { content: draft.content } }
            : draft.type === 'file'
              ? { type: 'file' as const, ...position, data: { name: draft.name, path: draft.path } }
              : {
                  type: 'agent' as const,
                  ...position,
                  data: { title: draft.title, engine: draft.engine, taskId: null },
                }
        await send({ type: 'node.create', payload: { canvasId, node } })
      }
      await queryClient.invalidateQueries({ queryKey: ['canvas'] })
      setDraft(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-separator px-3">
        <button type="button" onClick={onClose} className="text-sm text-muted">关闭</button>
        <h2 className="text-sm font-medium">节点</h2>
        <span className="w-10" />
      </header>

      {draft ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <h3 className="mb-3 text-sm font-medium">
            {draft.node ? '编辑' : '新建'}{TYPE_LABELS[draft.type]}
          </h3>
          <div className="flex flex-col gap-2">
            {draft.type === 'text' ? (
              <TextArea aria-label="文本内容" value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} fullWidth />
            ) : null}
            {draft.type === 'file' ? (
              <>
                <Input aria-label="文件名称" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} fullWidth />
                <Input aria-label="相对路径" value={draft.path} onChange={(e) => setDraft({ ...draft, path: e.target.value })} fullWidth />
              </>
            ) : null}
            {draft.type === 'agent' ? (
              <>
                <Input aria-label="Agent 标题" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} fullWidth />
                {!draft.node ? (
                  <select
                    aria-label="Agent 引擎"
                    value={draft.engine}
                    onChange={(e) => setDraft({ ...draft, engine: e.target.value as Engine })}
                    className="h-10 rounded-lg border border-separator bg-background px-2 text-sm"
                  >
                    <option value="fake">fake</option>
                    <option value="claude-sdk">claude-sdk</option>
                  </select>
                ) : null}
              </>
            ) : null}
            {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
            <div className="flex gap-2">
              <Button variant="tertiary" onPress={() => setDraft(null)} className="flex-1">返回</Button>
              <Button variant="primary" isDisabled={pending} onPress={() => void save()} className="flex-1">保存</Button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="shrink-0 p-3">
            <Input aria-label="搜索节点" placeholder="搜索节点" value={search} onChange={(e) => setSearch(e.target.value)} fullWidth />
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="secondary" onPress={() => setDraft({ type: 'text', content: '' })}>新建文本</Button>
              <Button size="sm" variant="secondary" onPress={() => setDraft({ type: 'file', name: '', path: '' })}>新建文件</Button>
              <Button size="sm" variant="secondary" onPress={() => setDraft({ type: 'agent', title: '', engine: 'fake' })}>新建 Agent</Button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3 pb-24">
            {filtered.length === 0 ? <p className="text-sm text-muted">没有节点</p> : null}
            {filtered.map((node) => (
              <button key={node.id} type="button" onClick={() => edit(node)} className="mb-2 flex min-h-11 w-full items-center justify-between rounded-lg border border-separator px-3 text-left">
                <span className="min-w-0 truncate text-sm">{nodeTitle(node)}</span>
                <span className="shrink-0 text-xs text-muted">{TYPE_LABELS[node.type]}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 3: 跑测试并提交**

Run: `pnpm --filter @baton/web test -- MobileNodeManager`

Expected: PASS。

```bash
git add apps/web/src/features/canvas/MobileNodeManager.tsx apps/web/src/features/canvas/MobileNodeManager.test.tsx
git commit -m "feat(web): 增加移动节点管理"
```

---

## Task 4: 总管 composer 移动选择器

Blocking: Task 1
Slice type: refactor
Seam: 移动端可选目标/上下文，`supervisor.send` 带对应 id

**Files:**

- Modify: `apps/web/src/features/supervisor/SupervisorComposer.tsx`
- Modify: `apps/web/src/features/supervisor/SupervisorComposer.test.tsx`
- Modify: `apps/web/src/features/supervisor/SupervisorPanel.tsx`

**Interfaces:**

- `SupervisorComposer` 新增 `mobile?: boolean`、`nodes?: ProtocolNode[]`。
- `SupervisorPanel` 新增 `mobile?: boolean`、`nodes?: ProtocolNode[]`。

- [ ] **Step 1: 写失败测试**

在 `SupervisorComposer.test.tsx` 增加：

```tsx
import { render, screen, waitFor, within } from '@testing-library/react'

it('uses picked target and context on mobile', async () => {
  const send = vi.fn().mockResolvedValue(undefined)
  render(
    <CommandProvider send={send}>
      <SupervisorComposer
        workspaceId="w1"
        contextNodes={[]}
        targetAgent={null}
        mobile
        nodes={[
          { id: 'a1', canvasId: 'c1', type: 'agent', x: 0, y: 0, w: 320, h: 200, groupId: null, createdAt: 1, updatedAt: 1, data: { title: 'Agent', engine: 'fake', taskId: null } },
          { id: 'n1', canvasId: 'c1', type: 'text', x: 0, y: 0, w: 320, h: 200, groupId: null, createdAt: 1, updatedAt: 1, data: { content: '上下文' } },
        ]}
      />
    </CommandProvider>,
  )

  await userEvent.click(screen.getByRole('button', { name: /目标 Agent/ }))
  const targetDialog = screen.getByRole('dialog', { name: '选择目标 Agent' })
  await userEvent.click(within(targetDialog).getByRole('button', { name: /Agent/ }))
  await userEvent.click(within(targetDialog).getByRole('button', { name: '确定' }))

  await userEvent.click(screen.getByRole('button', { name: /上下文 0 个/ }))
  const contextDialog = screen.getByRole('dialog', { name: '选择上下文' })
  await userEvent.click(within(contextDialog).getByRole('button', { name: /上下文/ }))
  await userEvent.click(within(contextDialog).getByRole('button', { name: '确定' }))

  await userEvent.type(screen.getByRole('textbox'), '帮我看看')
  await userEvent.keyboard('{Enter}')

  await waitFor(() =>
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'supervisor.send',
        payload: expect.objectContaining({ targetNodeId: 'a1', contextNodeIds: ['n1'] }),
      }),
    ),
  )
})
```

> 在现有 `SupervisorComposer.test.tsx` 的 `describe` 内追加；复用文件顶部已有的 `useCommand` / `useSupervisorStreamStore` mock，不新增全局 mock。

- [ ] **Step 2: 修改 composer**

在 props 增加：

```tsx
mobile = false,
nodes = [],
```

在组件内增加：

```tsx
const [pickedTarget, setPickedTarget] = useState<SupervisorTargetAgent | null>(null)
const [pickedContext, setPickedContext] = useState<ProtocolNode[] | null>(null)
const [picker, setPicker] = useState<'target' | 'context' | null>(null)
const effectiveTarget = pickedTarget ?? targetAgent
const effectiveContext = pickedContext ?? contextNodes
```

`submit` 内改用：

```tsx
const contextNodeIds = effectiveContext.map((node) => node.id)
const targetNodeId = effectiveTarget?.id
```

在 composer 顶部（`mobile` 时）渲染：

```tsx
{mobile ? (
  <div className="mb-2 flex flex-wrap gap-2">
    <Button size="sm" variant="tertiary" onPress={() => setPicker('target')}>
      目标 Agent {effectiveTarget?.title ?? '未选'}
    </Button>
    <Button size="sm" variant="tertiary" onPress={() => setPicker('context')}>
      上下文 {effectiveContext.length} 个
    </Button>
  </div>
) : null}
```

底部挂 `NodePicker`：

```tsx
<NodePicker
  open={picker === 'target'}
  onOpenChange={(open) => setPicker(open ? 'target' : null)}
  nodes={nodes}
  mode="single"
  value={effectiveTarget ? [effectiveTarget.id] : []}
  onChange={(ids) => {
    const node = nodes.find((item) => item.id === ids[0])
    setPickedTarget(node?.type === 'agent' ? { id: node.id, title: node.data.title } : null)
  }}
  title="选择目标 Agent"
/>
<NodePicker
  open={picker === 'context'}
  onOpenChange={(open) => setPicker(open ? 'context' : null)}
  nodes={nodes}
  mode="multi"
  value={effectiveContext.map((node) => node.id)}
  onChange={(ids) => setPickedContext(nodes.filter((node) => ids.includes(node.id)))}
  excludeIds={effectiveTarget ? [effectiveTarget.id] : []}
  title="选择上下文"
/>
```

- [ ] **Step 3: 修改 `SupervisorPanel`**

Props 增加 `mobile = false`、`nodes = []`，传给 `SupervisorComposer`：

```tsx
<SupervisorComposer
  workspaceId={workspaceId}
  contextNodes={contextNodes}
  targetAgent={targetAgent}
  mobile={mobile}
  nodes={nodes}
/>
```

- [ ] **Step 4: 跑测试**

Run: `pnpm --filter @baton/web test -- SupervisorComposer SupervisorPanel`

Expected: PASS（现有 + 新增）。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/features/supervisor/SupervisorComposer.tsx apps/web/src/features/supervisor/SupervisorComposer.test.tsx apps/web/src/features/supervisor/SupervisorPanel.tsx
git commit -m "feat(web): 总管 composer 支持移动目标与上下文选择"
```

---

## Task 5: `MobileMoreMenu` 与移动 dialogs

Blocking: Plan 1
Slice type: tracer-bullet
Seam: 更多菜单打开设置/信任/创建/任务/节点；dialog 全屏

**Files:**

- Create: `apps/web/src/features/shared/MobileMoreMenu.tsx`
- Create: `apps/web/src/features/shared/MobileMoreMenu.test.tsx`
- Modify: `apps/web/src/features/automation/AutomationSettingsDialog.tsx`
- Modify: `apps/web/src/features/workspaces/WorkspaceTrustDialog.tsx`
- Modify: `apps/web/src/features/workspaces/CreateWorkspaceDialog.tsx`

**Interfaces:**

- `MobileMoreMenu({ open, onOpenChange, onOpenSettings, onOpenTask, onOpenNodes, trustSlot })`。
- 三个 dialog 增加 `mobile?: boolean`。

- [ ] **Step 1: 写菜单测试**

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MobileMoreMenu } from './MobileMoreMenu'

it('opens actions from the more menu', async () => {
  const onOpenSettings = vi.fn()
  render(
    <MobileMoreMenu
      open
      onOpenChange={() => {}}
      onOpenSettings={onOpenSettings}
      onOpenTask={() => {}}
      onOpenNodes={() => {}}
      onCreateWorkspace={() => {}}
      trustSlot={<div>信任区</div>}
    />,
  )
  await userEvent.click(screen.getByRole('button', { name: '自动化设置' }))
  expect(onOpenSettings).toHaveBeenCalled()
  expect(screen.getByText('信任区')).toBeInTheDocument()
})
```

- [ ] **Step 2: 实现菜单**

```tsx
import { Button } from '@heroui/react/button'
import type { ReactNode } from 'react'

export function MobileMoreMenu({
  open,
  onOpenChange,
  onOpenSettings,
  onOpenTask,
  onOpenNodes,
  onCreateWorkspace,
  trustSlot,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenSettings: () => void
  onOpenTask: () => void
  onOpenNodes: () => void
  onCreateWorkspace: () => void
  trustSlot: ReactNode
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end bg-background/80 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="更多操作">
      <button type="button" aria-label="关闭更多操作" className="flex-1" onClick={() => onOpenChange(false)} />
      <div className="shrink-0 rounded-t-2xl border-t border-separator bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium">更多</h2>
          <button type="button" onClick={() => onOpenChange(false)} className="inline-flex h-11 w-11 items-center justify-center rounded-md" aria-label="关闭">
            ×
          </button>
        </div>
        <div className="flex flex-col gap-2">
          <Button variant="secondary" onPress={onOpenTask}>新建任务</Button>
          <Button variant="secondary" onPress={onOpenNodes}>节点列表</Button>
          <Button variant="secondary" onPress={onOpenSettings}>自动化设置</Button>
          <Button variant="secondary" onPress={onCreateWorkspace}>创建工作区</Button>
          <div className="rounded-lg border border-separator p-3">{trustSlot}</div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: dialog 全屏**

三个 dialog 增加 `mobile = false`，并给 `Modal.Dialog` 加 class：

```tsx
<Modal.Dialog className={mobile ? 'h-dvh w-screen max-w-none rounded-none' : undefined}>
```

`CreateWorkspaceDialog` 改为可选受控：

```tsx
export function CreateWorkspaceDialog({
  onCreated,
  open: controlledOpen,
  onOpenChange,
  mobile = false,
}: {
  onCreated: (workspaceId: string) => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
  mobile?: boolean
}) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = onOpenChange ?? setInternalOpen
  ...
  {controlledOpen === undefined ? <Button variant="secondary">新建工作区</Button> : null}
  <Modal isOpen={open} onOpenChange={setOpen}>
    ...
    <Modal.Dialog className={mobile ? 'h-dvh w-screen max-w-none rounded-none' : undefined}>
```

- [ ] **Step 4: 跑测试并提交**

Run: `pnpm --filter @baton/web test -- MobileMoreMenu AutomationSettingsDialog WorkspaceTrustDialog CreateWorkspaceDialog`

Expected: PASS。

```bash
git add apps/web/src/features/shared/MobileMoreMenu.tsx apps/web/src/features/shared/MobileMoreMenu.test.tsx apps/web/src/features/automation/AutomationSettingsDialog.tsx apps/web/src/features/workspaces/WorkspaceTrustDialog.tsx apps/web/src/features/workspaces/CreateWorkspaceDialog.tsx
git commit -m "feat(web): 增加移动更多菜单与全屏设置"
```

---

## Task 6: App 接线

Blocking: Task 1-5
Slice type: tracer-bullet
Seam: 更多按钮、任务表单、节点管理、移动 dialogs、总管 picker

**Files:**

- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/features/tasks/MobileBoardList.tsx`

**Interfaces:**

- `MobileBoardList` 新增 `onCreateTask?: () => void`。
- App 新增 `mobileMoreOpen`、`mobileTaskFormOpen`、`mobileNodesOpen`、`createWorkspaceOpen`。

- [ ] **Step 1: 改 `MobileBoardList`**

Header 增加：

```tsx
{onCreateTask ? (
  <Button size="sm" variant="primary" onPress={onCreateTask}>
    新建任务
  </Button>
) : null}
```

Props 增加 `onCreateTask?: () => void`。

- [ ] **Step 2: 改 App**

导入：

```tsx
import { MobileMoreMenu } from './features/shared/MobileMoreMenu'
import { MobileCreateTaskForm } from './features/tasks/MobileCreateTaskForm'
import { MobileNodeManager } from './features/canvas/MobileNodeManager'
```

状态：

```tsx
const [mobileMoreOpen, setMobileMoreOpen] = useState(false)
const [mobileTaskFormOpen, setMobileTaskFormOpen] = useState(false)
const [mobileNodesOpen, setMobileNodesOpen] = useState(false)
const [createWorkspaceOpen, setCreateWorkspaceOpen] = useState(false)
```

顶栏（仅在 `isMobile`）增加“更多”按钮：

```tsx
{isMobile ? (
  <Button variant="secondary" onPress={() => setMobileMoreOpen(true)}>
    更多
  </Button>
) : null}
```

移动看板加 `onCreateTask`：

```tsx
<MobileBoardList
  ...
  onCreateTask={() => setMobileTaskFormOpen(true)}
/>
```

总管：

```tsx
<SupervisorPanel
  workspaceId={activeWorkspaceId}
  contextNodes={contextNodes}
  targetAgent={targetAgent}
  mobile
  nodes={canvas.data?.nodes ?? []}
/>
```

更多菜单与表单/节点管理：

```tsx
{isMobile ? (
  <>
    <MobileMoreMenu
      open={mobileMoreOpen}
      onOpenChange={setMobileMoreOpen}
      onOpenSettings={() => {
        setMobileMoreOpen(false)
        setAutomationSettingsOpen(true)
      }}
      onOpenTask={() => {
        setMobileMoreOpen(false)
        setMobileTaskFormOpen(true)
      }}
      onOpenNodes={() => {
        setMobileMoreOpen(false)
        setMobileNodesOpen(true)
      }}
      onCreateWorkspace={() => {
        setMobileMoreOpen(false)
        setCreateWorkspaceOpen(true)
      }}
      trustSlot={
        activeWorkspace ? (
          <WorkspaceTrustBadge
            workspace={activeWorkspace}
            onTrust={() => {
              setMobileMoreOpen(false)
              setTrustDialogOpen(true)
            }}
            onRevoked={() => setTrustPromptedFor(activeWorkspace.id)}
          />
        ) : (
          <p className="text-xs text-muted">尚未选择工作区</p>
        )
      }
    />

    {mobileTaskFormOpen && activeWorkspaceId && canvas.data ? (
      <MobileCreateTaskForm
        workspaceId={activeWorkspaceId}
        canvasId={canvas.data.canvas.id}
        workspaceTrusted={activeWorkspace?.trusted ?? false}
        nodes={canvas.data.nodes}
        onCreated={(taskId) => {
          setMobileTaskFormOpen(false)
          setTask(taskId)
          writeUrlState({ workspaceId: activeWorkspaceId, taskId })
        }}
        onCancel={() => setMobileTaskFormOpen(false)}
      />
    ) : null}

    {mobileNodesOpen && canvas.data ? (
      <MobileNodeManager
        canvasId={canvas.data.canvas.id}
        nodes={canvas.data.nodes}
        onClose={() => setMobileNodesOpen(false)}
      />
    ) : null}
  </>
) : null}
```

移动 dialogs：

```tsx
<AutomationSettingsDialog
  ...
  mobile={isMobile}
/>
<WorkspaceTrustDialog
  ...
  mobile={isMobile}
/>
<CreateWorkspaceDialog
  onCreated={(id) => {
    setWorkspace(id)
    writeUrlState({ workspaceId: id, taskId: null })
  }}
  {...(isMobile
    ? { open: createWorkspaceOpen, onOpenChange: setCreateWorkspaceOpen, mobile: true }
    : {})}
/>
```

关键：Plan 1 曾用 `!isMobile` 包住 `AutomationSettingsDialog`；本任务必须移除该包裹，改为始终渲染并传 `mobile={isMobile}`，否则更多菜单打不开设置。`CreateWorkspaceDialog` 仅在移动端传受控 `open`，桌面保持内部触发按钮。

更多菜单需要“创建工作区”入口：在 `MobileMoreMenu` props 增加 `onCreateWorkspace`，并渲染按钮；App 传入 `() => { setMobileMoreOpen(false); setCreateWorkspaceOpen(true) }`。

- [ ] **Step 3: 跑测试**

Run: `pnpm --filter @baton/web test -- App MobileBoardList`

Expected: PASS；移动壳测试仍通过。

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/App.tsx apps/web/src/features/tasks/MobileBoardList.tsx apps/web/src/features/shared/MobileMoreMenu.tsx
git commit -m "feat(web): 接入移动控制面入口"
```

---

## Task 7: 收口

Blocking: Task 1-6
Slice type: verification
Seam: 组件测试 + 现有移动 e2e + 全量 web 测试

**Files:** 无新增。

- [ ] **Step 1: 跑 web 单测**

```bash
pnpm --filter @baton/web test
```

Expected: 全绿；新增 `NodePicker`、`MobileCreateTaskForm`、`MobileNodeManager`、`MobileMoreMenu` 测试通过。

- [ ] **Step 2: 跑现有移动 e2e**

```bash
pnpm exec playwright test apps/web/e2e/mobile-shell.spec.ts apps/web/e2e/mobile-tasks.spec.ts
```

Expected: 全绿。控制面全量 e2e（建任务/建节点/总管 picker/设置/信任）在 Plan 4 补齐。

- [ ] **Step 3: 全量 verify**

```bash
pnpm verify
```

Expected: 全绿。

- [ ] **Step 4: 记录执行结果**

在 plan 末尾追加“执行记录”段，记录实际差异、测试数量、已知问题；提交：

```bash
git add docs/plans/2026-11-19-m2-2b-mobile-controls.md
git commit -m "docs(plan): 记录 M2-2b 控制面执行结果"
```

---

## Self-Review

- **Spec coverage**：覆盖 spec §6.4（建任务）、§6.5（节点）、§6.6（总管）、§6.7（设置/信任/工作区）；contract DoD 5-11。
- **Placeholder scan**：无 TBD/TODO；新增组件含实际代码；dialog 改动给出精确 class。
- **Type consistency**：`NodePicker` props、`MobileCreateTaskForm` props、`SupervisorComposer` 新增 props 在任务间一致；`TaskSummary` / `Node` / `Engine` 沿用协议。
- **Risk**：`CreateWorkspaceDialog` 的受控改动会影响桌面；保留内部 state fallback，并跑现有测试。`SupervisorComposer` 的移动 picker 覆盖 props，但桌面默认行为不变。

## Execution Handoff

Plan 3 已落 `docs/plans/2026-11-19-m2-2b-mobile-controls.md`。执行方式同 Plan 1：subagent-driven（推荐）或 inline。
