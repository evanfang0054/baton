---
spec_ref: ../specs/2026-11-19-m2-2b-mobile-console-design.md
spec_topic: m2-2b-mobile-console
task_count: 5
estimated_phases: [verification, evidence, docs]
dod: "Playwright 多视口全量 + 控制面 e2e；ego-lite H5 真实 Claude 闭环；移动访问 runbook；性能记录；全量命令与 CI 全绿"
depends_on: [2026-11-19-m2-2b-mobile-foundation.md, 2026-11-19-m2-2b-mobile-tasks.md, 2026-11-19-m2-2b-mobile-controls.md]
status: completed
---

# M2-2b 移动端响应式控制台：验收实施计划（Plan 4/4）

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`（推荐）或 `executing-plans` 逐任务执行。步骤用 `- [ ]` 勾选。

**Goal:** 用自动化与真实链路证明移动端从“壳”到“控制面”都可用：多视口 Playwright、控制面 e2e、ego-lite H5 + 真实 Claude 闭环、移动访问 runbook、性能与证据。

**Architecture:** 不新增产品代码；只补 e2e、runbook、证据与索引。真实 Claude 只用于验收证据，不进 CI。

**Tech Stack:** Playwright（系统 Chrome）、ego-lite H5 视窗、真实 daemon + Claude、markdown 证据。

> GDD 显式跳过：本 plan 是验收，不产生新的行为契约；测试设计沿用 contract 16 条 DoD。

---

## File Structure

**Create**

- `apps/web/e2e/mobile-controls.spec.ts` — 建任务、建节点、kill switch。
- `apps/web/e2e/mobile-acceptance.spec.ts` — 360/390/768/1280 多视口矩阵。
- `docs/runbooks/mobile-access.md` — 手机访问与 token 轮换。
- `docs/evidence/2026-11-19-m2-2b-mobile-console/README.md` — 证据索引。
- `docs/evidence/2026-11-19-m2-2b-mobile-console/*.png` — 脱敏截图。

**Modify**

- `docs/README.md` — runbook / evidence 索引。

---

## Task 1: 控制面 Playwright

Blocking: Plan 3
Slice type: verification
Seam: 建任务 / 建节点 / kill switch 暂停与恢复

**Files:**

- Create: `apps/web/e2e/mobile-controls.spec.ts`

- [ ] **Step 1: 写 e2e**

```ts
import { expect, test, type Page } from '@playwright/test'

test.use({ viewport: { width: 390, height: 844 } })

type Sent = { type: string; payload: Record<string, unknown> }

async function mockApi(page: Page, sent: Sent[], state: { paused: boolean }) {
  await page.routeWebSocket('**/ws', (ws) => {
    ws.onMessage((raw) => {
      const message = JSON.parse(String(raw)) as { id?: string; type?: string; payload?: Record<string, unknown> }
      if (message.type && message.payload) sent.push({ type: message.type, payload: message.payload })
      if (!message.id) return
      ws.send(
        JSON.stringify({
          v: 1,
          id: `ack-${message.id}`,
          type: 'ack',
          ts: Date.now(),
          payload: { commandId: message.id, ok: true, data: { cursor: 0, hasMore: false } },
        }),
      )
    })
  })

  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/workspaces') {
      return route.fulfill({
        json: {
          workspaces: [
            { id: 'w1', name: 'demo', relPath: 'demo', trusted: true, projectHooks: 'off', trustedAt: 1, createdAt: 1 },
          ],
        },
      })
    }
    if (path === '/api/canvas') {
      return route.fulfill({
        json: {
          canvas: { id: 'c1', workspaceId: 'w1', viewport: { x: 0, y: 0, zoom: 1 } },
          nodes: [
            { id: 'a1', canvasId: 'c1', type: 'agent', x: 0, y: 0, w: 320, h: 200, groupId: null, createdAt: 1, updatedAt: 1, data: { title: '主 Agent', engine: 'fake', taskId: null } },
            { id: 'n1', canvasId: 'c1', type: 'text', x: 400, y: 0, w: 320, h: 200, groupId: null, createdAt: 1, updatedAt: 1, data: { content: '需求上下文' } },
          ],
          edges: [],
        },
      })
    }
    if (path === '/api/engines') {
      return route.fulfill({ json: { engines: [{ engine: 'fake', status: 'available' }] } })
    }
    if (path === '/api/tasks') return route.fulfill({ json: { tasks: [] } })
    if (path === '/api/notices') return route.fulfill({ json: { notices: [] } })
    if (path === '/api/workspaces/w1/automation') {
      return route.fulfill({
        json: {
          workspaceId: 'w1',
          trusted: true,
          policy: { autopilot: { enabled: true } },
          policyVersion: 'p1',
          killSwitch: state.paused,
          killSwitchForced: false,
          digestCronUnsupported: false,
        },
      })
    }
    if (path === '/api/audit') return route.fulfill({ json: { entries: [] } })
    if (path === '/api/automation/kill-switch') {
      const body = route.request().postDataJSON() as { enabled: boolean }
      state.paused = body.enabled
      return route.fulfill({ json: { killSwitch: state.paused, killSwitchForced: false } })
    }
    return route.fulfill({ json: {} })
  })
}

