---
spec_ref: ../specs/2026-11-21-m6-2-context-injection-design.md
spec_topic: m6-2-context-injection
task_count: 3
estimated_phases: [verification, evidence, docs]
dod: 'M6-2 DoD 13-15：Playwright、ego-lite 真实 Claude、证据、docs 与 contract 收口'
status: pending
depends_on: 2026-11-21-m6-2-canvas-web.md, 2026-11-21-m6-2-tasks-web.md
---

# M6-2 Plan 5：验收、证据与文档收口

> **For agentic workers:** REQUIRED SUB-SKILL: Use agent-harness:subagent-driven-development (recommended) or agent-harness:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 Playwright 固化投喂/打回/通过确认，用 ego-lite + 真实 Claude 跑通 waiting_input 投喂到 review，最后收口 contract 与 docs。

**Architecture:** Playwright 继续用 `page.routeWebSocket('**/ws')` + `page.route('**/api/**')` 固定数据；真实链路用临时 daemon + 临时 data/workspace，不污染本机；证据截图按脱敏规则处理。

**Tech Stack:** Playwright（系统 Chrome）、ego-lite、vitest、pnpm scripts。

**Commit strategy:** 每个 task 末尾提交；最后统一跑全量命令。

---

### Task 1: Playwright 投喂与验收

Blocking: Plan 2-4
Slice type: verification
Seam: `apps/web/e2e/context-injection.spec.ts`

**Files:**
- Create: `apps/web/e2e/context-injection.spec.ts`
- Modify: `apps/web/e2e/m6-helpers.ts`（新字段 fixture）

**Interfaces:**
- 复用 `mockWorkspace` / `task` / `agentNode` / `textNode` / `sceneDetail`；断言 `context.inject` / `review.decide` payload。

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test, type Page } from '@playwright/test'
import { agentNode, mockWorkspace, sceneDetail, task, textNode } from './m6-helpers'

type WsRoute = Parameters<Parameters<Page['routeWebSocket']>[1]>[0]

function wsRecorder(commands: Array<{ type?: string; payload?: unknown }>) {
  return (ws: WsRoute) => {
    ws.onMessage((raw: string) => {
      const message = JSON.parse(String(raw)) as { id?: string; type?: string; payload?: unknown }
      if (!message.id) return
      commands.push(message)
      ws.send(
        JSON.stringify({
          v: 1,
          id: `ack-${message.id}`,
          type: 'ack',
          ts: Date.now(),
          payload: { commandId: message.id, ok: true, data: {} },
        }),
      )
    })
  }
}

test('injects selected node into a waiting task from the canvas', async ({ page }) => {
  const commands: Array<{ type?: string; payload?: unknown }> = []
  await page.routeWebSocket('**/ws', wsRecorder(commands))

  const detail = sceneDetail()
  detail.task = {
    ...detail.task,
    status: 'waiting_input',
    waitingReason: 'question',
  }
  detail.attention = 'needs_reply'
  detail.review = null
  detail.waitingSince = Date.now()

  const waiting = task({
    id: 't1',
    nodeId: 'a1',
    title: '等待输入的任务',
    status: 'waiting_input',
    waitingReason: 'question',
    attention: 'needs_reply',
    waitingSince: Date.now(),
  })
  await mockWorkspace(page, {
    nodes: [textNode('n1', 80, 80), agentNode('a1', 420, 80)],
    tasks: [waiting],
    taskDetail: detail,
  })

  await page.goto('/?workspace=w1')
  await page.locator('.react-flow__node[data-id="n1"]').click()
  await page.getByRole('button', { name: '投喂给任务' }).click()
  await expect(page.getByRole('heading', { name: '投喂给任务' })).toBeVisible()
  await page.getByLabel('投喂说明').fill('补充报错')
  await page.getByRole('button', { name: '投喂' }).click()

  await expect
    .poll(() => commands.find((command) => command.type === 'context.inject')?.payload)
    .toEqual({ taskId: 't1', nodeIds: ['n1'], note: '补充报错' })
})

