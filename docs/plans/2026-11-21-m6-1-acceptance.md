---
spec_ref: ../specs/2026-11-21-m6-task-scene-design.md
spec_topic: m6-task-scene
task_count: 5
estimated_phases: [tests, implementation, verification]
dod: 'M6-1 DoD 14-17：Playwright、ego-lite 真实 Claude、证据、文档收口'
status: completed
depends_on: 2026-11-21-m6-1-board-attention.md
---

# M6-1 Plan 5：验收与文档收口

> **For agentic workers:** REQUIRED SUB-SKILL: Use agent-harness:subagent-driven-development (recommended) or agent-harness:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 用 Playwright 固化现场/分组/看板回归，用 ego-lite + 真实 Claude 跑通 review 现场，最后收口 contract 与 docs。

**Architecture:** Playwright 继续用 `page.routeWebSocket('**/ws')` + `page.route('**/api/**')` 固定数据；真实 Claude 验收用临时 data/workspace，不污染本机；证据截图按仓库脱敏规则处理。

**Tech Stack:** Playwright（系统 Chrome）、ego-lite、vitest、pnpm scripts。

**Commit strategy:** 每个 task 末尾提交；最后统一跑全量命令。

**Test helper 契约：** 在 `apps/web/e2e/m6-helpers.ts` 提供以下 helper，三个 spec 共用：

```ts
mockWorkspace(page: Page, input: {
  nodes?: Node[]
  tasks?: TaskSummary[]
  taskDetail?: TaskDetailResponse
  reviewDetail?: Partial<ReviewView>
}): Promise<void>
task(overrides: Partial<TaskSummary>): TaskSummary
textNode(id: string, x: number, y: number, overrides?: Partial<Node>): Node
agentNode(id: string, x: number, y: number, overrides?: Partial<Node>): Node
imageNode(id: string, src: string, x: number, y: number): Node
groupNode(id: string, x: number, y: number, w?: number, h?: number): Node
sceneDetail(): TaskDetailResponse
```

---

### Task 1: Playwright 图片与现场

Blocking: Plan 3
Slice type: verification
Seam: `apps/web/e2e/task-scene.spec.ts`

**Files:**
- Create: `apps/web/e2e/m6-helpers.ts`
- Create: `apps/web/e2e/task-scene.spec.ts`

**Interfaces:**
- 复用现有 `page.routeWebSocket` / `page.route` 模式；断言 `node.update`/`group.create` 命令与现场条。

- [x] **Step 1: 写测试**

```ts
test('image node and task scene', async ({ page }) => {
  const commands: Array<{ type?: string; payload?: unknown }> = []
  await page.routeWebSocket('**/ws', (ws) => {
    ws.onMessage((raw) => {
      const message = JSON.parse(String(raw)) as { id?: string; type?: string; payload?: unknown }
      if (!message.id) return
      commands.push(message)
      ws.send(JSON.stringify({
        v: 1, id: `ack-${message.id}`, type: 'ack', ts: Date.now(),
        payload: { commandId: message.id, ok: true, data: { nodeId: 'i1' } },
      }))
    })
  })
  await mockWorkspace(page, {
    nodes: [
      imageNode('i1', '.baton/uploads/a.png', 80, 80),
      agentNode('a1', 420, 80),
      textNode('n1', 80, 260),
    ],
    tasks: [{ id: 't1', nodeId: 'a1', status: 'review', waitingSince: Date.now() - 3600_000 }],
    taskDetail: sceneDetail(),
  })

  await page.goto('/')
  await expect(page.getByRole('img', { name: '图片' })).toBeVisible()
  await page.getByRole('button', { name: '看现场' }).click()
  await expect(page.getByTestId('task-scene-bar')).toContainText('任务')
  await expect(page.getByTestId('task-scene-bar')).toContainText('上下文 2 个')
  await page.getByRole('button', { name: '回到全局' }).click()
  await expect(page.getByTestId('task-scene-bar')).toHaveCount(0)
  expect(commands.every((command) => command.type !== 'node.update')).toBe(true)
})
```

- [x] **Step 2: 运行**

Run: `pnpm exec playwright test apps/web/e2e/task-scene.spec.ts --project=chromium`
Expected: PASS（或先 FAIL，补 mock 数据后 PASS）。

- [x] **Step 3: 提交**

```bash
git add apps/web/e2e/task-scene.spec.ts
git commit -m "test(e2e): 图片节点与任务现场"
```

---

### Task 2: Playwright 分组拖动

Blocking: Task 1
Slice type: verification
Seam: `group.create` / `node.move_many`

**Files:**
- Create: `apps/web/e2e/canvas-group.spec.ts`

**Interfaces:**
- 建组后拖动 group，断言只发一次 `node.move_many`，且 payload 包含 group + child 绝对坐标；刷新后 mock 返回新坐标，页面保持。

- [x] **Step 1: 写测试**

