---
spec_topic: m8-attention-gate-authority
decision_summary: "M8 注意力闭环：总管会话闸门卡、工作区授权自动批非 deny、交付取消级联、预算彻底退场；总管仍不 approve/reject"
design_approved: true
user_approved_at: 2026-11-23T14:28:38+08:00
gates: [design-approved]
spec_ref: 2026-11-22-m7-delivery-playbook-design.md
domain_terms:
  [
    supervisor-gate-card,
    workspace-authority,
    delivery-cancel,
    budget-removal,
    attention,
    kill-switch,
    deny-first,
  ]
---

# M8 注意力闭环与工作区授权设计

## 1. 背景

M7 已完成交付工作台，真实 Claude 与 deekseek 总管链路都已跑通。实测暴露出四个产品问题：

1. 人只通过总管无法闭环：工具审批与阶段闸门都要求人去任务详情/看板处理，总管明确拒绝代批。
2. 审批噪音大：设计阶段连续弹出 `ls`、`node` 校验、Chrome 路径检查等高风险 Bash 审批，人的注意力被低价值选择消耗。
3. 取消交付不完整：总管没有 `cancel_delivery` 工具；取消阶段任务曾让交付错误显示为 `running` 并指向未创建的下一阶段。
4. 预算概念失真：预先设置任务预算没有产品价值，超预算等待/提额与成本展示反而增加噪音。

本迭代不改变 baton.ai 的核心边界：总管是 Router，不获得 approve/reject/resolve 权力；人仍在闸门做最终决定。迭代目标是把闸门以「会话卡片」的形式送到人面前，并减少无意义审批。

## 2. 目标与非目标

### 目标

- 总管对话流中出现可操作的「待我处理」闸门卡：审批允许/拒绝、验收通过/打回。
- 信任工作区内，自动驾驶开启且 kill switch 关闭时，所有非 deny 操作自动批准；deny 仍优先，审计与 kill switch 保留。
- 交付取消成为一等动作：人类入口 + 总管二次确认 + 阶段取消级联。
- 预算、成本展示、budget 等待与提额从产品面彻底移除；内部保留 cost/turn 采集用于诊断。
- 真实端到端验收：总管创建交付 → 闸门卡 → 人点卡片 → 回总管继续 → 交付完成。

### 非目标

- 不给总管 approve/reject/resolve 工具。
- 不使用 Claude `--dangerously-skip-permissions`；保持审批事件，确保 deny/audit/kill switch 有效。
- 不做外部推送（飞书、手机、系统通知）；本轮只做 in-app 提醒。
- 不做总管栏完全替代看板；看板仍保留完整证据与历史。
- 不处理 DAG、多 worker、外部 Source、artifact 历史版本。

## 3. 已锁定决策

- 总管不能代批；闸门卡按钮只能由人点击，复用现有 `approval.decide` / `review.decide`。
- 会话卡片以事件卡片形式出现在总管对话流；卡片不作为模型消息持久化，避免 prompt injection。
- 工作区授权：信任工作区 + `autopilot.enabled=true` + kill switch 关闭时生效；范围是工作区内**所有任务**，不限交付阶段。
- 工作区授权自动批准所有非 deny 操作，包括高风险 Bash；deny 永远优先。
- 取消交付：人类入口 + 总管 `cancel_delivery` 工具（必须二次确认）；阶段任务取消级联为整个交付取消。
- 预算彻底移除：全局 SDK 上限、budget 等待、提额、预算/成本展示全部删除；内部 cost/turn 保留。
- 提醒只做 in-app；外部推送后置。
- 验收采用真实端到端 + 自动化测试双层。

## 4. 方案选择

### A（采用）UI 派生闸门卡 + policy 工作区授权

- 闸门卡由当前 `tasks` / `task detail` / approval 数据派生，不写入 supervisor 消息历史。
- 工作区授权进 core policy 求值；不改变审批事件链路。
- 交付取消复用现有 REST，加总管工具与级联。
- 预算删除代码路径与 DB 列。