test('rejects with canvas selection and requires confirmation on failed verify', async ({ page }) => {
  const commands: Array<{ type?: string; payload?: unknown }> = []
  await page.routeWebSocket('**/ws', wsRecorder(commands))

  const detail = sceneDetail()
  detail.review = detail.review ? { ...detail.review, verifyExitCode: 1 } : null

  await mockWorkspace(page, {
    nodes: [textNode('n1', 80, 80), agentNode('a1', 420, 80)],
    tasks: [task({ id: 't1', nodeId: 'a1', title: '待验收任务' })],
    taskDetail: detail,
  })

  await page.goto('/?workspace=w1')
  await page.locator('.react-flow__node[data-id="n1"]').click()
  await page.getByRole('button', { name: '展开看板' }).click()
  await page.getByTestId('task-board-overlay').getByText('待验收任务').click()

  await page.getByRole('button', { name: '打回' }).click()
  await page.getByRole('checkbox', { name: /附带当前选中的 1 个节点/ }).check()
  await page.getByRole('button', { name: '确认打回' }).click()
  await expect
    .poll(() => commands.find((command) => command.type === 'review.decide')?.payload)
    .toEqual({ reviewId: 'r1', decision: 'reject', contextNodeIds: ['n1'] })

  await page.getByRole('button', { name: '通过' }).click()
  await expect(page.getByText('校验未通过，仍要通过吗？')).toBeVisible()
  await page.getByLabel('通过理由').fill('已知问题，先合')
  await page.getByRole('button', { name: '确认通过' }).click()
  await expect
    .poll(() => commands.filter((command) => command.type === 'review.decide').at(-1)?.payload)
    .toEqual({ reviewId: 'r1', decision: 'approve', reason: '已知问题，先合' })
})
```

如果 `m6-helpers.ts` 的 `task()`/`sceneDetail()` 还没有 `enqueuedAt`/`injections`，在 Step 3 一并补齐。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec playwright test apps/web/e2e/context-injection.spec.ts --project=chromium`
Expected: FAIL — 按钮/对话框/checkbox 缺失，或 fixture 类型不匹配。

- [ ] **Step 3: Fix helper fixtures**

`m6-helpers.ts`：

```ts
// task()
enqueuedAt: null,
// sceneDetail().task.context
injections: [],
```

