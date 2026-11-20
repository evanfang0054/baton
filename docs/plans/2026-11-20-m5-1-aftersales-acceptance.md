---
spec_ref: ../specs/2026-11-20-m5-supervisor-aftersales-design.md
spec_topic: m5-supervisor-aftersales
task_count: 5
estimated_phases: [tests, verification, documentation]
dod: "Playwright 覆盖售后/批量/取消确认；真实 Claude 售后链路与截图证据落库；docs 索引与 contract 收口；全量命令通过"
status: completed
depends_on: docs/plans/2026-11-20-m5-1-aftersales-web.md
---

# M5-1 acceptance：Playwright、真实 Claude 与文档收口计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `agent-harness:subagent-driven-development` (recommended) or `agent-harness:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 Playwright 与真实 Claude 证明售后/批量链路可用，并把证据、索引与 contract 收口。

**Architecture:** Playwright 复用 `supervisor.spec.ts` 的 REST/WS mock 模式；真实链路用本机 Claude Code 登录态；截图按仓库脱敏约定落 `docs/evidence/`。

**Tech Stack:** Playwright（系统 Chrome）、ego-lite 浏览器、pnpm。

---

## 文件结构

- Create: `apps/web/e2e/supervisor-aftersales.spec.ts` — 售后与批量。
- Create: `docs/evidence/<date>-m5-supervisor-aftersales/README.md` + 脱敏截图。
- Modify: `docs/README.md` — 索引 contract/plan/evidence。
- Modify: `docs/contracts/M5-1-supervisor-aftersales.contract.md` — 勾选 DoD。

---

### Task 1: Playwright 批量建任务

Blocking: none
Slice type: verification
Seam: `supervisor-aftersales.spec.ts`

**Files:**
- Create: `apps/web/e2e/supervisor-aftersales.spec.ts`

**Interfaces:**
- Consumes: `supervisor.spec.ts` 的 `workspace/canvasNodes/assistantMessage/mockSupervisorRest` 模式
- Produces: 批量 3 卡断言

- [ ] **Step 1: 写测试**

```ts
import { expect, test } from '@playwright/test'

test('batch creates three todo tasks sharing one agent', async ({ page }) => {
  let messages: unknown[] = []
  const batchMessage = {
    id: 'm-batch',
    threadId: 'th1',
    role: 'assistant',
    content: '已批量建好 3 个待办。',
    toolCalls: [
      {
        id: 'tc-batch',
        name: 'create_tasks',
        args: { nodeIds: ['t1', 't2', 't3'] },
        ok: true,
        result: {
          created: ['需求 A', '需求 B', '需求 C'].map((title, index) => ({
            taskId: `task-${index + 1}`,
            title,
            target: { id: 'a1', title: 'Agent 1', engine: 'claude-sdk' },
            contextCount: 0,
            status: 'todo',
          })),
          failed: [],
        },
      },
    ],
    decision: null,
    meta: null,
    status: 'ok',
    error: null,
    createdAt: 2,
  }

  await page.routeWebSocket('**/ws', (ws) => {
    ws.onMessage((raw) => {
      const message = JSON.parse(String(raw)) as { id?: string; type?: string }
      if (!message.id) return
      if (message.type === 'supervisor.send') {
        ws.send(
          JSON.stringify({
            v: 1,
            id: `ack-${message.id}`,
            type: 'ack',
            ts: Date.now(),
            payload: { commandId: message.id, ok: true, data: { threadId: 'th1', messageId: 'm-batch' } },
          }),
        )
        messages = [batchMessage]
        ws.send(
          JSON.stringify({ v: 1, ts: Date.now(), type: 'supervisor.message', payload: batchMessage }),
        )
      }
    })
  })

  // 复用 supervisor.spec.ts 的 mockSupervisorRest 与 workspace/canvasNodes
  await mockSupervisorRest(page, () => messages)
  await page.goto('/?workspace=w1')
  await page.getByRole('tab', { name: '总管' }).click()
  await page.getByPlaceholder('给总管发消息').fill('把这 3 个需求分别建任务')
  await page.getByRole('button', { name: '发送' }).click()

  await expect(page.getByText('需求 A')).toBeVisible()
  await expect(page.getByText('需求 B')).toBeVisible()
  await expect(page.getByText('需求 C')).toBeVisible()
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @baton/web e2e -- supervisor-aftersales.spec.ts`（若 package 没有 e2e script，用 `pnpm exec playwright test apps/web/e2e/supervisor-aftersales.spec.ts`）
Expected: FAIL，直到 web plan 的多卡渲染完成。

- [ ] **Step 3: 修 mock/选择器**