```ts
test('group drag persists children in one command', async ({ page }) => {
  const commands: Array<{ type?: string; payload?: any }> = []
  await mockWorkspace(page, { nodes: [textNode('n1', 80, 80), groupNode('g1', 0, 0, 400, 300)], tasks: [] })
  await page.goto('/')
  await page.getByTestId('node-g1').click()
  await dragBy(page.getByTestId('node-g1'), 100, 100)
  const move = commands.find((command) => command.type === 'node.move_many')
  expect(move?.payload.moves).toEqual(expect.arrayContaining([
    { nodeId: 'g1', x: 100, y: 100 },
    { nodeId: 'n1', x: 180, y: 180 },
  ]))
})
```

- [x] **Step 2: 运行**

Run: `pnpm exec playwright test apps/web/e2e/canvas-group.spec.ts --project=chromium`
Expected: PASS。

- [x] **Step 3: 提交**

```bash
git add apps/web/e2e/canvas-group.spec.ts
git commit -m "test(e2e): 分组拖动持久化"
```

---

### Task 3: Playwright 看板与 review 卡

Blocking: Plan 4
Slice type: verification
Seam: 需要我过滤 / stale / review 卡

**Files:**
- Create: `apps/web/e2e/board-attention.spec.ts`

**Interfaces:**
- 用两条任务（review 等待 40 分钟、running）断言「需要我」只显示 review、stale 文本出现、review 卡显示初步结论、通过后卡片消失。

- [x] **Step 1: 写测试**

```ts
test('needs me filter, stale and review card', async ({ page }) => {
  await mockWorkspace(page, {
    tasks: [
      task({ id: 't1', title: '待验收任务', status: 'review', attention: 'needs_review', waitingSince: Date.now() - 40 * 60_000 }),
      task({ id: 't2', title: '运行中', status: 'running', attention: 'none', waitingSince: null }),
    ],
    reviewDetail: { preliminaryVerdict: 'pass', preliminaryReason: 'VERDICT: PASS' },
  })
  await page.goto('/')
  await page.getByRole('button', { name: '需要我' }).click()
  await expect(page.getByText('待验收任务')).toBeVisible()
  await expect(page.getByText('运行中')).toHaveCount(0)
  await expect(page.getByText('已等待超过 30 分钟')).toBeVisible()
  await expect(page.getByText('初步验收：PASS')).toBeVisible()
  await page.getByRole('button', { name: '通过' }).click()
  await expect(page.getByText('待验收任务')).toHaveCount(0)
})
```

- [x] **Step 2: 运行**

Run: `pnpm exec playwright test apps/web/e2e/board-attention.spec.ts --project=chromium`
Expected: PASS。

- [x] **Step 3: 提交**

```bash
git add apps/web/e2e/board-attention.spec.ts
git commit -m "test(e2e): 看板注意力与 review 卡"
```

---

### Task 4: 真实 Claude + ego-lite 验收

Blocking: Task 1-3
Slice type: verification
Seam: 临时 daemon + 真实 workspace

**Files:**
- Create: `docs/evidence/2026-11-21-m6-task-scene/README.md`
- Create: `docs/evidence/2026-11-21-m6-task-scene/*.png`（脱敏截图）

**Interfaces:**
- 临时 daemon：`BATON_PORT=7317`（与 Vite proxy 一致）、临时 `BATON_DATA_DIR`、临时 workspace；结束后停止并删除。
- 启动前先确认 `lsof -i :7317` 没有本机 daemon；如果有，先停掉或复用其数据目录，不要同时写同一 SQLite。
- 场景：一个真实 Claude 任务完成到 review → 现场显示 verify/diff/初步结论 → 人工通过/打回 → review 卡消失。

- [x] **Step 1: 启动临时环境**

```bash
TMP=$(mktemp -d)
BATON_DATA_DIR="$TMP/data" BATON_WORKSPACES_ROOT="$TMP/workspaces" BATON_PORT=7317 \
  pnpm dev >"$TMP/dev.log" 2>&1 &
DEV_PID=$!
echo "dev pid=$DEV_PID"
```

在演示 workspace 初始化一个最小 git 仓库与 `package.json`（含 `test` 脚本），用 web 建 workspace、信任、建任务。

- [x] **Step 2: ego-lite 取证**

1. 打开 `http://127.0.0.1:5173`，截图任务看板。
2. 点任务「看现场」，截图现场条、上下文节点、review 卡。
3. 人工通过/打回，截图 review 卡消失。
4. 截图前检查用户名、绝对路径、token、transcript；不符合则裁剪/替换。

- [x] **Step 3: 写证据 README**

```markdown
# M6-1 任务现场验收

- 日期：2026-11-21
- 环境：临时 daemon（端口 7317）+ Vite dev（5173）、临时 data/workspace、真实 Claude
- 场景：任务 → review → 现场（上下文/verify/diff/初步结论）→ 人工决定 → review 卡消失
- 截图：`01-board.png`、`02-scene.png`、`03-review-card.png`、`04-after-decision.png`
- 结论：通过/失败（如实记录）
- 脱敏：任务 ID/绝对路径已替换，transcript 已隐藏
```

