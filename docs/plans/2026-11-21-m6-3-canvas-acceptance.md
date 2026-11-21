---
spec_ref: ../specs/2026-11-21-m6-3-acceptance-evidence-design.md
spec_topic: m6-3-acceptance-evidence
task_count: 6
estimated_phases: [tests, implementation, verification]
dod: "画布 review 卡承载验收摘要并可打开证据；现场条显示 AC/成本；Playwright 与 ego-lite 证据落库；contract 收口"
status: active
depends_on: 2026-11-21-m6-3-tasks-web.md
---

# M6-3 Plan 5：画布验收证据卡、e2e 与收口

> **For agentic workers:** 使用 `agent-harness:subagent-driven-development`（推荐）或 `executing-plans` 按 task 执行。

**Goal:** 把验收证据搬到画布 review 卡和现场条，完成 Playwright UI 回归、ego-lite + 真实 Claude 证据与 contract 收口。

**Architecture:** 画布 review 卡数据来自任务 summary 的 acceptance/budget；卡片只读，`查看证据` 打开任务详情验收区块；现场条只显示摘要。后端链路已在 Plan 2/3 完成，本 plan 不新增业务写入。

**Tech Stack:** React 19、@xyflow/react 13、Playwright、ego-lite、vitest。

**Commit strategy:** 每个 task 末尾一次 commit。

**Design sync:** 先读 `DESIGN.md`；review 卡/现场条只用语义 token；状态带文字+图标；卡片保持轻量。

---

### Task 1: 画布 review 卡数据

Blocking: Plan 4
Slice type: tracer-bullet
Seam: `toFlowNodes` 的 review 节点 data

**Files:**
- Modify: `apps/web/src/features/canvas/model.ts:38-158`
- Test: `apps/web/src/features/canvas/canvas-model.test.ts`

**Interfaces:**
- Produces: review 节点 data 增加 `acceptance: TaskAcceptanceSummary | null`、`budget: TaskBudgetSummary | null`；没有任务/验收时保持 null。

- [ ] **Step 1: 写失败测试**

```ts
it('carries acceptance and budget onto the review card', () => {
  const nodes = toFlowNodes(canvas, [task({ id: 't1', status: 'review',
    acceptance: { pass: 2, total: 3, fail: 1 }, budget: { spent: 1.2, limit: 2, over: false } })], [])
  const card = nodes.find((n) => n.id === reviewCardId('t1'))
  expect(card?.data).toMatchObject({ acceptance: { pass: 2, total: 3, fail: 1 }, budget: { spent: 1.2, limit: 2 } })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @baton/web exec vitest run src/features/canvas/canvas-model.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

- `CanvasNodeData` 加 acceptance/budget 字段；`toFlowNodes` 从传入的 `TaskSummary` 读取；旧的 `TaskSummary` 缺字段时 null。
- 不改节点位置/尺寸逻辑。

- [ ] **Step 4: 跑测试**

Run: `pnpm --filter @baton/web exec vitest run src/features/canvas/canvas-model.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/canvas/model.ts apps/web/src/features/canvas/canvas-model.test.ts
git commit -m "feat(web): review 卡携带验收与预算摘要"
```

---

### Task 2: ReviewCardNode 摘要与查看证据

Blocking: Task 1
Slice type: tracer-bullet
Seam: 卡片渲染 + 打开详情

**Files:**
- Modify: `apps/web/src/features/canvas/nodes/ReviewCardNode.tsx:12`
- Modify: `apps/web/src/features/canvas/CanvasPanel.tsx`（onOpenEvidence 接线）
- Modify: `apps/web/src/features/tasks/TaskDetailPanel.tsx`（`data-section="acceptance"` + scroll）
- Test: `apps/web/src/features/canvas/nodes/nodes.test.tsx`

**Interfaces:**
- Produces: review 卡显示 `AC x/y`、`✔/✘/○`、最多 1 条失败项、verify 状态、`$spent/$budget`、初步结论、`查看证据`；点击打开任务详情并滚到验收区块；卡片仍只读。

- [ ] **Step 1: 写失败测试**

```tsx
it('renders AC summary and opens evidence', async () => {
  render(<ReviewCardNode data={reviewData({ acceptance: { pass: 2, total: 3, fail: 1 } })} />)
  expect(screen.getByText('AC 2/3')).toBeInTheDocument()
  expect(screen.getByText('深链参数未校验')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '查看证据' }))
  expect(onOpenEvidence).toHaveBeenCalledWith('t1', 'acceptance')
})

