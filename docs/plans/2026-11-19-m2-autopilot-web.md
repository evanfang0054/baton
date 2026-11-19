---
spec_ref: ../specs/2026-11-19-m2-autopilot-design.md
spec_topic: m2-autopilot-v0
task_count: 5
estimated_phases: [tests, implementation, verification]
dod: "web 自动化设置、顶栏状态/kill switch、digest 卡、任务自动化卡、看板批量开工与对应测试完成；pnpm verify:full 全绿"
depends_on: [2026-11-19-m2-autopilot-daemon.md]
status: completed
---

# M2-2a 无人值守与汇报：web 实施计划（Plan 3/4）

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`（推荐）或 `executing-plans` 逐任务执行。步骤用 `- [ ]` 勾选。

**Goal:** 把 daemon 的自动化控制面、digest 与审计数据做成可用的桌面 UI，并保持现有三栏布局与 `DESIGN.md` 视觉约束。

**Architecture:** `apps/web/src/features/automation/**` 承载设置与顶栏状态；`DigestCard` 挂在总管面板顶部；`TaskAutomationCard` 挂在任务详情；看板只增加选择模式与批量 enqueue，不改变任务状态机。

**Tech Stack:** React 19、HeroUI v3、TanStack Query、Zustand、Tailwind 4、Testing Library、Playwright。

---

## 计划地图

| Plan | 范围 | 状态 |
|---|---|---|
| 1. 契约层 | protocol / core / migration / 仓储 | 前置 |
| 2. daemon | policy / kill switch / digest / notice & audit / runtime | 前置 |
| **3. web（本计划）** | 设置弹窗 / 顶栏状态 / digest 卡 / 任务自动化卡 / 批量开工 | 实施中 |
| 4. 验收 | Playwright / ego-lite / 证据 / 全量验证 | 依赖 3 |

**GDD:** 按仓库先例显式跳过；测试设计由 contract 14 条 DoD 与任务内测试承担。

**Commit strategy:** 每个 Task 结束提交一次；Task 5 跑 `pnpm verify:full`。

---

## Task 1: API client、query keys 与实时 notice 分发

Blocking: Plan 2
Slice type: tracer-bullet
Seam: `getAutomation` / `updateAutomationPolicy` / `setKillSwitch` / `listNotices` / `generateDigest` 可被组件调用

**Files：**

- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/lib/query.ts`
- Modify: `apps/web/src/features/realtime/RealtimeProvider.tsx`
- Create: `apps/web/src/lib/api-automation.test.ts`

**Interfaces：**

- Produces: `getAutomation(workspaceId)`、`updateAutomationPolicy(workspaceId, patch)`、`setKillSwitch(enabled)`、`listNotices(workspaceId, opts)`、`readNotice(id)`、`generateDigest(workspaceId)`、`getTaskAutomation(taskId)`、`listAudit(actionPrefix)`。
- Consumes: `AutomationSummary`、`AutomationPolicyPatch`、`KillSwitchResponse`、`NoticeListResponse`、`DigestGenerateResponse`、`TaskAutomationSummary`、`AuditListResponse`。

- [x] **Step 1: 写失败测试**

`apps/web/src/lib/api-automation.test.ts`：

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getAutomation, setKillSwitch } from './api'

afterEach(() => vi.restoreAllMocks())

describe('automation api', () => {
  it('parses automation summary', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          workspaceId: 'w1',
          trusted: true,
          policy: { verify: {}, approval: { default: 'ask', allow: [], deny: [], autoApproveMaxRisk: 'low' }, autopilot: { enabled: true, retryMax: 2, digestCron: '0 9,21 * * *' } },
          policyVersion: 'abc123abc123',
          killSwitch: false,
          killSwitchForced: false,
          digestCronUnsupported: false,
        }),
        { status: 200 },
      ),
    )
    await expect(getAutomation('w1')).resolves.toMatchObject({ trusted: true })
  })

  it('sends kill switch payload', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ killSwitch: true, killSwitchForced: false }), { status: 200 }))
    await setKillSwitch(true)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/automation/kill-switch',
      expect.objectContaining({ method: 'PUT' }),
    )
  })
})
```

- [x] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @baton/web exec vitest run src/lib/api-automation.test.ts`
Expected: FAIL，函数未导出。

- [x] **Step 3: 实现 API 与 query keys**

`api.ts` 按现有 `request` 模式追加：

```ts
export async function getAutomation(workspaceId: string) {
  return AutomationSummary.parse(
    await request(`/api/workspaces/${encodeURIComponent(workspaceId)}/automation`),
  )
}

export async function updateAutomationPolicy(
  workspaceId: string,
  patch: AutomationPolicyPatch,
) {
  return AutomationSummary.parse(
    await request(`/api/workspaces/${encodeURIComponent(workspaceId)}/automation`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    }),
  )
}

export async function setKillSwitch(enabled: boolean) {
  return KillSwitchResponse.parse(
    await request('/api/automation/kill-switch', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled }),
    }),
  )
}
```

`listNotices/readNotice/generateDigest/getTaskAutomation/listAudit` 同样用 `URLSearchParams` + `request`。

`query.ts` 增加：

```ts
automation: (workspaceId: string) => ['automation', workspaceId] as const,
notices: (workspaceId: string) => ['notices', workspaceId] as const,
taskAutomation: (taskId: string) => ['task-automation', taskId] as const,
audit: (prefix: string) => ['audit', prefix] as const,
```

`RealtimeProvider` 的 `onEvent` 增加：

```ts
if (event.type === 'notice') {
  void queryClient.invalidateQueries({ queryKey: queryKeys.notices(workspaceId) })
  if (event.payload.kind === 'digest') {
    toast.info('总管汇报已生成')
  }
  return
}
```

- [x] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @baton/web exec vitest run src/lib/api-automation.test.ts`
Expected: PASS。

- [x] **Step 5: Commit**

```bash
git add apps/web/src/lib apps/web/src/features/realtime
git commit -m "feat(web): 自动化 API 与 notice 实时分发"
```

---

## Task 2: 自动化设置弹窗与顶栏状态

Blocking: Task 1
Slice type: tracer-bullet
Seam: 顶栏「自动化运行中/已暂停/关闭」可切换；设置弹窗可保存三个字段

**Files：**

- Create: `apps/web/src/features/automation/AutomationStatus.tsx`
- Create: `apps/web/src/features/automation/AutomationSettingsDialog.tsx`
- Create: `apps/web/src/features/automation/AutomationStatus.test.tsx`
- Create: `apps/web/src/features/automation/AutomationSettingsDialog.test.tsx`
- Modify: `apps/web/src/App.tsx`

**Interfaces：**

- Produces: `<AutomationStatus state={{ mode: 'off'|'on'|'paused'; killSwitchForced: boolean }} onPause={() => void} onOpenSettings={() => void} />`；`<AutomationSettingsDialog workspaceId open onOpenChange />`。
- Consumes: `getAutomation/updateAutomationPolicy/setKillSwitch/listAudit`、`queryKeys.automation`。

- [x] **Step 1: 写失败测试**

`AutomationStatus.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { AutomationStatus } from './AutomationStatus'

describe('AutomationStatus', () => {
  it('renders paused state and invokes kill switch', async () => {
    const onPause = vi.fn()
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AutomationStatus
          state={{ mode: 'paused', killSwitchForced: false }}
          onPause={onPause}
          onOpenSettings={() => {}}
        />
      </QueryClientProvider>,
    )
    expect(screen.getByText('自动化已暂停')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '暂停自动化' }))
    expect(onPause).toHaveBeenCalled()
  })
})
```

`AutomationSettingsDialog.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { AutomationSettingsDialog } from './AutomationSettingsDialog'

const update = vi.fn().mockResolvedValue({})
vi.mock('../../lib/api', () => ({
  getAutomation: vi.fn().mockResolvedValue({
    workspaceId: 'w1',
    trusted: true,
    policy: {
      verify: {},
      approval: { default: 'ask', allow: ['Read'], deny: [], autoApproveMaxRisk: 'low' },
      autopilot: { enabled: true, retryMax: 2, digestCron: '0 9,21 * * *' },
    },
    policyVersion: 'abc123abc123',
    killSwitch: false,
    killSwitchForced: false,
    digestCronUnsupported: false,
  }),
  updateAutomationPolicy: update,
  listAudit: vi.fn().mockResolvedValue({ entries: [] }),
}))

describe('AutomationSettingsDialog', () => {
  it('saves only the editable policy fields', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AutomationSettingsDialog workspaceId="w1" open onOpenChange={() => {}} />
      </QueryClientProvider>,
    )
    const retry = await screen.findByLabelText('最大自动重试次数')
    await userEvent.clear(retry)
    await userEvent.type(retry, '3')
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(update).toHaveBeenCalledWith('w1', { autopilot: { retryMax: 3 } })
  })
})
```

- [x] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @baton/web exec vitest run src/features/automation`
Expected: FAIL，组件不存在。

- [x] **Step 3: 实现 AutomationStatus**

- 三态文案：`自动化关闭` / `自动化运行中` / `自动化已暂停`。
- 运行中显示「暂停自动化」按钮；暂停立即调 `setKillSwitch(true)`，toast + invalidate。
- 已暂停显示「已暂停」；恢复按钮打开设置弹窗，不直接恢复。
- env 强制时显示「由环境变量强制暂停」并禁用按钮。
- 只用 `DESIGN.md` token：`bg-surface`、`border-separator`、`text-muted`、`bg-warning`、`bg-success`。

- [x] **Step 4: 实现 AutomationSettingsDialog**

- 使用 `useQuery(queryKeys.automation(workspaceId), getAutomation)`。
- 表单字段：`autopilot.enabled` Switch、`retryMax` NumberInput（0–10）、`autoApproveMaxRisk` Select（low/medium）。
- 只读区：`allow`/`deny` 列表、`verify.command/timeoutSec`、`digestCron`；使用 `<code>` + `text-muted`。
- 未信任：显示「先信任工作区，才能启用自动化」，保存禁用。
- 保存：`updateAutomationPolicy`，成功 toast + invalidate；失败内联错误，不关闭。
- 最近变更：`listAudit('automation.')`，展示 action/time/actor。
- 文案固定：「修改只影响新启动的会话；运行中的任务使用启动时的策略快照。」「高风险操作永远不会自动批准。」

- [x] **Step 5: 接入 App.tsx**

- header 右侧渲染 `<AutomationStatus workspaceId={activeWorkspaceId} ... />`。
- App 持有 `settingsOpen` state；点击状态或 workspace 菜单「自动化设置」打开 `AutomationSettingsDialog`。
- `WorkspaceSwitcher` 增加 `onOpenAutomation?: () => void`，菜单项「自动化设置」。

- [x] **Step 6: 运行测试**

Run: `pnpm --filter @baton/web exec vitest run src/features/automation`
Expected: PASS。

- [x] **Step 7: Commit**

```bash
git add apps/web/src/features/automation apps/web/src/App.tsx apps/web/src/features/workspaces
git commit -m "feat(web): 自动化设置与顶栏 kill switch"
```

---

## Task 3: Digest 卡与 notice 历史

Blocking: Task 1
Slice type: tracer-bullet
Seam: 总管面板顶部出现最新 digest；生成/已读/历史可用

**Files：**

- Create: `apps/web/src/features/supervisor/DigestCard.tsx`
- Create: `apps/web/src/features/supervisor/DigestCard.test.tsx`
- Modify: `apps/web/src/features/supervisor/SupervisorPanel.tsx`
- Modify: `apps/web/src/features/right-panel/RightPanel.tsx`（未读圆点）

**Interfaces：**

- Produces: `<DigestCard workspaceId? notice? onRead onOpenTask onGenerate />`；`RightPanel` 增加 `hasUnreadNotice`。
- Consumes: `listNotices/readNotice/generateDigest`、`Notice`、`DigestReport`。

- [x] **Step 1: 写失败测试**

`DigestCard.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DigestCard } from './DigestCard'

const notice = {
  id: 'n1',
  workspaceId: 'w1',
  ts: 100,
  kind: 'digest',
  payload: {
    workspaceId: 'w1',
    windowStart: 0,
    windowEnd: 100,
    generatedAt: 100,
    policyVersion: 'abc123abc123',
    snapshot: { total: 3, unplanned: 0, todo: 0, running: 0, waiting: 1, review: 2, done: 0, closed: 0, attention: { needsApproval: 0, needsReply: 1, needsAttention: 0, needsReview: 2 } },
    ready: [{ id: 't1', title: '待验收', status: 'review', attention: 'needs_review', waitingSince: 10, retryCount: 0 }],
    blocked: [{ id: 't2', title: '待回答', status: 'waiting_input', attention: 'needs_reply', waitingSince: 20, retryCount: 0 }],
    dropped: [],
    changes: { created: 2, updated: 2, completed: 0, failed: 0, cancelled: 0, retried: 1, autoAllowed: 1, autoDenied: 0 },
    oldestWaiting: { id: 't2', title: '待回答', status: 'waiting_input', attention: 'needs_reply', waitingSince: 20, retryCount: 0 },
  },
  readAt: null,
}

describe('DigestCard', () => {
  it('shows ready/blocked counts and marks read', async () => {
    const onRead = vi.fn()
    render(<DigestCard notice={notice} onRead={onRead} onOpenTask={() => {}} onGenerate={() => {}} />)
    expect(screen.getByText('待验收 2')).toBeInTheDocument()
    expect(screen.getByText('待处理 1')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '知道了' }))
    expect(onRead).toHaveBeenCalledWith('n1')
  })
})
```

- [x] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @baton/web exec vitest run src/features/supervisor/DigestCard.test.tsx`
Expected: FAIL，组件不存在。

- [x] **Step 3: 实现 DigestCard**

- props 支持两种模式：传入 `notice` 用于测试；或传 `workspaceId` 内部查询。
- 内容：标题「本轮汇报」+ 生成时间 + 未读圆点；计数 chips；变化行；最长等待；前 3 个 blocked 任务（点击 `onOpenTask(taskId)`）。
- 操作：「生成汇报」`generateDigest` → invalidate notices；「知道了」`readNotice`；「历史」展开最近 5 条 digest（`listNotices` 结果过滤 `kind==='digest'`）。
- 空态：没有 digest 时显示「还没有汇报」+ 生成按钮。
- `aria-live="polite"` 只播报计数摘要；不逐字。
- 只用 DESIGN token，不写 hex。

- [x] **Step 4: 接入 SupervisorPanel**

- `SupervisorPanel` 顶部渲染 `<DigestCard workspaceId={workspaceId} onOpenTask={...} />`。
- `onOpenTask` 使用 `useAppStore.setTask` + `setRightPanel('task')`。
- `RightPanel` 增加 `hasUnreadNotice` prop，在「总管」tab 显示小圆点；由 App 查询 notices 计算。

- [x] **Step 5: 运行测试**

Run: `pnpm --filter @baton/web exec vitest run src/features/supervisor src/features/right-panel`
Expected: PASS。

- [x] **Step 6: Commit**

```bash
git add apps/web/src/features/supervisor apps/web/src/features/right-panel apps/web/src/App.tsx
git commit -m "feat(web): 总管 digest 卡与未读提示"
```

---

## Task 4: 任务自动化记录卡

Blocking: Task 1
Slice type: tracer-bullet
Seam: 任务详情出现自动批准/拒绝/重试记录

**Files：**

- Create: `apps/web/src/features/tasks/TaskAutomationCard.tsx`
- Create: `apps/web/src/features/tasks/TaskAutomationCard.test.tsx`
- Modify: `apps/web/src/features/tasks/TaskDetailPanel.tsx`

**Interfaces：**

- Produces: `<TaskAutomationCard taskId />`。
- Consumes: `getTaskAutomation(taskId)`、`queryKeys.taskAutomation`。

- [x] **Step 1: 写失败测试**

```tsx
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { TaskAutomationCard } from './TaskAutomationCard'

vi.mock('../../lib/api', () => ({
  getTaskAutomation: vi.fn().mockResolvedValue({
    taskId: 't1',
    retryCount: 1,
    lastVerifyExitCode: 1,
    lastPolicyVersion: 'abc123abc123',
    autoDecisions: [
      { approvalId: 'a1', decision: 'allow', toolName: 'Bash', risk: 'low', decidedAt: 10, policyVersion: 'abc123abc123' },
    ],
  }),
}))

describe('TaskAutomationCard', () => {
  it('renders auto approval and retry count without prompt', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TaskAutomationCard taskId="t1" />
      </QueryClientProvider>,
    )
    expect(await screen.findByText('自动批准 1 次')).toBeInTheDocument()
    expect(screen.getByText('自动重试 1 次')).toBeInTheDocument()
    expect(screen.queryByText(/SECRET/)).not.toBeInTheDocument()
  })
})
```

- [x] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @baton/web exec vitest run src/features/tasks/TaskAutomationCard.test.tsx`
Expected: FAIL，组件不存在。

- [x] **Step 3: 实现 TaskAutomationCard**

- 查询 `getTaskAutomation`；loading / error / empty 三态。
- 汇总：自动批准/拒绝次数、重试次数、最近 verify 退出码、lastPolicyVersion。
- 列表：`toolName`、`risk`、`decidedAt`、`policyVersion`；只读、无展开原始入参。
- 空态：「本任务没有自动决策」。
- 放在 `TaskDetailPanel` 的 `TaskOriginCard` 之后、review 之前。

- [x] **Step 4: 运行测试**

Run: `pnpm --filter @baton/web exec vitest run src/features/tasks`
Expected: PASS。

- [x] **Step 5: Commit**

```bash
git add apps/web/src/features/tasks
git commit -m "feat(web): 任务自动化记录卡"
```

---

## Task 5: 看板批量开工与 web 全量验证

Blocking: Tasks 1–4
Slice type: tracer-bullet
Seam: 看板多选 2 个 `todo` 任务，点击「开工 2 个」，两条 `task.enqueue` 发出

**Files：**

- Modify: `apps/web/src/features/tasks/TaskBoard.tsx`
- Modify: `apps/web/src/features/tasks/TaskCard.tsx`
- Create: `apps/web/src/features/tasks/TaskBoard.batch.test.tsx`
- Create: `apps/web/e2e/automation.spec.ts`
- Modify: 本计划末尾「完成记录」

**Interfaces：**

- Produces: 看板选择模式、`onBatchStart` 内部调用 `task.enqueue`；`TaskCard` 增加 `selectable/selected/onToggle`。
- Consumes: `useCommand`、`task.enqueue`、`queryKeys.tasks`。

- [x] **Step 1: 写失败测试**

`TaskBoard.batch.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TaskBoard } from './TaskBoard'

const send = vi.fn().mockResolvedValue({ ok: true })
vi.mock('../../lib/command-context', () => ({ useCommand: () => send }))

const tasks = [
  { id: 't1', workspaceId: 'w1', nodeId: 'n1', title: 'A', prompt: '', status: 'todo', waitingReason: null, engine: 'fake', workspaceMode: 'main', branch: null, worktreePath: null, verifyCommand: null, retryCount: 0, dangerouslySkipPermissions: false, contextJson: null, originJson: null, createdAt: 1, updatedAt: 1, attention: 'none', waitingSince: null },
  { id: 't2', workspaceId: 'w1', nodeId: 'n2', title: 'B', prompt: '', status: 'todo', waitingReason: null, engine: 'fake', workspaceMode: 'main', branch: null, worktreePath: null, verifyCommand: null, retryCount: 0, dangerouslySkipPermissions: false, contextJson: null, originJson: null, createdAt: 2, updatedAt: 2, attention: 'none', waitingSince: null },
]

describe('TaskBoard batch start', () => {
  it('selects todo tasks and enqueues each', async () => {
    render(<TaskBoard tasks={tasks as never} agentNodes={[]} selectedTaskId={null} expanded pinned={false} onSelectTask={() => {}} onClose={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: '批量开工' }))
    await userEvent.click(screen.getByRole('checkbox', { name: '选择 A' }))
    await userEvent.click(screen.getByRole('checkbox', { name: '选择 B' }))
    await userEvent.click(screen.getByRole('button', { name: '开工 2 个' }))
    expect(send).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenNthCalledWith(1, { type: 'task.enqueue', payload: { taskId: 't1' } })
    expect(send).toHaveBeenNthCalledWith(2, { type: 'task.enqueue', payload: { taskId: 't2' } })
  })
})
```

- [x] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @baton/web exec vitest run src/features/tasks/TaskBoard.batch.test.tsx`
Expected: FAIL，按钮/选择模式不存在。

- [x] **Step 3: 实现选择模式**

- `TaskBoard` 内部 state：`selecting: boolean`、`selected: Set<string>`。
- header 按钮「批量开工」进入选择模式；「取消」退出；「全选待办」。
- 只有 `status === 'todo'` 可选；`TaskCard` 增加 checkbox 与 `aria-label="选择 <title>"`。
- 主按钮「开工 N 个」逐条 `await send({ type:'task.enqueue', payload:{ taskId } })`；成功计数，失败收集。
- 完成后 toast「已开工 X 个，Y 个失败」；invalidate tasks；清空选择。
- 上限 20：超过时禁用并提示。

- [x] **Step 4: Playwright mock**

`apps/web/e2e/automation.spec.ts`：

- 固定 `/api/workspaces/:id/automation`、`/api/notices`、`/api/audit`、`/api/tasks/:id/automation`。
- 覆盖设置弹窗保存、kill switch 三态、digest 卡生成/已读/历史、任务自动化卡、看板批量开工。
- `page.routeWebSocket` 捕获 `task.enqueue` 次数；断言 2 次。
- 不依赖本机 daemon。

- [x] **Step 5: 运行 web 与全量验证**

```bash
pnpm --filter @baton/web test
pnpm verify:full
pnpm check:boundaries
pnpm check:protocol
pnpm format:check
```

Expected: 全部退出码 0。

- [x] **Step 6: 记录完成情况**

在本计划末尾追加：

```md
## 完成记录（YYYY-MM-DD）

- 关键 commit：
- 测试结果：
- 与计划的偏差：
- 未解决风险：
```

- [x] **Step 7: Commit**

```bash
git add apps/web docs/plans/2026-11-19-m2-autopilot-web.md
git commit -m "feat(web): 看板批量开工与自动化 UI 验收"
```

---

## 完成记录（2026-11-19）

- 关键 commit：`267880a` 自动化 API/query keys/notice 实时分发；`ae8bdfd` 自动化设置弹窗与顶栏 kill switch；`0027f89` 总管 digest 卡与未读提示；`e2d2d5a` 任务自动化记录卡；随后一个 commit 提交看板批量开工与 Playwright 验收。
- 测试结果：web 36 files / 137 tests；`pnpm verify:full` 退出码 0，Playwright 9 tests 全绿（含 automation 3 条：设置/kill switch、digest 已读与生成、批量开工 + 任务自动化卡）。
- 与计划的偏差：`WorkspaceSwitcher` 未新增「自动化设置」菜单项——它是原生 select，塞入动作项会破坏语义；顶栏三个状态都提供「设置」入口，覆盖同一需求。`AutomationStatus` 直接接收 `AutomationSummary`（而非计划里的 `state/mode` 形状），避免上层重复推导。暂停后的恢复放在设置弹窗内（kill switch banner + 「恢复自动化」），与「恢复按钮打开设置弹窗」一致。
- 未解决风险：批量开工逐条发送，部分失败只 toast 汇总，不重试；Digest 卡在无 workspace 时静默不渲染；`pnpm --filter @baton/web exec vitest run` 偶发 "failed to find current suite"，清 `node_modules/.vitest-cache` 与 `apps/web/node_modules/.vite` 后恢复（既有环境问题，非本次代码引入）。

