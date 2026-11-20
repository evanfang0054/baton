# M5-1 总管售后与批量：Definition of Done

> 回链 spec：`docs/specs/2026-11-20-m5-supervisor-aftersales-design.md`。
> 前置：M1-M4 已合并；PR #26 已合并到 `main`（`e37e178`）。
> 分支：spec 在 `docs/m5-supervisor-aftersales-spec`；实现分支从最新 `main` 开 `feat/m5-1-supervisor-aftersales`。

## 0. 文档信息

- **状态**：contract 已落库，待实现。
- **范围**：`apps/daemon/src/supervisor/**`、`apps/daemon/src/runtime/index.ts`、`apps/daemon/src/db/repositories.ts`、`apps/daemon/test/**`、`apps/web/src/features/supervisor/**`、`apps/web/src/features/realtime/**`、`apps/web/e2e/**`、`docs/**`。
- **预期不改**：`packages/protocol/**`、`packages/core/**`、数据库 migration。若实现中必须改，先停下补 spec/ADR。
- **GDD**：按仓库 M1/M2/M3 先例显式跳过；测试设计由本 contract 的 DoD 与 3 个 plan 的测试矩阵承担。

## 1. 范围

本迭代把已经存在的任务生命周期能力接到总管：

- 售后：`retry_task`、`reopen_task`、`cancel_task`、`reply_task`。
- 查询：`list_tasks` 的 `q/status`、`get_task` 的 `pending`、`get_task_history`。
- 批量：`create_tasks` 从 1-6 个文本节点建任务，共享一个 Agent。
- 审计、提示词、web 多卡与刷新、测试与真实 Claude 验收。

不做：外部 Source、DAG/任务依赖、运行中 `context.inject`、挂起提醒、cost/turn、续已结束旧 session、批量 worktree、自动验收、读取 transcript/代码/日志、多用户。

## 2. DoD

- [x] **1. 工具面**：`SupervisorToolset`/`BoundToolset` 共 14 个工具；真实引擎请求体包含全部 14 个工具，有断言测试。
- [x] **2. 搜索**：`list_tasks` 支持 `q`（标题包含或 id 前缀，大小写不敏感）与 `status`；只在当前 workspace 查询；排序不变。
- [x] **3. pending**：`get_task` 在 `waiting_input` 时返回结构化 `pending`；普通审批只返回 `toolName/risk/reason`，不返回原始 input；`AskUserQuestion` 只返回 question/header/options 白名单字段；解析失败降级为 approval。
- [x] **4. 历史**：`get_task_history` 返回最近 50 条状态转移 + session + review 摘要；不返回 transcript、事件 payload 正文或 diff 正文；跨 workspace 返回 `task_not_found`。
- [x] **5. retry**：`retry_task` 只允许 `failed → queued`；note 进 `<feedback>`；`retryCount` 重置；写 `supervisor.task.retry` 审计；非 failed 返回 `invalid_transition`。
- [x] **6. reopen**：`reopen_task` 只允许 `done/cancelled → todo`；note 进 `<reopen_note>`；`start=true` 时再入队，入队失败不回滚 reopen；写 `supervisor.task.reopen` 审计。
- [x] **7. cancel**：`cancel_task` 对任意非终态可用；`running` 且 `confirm!==true` 返回 `confirmation_required`，不执行；确认后取消并中断会话；写 `supervisor.task.cancel` 审计；终态返回 `invalid_transition`。
- [x] **8. reply**：`reply_task` 只在 `waiting_input` 且 `canAcceptUserInput` 且 session 活跃时执行；审批返回 `reply_not_allowed`；无活跃 session 返回 `session_not_active`；只转发用户原话；审计只记长度不记全文。
- [x] **9. 批量预检**：`create_tasks` 的 nodeIds 1-6、去重后唯一、全部是当前画布 text 节点且内容非空；目标 Agent/context 合法；重复 nodeId、非 text、空内容、超限、跨画布均返回 `supervisor_batch_invalid`，整批不创建。
- [x] **10. 批量创建**：共享一个 Agent（优先选中，否则建一个并复用）；每条任务 prompt = 源文本节点内容、标题 = 首行/节点标题（≤80）；默认全部 `todo`；`start=true` 才批量入队；部分失败不回滚，返回 `created/failed`；写每条 `supervisor.task.create` 与一条 `supervisor.task.batch` 审计。
- [x] **11. 提示词**：`prompt.ts` 工具清单更新为 14；新增售后、批量、确认、reply、pending、claim-without-tool 规则；`PROMPT_VERSION` 变化。
- [x] **12. claim 守卫**：声称“已重试/已重开/已取消/已回复/已批量建”但没有对应成功工具结果时，追加更正并记录 reason；单测覆盖。
- [x] **13. Web 多卡**：一条 `supervisor.message` 能从 `create_tasks` 结果渲染多张现有任务卡；批量失败逐条显示；同一 taskId 去重。
- [x] **14. Web 刷新**：`create_tasks/retry_task/reopen_task/cancel_task/reply_task` 成功后失效 tasks 与 canvas；失败不刷新；RealtimeProvider 单测覆盖。
- [x] **15. 隔离与隐私**：跨 workspace 不可见；错误不包含本机路径、token、transcript、原始审批 input；`file` 节点内容不读取。
- [x] **16. 权限边界**：总管仍不能 approve/reject、不能验收/打回；`reply_task` 不处理审批；`cancel` 只在用户明确要求时执行。
- [x] **17. 测试**：单元、daemon 集成、web 组件、Playwright（售后 + 批量 + 取消确认）与真实 Claude 售后链路全部通过；证据落 `docs/evidence/<date>-m5-supervisor-aftersales/`。
- [x] **18. 收口**：`pnpm verify`、`pnpm verify:full`、`pnpm pack:check`、`pnpm check:boundaries`、`pnpm check:protocol`、`pnpm format:check` 全绿；`docs/README.md` 索引完整；新增源码无未完成项。

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