优点：改动可控、不会污染模型上下文、保留 deny/审计/kill switch。

### B（未采用）持久化闸门消息

把每张闸门卡写成 supervisor message/notice。历史完整，但需要新 schema、模型历史隔离与清理策略，复杂度高。

### C（未采用）只做深链

只在总管消息里给「去处理」按钮，不内嵌动作。改动最小，但不满足「会话卡片内直接操作」。

## 5. 设计

### 5.1 会话闸门卡片

**位置**：总管对话流底部，输入框上方；作为待处理卡栈渲染。卡片由 UI 查询派生，不进入 supervisor message 表，也不进入模型 prompt。

**数据来源**：

- `listTasks(workspaceId)` 中 `attention=needs_approval|needs_review` 的任务。
- 对每个任务查询 `getTask(taskId)`；审批卡取 `approvals` 中 `decision=null` 的最新一条；验收卡取 `review` 与 `acceptance` 摘要。
- 卡片在 `task.status` / approval 事件触发查询失效时实时出现；处理完成后消失。

**审批卡**：

- 展示任务标题、工具名、风险、命令/路径预览、等待时长。
- 操作：允许 / 拒绝；可选备注；「查看详情」打开现有任务详情。
- 发送 `approval.decide`，payload 必须包含 `approvalId`。

**验收卡**：

- 展示交付/阶段、AC 计数、verify 退出码、diff 统计、最久等待。
- 操作：通过 / 打回；通过前复用 `needsAcceptanceOverride` 规则：
  - verify 未过、零 AC、存在 fail/pending 时必须填写理由；
  - 打回必须填写反馈。
- 发送 `review.decide`，payload 与 ReviewCard 一致。

**约束**：

- 卡片只是 UI 投影，不能出现在总管模型上下文；模型无法通过文本伪造卡片。
- 不新增 supervisor 工具；总管仍不能 approve/reject。
- 卡片最多展示当前待处理项；不把 failed/stale/reply 做成动作卡，仍走 digest/任务详情。
- 等待时长复用 `WaitingTime`；卡片出现时通过 `aria-live` 宣告。

### 5.2 工作区授权

**求值顺序**：`deny` → `delegated supervisor authority` → `workspace authority` → `allow` → `ask`。

**生效条件**：

- `workspace.trusted === true`
- `policy.autopilot.enabled === true`
- `killSwitch === false`
- 任务所在 workspace 与当前 workspace 一致

**行为**：

- 未命中 deny 的审批请求直接 `allow`，`autoApproved=true`，reason=`workspace authority`。
- 风险等级仍计算并写入审计；高风险不会阻止自动批准。
- 写审计 `approval.auto_allow`，detail 含 `policyVersion`、`risk`、`toolName`、`authority: 'workspace'`。
- 不设置 Claude `bypassPermissions`；继续接收 approval 事件，保证 deny、审计、kill switch 可执行。

**范围**：信任工作区内所有任务，包括手动任务、总管任务、交付阶段任务。

**安全护栏**：

- 扩充默认 deny：敏感凭据路径（`.ssh`、`.aws`、`.gnupg`）、控制面（`.baton/policy.json`、skills、playbooks 写入）、系统目录写入、破坏性命令（`sudo`、`rm -rf`、`curl | sh`、`git push`、`mkfs`、`dd` 等）。
- deny 规则匹配失败时 fail-closed，不允许被工作区授权绕过。
- 审计与 kill switch 优先于工作区授权；kill switch 打开后立即回到 ask/deny。
- 自动化设置文案改为「工作区内非 deny 操作自动批准（含高风险）」；这是对现有自动驾驶语义的扩展。

`approval.autoApproveMaxRisk` 保留用于未启用工作区授权的场景；工作区授权命中时不再受它限制。

### 5.3 取消交付

**人类入口**：

