---
spec_ref: ../specs/2026-11-23-m8-attention-gate-authority-design.md
spec_topic: m8-attention-gate-authority
task_count: 3
estimated_phases: [tests, implementation, verification]
dod: "总管对话流底部出现审批/验收闸门卡；内联动作复用 approval.decide/review.decide；卡片不写入 supervisor 消息、不进入模型上下文；WS 失效后 2 秒内出现/消失；pnpm verify + Playwright 通过"
status: completed
depends_on: 2026-11-23-m8-2-workspace-authority-cancel.md
---

# M8-3 总管会话闸门卡实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement task-by-task. Steps use `- [ ]` syntax for tracking.

**Goal:** 人只在总管对话流里就能处理审批与验收，不需要打开任务看板。

**Architecture:** 卡片是 UI 投影：`listTasks(workspaceId)` 选出 `needs_approval|needs_review`，再按 taskId 查 `getTask`。动作复用现有 `approval.decide` / `review.decide`；不新增 supervisor 工具、不写 supervisor_message、不进入 prompt。

---

### Task 1: Gate card 组件与数据投影

Blocking: none  
Slice type: feature  
Seam: `SupervisorGateCards` props/commands

**Files:**
- Create: `apps/web/src/features/supervisor/SupervisorGateCards.tsx`
- Test: `apps/web/src/features/supervisor/SupervisorGateCards.test.tsx`

**Interfaces:**
- `SupervisorGateCards({ workspaceId, onOpenTask })`
- 内部选择器：task attention → detail 中最新 `approvals.decision === null` / `review.verdict === null`。
- 审批动作：`approval.decide { approvalId, decision: 'allow'|'deny', note? }`。
- 验收动作：`review.decide { reviewId, decision: 'approve', overrideReason? }` / `{ reviewId, decision: 'reject', feedback }`。

- [ ] **Step 1: 写失败测试**

- 渲染待审批任务：显示标题、工具、风险、等待时长；点允许发送一次 `approval.decide` allow。
- 渲染待验收任务：显示 AC 计数、退出码、diff；通过需 override 时先展开理由，填理由后发送。
- 打回必须填反馈，发送 `review.decide` reject。
- `review.verdict !== null` 或没有 pending approval 的任务不渲染卡片。

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm --filter @baton/web exec vitest run src/features/supervisor/SupervisorGateCards.test.tsx`

- [ ] **Step 3: 实现**

- 用 `useQuery` 拉 tasks，`useQueries` 拉详情；最多渲染 4 张卡，避免长列表。
- 审批卡紧凑展示 `Bash` / `Edit` 等 input 预览；验收卡复用 `needsAcceptanceOverride`。
- 动作后 `invalidateTaskQueries` + `supervisor`/`notices` 无关查询不主动轮询。
- 容器 `aria-live="polite"`，`section aria-label="待我处理"`。

- [ ] **Step 4: 验证并提交**

Run: `pnpm --filter @baton/web test`  
Commit: `feat(web): add supervisor gate card component`

---

### Task 2: 接入总管对话流与实时刷新

Blocking: Task 1  
Slice type: feature  
Seam: `SupervisorPanel` layout + WS invalidation

**Files:**
- Modify: `apps/web/src/features/supervisor/SupervisorPanel.tsx`
- Test: `apps/web/src/features/supervisor/SupervisorPanel.test.tsx`

**Interfaces:**
- 卡片位于 `SupervisorMessageList` 与 `SupervisorComposer` 之间；移动端同样显示。
- 点「查看详情」调用现有 `openStage(taskId)`。
- `task.status` / approval 事件触发 `queryKeys.tasks(workspaceId)` 失效后卡片自动出现/消失。

- [ ] **Step 1: 写失败测试**

- 有待审批任务时 `SupervisorPanel` 渲染 `待我处理` 区域。
- 处理成功后 tasks 查询刷新，卡片消失。
- 卡片不出现在 supervisor message 列表里。

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm --filter @baton/web exec vitest run src/features/supervisor/SupervisorPanel.test.tsx`

- [ ] **Step 3: 实现**

- 在 `SupervisorPanel` 插入组件；确保 flex 高度不挤压消息列表（shrink-0、最大高度滚动）。
- 不新增 WS 命令或消息类型。

- [ ] **Step 4: 验证并提交**

Run: `pnpm --filter @baton/web typecheck && pnpm --filter @baton/web test`  
Commit: `feat(web): surface gate cards in supervisor chat`

---

### Task 3: Playwright 闸门卡回归与截图

Blocking: Task 2  
Slice type: test  
Seam: mocked workspace + WS recorder

**Files:**
- Modify/Create: `apps/web/e2e/supervisor-gate-cards.spec.ts`
- Modify: `apps/web/e2e/m6-helpers.ts`（如需 fixture）
- Evidence: `docs/evidence/2026-11-22-m7-delivery/m8-gate-cards.md`

- [ ] **Step 1: 写 Playwright 用例**

- mock 一条 `needs_approval` 任务 + detail，进入总管栏，断言审批卡字段，点允许，断言只发送一次 `approval.decide`。
- mock 一条 `needs_review` 任务 + detail/review/acceptance，断言验收卡；点通过展开理由，填写后发送 `review.decide`。
- 断言卡片不出现在消息历史 DOM 中（仅 gate 区域）。

- [ ] **Step 2: 运行**

Run: `pnpm --filter @baton/web exec playwright test e2e/supervisor-gate-cards.spec.ts`

- [ ] **Step 3: 截图与证据**

- 桌面与移动端各一张；记录命令与结果到 `docs/evidence/2026-11-22-m7-delivery/m8-gate-cards.md`。

- [ ] **Step 4: 验证并提交**

Run: `pnpm --filter @baton/web exec playwright test`  
Commit: `test(web): cover supervisor gate cards`

---

## Plan 完成定义

- 审批/验收卡在总管栏出现并可内联操作；动作复用既有命令。
- 卡片不进入消息/model 上下文；无新增 supervisor 工具。
- 移动端可用；WS 事件后自动刷新。
- `pnpm verify` 与 Playwright 通过，附截图证据。