- 外部 Source（GitHub/飞书）、Trigger/Thread/Subscription/Admission 表。
- DAG/任务依赖/计划实体。
- 运行中 `context.inject`、跨 Agent 结果注入。
- 挂起提醒、手机/系统推送。
- cost/turn UI、自动批准次数上限。
- 续已结束旧 session（SDK resume/idle eviction）。
- 批量 worktree。
- 自动验收/代验收。
- 读取 transcript、日志、文件正文、代码。
- 多用户、外部身份映射。

## 5. 实施顺序

1. Plan 1 daemon：工具、查询、`replyToTask`、批量、prompt、接线、测试。
2. Plan 2 web：多卡、失败列表、图标/回执、刷新、组件测试。
3. Plan 3 acceptance：Playwright、真实 Claude + ego-lite、证据、文档收口。

Plan 2 依赖 Plan 1 的工具结果形状；Plan 3 依赖 Plan 1+2。每个 task 结束按仓库先例提交；最后统一跑全量命令。

## 6. 证据

- Playwright 输出与截图。
- 真实 Claude 售后链路：完成 → 跟进 → 新 session → 再完成；记录 taskId、状态、审计与脱敏截图。
- 批量建任务：3 个文本节点 → 3 张 todo 卡 → 一个 Agent 节点。
- 取消运行中任务：确认问题 → 确认 → cancelled。
- 审批场景：`reply_task` 被拒绝，提示走审批卡。

## 7. 评审记录

- 2026-11-20：contract 与 spec 同步落库；待实现。
- 2026-11-21：实现与验收完成。daemon 285 tests、web 198 tests、Playwright 35 条全绿；真实 Claude 售后链路（done → reopen → 新会话 → review）证据见 `docs/evidence/2026-11-21-m5-supervisor-aftersales/README.md`。验收中发现并修复 claim 守卫被任务标题“创建”误触发的问题（`a8f5846`）。
