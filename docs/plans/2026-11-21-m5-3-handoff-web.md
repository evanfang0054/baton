---
spec_ref: ../specs/2026-11-21-m5-3-context-handoff-design.md
spec_topic: m5-3-context-handoff
task_count: 4
estimated_phases: [web, verification]
dod: "任务详情交接按钮；task.handoff 命令；Toast/warnings；总管 handoff_task 多卡与来源行；移动端；组件测试"
status: completed
depends_on: docs/plans/2026-11-21-m5-3-handoff-core-daemon.md
---

# M5-3 Plan 2：web 交接入口与渲染

> **For agentic workers:** REQUIRED SUB-SKILL: Use `agent-harness:subagent-driven-development` (recommended) or `agent-harness:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户在任务详情一键生成交接节点，并让总管 `handoff_task` 的结果在对话里显示任务卡与交接来源。

**Architecture:** 复用 `useCommand`/`useCommandAction`、`queryKeys.canvas`、HeroUI `toast`、`SupervisorTaskCard`；不新增全局状态。

**Tech Stack:** React 19、HeroUI v3、TanStack Query、Testing Library。

---

## 文件结构

- Create: `apps/web/src/features/tasks/HandoffButton.tsx`
- Modify: `apps/web/src/features/tasks/TaskDetailPanel.tsx`
- Modify: `apps/web/src/features/tasks/MobileTaskDetail.tsx`（如动作区独立）
- Modify: `apps/web/src/features/supervisor/SupervisorMessage.tsx`
- Modify: `apps/web/src/features/supervisor/SupervisorToolCard.tsx`
- Create/Modify tests: `HandoffButton.test.tsx`、`SupervisorMessage.test.tsx`、`TaskDetailPanel.test.tsx`、`MobileTaskDetail` 相关测试。

---

### Task 1: 任务详情交接按钮

Blocking: Plan 1 Task 4
Slice type: implementation
Seam: `apps/web/src/features/tasks/HandoffButton.tsx`

**Files:**
- Create: `apps/web/src/features/tasks/HandoffButton.tsx`
- Modify: `apps/web/src/features/tasks/TaskDetailPanel.tsx`

**Interfaces:**
- Consumes: WS `task.handoff` `{ taskId }`；ack `{ nodeId, taskId, warnings }`
- Produces: `HandoffButton({ taskId, workspaceId, status })`

- [ ] **Step 1: 写组件**

```tsx
import type { TaskStatus } from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { toast } from '@heroui/react/toast'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useCommand } from '../../lib/command-context'
import { queryKeys } from '../../lib/query'

const ELIGIBLE: TaskStatus[] = ['review', 'done', 'failed', 'cancelled']

export function HandoffButton({
  taskId,
  workspaceId,
  status,
}: {
  taskId: string
  workspaceId: string
  status: TaskStatus
}) {
  const send = useCommand()
  const queryClient = useQueryClient()
  const [pending, setPending] = useState(false)
  if (!ELIGIBLE.includes(status)) return null

  const run = async () => {
    setPending(true)
    try {
      const ack = (await send({ type: 'task.handoff', payload: { taskId } })) as {
        warnings?: string[]
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.canvas(workspaceId) })
      toast.success('已生成交接节点，可在画布中选中它创建下一个任务')
      for (const warning of ack.warnings ?? []) toast.info(warning)
    } catch (cause) {
      toast.danger(cause instanceof Error ? cause.message : '生成交接节点失败')
    } finally {
      setPending(false)
    }
  }

  return (
    <Button variant="tertiary" size="sm" isDisabled={pending} onPress={run}>
      生成交接节点
    </Button>
  )
}
```

- [ ] **Step 2: 放进任务详情**

在 `TaskDetailPanel` 的验收/动作区域渲染：

```tsx
<HandoffButton taskId={task.id} workspaceId={task.workspaceId} status={task.status} />
```

位置：`ReviewCard` 之后、`TaskActions` 之前；`review` 状态也能看到。移动端复用同一组件。

- [ ] **Step 3: 组件测试**

`HandoffButton.test.tsx`：
- `review/done/failed/cancelled` 显示按钮；`todo/running/verifying` 不渲染。
- 点击调用 `task.handoff`，成功后 `toast.success` + canvas invalidate。
- ack.warnings → `toast.info`。
- 命令失败 → `toast.danger`，不 invalidate。

- [ ] **Step 4: 跑测试**

Run: `pnpm --filter @baton/web test -- HandoffButton`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/features/tasks/HandoffButton.tsx apps/web/src/features/tasks/TaskDetailPanel.tsx apps/web/src/features/tasks/HandoffButton.test.tsx
git commit -m "feat(web): 任务详情生成交接节点"
```

---

### Task 2: 总管 handoff_task 渲染

Blocking: Plan 1 Task 5
Slice type: implementation
Seam: `apps/web/src/features/supervisor/SupervisorMessage.tsx`