it('shows unavailable state instead of 0/0', () => {
  render(<ReviewCardNode data={reviewData({ acceptance: null })} />)
  expect(screen.getByText('初步验收未完成')).toBeInTheDocument()
  expect(screen.queryByText('AC 0/0')).toBeNull()
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @baton/web exec vitest run src/features/canvas/nodes/nodes.test.tsx`
Expected: FAIL。

- [ ] **Step 3: 实现**

- 卡片布局：标题/状态 → AC 计数 → 失败项（1 条，截断）→ verify → cost/budget → 初步结论 → 按钮。
- `查看证据` 调 `onOpenEvidence(taskId, 'acceptance')`；`CanvasPanel` 传给任务详情打开动作。
- `TaskDetailPanel` 的验收区块加 `data-section="acceptance"`；带 section 打开时 `scrollIntoView({block:'start'})`。
- 卡片只读：没有通过/打回按钮；不新增节点类型。

- [ ] **Step 4: 跑测试**

Run: `pnpm --filter @baton/web exec vitest run src/features/canvas/nodes/nodes.test.tsx`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/canvas apps/web/src/features/tasks/TaskDetailPanel.tsx
git commit -m "feat(web): 画布验收证据卡与查看证据"
```

---

### Task 3: 现场条 AC/成本摘要

Blocking: Task 1
Slice type: tracer-bullet
Seam: `TaskSceneBar`

**Files:**
- Modify: `apps/web/src/features/canvas/TaskSceneBar.tsx:8-48`
- Test: `apps/web/src/features/canvas/TaskSceneBar.test.tsx`

**Interfaces:**
- 现场条在原有上下文计数旁显示 `AC x/y · $spent/$budget`；无验收显示 `AC —`；不新增操作。

- [ ] **Step 1: 写失败测试**

```tsx
it('shows AC and budget summary', () => {
  render(<TaskSceneBar scene={scene({ acceptance: { pass: 2, total: 3 }, budget: { spent: 1.2, limit: 2 } })} />)
  expect(screen.getByText('AC 2/3')).toBeInTheDocument()
  expect(screen.getByText('$1.20 / $2.00')).toBeInTheDocument()
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @baton/web exec vitest run src/features/canvas/TaskSceneBar.test.tsx`
Expected: FAIL。

- [ ] **Step 3: 实现**

- 从 `scene` 或任务 summary 读 acceptance/budget；使用 `DESIGN.md` token。
- 保持原有“回到全局”等动作不变。

- [ ] **Step 4: 跑测试**

Run: `pnpm --filter @baton/web exec vitest run src/features/canvas/TaskSceneBar.test.tsx`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/canvas/TaskSceneBar.tsx apps/web/src/features/canvas/TaskSceneBar.test.tsx
git commit -m "feat(web): 现场条显示验收与预算摘要"
```

---

### Task 4: Playwright UI 回归（mock API）

Blocking: Task 1-3
Slice type: tracer-bullet
Seam: `apps/web/e2e/acceptance-evidence.spec.ts`

**Files:**
- Modify: `apps/web/e2e/m6-helpers.ts`（fixtures 加 acceptance/budget/report）
- Create: `apps/web/e2e/acceptance-evidence.spec.ts`

**Interfaces:**
- 覆盖：review 卡摘要 + 查看证据；AC fail 通过二次确认 + `overrideReason`；`waiting_input(budget)` 预算卡 + `task.set_budget`；总管回答 AC/cost 不声称已通过。

- [ ] **Step 1: 写失败 e2e**

```ts
test('review card opens evidence and AC override sends reason', async ({ page }) => {
  await mockWorkspace(page, { task: task({ status: 'review', acceptance: { pass: 2, total: 3, fail: 1 } }) })
  await page.goto('/?workspace=w1')
  await expect(page.getByText('AC 2/3')).toBeVisible()
  await page.getByRole('button', { name: '查看证据' }).click()
  await expect(page.getByText('验收清单')).toBeVisible()
  await page.getByRole('button', { name: '通过' }).click()
  await page.getByLabel('通过理由').fill('已知风险')
  await page.getByRole('button', { name: '确认通过' }).click()
  await expect.poll(() => lastWsCommand(page)).toMatchObject({ type: 'review.decide', payload: { decision: 'approve', overrideReason: '已知风险' } })
})
```

- [ ] **Step 2: 跑 e2e 确认失败**

Run: `pnpm exec playwright test apps/web/e2e/acceptance-evidence.spec.ts --project=chrome`
Expected: FAIL。

- [ ] **Step 3: 实现 fixtures 与 mock**

- `m6-helpers.ts` 的 `task()` 默认加 `acceptance: null`、`budget: null`；新增 `acceptanceSummary()`、`budgetSummary()`、`acceptanceReport()`。
- `mockWorkspace` 支持 `GET /api/tasks/:id/acceptance` 返回 bundle/report。
- 预算卡 e2e：task status `waiting_input`、waitingReason `budget`；点击“提额并继续”断言 `task.set_budget`。
- 总管 e2e：mock `supervisor.send` 回复“AC 2/3，1 条未过，花费 $1.20/$2.00”；断言不含“已通过/已批准”。

- [ ] **Step 4: 跑 e2e**

Run: `pnpm exec playwright test apps/web/e2e/acceptance-evidence.spec.ts --project=chrome`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/web/e2e/m6-helpers.ts apps/web/e2e/acceptance-evidence.spec.ts
git commit -m "test(e2e): 验收证据卡/AC override/预算卡"
```

---

### Task 5: ego-lite + 真实 Claude 证据

Blocking: Task 4
Slice type: verification
Seam: 真实 daemon + 真实 Claude

**Files:**
- Create: `docs/evidence/2026-11-21-m6-3-acceptance/README.md`
- Create: `docs/evidence/2026-11-21-m6-3-acceptance/*.png`

- [ ] **Step 1: 启动临时环境**

```bash
BATON_DATA_DIR=$(mktemp -d) BATON_WORKSPACES_ROOT=$(mktemp -d) \
BATON_CLAUDE_MAX_BUDGET_USD=2 pnpm dev
```

- [ ] **Step 2: 跑真实链路**

1. 建任务（虚构需求）→ 真实 Claude 执行 → `review`；
2. 验收员生成 AC；打开详情看 AC 清单/报告/cost/verifier cost；
3. 编辑/waive 一条；点通过（如有 fail，填理由）；
4. 建一个低预算任务（如 `$0.05`）→ `waiting_input(budget)` → 预算卡提额 → 新 run → review；
5. 总管问“这单怎么样/花了多少”，断言回答引用 AC/usage，不声称已通过。

- [ ] **Step 3: 截图**

- `01-review-card.png`：画布 review 卡（AC 3/5、cost/budget、查看证据）
- `02-ac-editor.png`：任务详情 AC 编辑器 + 报告
- `03-ac-override.png`：失败项通过二次确认
- `04-budget-card.png`：`waiting_input(budget)` 预算卡
- `05-supervisor-answer.png`：总管回答 AC/cost

- [ ] **Step 4: 写 evidence README**

- 日期/环境/场景/真实结果/截图清单/脱敏说明/已知限制。
- 不写本机绝对路径、用户名、token、transcript 正文。

- [ ] **Step 5: Commit**

```bash
git add docs/evidence/2026-11-21-m6-3-acceptance
git commit -m "docs(evidence): M6-3 验收证据真实链路"
```

---

### Task 6: 收口与 contract

Blocking: Task 1-5
Slice type: verification
Seam: 全量 verify + docs 索引

- [ ] **Step 1: 跑全量命令**

```bash
pnpm verify
pnpm verify:full
pnpm pack:check
pnpm check:boundaries
pnpm check:protocol
pnpm format:check
```

Expected: 全部退出码 0。

- [ ] **Step 2: 更新 docs 索引**

- `docs/README.md` 的 spec/contract/plan/evidence 索引已包含 M6-3；如文件名有调整，同步。
- `docs/contracts/M6-3-acceptance-evidence.contract.md` 的 DoD checkbox 全勾；2.1 填真实证据；状态改“已实现，验收通过”。

- [ ] **Step 3: 更新 spec 状态**

- `docs/specs/2026-11-21-m6-3-acceptance-evidence-design.md` 的 `status` 改 `implemented`；`gates` 保留 `design-approved, user-review-passed`。

- [ ] **Step 4: 最终 commit**

```bash
git add docs
git commit -m "docs: M6-3 收口"
```

- [ ] **Step 5: 合并前检查**

- `git diff main...HEAD -- apps packages` 只含 M6-3 范围；不混入 M6-2 未合并提交。
- 先合并 M6-2 到 main，再把 `feat/m6-3-acceptance` 从最新 main rebase/retarget。
- PR 描述附：spec/contract/5 plans/evidence；`pnpm verify:full` 输出；DESIGN token 说明；迁移 0012 说明。

---

## 自检

- [ ] Spec §7.4、§11 的画布/现场条均有 task。
- [ ] 卡片只读；通过/打回仍在详情；M6-4 才上卡。
- [ ] Playwright 覆盖 UI；daemon 集成覆盖预算/批准上限/幂等；ego-lite 覆盖真实链路。
- [ ] contract 的 19 条 DoD 全部有对应实现/测试/证据。
- [ ] 不新增节点类型、不改任务状态、不做 AC 模板/DAG/外部 Source。