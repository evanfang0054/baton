---
spec_ref: ../specs/2026-11-18-m2-supervisor-design.md
spec_topic: m2-supervisor-v0
task_count: 4
estimated_phases: [tests, implementation, verification]
dod: "RightPanel 三 tab、SupervisorPanel 状态、stream-store、composer chips/payload、任务卡只打开不开工；web 测试全绿"
depends_on: [2026-11-18-m2-supervisor-daemon.md]
status: pending
---

# M2-1 总管 Router v0：Web 右栏实施计划（Plan 3/4）

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`（推荐）或 `executing-plans` 逐任务执行。步骤用 `- [ ]` 勾选。

**Goal:** 把右栏从「节点/任务二选一」升级为「总管 / 任务 / 节点」三 tab，并让总管对话、流式、工具卡、任务卡、上下文 chips 可用。

**Architecture:** `RightPanel` 只做容器与 tab；`SupervisorPanel` 组合查询、stream-store 与卡片；`RealtimeProvider` 只把 supervisor 事件送入 stream-store，不写 session-cache。

**Tech Stack:** React 19、Zustand、TanStack Query、HeroUI v3、Tailwind 4、Testing Library、Playwright（Plan 4）。

---

## Task 1: API、query keys、RightPanel 与 App 接线

Blocking: Plan 2 Task 5
Slice type: tracer-bullet
Seam: 右栏出现「总管/任务/节点」三 tab，默认总管

**Files：**

- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/lib/query.ts`
- Modify: `apps/web/src/stores/app.ts`
- Create: `apps/web/src/features/right-panel/RightPanel.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/features/tasks/TaskDetailPanel.tsx`
- Modify: `apps/web/src/features/canvas/NodePanel.tsx`
- Create: `apps/web/src/features/right-panel/RightPanel.test.tsx`

**Interfaces：**

- Produces: `getSupervisorStatus()`、`getSupervisorMessages(workspaceId, before?, limit?)`；`queryKeys.supervisorStatus/supervisorMessages`；`rightPanel: 'supervisor'|'task'|'node'`；`RightPanel`。

- [ ] **Step 1: 写失败测试**

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { RightPanel } from './RightPanel'

