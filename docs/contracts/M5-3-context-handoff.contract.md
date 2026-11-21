# M5-3 上下文交接 v0：Definition of Done

> 回链 spec：`docs/specs/2026-11-21-m5-3-context-handoff-design.md`。
> 前置：M1-M5-1 已合并；PR #27 已合并到 `main`（`db1ffd7`）。
> 分支：spec 在 `docs/m5-3-context-handoff-spec`；实现分支从最新 `main` 开 `feat/m5-3-context-handoff`。

## 0. 文档信息

- **状态**：实现、自动验收与真实 Claude + ego-lite 证据完成。
- **范围**：`packages/core/src/handoff/**`、`apps/daemon/src/handoff/**`、`apps/daemon/src/runtime/index.ts`、`apps/daemon/src/supervisor/**`、`packages/protocol/src/commands.ts`、`packages/core/src/supervisor/policy.ts`、`apps/web/src/features/**`、`apps/web/e2e/**`、`docs/**`。
- **预期不改**：任务状态机、数据库 migration、`node`/`edge` 表结构、`NodeType`/`EdgeType`。
- **GDD**：按仓库 M1/M2/M3/M5-1 先例显式跳过；测试设计由本 contract 的 DoD 与 3 个 plan 的测试矩阵承担。

## 1. 范围

本迭代把任务结果变成可复用的画布上下文：

- 交接节点：普通 text 节点，包含任务目标、状态、outcome、verify、diff stat、变更文件、产物位置、最后回复节选。
- 入口：任务详情「生成交接节点」按钮；总管 `handoff_task` 工具。
- 新任务：通过 `contextNodeIds` 带上交接节点；不建 context 边、不注入旧任务。
- worktree：允许源任务，标注分支名与“主工作区不可读”，不复制/不合并。
- 审计、提示词、claim 守卫、工具策略、web 渲染、测试与真实 Claude 验收。

不做：`result` 节点类型、自动 context 边、运行中 `context.inject`、续旧任务、跨 worktree 合并、完整 diff/transcript、DAG、外部 Source、成本/AC 清单。

## 2. DoD

- [x] **1. Core 纯函数**：`buildHandoffSummary` 是确定性纯函数，不读文件、不访问时间/随机数；同一输入逐字节相同；有快照测试。
- [x] **2. 内容完整**：节点包含任务目标（`<task>` 块，≤1000 字）、状态、最后 outcome、verify exit、diff stat、变更文件（相对路径，≤30）、产物位置、最后回复节选（≤2000 字）、事实参考声明。
- [x] **3. 限长与截断**：总 ≤8000 字；超限按变更文件 → 最后回复 → 任务目标裁剪；`truncated="true"`；文件超 30 个写“共 N 个，已截断”。
- [x] **4. 路径脱敏**：不主动写本机绝对路径；workspace/worktree 前缀替换为 `<workspace>` / `<worktree>`；变更文件相对工作区。
- [x] **5. worktree 语义**：源任务 `workspaceMode=worktree` 允许交接；`worktree="unreadable"`、只写 `task.branch`、明确“主工作区不可读”；不复制/merge/checkout。
- [x] **6. 状态门槛**：只允许 `review/done/failed/cancelled` 且至少有一个 session 或 review；`todo/queued/running/waiting_input/verifying` 返回 `handoff_invalid`；无结果返回 `handoff_no_result`。
- [x] **7. 节点创建**：`task.handoff` 创建 text 节点，内容以 `【交接】` 开头，放在源 Agent 右侧 `(x+w+40, y)`；无 Agent 时 `(0,0)`；事务失败返回 `handoff_node_failed`，不写成功审计。
- [x] **8. WS 命令**：`packages/protocol/src/commands.ts` 新增 `task.handoff`（请求 `{ taskId, workspaceId }`）；ack `{ nodeId, taskId, warnings }`；跨 workspace 返回 `task_not_found`；现有命令不回归。
- [x] **9. 审计**：UI/WS 写 `task.handoff.create` `{ taskId, nodeId, worktree, truncated, warnings }`；总管写 `supervisor.task.handoff` `{ fromTaskId, toTaskId, nodeId, hasNote, started }`；不记录节点正文/note 全文。
- [x] **10. 总管工具**：新增 `handoff_task`（`fromTaskId`、`toNodeId?`、`title?`、`note?`、`start?`）；工具面 14→15；真实引擎请求体包含 15 个工具；`allowedTools` 与注册工具一致。
- [x] **11. 目标与任务**：`toNodeId` → 当前选择唯一 Agent → 自动建共享 Agent；新任务 `workspaceMode=main`、默认 `todo`；`start=true` 才入队；入队失败不回滚已创建任务。
- [x] **12. 上下文**：新任务 `contextNodeIds` 包含交接节点；`task.context_json` 快照包含它；不创建 `context` 边；不往运行中/旧任务注入。
- [x] **13. 提示词与守卫**：提示词新增交接规则（状态门槛、note 原话、默认不开工、worktree 如实说明、只建新任务、交接≠完成）；claim 守卫覆盖“已交接/已生成交接节点”，标题含“交接”不误触发。
- [x] **14. Web**：任务详情按钮只在可交接状态显示；成功 Toast + canvas 失效；worktree 警告显示；总管 `handoff_task` 消息渲染任务卡 + 交接来源行；移动端可用；现有审批/验收/diff/历史/批量不回归。
- [x] **15. 测试**：core 单测（快照/限长/worktree/路径/确定性）、daemon 集成（状态/隔离/worktree/审计/工具/claim/edge 不存在）、web 组件、Playwright（UI 交接 + 总管交接 + 重复交接）、真实 Claude + ego-lite 全链路通过；证据落 `docs/evidence/<date>-m5-3-context-handoff/`。
- [x] **16. 收口**：`pnpm verify`、`pnpm verify:full`、`pnpm pack:check`、`pnpm check:boundaries`、`pnpm check:protocol`、`pnpm format:check` 全绿；`docs/README.md` 索引完整；新增源码无未完成项。