**Files:**
- Modify: `apps/web/src/features/supervisor/SupervisorMessage.tsx`
- Modify: `apps/web/src/features/supervisor/SupervisorToolCard.tsx`
- Modify: `apps/web/src/features/supervisor/SupervisorMessage.test.tsx`

**Interfaces:**
- Consumes: `handoff_task` 结果 `{ task, handoff: { nodeId, fromTaskId, fromTitle, fromStatus, worktree, warnings } }`
- Produces: 任务卡 + 交接来源行 + warnings

- [ ] **Step 1: 加结果解析**

```ts
type HandoffResult = {
  task?: unknown
  handoff?: {
    nodeId: string
    fromTaskId: string
    fromTitle: string
    fromStatus: string
    worktree: boolean
    warnings: string[]
  }
}

const handoffResults = message.toolCalls
  .filter((call) => call.name === 'handoff_task' && call.ok)
  .map((call) => (call.result ?? {}) as HandoffResult)
const handoffCards = handoffResults
  .map((result) => SupervisorTaskCardSchema.safeParse(result.task))
  .flatMap((parsed) => (parsed.success ? [parsed.data] : []))
const handoffMeta = handoffResults.map((result) => result.handoff).filter(Boolean)
```

- [ ] **Step 2: 渲染**

- `cards` 合并 `handoffCards`（与单卡/批量卡一起去重）。
- 每张交接卡上方/下方加一行：

```tsx
<p className="text-xs text-muted">
  交接自《{meta.fromTitle}》{meta.worktree ? ' · 源任务在隔离 worktree，变更文件不可读' : ''}
</p>
```

- warnings 用现有 `text-warning` 列表逐条显示。

- [ ] **Step 3: 工具图标**

`SupervisorToolCard.tsx` 的图标映射加 `handoff_task`（用 `ArrowRightLeft` 或 `GitBranch`）；参数/结果预览沿用 4000 字截断。

- [ ] **Step 4: 测试**

`SupervisorMessage.test.tsx`：
- `handoff_task` 成功 → 任务卡 + “交接自《A》”。
- worktree → 警告行。
- 同一 taskId 与 `create_task` 重复 → 去重保留最后一张。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/features/supervisor
git commit -m "feat(web): 总管交接结果渲染"
```

---

### Task 3: 移动端与详情动作

Blocking: Task 1
Slice type: implementation
Seam: `apps/web/src/features/tasks/MobileTaskDetail.tsx`

**Files:**
- Modify: `apps/web/src/features/tasks/MobileTaskDetail.tsx`（如需单独放按钮）
- Modify: `apps/web/src/features/tasks/TaskDetailPanel.mobile.test.tsx`（或新增）

- [ ] **Step 1: 检查移动端动作区**

如果移动端复用 `TaskDetailPanel`，确认按钮可见；如果移动端单独渲染动作，补 `HandoffButton`。

- [ ] **Step 2: 布局**

按钮与“通过/打回”同组；窄屏使用 `flex-wrap`；不新增移动专属弹窗。

- [ ] **Step 3: 测试**

- 移动端 `review` 任务能看到“生成交接节点”。
- 点击后调用命令、Toast、canvas 失效。
- 现有审批/验收动作不回归。

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/features/tasks
git commit -m "feat(web): 移动端交接入口"
```

---

### Task 4: web 全片验证

Blocking: Task 2 + Task 3
Slice type: verification
Seam: 仓库命令行

- [ ] **Step 1: 跑 web 测试**

Run: `pnpm --filter @baton/web test`
Expected: PASS。

- [ ] **Step 2: 跑全量**

Run: `pnpm verify`
Expected: exit 0。

- [ ] **Step 3: 自查 UI 文案**

- 中文、无硬编码 hex、使用 DESIGN token。
- Toast 不出现本机路径/token。
- 交接节点文本第一行是 `【交接】`。

- [ ] **Step 4: 提交（如有修正）**

```bash
git add apps/web
git commit -m "chore(web): M5-3 交接收口"
```

---

## 执行记录

- 2026-11-21：Task 1 完成，提交 `95a276d`；`HandoffButton` 4 条组件测试（状态门槛、命令、warnings、失败 Toast）。
- 2026-11-21：Task 2/3/4 完成，提交 `14c0c30`；`SupervisorMessage` 渲染交接来源与 worktree 警告；`RealtimeProvider` 把 `handoff_task` 纳入 tasks/canvas 失效集合；web 204 tests 全绿。
- 未新增移动专属交互：按钮在任务详情滚动区内，移动端复用同一组件。

## 计划自检

- Spec 覆盖：按钮、命令、Toast/warnings、总管多卡、来源行、移动端、测试。
- 无占位符：每个 task 都有测试/命令/提交。
- 依赖：Task 1→2→3→4；依赖 Plan 1 Task 4/5。