test('creates a task from mobile with agent and context', async ({ page }) => {
  const sent: Sent[] = []
  const state = { paused: false }
  await mockApi(page, sent, state)
  await page.goto('/')

  await page.getByRole('button', { name: '更多' }).click()
  await page.getByRole('button', { name: '新建任务' }).click()

  await page.getByLabel('任务标题').fill('移动建任务')
  await page.getByLabel('任务 prompt').fill('改一个常量')
  await page.getByRole('button', { name: '选择节点' }).click()
  await page.getByRole('button', { name: /需求上下文/ }).click()
  await page.getByRole('button', { name: '确定' }).click()
  await page.getByRole('button', { name: '创建' }).click()

  await expect
    .poll(() => sent.find((item) => item.type === 'task.create')?.payload)
    .toMatchObject({ nodeId: 'a1', contextNodeIds: ['n1'], title: '移动建任务' })
})

test('creates a text node from the node list', async ({ page }) => {
  const sent: Sent[] = []
  const state = { paused: false }
  await mockApi(page, sent, state)
  await page.goto('/')

  await page.getByRole('button', { name: '更多' }).click()
  await page.getByRole('button', { name: '节点列表' }).click()
  await page.getByRole('button', { name: '新建文本' }).click()
  await page.getByLabel('文本内容').fill('新的上下文')
  await page.getByRole('button', { name: '保存' }).click()

  await expect
    .poll(() => sent.find((item) => item.type === 'node.create')?.payload)
    .toMatchObject({ canvasId: 'c1', node: { type: 'text', data: { content: '新的上下文' } } })
})

test('pauses automation from the more menu', async ({ page }) => {
  const sent: Sent[] = []
  const state = { paused: false }
  await mockApi(page, sent, state)
  await page.goto('/')

  await page.getByRole('button', { name: '更多' }).click()
  await expect(page.getByText('自动化运行中')).toBeVisible()
  await page.getByRole('button', { name: '暂停自动化' }).click()
  await expect(page.getByText('自动化已暂停')).toBeVisible()
})
```

Run: `pnpm exec playwright test apps/web/e2e/mobile-controls.spec.ts`

Expected: 3 passed。

- [ ] **Step 2: 提交**

```bash
git add apps/web/e2e/mobile-controls.spec.ts
git commit -m "test(web): 增加移动控制面 e2e"
```

---

## Task 2: 多视口矩阵

Blocking: Plan 1-3
Slice type: verification
Seam: 360/390/768/1280；无画布/画布存在；无横向溢出

**Files:**

- Create: `apps/web/e2e/mobile-acceptance.spec.ts`

- [ ] **Step 1: 写矩阵测试**

```ts
import { expect, test, type Page } from '@playwright/test'