## 3. 验收命令

```bash
pnpm verify
pnpm verify:full
pnpm pack:check
pnpm check:boundaries
pnpm check:protocol
pnpm format:check
```

## 4. 不在范围

- `result` 节点类型、`NodeType`/`EdgeType` 扩展。
- 自动 `context` 边、运行中 `context.inject`、续旧任务/session。
- 跨 worktree 文件复制、自动 merge/checkout、`baseBranch`。
- 完整 diff/patch、transcript、工具入参、命令、日志、代码正文。
- DAG/任务依赖、多来源合并、外部 Source、挂起提醒、cost/turn、AC 清单。
- 多用户、跨 workspace 交接。

## 5. 实施顺序

1. Plan 1 core + daemon：summary、service、WS 命令、总管工具、prompt/claim/策略、集成测试。
2. Plan 2 web：按钮、命令客户端、Toast/warnings、总管消息、移动端、组件测试。
3. Plan 3 acceptance：Playwright、真实 Claude + ego-lite、证据、文档收口。

Plan 2 依赖 Plan 1 的命令与结果形状；Plan 3 依赖 Plan 1+2。每个 task 结束按仓库先例提交；最后统一跑全量命令。

## 6. 证据

- Playwright 输出与截图。
- 真实 Claude：A 写文件 → review → 交接节点 → B 新任务读取并修改 → review；记录 taskId、状态、审计、脱敏截图。
- worktree 源任务：节点 warning、无绝对路径、B 不声称可读。
- 重复交接：两个快照节点，不覆盖。

## 7. 评审记录

- 2026-11-21：contract 与 spec 同步落库；待实现。
- 2026-11-21：实现与自动验收完成。提交 `325c1ab`（core 摘要）、`c9217b9`（protocol）、`d587624`（core 策略）、`0dd714e`（daemon）、`95a276d`/`14c0c30`（web）、`7a7820a`（e2e）。`pnpm verify:full` 全绿：protocol 119、core 143、adapters 27、web 204、daemon 294 tests，Playwright 38 条；`pnpm pack:check` 通过。
- 2026-11-21：真实 Claude + ego-lite 链路完成：A 写 `hello` → review → 生成交接节点 → 总管 `handoff_task` 建 B（上下文 1 节点 / 490 字符）→ B 写 `hello baton` → review → 人工通过 → done；审计 `task.handoff.create` / `supervisor.task.handoff` 均存在；证据见 `docs/evidence/2026-11-21-m5-3-context-handoff/`。
- 2026-11-21：PR #28 深度 review 修复：先脱敏再截断、文件超限补 `truncated="true"`、worktree 使用 `<worktree>` 占位符、转义 `</handoff>`/`</node>` 等结构性关闭标签、`task.handoff` 的 `workspaceId` 改为必填、`handoff_task` 先校验目标/上下文再落节点、审计补齐 `toTaskId`/`nodeId`、补重复交接 Playwright。