把 `mockSupervisorRest`、`workspace`、`canvasNodes`、`assistantMessage` 复制进本 spec（或抽到 `apps/web/e2e/supervisor-fixtures.ts`），确保不依赖测试执行顺序；输入框/按钮的可访问名称以实际 UI 为准。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec playwright test apps/web/e2e/supervisor-aftersales.spec.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/web/e2e/supervisor-aftersales.spec.ts
git commit -m "test(e2e): 总管批量建任务"
```

---

### Task 2: Playwright 售后与取消确认

Blocking: Task 1
Slice type: verification
Seam: `supervisor-aftersales.spec.ts`

**Files:**
- Modify: `apps/web/e2e/supervisor-aftersales.spec.ts`

**Interfaces:**
- Consumes: Task 1 的 mock helpers
- Produces: retry/reopen/cancel confirmation 断言

- [ ] **Step 1: 写测试**

```ts
test('retries a failed task from chat', async ({ page }) => {
  let messages: unknown[] = []
  const retryMessage = {
    id: 'm-retry',
    threadId: 'th1',
    role: 'assistant',
    content: '已重试，任务回到队列。',
    toolCalls: [
      {
        id: 'tc-retry',
        name: 'retry_task',
        args: { taskId: 'task-1' },
        ok: true,
        result: { ok: true, taskId: 'task-1', status: 'queued' },
      },
    ],
    decision: null,
    meta: null,
    status: 'ok',
    error: null,
    createdAt: 2,
  }

  await page.routeWebSocket('**/ws', (ws) => {
    ws.onMessage((raw) => {
      const message = JSON.parse(String(raw)) as { id?: string; type?: string }
      if (!message.id) return
      if (message.type === 'supervisor.send') {
        ws.send(
          JSON.stringify({
            v: 1,
            id: `ack-${message.id}`,
            type: 'ack',
            ts: Date.now(),
            payload: { commandId: message.id, ok: true, data: { threadId: 'th1', messageId: 'm-retry' } },
          }),
        )
        messages = [retryMessage]
        ws.send(
          JSON.stringify({ v: 1, ts: Date.now(), type: 'supervisor.message', payload: retryMessage }),
        )
      }
    })
  })

  await mockSupervisorRest(page, () => messages)
  await page.goto('/?workspace=w1')
  await page.getByRole('tab', { name: '总管' }).click()
  await page.getByPlaceholder('给总管发消息').fill('重试那个失败的任务')
  await page.getByRole('button', { name: '发送' }).click()

  await expect(page.getByText('已重试，任务回到队列。')).toBeVisible()
  await expect(page.getByText('retry_task')).toBeVisible()
})

