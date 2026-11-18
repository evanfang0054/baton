---
spec_ref: ../specs/2026-11-17-m1-claude-adapter-design.md
spec_topic: m1-claude-adapter
task_count: 6
estimated_phases: [tests, implementation, verification]
dod: "trust 弹窗/徽标/撤销；引擎选择与状态；多审批卡；截断提示；Playwright fake 链路；真实验收记录"
depends_on: [2026-11-18-m1-7a-adapter-wiring.md]
---

# M1-7a Web UX 与验收实施计划（Plan D）

**Goal:** 让 trust/engine/多审批/截断在 web 上可用，并补齐 Playwright 链路与真实环境验收记录。

**Architecture:** 只改 `apps/web` 与文档；REST 走 `/api/workspaces/:id/trust` 与 `/api/engines`，命令仍走 WS。

---

## Task 1: API 与查询键

**Files:** `apps/web/src/lib/api.ts`、`apps/web/src/lib/query.ts`、`apps/web/src/lib/api.test.ts`

- [ ] 新增 `listEngines()`、`updateWorkspaceTrust()`。
- [ ] 新增 `queryKeys.engines`。
- [ ] 测试：schema 解析与 PATCH 请求体。

## Task 2: Trust 弹窗、徽标与撤销

**Files:** `features/workspaces/WorkspaceTrustDialog.tsx`、`features/workspaces/WorkspaceTrustBadge.tsx`、`App.tsx`、测试。

- [ ] 首次打开未信任 workspace 自动弹窗；列出 CLAUDE.md/skills/MCP/plugins 与 hooks 风险。
- [ ] hooks 开关默认关；确认后 PATCH；撤销只影响新会话。
- [ ] header 显示「未信任/已信任」+ 撤销按钮。
- [ ] 组件测试：确认、撤销、hooks 开关。

## Task 3: 引擎选择

**Files:** `features/tasks/CreateTaskForm.tsx`、测试。

- [ ] 查询 `/api/engines`；`available|unknown` 默认 claude，`unavailable` 回退 fake。
- [ ] 展示状态与原因；fake 标「演示引擎」。
- [ ] 提交使用选中的 engine；不可用选项禁用。
- [ ] 组件测试：默认 claude、不可用时 fake、提交 payload。

## Task 4: 多审批与截断提示

**Files:** `TaskDetailPanel.tsx`、`transcript-model.ts`、`Transcript.tsx`、测试。

- [ ] 渲染全部 pending approvals（按 approvalId），allow/deny 只影响对应卡片。
- [ ] `_baton.truncated` 事件在条目末尾追加「内容已截断」提示。
- [ ] 测试：两张审批卡同时出现、截断提示。

## Task 5: Playwright 链路

**Files:** `apps/web/e2e/journey.spec.ts`

- [ ] mock REST + `page.routeWebSocket`：加载 workspace → 查看任务 → 允许审批 → 断言卡片消失。
- [ ] 不调用真实 API。

## Task 6: 全量验证与验收记录

- [ ] `pnpm verify` / `pnpm verify:full` / `pnpm pack:check`。
- [ ] 记录真实 Claude 验收状态（本机未登录则明确阻塞）。
- [ ] 更新 `docs/README.md` 与本计划执行记录。

---

## 执行记录（2026-11-18）

分支 `feat/m1-7a-web-acceptance`，基于 `feat/m1-7a-claude-adapter`。

**实现**

- API：`listEngines()`、`updateWorkspaceTrust()`、`queryKeys.engines`。
- Trust：首次打开未信任 workspace 自动弹窗；说明 CLAUDE.md/skills/MCP/plugins 与 hooks 风险；hooks 默认关；header 徽标、信任与撤销。
- Engine：建任务表单读取 `/api/engines`；`available|unknown` 默认 Claude，`unavailable` 回退演示引擎；展示状态与原因；不可用选项禁用。
- 审批：详情面板渲染全部 pending approvals，按 `approvalId` 独立 allow/deny。
- Transcript：事件 `_baton.truncated` 标记显示「内容已截断」。
- Playwright `apps/web/e2e/journey.spec.ts`：REST + `routeWebSocket` mock，覆盖信任 → 审批允许 → 卡片消失。

**测试**

- 新增/更新组件测试：trust 弹窗与撤销、引擎默认/回退、并发审批、截断提示、API schema。
- `pnpm verify` / `pnpm verify:full` / `pnpm pack:check` 全通过。
- 测试总数 430：protocol 102、adapters 22、core 98、web 75、daemon 133。
- Playwright 2 passed：shell + journey。

**真实 Claude 验收**

- 阻塞：本机 Claude Code 未登录（`claude /login`），S2 spike 已记录 `Not logged in`。
- 未执行 `建任务 → 工具审批 → blocked → reply → ready → verify → review` 的真实闭环；需登录后按 `docs/runbooks/local.md` 重跑。
- CI 与自动化链路不依赖真实 API。