- 交付画布顶部卡片与交付看板卡片增加「停止交付」。
- 二次确认后调用现有 `POST /api/deliveries/:id/cancel`。
- 成功后失效 `deliveries/delivery/deliveryCanvas/tasks` 查询，卡片显示「已取消」。

**总管工具**：

- 新增第 29 个工具 `cancel_delivery({ deliveryId, confirm?: boolean })`。
- 非终态交付首次调用返回 `confirmation_required`，prompt 要求总管先问用户；用户明确确认后传 `confirm=true`。
- 成功后返回交付状态；审计 `supervisor.delivery.cancel`，标记 `confirmedByUser=true`。
- 总管仍不能取消验收或替人做决定。

**级联**：

- 任意任务取消时，如果任务有 `deliveryId` 且 `stageKey` 非空，调用 `markDeliveryCancelled(deliveryId, reason)`。
- 标记 `cancelledAt`、写审计 `delivery.cancel`、广播 `delivery.updated`；`deriveDeliveryStatus` 已保证状态为 `cancelled`、`currentStageKey=null`。
- 级联幂等；取消交付自身时不会重复取消。
- 不删除 artifact、annotation、画布节点。

### 5.4 预算退场

**删除的产品概念**：

- `task.budgetUsd`、`TaskBudgetSummary`、`AcceptanceReportFacts.budget`、`TaskDetailResponse.budget`、`TaskSummary.budget`。
- `waitingReason='budget'`、`budget_exceeded`、`budget_raise`、`task.set_budget`。
- 全局 `claudeMaxBudgetUsd`、`verifierBudgetUsd`、`maxTaskBudgetUsd` 配置与 adapter `maxBudgetUsd` 传递。
- `AttentionKind='budget'`、`AttentionCounts.budget`、digest 的预算计数。
- UI 的 BudgetEditor、BudgetCard、预算/剩余/成本/turn 展示，包括 TaskCard、ReviewCard、TaskSceneBar、TaskDetail、AcceptanceReport、Supervisor get_task 输出。
- 总管 prompt 中预算相关规则与「超预算」话术。

**保留**：

- session `costUsd/turns` 采集与 `baton.session.usage` 事件，仅用于日志/诊断；不出现在 API 展示、验收报告、总管回答。
- `claudeMaxTurns` 与任务取消/kill switch 仍是运行约束。

**迁移 0016**：

- `ALTER TABLE task DROP COLUMN budget_usd`。
- 历史 `waiting_input` 且 `waitingReason='budget'` 的任务改为 `todo`，清空 `waitingReason`，不自动开工。
- 旧 digest notice 中 `budget` 计数字段按 0/忽略兼容读取。
- 删除 budget 相关测试；新增「不再出现 budget 等待」断言。

**风险**：移除 SDK 成本上限后，模型可能产生更高费用；用户已明确接受。系统仍可用取消任务、kill switch 与并发上限止损。

### 5.5 注意力与提醒

- 保留 digest、需要我计数、等待时长、任务卡 stale 标识。
- 新增闸门卡后，总管栏成为「新需求入口 + 待办动作」；看板仍是完整证据与历史。
- 本轮不做外部推送；`attentionReminder` 仍只控制 digest 生成，不新增通道。

## 6. 协议 / API / DB 变更

### protocol

- 删除 budget 相关 schema 与枚举成员。
- `AttentionKind` 删除 `budget`；`AttentionCounts` 删除 `budget`。
- 删除 `TaskSetBudgetInput` / `task.set_budget`。
- 新增 `SupervisorCancelDeliveryInput` / 工具结果 schema（若现有 supervisor tool 统一走 zod）。
- `TaskSummary` / `TaskDetailResponse` 删除 budget 字段。
- `AcceptanceReportFacts` 删除 budget 与 usage 展示字段（内部 session usage 不受影响）。

### daemon