如果 `session` fixture 出现在该文件，补 `costUsd: null, turns: null`。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec playwright test apps/web/e2e/context-injection.spec.ts --project=chromium`
Expected: PASS。再跑 `pnpm exec playwright test apps/web/e2e/task-scene.spec.ts apps/web/e2e/board-attention.spec.ts --project=chromium` 确认旧场景不回归。

- [ ] **Step 5: Commit**

```bash
git add apps/web/e2e
git commit -m "test(e2e): M6-2 投喂与验收"
```

---

### Task 2: ego-lite + 真实 Claude 验收

Blocking: Task 1
Slice type: verification
Seam: 临时 daemon + 真实 workspace

**Files:**
- Create: `docs/evidence/2026-11-21-m6-2-context-injection/README.md`
- Create: `docs/evidence/2026-11-21-m6-2-context-injection/*.png`（脱敏截图）

**Interfaces:**
- 临时 daemon：`BATON_PORT=7317`（与 Vite proxy 一致）、临时 `BATON_DATA_DIR`、临时 workspace；结束后停止并删除。
- 启动前确认 `lsof -i :7317` 没有本机 daemon；有则先停掉或复用其数据目录，不要同时写同一 SQLite。

- [ ] **Step 1: 启动临时环境**

```bash
TMP=$(mktemp -d)
BATON_DATA_DIR="$TMP/data" BATON_WORKSPACES_ROOT="$TMP/workspaces" BATON_PORT=7317 \
  pnpm dev >"$TMP/dev.log" 2>&1 &
DEV_PID=$!
echo "dev pid=$DEV_PID"
```

在演示 workspace 初始化一个最小 git 仓库与 `package.json`（含 `test` 脚本），用 web 建 workspace、信任、建 Agent 节点与任务。

- [ ] **Step 2: ego-lite 取证**

1. 打开 `http://127.0.0.1:5173`，截图任务看板。
2. 让真实 Claude 任务进入 `waiting_input`（或在任务 prompt 里要求它先提问）；选中一个新的文本节点，点「投喂给任务」，截图对话框与现场条「已注入 1 次」。
3. 继续执行到 `review`；截图任务详情时间线、review 卡 cost/turn。
4. 打回时勾选「附带当前选中的节点」，截图生成的 feedback/context；或直接通过并截图确认块。
5. 截图前检查用户名、绝对路径、token、transcript；不符合则裁剪/替换。

- [ ] **Step 3: 写证据 README**

```markdown
# M6-2 上下文再注入验收

- 日期：2026-11-21
- 环境：临时 daemon（端口 7317）+ Vite dev（5173）、临时 data/workspace、真实 Claude
- 场景：任务 → waiting_input → 画布投喂 → running → review → 时间线/usage
- 截图：`01-board.png`、`02-inject-dialog.png`、`03-timeline.png`、`04-review-usage.png`
- 结论：通过/失败（如实记录）
- 脱敏：任务 ID/绝对路径已替换，transcript 已隐藏
- 已知限制：连接中断后的手动重试可能重复注入
```

- [ ] **Step 4: 停止并清理临时环境**

```bash
kill "$DEV_PID" && rm -rf "$TMP"
```

Expected: daemon 停止；临时目录删除；不触碰本机 `~/.baton`。

- [ ] **Step 5: Commit**

```bash
git add docs/evidence/2026-11-21-m6-2-context-injection
git commit -m "docs(evidence): M6-2 上下文再注入验收"
```

---

### Task 3: docs 索引、contract 收口与全量命令

Blocking: Task 1-2
Slice type: verification
Seam: docs index + contract DoD

**Files:**
- Modify: `docs/README.md`
- Modify: `docs/contracts/M6-2-context-injection.contract.md`
- Modify: `docs/specs/2026-11-21-m6-2-context-injection-design.md`（状态改为已实现）
- Modify: `docs/plans/2026-11-21-m6-2-*.md`（status: completed）

**Interfaces:**
- docs 索引包含 spec/contract/5 个 plan/evidence；contract DoD 全部按真实完成情况勾选。

- [ ] **Step 1: 确认 docs 索引**

`docs/README.md` 已包含 spec/contract/5 个 plan；验收时补 evidence 行：

```md
- [M6-2 上下文再注入验收](evidence/2026-11-21-m6-2-context-injection/README.md)
```

- [ ] **Step 2: 勾选 DoD**

逐条对照 spec、测试输出、Playwright 与 ego-lite 证据；未真实完成的条目不勾选，并在 contract 末尾写“未完成项/原因”。

注意：contract 的 Playwright 条目里“queued 保序”由 daemon 集成测试覆盖，不伪造成浏览器断言；在 contract 里写明证据位置。

- [ ] **Step 3: 更新状态**

- spec frontmatter `status: implemented`；
- 5 个 plan frontmatter `status: completed`；
- contract 状态改为“已实现，验收通过”或如实记录未完成项。

- [ ] **Step 4: 全量命令**

```bash
pnpm verify
pnpm verify:full
pnpm pack:check
pnpm check:boundaries
pnpm check:protocol
pnpm format:check
```

Expected: 全部退出码 0；Playwright 全部通过。

- [ ] **Step 5: Commit**

```bash
git add docs
git commit -m "docs: M6-2 收口"
```

---

## 验收

- `pnpm verify:full` 全绿。
- contract 15 条 DoD 全部有证据或明确未完成原因。
- ego-lite 截图已脱敏；临时 daemon 已停止、临时目录已删除。
- 不把 `dist`、`node_modules`、`.env`、本机绝对路径提交进仓库。