async function mockEmpty(page: Page) {
  await page.route('**/api/**', (route) => route.fulfill({ json: { workspaces: [] } }))
}

const mobileViewports = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
]

for (const viewport of mobileViewports) {
  test(`mobile shell at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await mockEmpty(page)
    await page.goto('/')

    await expect(page.getByRole('navigation', { name: '移动端导航' })).toBeVisible()
    await expect(page.getByTestId('mobile-board')).toBeVisible()
    await expect(page.getByTestId('canvas')).toHaveCount(0)
    await expect(page.getByTestId('board-rail')).toHaveCount(0)
    await expect(page.getByTestId('right-panel')).toHaveCount(0)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
    ).toBe(false)
  })
}

test('tablet keeps canvas and collapses the board', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 })
  await mockEmpty(page)
  await page.goto('/')

  await expect(page.getByTestId('canvas')).toBeVisible()
  await expect(page.getByTestId('board-rail')).toBeVisible()
  await expect(page.getByTestId('right-panel')).toBeVisible()
  await expect(page.getByTestId('task-board-overlay')).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: '移动端导航' })).toHaveCount(0)
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
  ).toBe(false)
})

test('desktop keeps the existing three-pane shell', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await mockEmpty(page)
  await page.goto('/')

  await expect(page.getByTestId('canvas')).toBeVisible()
  await expect(page.getByTestId('board-rail')).toBeVisible()
  await expect(page.getByTestId('right-panel')).toBeVisible()
  await expect(page.getByRole('navigation', { name: '移动端导航' })).toHaveCount(0)
})
```

Run: `pnpm exec playwright test apps/web/e2e/mobile-acceptance.spec.ts`

Expected: 4 passed。

- [ ] **Step 2: 全量 e2e**

```bash
pnpm exec playwright test
```

Expected: 现有 + 新增全绿；记录测试数量。

- [ ] **Step 3: 提交**

```bash
git add apps/web/e2e/mobile-acceptance.spec.ts
git commit -m "test(web): 增加移动多视口验收矩阵"
```

---

## Task 3: ego-lite H5 + 真实 Claude 验收

Blocking: Task 1、Task 2
Slice type: verification
Seam: 手机建任务 → 开工 → 审批 → verify → 移动端验收

**Files:**

- Create: `docs/evidence/2026-11-19-m2-2b-mobile-console/README.md`
- Create: `docs/evidence/2026-11-19-m2-2b-mobile-console/*.png`

**准备**

1. 用临时 `BATON_DATA_DIR` / `BATON_WORKSPACES_ROOT` 启动 daemon，避免污染本机数据：
   ```bash
   export BATON_DATA_DIR="$(mktemp -d)"
   export BATON_WORKSPACES_ROOT="$(mktemp -d)"
   export BATON_HOST=127.0.0.1
   export BATON_TOKEN="$(openssl rand -hex 16)"
   pnpm dev
   ```
2. 在 `$BATON_WORKSPACES_ROOT` 下创建示例工作区 `demo-mobile`，准备：
   - `src/mobile.txt` 初始内容 `MOBILE-DEMO`
   - `.baton/verify.sh`：检查文件包含 `MOBILE-DONE`，否则 `exit 1`
   - `.baton/policy.json`：`verify.command = sh .baton/verify.sh`
3. 用 ego-lite 打开 `http://127.0.0.1:7317/auth?token=$BATON_TOKEN`（H5 视窗 390×844）。

> 注意：示例路径、token、主机名不得进仓库；证据 README 用 `$BATON_DATA_DIR` / `<workspace>` 占位。

- [ ] **Step 1: 手机建任务**

- 更多 → 创建工作区（`demo-mobile`）→ 信任（允许项目 hooks 保持关闭）。
- 更多 → 节点列表 → 新建 Agent（标题“移动演示”，引擎 Claude）→ 新建文本（内容“把 src/mobile.txt 改成 MOBILE-DONE”）。
- 更多 → 新建任务：选 Agent、选上下文、标题“移动端真实任务”、prompt“把 src/mobile.txt 改成 MOBILE-DONE，然后运行 verify”。

Expected: 任务出现在“待办”。

- [ ] **Step 2: 开工与审批**

- 打开任务 → “立即开工”。
- 真实 Claude 触发 `Edit`/`Bash` 审批时，在手机上允许一次、拒绝一次（或按实际审批类型至少处理一次）。
- 如果 verify 失败，确认自动重试最多一次；最终进入“待验收”。

Expected: 任务进入 `review`；transcript 可见；无桌面浏览器参与。

- [ ] **Step 3: 移动端验收**

- 查看 verify 输出与 diff 统计；点“通过”→ `done`。
- 再建一个任务，故意让 verify 失败，点“打回”并填写反馈 → 任务回到 `todo/queued`。

Expected: 通过/打回都在手机完成。

- [ ] **Step 4: 截图与 README**

截图（脱敏后）：
- `01-mobile-board.png` — 待处理优先看板。
- `02-create-task.png` — 表单 + Agent/上下文。
- `03-approval.png` — 审批卡。
- `04-review.png` — 验收卡与 verify。
- `05-more-menu.png` — 自动化状态与暂停。
- `06-tablet.png` — 768 平板画布 + 收起看板。

README 记录：
- 步骤、结果、任务 ID（可用 `t-*` 占位）、审批类型、verify 退出码。
- 真实 Claude 版本/模型不记录具体账号；只写“host-native Claude”。
- 残留风险：真实审批样本数量、手机 token 全权限、移动 bundle 体积。

- [ ] **Step 5: 提交证据**

```bash
git add docs/evidence/2026-11-19-m2-2b-mobile-console
git commit -m "docs(evidence): 完成 M2-2b 移动端验收"
```

---

## Task 4: 移动访问 runbook 与索引

Blocking: Task 3
Slice type: docs
Seam: 文档链接与脱敏检查

**Files:**

- Create: `docs/runbooks/mobile-access.md`
- Modify: `docs/README.md`

- [ ] **Step 1: 写 runbook**

内容必须覆盖：

- 本机：`BATON_HOST=127.0.0.1`，手机无法访问；远程必须显式监听。
- 局域网：`BATON_HOST=0.0.0.0` + `BATON_TOKEN`；打开 `http://<host>:7317/auth?token=<token>`。
- Tailscale/Caddy/Nginx：推荐 HTTPS；`BATON_TOKEN` 必须设置。
- 手机丢失：轮换 `BATON_TOKEN` 并重启 daemon；cookie 为 HttpOnly，前端不写 localStorage。
- 截图脱敏：不拍 token、地址栏、用户名、主机名、通知内容。
- 支持视口：`<768` 移动控制台（无画布）；`768–1023` 压缩桌面；`≥1024` 桌面。
- 手机端能力：任务/闸门/开工/批量/建任务/节点表单/总管/设置/信任/汇报；不含画布、删除节点、连线、图片/group/review。

- [ ] **Step 2: 更新 `docs/README.md`**

- runbook 索引增加 `mobile-access.md`。
- 验收证据增加 `2026-11-19-m2-2b-mobile-console/README.md`。

- [ ] **Step 3: 验证并提交**

```bash
pnpm exec prettier --check docs/runbooks/mobile-access.md docs/README.md
grep -n "token=\|/Users/\|@[a-z0-9.-]*\." docs/runbooks/mobile-access.md docs/evidence/2026-11-19-m2-2b-mobile-console/README.md
```

Expected: Prettier 通过；grep 只命中占位符（如 `<token>`），不得命中真实值。

```bash
git add docs/runbooks/mobile-access.md docs/README.md
git commit -m "docs(runbook): 增加移动访问与 token 轮换"
```

---

## Task 5: 性能记录与全量收口

Blocking: Task 1-4
Slice type: verification
Seam: bundle 体积、全量命令、CI

- [ ] **Step 1: 记录 bundle 体积**

```bash
pnpm --filter @baton/web build
find apps/web/dist/assets -maxdepth 1 -name '*.js' -print0 | xargs -0 gzip -c | wc -c
```

Expected: 记录 gzip 字节数到证据 README。若 > 400KB gzip 或 ego-lite H5 首屏 > 2s，记录为 follow-up（`React.lazy` 画布），不阻塞本迭代。

- [ ] **Step 2: 全量命令**

```bash
pnpm verify
pnpm verify:full
pnpm pack:check
pnpm check:boundaries
pnpm check:protocol
pnpm format:check
pnpm check:secrets
```

Expected: 全部 exit 0。

- [ ] **Step 3: 更新证据 README 与索引**

证据 README 增加：
- 测试数量（web 单测、Playwright、移动 e2e）。
- bundle gzip 体积。
- 真实 Claude 流程结果与残留风险。
- 桌面/平板回归结论。

- [ ] **Step 4: 提交并准备 PR**

```bash
git add docs/evidence/2026-11-19-m2-2b-mobile-console/README.md
git commit -m "docs(evidence): 记录 M2-2b 性能与验收结果"
```

PR 前检查：
- `git diff main...HEAD -- packages/protocol apps/daemon` 为空（无后端变更）。
- CI 五项 checks 全绿。
- 截图无 token/用户名/绝对路径/主机名。

> push/PR 需用户确认；不要在未确认前操作公开仓库。

---

## Self-Review

- **Spec coverage**：覆盖 spec §10（测试与验收）、§11（性能/风险）与 contract DoD 14、15、16；真实 Claude 流程与证据位置明确。
- **Placeholder scan**：无 TBD/TODO；e2e fixture 含实际 workspace/canvas/engines/automation 数据；runbook 列出必须覆盖的条目。
- **Type consistency**：`AutomationSummary` 使用 `policy: { autopilot: { enabled: true } }`，其余字段由 schema 默认值补齐；`TaskDetailResponse` / `Approval` 字段与协议一致。
- **Risk**：真实 Claude 可能因本机登录态/模型不可用而阻塞；如阻塞，如实记录“blocked + 原因”，不得用 fake 冒充真实验收。

## Execution Handoff

Plan 4 已落 `docs/plans/2026-11-19-m2-2b-mobile-acceptance.md`。执行方式：subagent-driven（推荐）或 inline。

## 执行记录（2026-11-19）

- 5 个 task 全部完成；控制面 e2e、多视口矩阵、真实 Claude 闭环、runbook、证据与索引均落地。
- 验证：web 单测 164（新增 2 条 Agent 引擎回归）；Playwright 24 条全绿；`pnpm verify` exit 0；`pnpm pack:check` ok；`pnpm check:secrets` no leaks。
- 视口矩阵：360 / 390 / 768 / 1280 全绿；移动无画布与横向溢出，平板保留画布并收起看板。
- 真实 Claude：手机建工作区/节点/任务 → `Write` 审批 → verify exit 0 → 手机验收通过 `done`；另跑一次失败 verify（exit 1）→ 手机打回并填写反馈。
- bundle：JS 978.64 kB，Vite gzip 300.80 kB；全 JS gzip 297,218 bytes。
- 偏离：
  - 真实审批 transcript 含本机绝对路径，`03-approval.png` 改用 Playwright 相对路径 fixture；真实审批仍在两次真实任务中执行。
  - 本地 5173 被无关进程占用，全量 e2e 用临时配置在 5199 跑完；仓库 Playwright 配置未改。
  - 修复移动建任务默认引擎：从 Agent 节点继承 `engine`，并在切换 Agent 时同步；新增 2 条组件测试。
  - 打回后 core 实际是 `queued` 并立即入队为 `running`，与计划文字「回到 todo/queued」不完全一致；已记入证据残留风险。
- 未做：不涉及后端/协议改动；分支已 push 到 `origin/feat/m2-2b-mobile-console`，PR 创建因本机 `gh` token 失效阻塞，重新登录后补建。