- [x] **Step 4: 停止并清理临时环境**

Run: `kill "$DEV_PID" && rm -rf "$TMP"`
Expected: daemon 停止；临时目录删除；不触碰本机 `~/.baton`。

- [x] **Step 5: 提交**

```bash
git add docs/evidence/2026-11-21-m6-task-scene
git commit -m "docs(evidence): M6-1 任务现场验收"
```

---

### Task 5: 文档索引、contract 收口与全量命令

Blocking: Task 1-4
Slice type: verification
Seam: docs index + DoD 勾选

**Files:**
- Modify: `docs/README.md`
- Modify: `docs/contracts/M6-1-task-scene.contract.md`
- Modify: `docs/specs/2026-11-21-m6-task-scene-design.md`（状态改为已实现）

**Interfaces:**
- docs 索引包含 spec/contract/5 个 plan/evidence。
- contract DoD 全部 `[x]`，只勾选真实完成的项。

- [x] **Step 1: 更新 docs 索引**

在 `docs/README.md` 的 spec/contract/plan/evidence 四节分别加入：

```md
- [2026-11-21 M6-1 任务现场 v0 设计](specs/2026-11-21-m6-task-scene-design.md)
- [M6-1 任务现场](contracts/M6-1-task-scene.contract.md)
- [M6-1 Plan 1 protocol + core](plans/2026-11-21-m6-1-protocol-core.md)
- [M6-1 Plan 2 daemon](plans/2026-11-21-m6-1-daemon.md)
- [M6-1 Plan 3 web canvas](plans/2026-11-21-m6-1-canvas-web.md)
- [M6-1 Plan 4 web 看板](plans/2026-11-21-m6-1-board-attention.md)
- [M6-1 Plan 5 验收](plans/2026-11-21-m6-1-acceptance.md)
- [M6-1 任务现场验收](evidence/2026-11-21-m6-task-scene/README.md)
```

- [x] **Step 2: 勾选 DoD**

逐条对照 spec、测试输出、Playwright 与 ego-lite 证据；未真实完成的条目不勾选，并在 contract 末尾写“未完成项/原因”。

- [x] **Step 3: 全量命令**

```bash
pnpm verify
pnpm verify:full
pnpm pack:check
pnpm check:boundaries
pnpm check:protocol
pnpm format:check
```

Expected: 全部退出码 0；Playwright 全部通过。

- [x] **Step 4: 提交**

```bash
git add docs
git commit -m "docs: M6-1 收口"
```

---

## 验收

- `pnpm verify:full` 全绿。
- contract 17 条 DoD 全部有证据或明确未完成原因。
- ego-lite 截图已脱敏；临时 daemon 已停止、临时目录已删除。
- 不把 `dist`、`node_modules`、`.env`、本机绝对路径提交进仓库。

---

## 执行记录

- 2026-11-21：Task 1-5 全部完成；e2e 提交 `59d2b3c`，验收证据与收口提交见 git log。
- Playwright：新增 `m6-helpers.ts`、`task-scene.spec.ts`、`canvas-group.spec.ts`、`board-attention.spec.ts`；`pnpm verify:full` 共 41 条 e2e 全绿。分组拖动断言改为“同一笔 `node.move_many` 中 group 与子节点位移一致”，因为浏览器拖拽像素会取整；不固定绝对坐标。
- 真实 Claude + ego-lite：临时 daemon（7317）+ Vite（5173）+ 临时 data/workspace + 真实 `claude-sdk`；任务从 `review` → 现场 → 人工通过 → `done`。证据见 `docs/evidence/2026-11-21-m6-task-scene/README.md`，截图 3 张（看板、现场/review 卡、通过后）。
- 真实环境限制：临时环境 Corepack 缓存的 pnpm 不可用，`verifyExitCode = 1`；Claude 会话内改用 Homebrew pnpm 跑通。临时 daemon 未配置总管模型，`preliminaryVerdict = null`，review 卡显示“进行中/未完成”。这两点已写入证据 README，不伪装成通过。
- 收口：docs 索引加入 evidence；spec `status: implemented`；contract 17 条 DoD 全部勾选并补证据说明；`pnpm verify:full`、`pnpm pack:check`、`pnpm check:boundaries`、`pnpm check:protocol`、`pnpm format:check` 均退出码 0。
- 偏差：计划中的 `03-review-card.png` 因截图包含 transcript/本机路径而删除，review 卡证据由 `02-scene.png` 承担；没有提交未脱敏截图。
- 2026-11-21 代码评审修复后复验：`pnpm verify` 退出码 0；web 233 tests、54 files 全绿；M6 e2e 3 条（task-scene / canvas-group / board-attention）通过。board-attention 改为先打开任务详情再断言初步验收，因为全局画布不再为每张 review 卡拉详情。