- `PolicyContext` 增加 `workspaceAuthority`；`evaluateApproval` 按 5.2 顺序求值。
- `approval.auto_allow` 审计增加 authority 字段。
- `cancelDelivery` 复用；新增 `markDeliveryCancelled` 幂等入口；任务取消级联。
- supervisor tools：新增 `cancel_delivery`，工具数 28 → 29；prompt、`SUPERVISOR_POLICY.allowedTools`、model-surface 快照同步。
- 删除 `budget-command`、`budget/service`、预算相关 transition 分支与 config 字段。
- session-runner 不再传 `maxBudgetUsd`；不再处理 budget error → budget_exceeded。

### web

- `SupervisorGateCards` 组件：查询 tasks/task detail；审批卡 + 验收卡；动作复用 command。
- 交付画布/看板增加「停止交付」确认。
- 删除 BudgetEditor、BudgetCard 及所有预算/成本/turn 展示。
- 自动化设置文案更新；保留既有开关。

### DB

- migration 0016：删除 `task.budget_usd`，迁移 budget 等待任务。
- 不改 artifact/annotation/canvas/task 其他列。

## 7. 错误处理

- 闸门卡动作失败：toast 展示服务端错误；保留卡片；不乐观删除。
- 审批已处理/过期：`approval_not_found` / `approval_expired` 刷新卡片并提示。
- 验收已决定/过期：`already_decided` / `review_expired` 刷新卡片。
- 取消交付重复调用：幂等返回当前 cancelled 状态。
- 工作区授权下 deny 命中：返回 deny，不执行；审计 `approval.auto_deny` 或现有 deny 路径。
- 预算移除后旧客户端发送 `task.set_budget`：返回 `unknown_command` 或 `invalid_payload`；不静默成功。

## 8. 测试与验收

### 自动化

- core policy：工作区授权 allow 非 deny；deny 优先；kill switch；未信任；autopilot 关闭；高风险 Bash。
- core delivery：阶段取消 → cancelled / currentStageKey null；交付取消幂等。
- daemon：cancel_delivery 二次确认；任务取消级联；审计；预算等待不再出现；session-runner 不传 maxBudgetUsd。
- web：审批卡允许/拒绝；验收卡通过/打回/override；卡片实时出现与消失；交付停止入口。
- protocol：budget 字段/枚举删除后的 schema 快照；旧 digest 兼容。
- Playwright：现有 54 条回归 + 新闸门卡/取消交付用例。
- 真实 ego：deepseek 总管 + 真实 Claude + 自动驾驶开启；交付从创建到完成；每道闸门用会话卡处理；检查 supervisor toolCalls 无 approve/reject；证据落 `docs/evidence/2026-11-22-m7-delivery/`。

### 验收标准

- 人只在总管栏点击闸门卡即可推进交付；不需要打开任务看板。
- 总管全程没有 approve/reject 工具调用；模型不能代批。
- 信任工作区 + 自动驾驶开启时，非 deny 操作不再逐条弹审批；deny 仍被阻断。
- 取消阶段任务后交付立即显示已取消，不再出现 running/下一阶段悬挂。
- 产品 UI 不再出现预算、剩余、提额、成本展示；内部 cost/turn 仍可诊断。

## 9. 实施切片

1. **protocol/core/migration 0016**：删除 budget；`workspaceAuthority` 求值；delivery 状态/取消级联纯函数；测试。
2. **daemon**：policy 上下文/审计；`cancel_delivery` 工具与 prompt；任务取消级联；删除 budget 服务/命令/config；迁移。
3. **web**：`SupervisorGateCards`；交付停止入口；删除预算/成本 UI。
4. **e2e/evidence**：Playwright + 真实 ego 链路 + 证据文档。

## 10. 风险与后置

- 工作区授权是强信任：agent 可访问 workspace 外路径和网络；通过扩充 deny、审计、kill switch 缓解，但仍不是沙箱。
- 删除 SDK 成本上限后费用可能上升；已接受，靠取消/kill switch/并发上限止损。
- 闸门卡不持久化：刷新后仅在仍待处理时出现；历史动作仍在任务审计/验收报告中。
- 外部推送、飞书触发器、沙箱执行、DAG、多 worker 后置。