describe('RightPanel', () => {
  it('shows supervisor by default and switches tabs', async () => {
    const onModeChange = vi.fn()
    render(
      <RightPanel
        mode="supervisor"
        onModeChange={onModeChange}
        hasTask
        hasNode
        supervisor={<div>总管内容</div>}
        task={<div>任务内容</div>}
        node={<div>节点内容</div>}
      />,
    )
    expect(screen.getByText('总管内容')).toBeVisible()
    expect(screen.getByRole('tab', { name: '总管' })).toHaveAttribute('aria-selected', 'true')

    await userEvent.click(screen.getByRole('tab', { name: '任务' }))
    expect(onModeChange).toHaveBeenCalledWith('task')
  })

  it('falls back to supervisor when the selected tab is unavailable', () => {
    render(
      <RightPanel
        mode="task"
        onModeChange={vi.fn()}
        hasTask={false}
        hasNode={false}
        supervisor={<div>总管内容</div>}
        task={null}
        node={null}
      />,
    )
    expect(screen.getByText('总管内容')).toBeVisible()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @baton/web test -- RightPanel`
Expected: FAIL。

- [ ] **Step 3: 实现**

`api.ts`：

```ts
export async function getSupervisorStatus(): Promise<SupervisorStatusResponse> {
  return request('/api/supervisor/status')
}

export async function getSupervisorMessages(
  workspaceId: string,
  before?: string,
  limit = 50,
): Promise<SupervisorMessagesResponse> {
  const params = new URLSearchParams({ workspaceId, limit: String(limit) })
  if (before) params.set('before', before)
  return request(`/api/supervisor/messages?${params}`)
}
```

（`request` 用现有 `api.ts` 的封装，保持错误码。）

`query.ts`：

```ts
supervisorStatus: ['supervisor', 'status'] as const,
supervisorMessages: (workspaceId: string) => ['supervisor', 'messages', workspaceId] as const,
```

`stores/app.ts`：

```ts
rightPanel: 'supervisor' | 'task' | 'node'
setRightPanel: (value: 'supervisor' | 'task' | 'node') => void
```

初始 `rightPanel: 'supervisor'`；`setWorkspace` 重置为 `supervisor`。

`RightPanel.tsx`：

- 400px、`border-l border-separator bg-surface`、纵向 flex。
- 顶部 tab 用 HeroUI `Tabs` 或等价 button + `role="tab"`；只显示可用 tab。
- `mode` 不可用时 fallback 到 `supervisor`。
- 内容区 `min-h-0 flex-1`。

`App.tsx`：

- 用 `rightPanel`/`setRightPanel`。
- 选中节点时 `setRightPanel(id ? 'node' : 'supervisor')`；选中任务时 `setRightPanel('task')`。
- 关闭 NodePanel/TaskDetailPanel 时 `setRightPanel('supervisor')`。
- 从 `selectedNodeIds` + canvas nodes 计算 `targetAgent`：选择里恰好一个 `type==='agent'` 时传该节点，否则 `null`。
- `RightPanel` 的 `supervisor` 内容先放最小 `SupervisorPanel` stub（Task 3 替换），避免 Task 1 依赖未实现组件。

`TaskDetailPanel`/`NodePanel`：去掉外层 `w-[380px] shrink-0 border-l ...`，改为 `flex min-h-0 flex-1 flex-col`；`data-testid` 保留。现有测试按内容查询，通常不受影响。

- [ ] **Step 4: 跑测试**

Run: `pnpm --filter @baton/web test -- RightPanel TaskDetailPanel NodePanel`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/lib apps/web/src/stores apps/web/src/features/right-panel apps/web/src/App.tsx apps/web/src/features/tasks apps/web/src/features/canvas
git commit -m "feat(web): 右栏三 tab 与总管入口"
```

---

## Task 2: stream-store、supervisor-model 与 RealtimeProvider

Blocking: Task 1
Slice type: tracer-bullet
Seam: `supervisor.delta/tool/message` 进入 stream-store，final 清空并更新缓存

**Files：**

- Create: `apps/web/src/features/supervisor/stream-store.ts`
- Create: `apps/web/src/features/supervisor/supervisor-model.ts`
- Modify: `apps/web/src/features/realtime/RealtimeProvider.tsx`
- Create: `apps/web/src/features/supervisor/supervisor-model.test.ts`

**Interfaces：**

- Produces: `useSupervisorStream`；`applyDelta`/`applyTool`/`finishStream`；RealtimeProvider 对 supervisor 事件的分发。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest'
import { applyDelta, applyTool, createStreamState } from './supervisor-model'

describe('supervisor stream projection', () => {
  it('appends deltas and dedupes final message', () => {
    let state = createStreamState()
    state = applyDelta(state, { threadId: 'th1', messageId: 'm1', delta: '正在' })
    state = applyDelta(state, { threadId: 'th1', messageId: 'm1', delta: '建任务' })
    expect(state.text).toBe('正在建任务')

    state = applyTool(state, {
      threadId: 'th1',
      messageId: 'm1',
      toolCallId: 'tc1',
      name: 'create_task',
      phase: 'start',
    })
    expect(state.tools).toEqual([
      { id: 'tc1', name: 'create_task', phase: 'start', ok: undefined, summary: undefined },
    ])

    const finished = applyTool(state, {
      threadId: 'th1',
      messageId: 'm1',
      toolCallId: 'tc1',
      name: 'create_task',
      phase: 'end',
      ok: true,
      summary: '已建到待办',
    })
    expect(finished.tools[0]?.ok).toBe(true)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @baton/web test -- supervisor-model`
Expected: FAIL。

- [ ] **Step 3: 实现**

`stream-store.ts`：

```ts
interface SupervisorStreamState {
  threadId: string | null
  messageId: string | null
  text: string
  tools: Array<{ id: string; name: string; phase: 'start'|'end'; ok?: boolean; summary?: string }>
  status: 'idle' | 'streaming' | 'error'
  reset(): void
}
```

- `begin(message)`、`append(delta)`、`tool(event)`、`finish()`、`reset()`；同一 `messageId` 才追加，其他忽略。
- `useSupervisorStream` 直接导出 `useSupervisorStreamStore`。

`supervisor-model.ts`：

- `createStreamState()`、`applyDelta`、`applyTool`、`finishStream` 纯函数，供 store 与测试复用。

`RealtimeProvider.tsx`：

```ts
if (event.type === 'supervisor.delta' || event.type === 'supervisor.tool') {
  useSupervisorStreamStore.getState().apply(event)
  return
}
if (event.type === 'supervisor.message') {
  useSupervisorStreamStore.getState().finish()
  const key = queryKeys.supervisorMessages(workspaceId)
  queryClient.setQueryData<SupervisorMessagesResponse>(key, (previous) =>
    previous ? { ...previous, messages: [...previous.messages, event.payload] } : previous,
  )
  void queryClient.invalidateQueries({ queryKey: key })
  return
}
```

（`apply` 可在 store 内分发 delta/tool；final message 作为 `SupervisorMessage` 入缓存。）

- [ ] **Step 4: 跑测试**

Run: `pnpm --filter @baton/web test -- supervisor-model RealtimeProvider`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/features/supervisor apps/web/src/features/realtime
git commit -m "feat(web): 总管流式状态与实时分发"
```

---

## Task 3: SupervisorPanel、消息/工具/任务卡与状态

Blocking: Task 2
Slice type: tracer-bullet
Seam: 空态/未配置/流式/错误/任务卡/打开任务

**Files：**

- Create: `apps/web/src/features/supervisor/SupervisorPanel.tsx`
- Create: `apps/web/src/features/supervisor/SupervisorMessageList.tsx`
- Create: `apps/web/src/features/supervisor/SupervisorMessage.tsx`
- Create: `apps/web/src/features/supervisor/SupervisorToolCard.tsx`
- Create: `apps/web/src/features/supervisor/SupervisorTaskCard.tsx`
- Create: `apps/web/src/features/supervisor/SupervisorEmptyState.tsx`
- Create: `apps/web/src/features/supervisor/SupervisorStatusBar.tsx`
- Create: `apps/web/src/features/supervisor/SupervisorPanel.test.tsx`

**Interfaces：**

- Consumes: `getSupervisorStatus`、`getSupervisorMessages`、`useSupervisorStream`、`queryKeys`、`useCommand`。
- Produces: `SupervisorPanel({ workspaceId, contextNodes, targetAgent })`。

- [ ] **Step 1: 写失败测试**

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SupervisorPanel } from './SupervisorPanel'

vi.mock('../../lib/api', () => ({
  getSupervisorStatus: vi.fn().mockResolvedValue({
    configured: false,
    mode: 'explicit',
    policyVersion: 'p1',
    errorCode: 'supervisor_unavailable',
  }),
  getSupervisorMessages: vi.fn().mockResolvedValue({ threadId: null, messages: [] }),
}))

describe('SupervisorPanel', () => {
  it('shows the unconfigured hint', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <SupervisorPanel workspaceId="w1" contextNodes={[]} targetAgent={null} />
      </QueryClientProvider>,
    )
    expect(await screen.findByText(/未配置/)).toBeVisible()
    expect(screen.getByRole('button', { name: '检查配置' })).toBeVisible()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @baton/web test -- SupervisorPanel`
Expected: FAIL。

- [ ] **Step 3: 实现**

- `SupervisorPanel`：`useQuery` status/messages；未配置显示提示；空会话显示定位 + 两个快捷入口；有消息时渲染 `SupervisorMessageList`；流式时渲染 stream 气泡 + 工具进度；错误显示内联错误卡 + 重试。
- `SupervisorMessageList`：`role="log"`，按时间升序；顶部「加载更早」；长列表用现有虚拟滚动或分页（v0 先分页）。
- `SupervisorMessage`：角色标签（你/总管/工具）+ 纯文本 `whitespace-pre-wrap`；不渲染 HTML。
- `SupervisorToolCard`：`icon + name + 状态`，可展开 args/result（`font-mono text-xs`、截断、`overflow-auto`）。
- `SupervisorTaskCard`：从 assistant message 的 `create_task` `ToolCallRecord.result` 读取 `taskId/title/target/contextCount/status`；展示标题、目标 Agent、上下文数量、`todo` Chip、提示“需要你点立即开工”、按钮「打开任务」→ `setTask(taskId)` + `setRightPanel('task')`。
- `SupervisorEmptyState`：一句定位 + 快捷入口；点击把文本填入 composer（通过回调）。
- `SupervisorStatusBar`：`mode` 文案“仅明确指令”、配置状态、连接状态。

视觉只用 `DESIGN.md` token；不硬编码 hex；焦点可见；状态有文字/图标。

- [ ] **Step 4: 跑测试**

Run: `pnpm --filter @baton/web test -- SupervisorPanel`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/features/supervisor
git commit -m "feat(web): 总管面板、消息卡与任务卡"
```

---

## Task 4: SupervisorComposer 与上下文 chips

Blocking: Task 3
Slice type: tracer-bullet
Seam: 发送 payload 带 `contextNodeIds/targetNodeId`，IME 回车不误发

**Files：**

- Create: `apps/web/src/features/supervisor/SupervisorComposer.tsx`
- Create: `apps/web/src/features/supervisor/SupervisorComposer.test.tsx`
- Modify: `apps/web/src/features/supervisor/SupervisorPanel.tsx`

**Interfaces：**

- Consumes: `useCommand`、`contextNodeIds`、`contextNodes`、`targetAgent`、`clearContext`/`removeContextNode`。
- Produces: `SupervisorComposer({ workspaceId, contextNodes, targetAgent })`。

- [ ] **Step 1: 写失败测试**

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CommandProvider } from '../../lib/command-context'
import { SupervisorComposer } from './SupervisorComposer'

describe('SupervisorComposer', () => {
  it('sends context and target in the payload', async () => {
    const send = vi.fn().mockResolvedValue({ threadId: 'th1', messageId: 'm1' })
    render(
      <CommandProvider send={send}>
        <SupervisorComposer
          workspaceId="w1"
          contextNodes={[{ id: 'n1', type: 'text', title: '需求 A' } as never]}
          targetAgent={{ id: 'a1', title: 'Agent 1' }}
        />
      </CommandProvider>,
    )
    await userEvent.type(screen.getByRole('textbox'), '给这个 Agent 建个任务')
    await userEvent.click(screen.getByRole('button', { name: '发送' }))
    expect(send).toHaveBeenCalledWith({
      type: 'supervisor.send',
      payload: {
        workspaceId: 'w1',
        requestId: expect.any(String),
        text: '给这个 Agent 建个任务',
        contextNodeIds: ['n1'],
        targetNodeId: 'a1',
      },
    })
  })

  it('does not send on IME composition Enter', async () => {
    const send = vi.fn()
    render(
      <CommandProvider send={send}>
        <SupervisorComposer workspaceId="w1" contextNodes={[]} targetAgent={null} />
      </CommandProvider>,
    )
    const box = screen.getByRole('textbox')
    await userEvent.type(box, '你好')
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true }))
    expect(send).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @baton/web test -- SupervisorComposer`
Expected: FAIL。

- [ ] **Step 3: 实现**

- `TextArea` + 上下文 chips（`contextNodes`：type + title，可移除）+ 目标 Agent chip + 发送按钮。
- 发送：
  ```ts
  const requestId = crypto.randomUUID()
  await send({
    type: 'supervisor.send',
    payload: { workspaceId, requestId, text, contextNodeIds: contextNodes.map(n => n.id), ...(targetAgent ? { targetNodeId: targetAgent.id } : {}) },
  })
  ```
- 成功后清空输入；失败保留草稿与 requestId，显示错误。
- 流式/`busy` 禁用发送；按钮 `aria-label="发送"`。
- Enter 发送、Shift+Enter 换行；`event.nativeEvent.isComposing` 时不发送。
- 固定提示：“总管只建待办，不会自动开工。”
- 没有目标 Agent 时显示“未选目标 Agent”，但仍可发送（总管会追问）。

- [ ] **Step 4: 跑测试与全量 web 测试**

Run:

```bash
pnpm --filter @baton/web test -- SupervisorComposer SupervisorPanel RightPanel
pnpm --filter @baton/web typecheck
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/features/supervisor
git commit -m "feat(web): 总管输入框与上下文 chips"
```

---

## 完成记录（待填）

- 日期：
- 关键 commit：
- `pnpm --filter @baton/web test` 结果：
- 偏离与坑：