test('asks for confirmation before cancelling a running task', async ({ page }) => {
  let messages: unknown[] = []
  let turn = 0
  const message = (content: string, toolCall: Record<string, unknown>) => ({
    id: `m-cancel-${turn}`,
    threadId: 'th1',
    role: 'assistant' as const,
    content,
    toolCalls: [toolCall],
    decision: null,
    meta: null,
    status: 'ok' as const,
    error: null,
    createdAt: 2,
  })
  const confirmation = message('任务正在运行，确认取消吗？', {
    id: 'tc-cancel-1',
    name: 'cancel_task',
    args: { taskId: 'task-1' },
    ok: false,
    error: { code: 'confirmation_required', message: 'confirm before cancelling a running task' },
  })
  const cancelled = message('已取消。', {
    id: 'tc-cancel-2',
    name: 'cancel_task',
    args: { taskId: 'task-1', confirm: true },
    ok: true,
    result: { ok: true, taskId: 'task-1', status: 'cancelled' },
  })

  await page.routeWebSocket('**/ws', (ws) => {
    ws.onMessage((raw) => {
      const incoming = JSON.parse(String(raw)) as { id?: string; type?: string }
      if (!incoming.id) return
      if (incoming.type !== 'supervisor.send') return
      turn += 1
      const payload = turn === 1 ? confirmation : cancelled
      ws.send(
        JSON.stringify({
          v: 1,
          id: `ack-${incoming.id}`,
          type: 'ack',
          ts: Date.now(),
          payload: { commandId: incoming.id, ok: true, data: { threadId: 'th1', messageId: payload.id } },
        }),
      )
      messages = [payload]
      ws.send(JSON.stringify({ v: 1, ts: Date.now(), type: 'supervisor.message', payload }))
    })
  })

  await mockSupervisorRest(page, () => messages)
  await page.goto('/?workspace=w1')
  await page.getByRole('tab', { name: '总管' }).click()
  await page.getByPlaceholder('给总管发消息').fill('取消那个运行中的任务')
  await page.getByRole('button', { name: '发送' }).click()

  await expect(page.getByText('任务正在运行，确认取消吗？')).toBeVisible()
  await expect(page.getByText('cancelled')).not.toBeVisible()

  await page.getByPlaceholder('给总管发消息').fill('确认')
  await page.getByRole('button', { name: '发送' }).click()
  await expect(page.getByText('已取消。')).toBeVisible()
  await expect(page.getByText('cancel_task')).toBeVisible()
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec playwright test apps/web/e2e/supervisor-aftersales.spec.ts`
Expected: FAIL，直到 Task 1/2 实现。

- [ ] **Step 3: 实现第二轮 mock**

第二轮 `supervisor.send` 返回：

```ts
const confirmMessage = {
  id: 'm-cancel-2',
  threadId: 'th1',
  role: 'assistant',
  content: '已取消。',
  toolCalls: [
    {
      id: 'tc-cancel-2',
      name: 'cancel_task',
      args: { taskId: 'task-1', confirm: true },
      ok: true,
      result: { ok: true, taskId: 'task-1', status: 'cancelled' },
    },
  ],
  // ...其余字段
}
```

第一轮返回 `cancel_task` 失败结果 `{ ok:false, code:'confirmation_required', taskId:'task-1', status:'running' }`，文本为“任务正在运行，确认取消吗？”。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec playwright test apps/web/e2e/supervisor-aftersales.spec.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/web/e2e/supervisor-aftersales.spec.ts
git commit -m "test(e2e): 总管售后与取消确认"
```

---

### Task 3: 真实 Claude 售后链路 + ego-lite 证据

Blocking: Task 2
Slice type: verification
Seam: 本机真实 Claude Code

**Files:**
- Create: `docs/evidence/<date>-m5-supervisor-aftersales/README.md`
- Create: 脱敏截图（桌面 1-2 张）

- [ ] **Step 1: 启动真实环境**

```bash
pnpm build
BATON_WORKSPACES_ROOT="$HOME" pnpm dev
```

打开 Web，确认总管已配置真实模型（`~/.baton/supervisor.json`），workspace 已信任。

- [ ] **Step 2: 跑售后链路**

1. 用总管创建一个真实任务（例如“在 demo 仓库新增一个 README 小节”）。
2. 等任务进入 `review` 或 `failed`。
3. 对总管说“上次那个任务还有个问题，跟进一下”，确认它找到任务、reopen + 新 session。
4. 等新 session 完成，确认任务仍在 `review`，人工 approve 后才 `done`。

- [ ] **Step 3: 采证**

记录 taskId、状态变化、审计动作 `supervisor.task.reopen`，用 ego-lite 截图（检查路径栏/用户名/群名已脱敏）。写入 README：

```md
# M5-1 总管售后与批量验收

- 日期：<date>
- 分支/提交：<branch> / <commit>
- 真实任务：<taskId>（脱敏标题）
- 链路：done → 总管“跟进” → reopen + queued → review → 人工 approve → done
- 审计：supervisor.task.reopen / supervisor.task.create
- 批量：3 个文本节点 → 3 个 todo 任务，共享 1 个 Agent
- 取消：running 任务先确认，确认后 cancelled
- 截图：desktop-1.png, desktop-2.png
```

- [ ] **Step 4: 自查**

确认截图没有本机绝对路径、token、用户名、transcript 正文；证据 README 不含本机绝对路径。

- [ ] **Step 5: 提交**

```bash
git add docs/evidence
git commit -m "docs: M5-1 真实 Claude 售后验收证据"
```

---

### Task 4: 文档索引与 contract 收口

Blocking: Task 3
Slice type: documentation
Seam: `docs/README.md` / contract

**Files:**
- Modify: `docs/README.md`
- Modify: `docs/contracts/M5-1-supervisor-aftersales.contract.md`

- [ ] **Step 1: 加索引**

在 `docs/README.md`：

- `现行 contract` 加 `M5-1 总管售后与批量`。
- `现行 plan` 加 3 个 plan。
- `验收证据` 加 `M5-1 总管售后与批量验收`。

- [ ] **Step 2: 勾选 DoD**

把 contract 中已验证的条目改为 `[x]`；未验证的条目保持 `[ ]` 并在评审记录写明原因。不要伪造勾选。

- [ ] **Step 3: 跑格式检查**

Run: `pnpm format:check`
Expected: PASS。

- [ ] **Step 4: 提交**

```bash
git add docs/README.md docs/contracts/M5-1-supervisor-aftersales.contract.md
git commit -m "docs: M5-1 索引与合同收口"
```

---

### Task 5: 全量验证

Blocking: Task 4
Slice type: verification
Seam: 仓库命令行

- [ ] **Step 1: 跑全量**

```bash
pnpm verify
pnpm verify:full
pnpm pack:check
pnpm check:boundaries
pnpm check:protocol
pnpm format:check
```

Expected: 全部 exit 0。

- [ ] **Step 2: 记录真实输出**

把每条命令的结果与测试数量写进 evidence README；不要只写“已通过”。

- [ ] **Step 3: 提交（如有修正）**

```bash
git add .
git commit -m "chore: M5-1 全量验证收口"
```

---

## 执行记录

- 2026-11-21：Playwright `supervisor-aftersales.spec.ts` 3 条全绿；`pnpm verify:full` 35 条全绿；真实 Claude 售后链路（Write 审批 → review → done → reopen → 新会话 Edit 审批 → review）通过，证据 `docs/evidence/2026-11-21-m5-supervisor-aftersales/`。验收中修复 claim 误判 `a8f5846`。

## 计划自检

- Spec 覆盖：Playwright 售后/批量/取消确认、真实 Claude、证据、索引、全量命令。
- 无占位符：每个任务都有测试/证据/命令/提交。
- 依赖：本计划依赖 daemon + web 两个 plan；未完成前不启动。
