# Sprint Contract: M8 注意力闸门与工作区授权

## User-visible Outcome

我在总管对话里就能看到需要我处理的审批和验收卡片，点允许/拒绝或通过/打回，交付继续推进，不需要打开任务看板。信任工作区开启自动驾驶后，agent 的普通命令不再逐条弹审批，但危险命令仍被 deny；取消交付也能在卡片或总管里完成。预算和成本展示彻底消失，界面只保留任务、产物和验收证据。

## Definition of Done

- [ ] 当前 workspace 有 `attention=needs_approval` 的任务时，总管对话流在 WS 事件后 2 秒内出现审批卡；卡片包含任务标题、工具名、风险、命令/路径预览、等待时长，并有「允许」「拒绝」「查看详情」。
- [ ] 点「允许」或「拒绝」发送且仅发送一次 `approval.decide`，payload 包含正确 `approvalId` 与 `decision`；成功后卡片消失，任务/审批查询刷新。
- [ ] 当前 workspace 有 `attention=needs_review` 的任务时，总管对话流在 WS 事件后 2 秒内出现验收卡；卡片包含 AC 计数、verify 退出码、diff 统计、等待时长，并有「通过」「打回」「查看详情」。
- [ ] 验收卡「通过」在 verify 未过、零 AC、存在 fail/pending 时必须填写理由；「打回」必须填写反馈；发送的 `review.decide` payload 与 ReviewCard 一致；成功后卡片消失。
- [ ] 闸门卡不写入 supervisor message 表、不进入模型 prompt；总管工具列表/快照不包含 approve/reject/resolve；模型无法通过文本伪造卡片。
- [ ] 信任工作区 + `autopilot.enabled=true` + kill switch 关闭时，所有任务的所有非 deny 审批请求自动 allow；审计 `approval.auto_allow` 含 `authority=workspace`、`policyVersion`、`risk`、`toolName`。
- [ ] 同一工作区下，deny 规则仍返回 deny 且不执行；workspace 未信任、autopilot 关闭、kill switch 打开时仍返回 ask/deny，不自动批准。
- [ ] 工作区授权不设置 Claude `bypassPermissions`；adapter start 的 `permissionMode` 仍为默认，`allowDangerouslySkipPermissions` 为 false。
- [ ] 交付画布/看板「停止交付」经二次确认后调用 cancel API；交付状态为 cancelled、currentStageKey 为 null；artifact/annotation 数量不变。
- [ ] 总管 `cancel_delivery` 首次返回 `confirmation_required`；`confirm=true` 后取消交付并写审计；重复调用幂等。
- [ ] 从任务看板取消当前阶段任务时，交付级联为 cancelled；不再出现 running 或指向未创建的下一阶段。
- [ ] 产品 UI 不再出现预算、剩余、提额、成本、turn 文案（TaskDetail/TaskCard/ReviewCard/TaskSceneBar/AcceptanceReport/总管栏/移动端）。
- [ ] protocol/API/daemon 不再有 `budgetUsd`、`TaskBudgetSummary`、`waitingReason=budget`、`budget_exceeded`、`budget_raise`、`task.set_budget`、`maxBudgetUsd`、budget attention kind/counts；旧客户端发送 `task.set_budget` 返回错误而不是成功。
- [ ] migration 0016 删除 `task.budget_usd`；历史 `waiting_input(budget)` 任务变 `todo` 且 waitingReason 为空；旧 digest/acceptance payload 的 budget 字段可兼容忽略。
- [ ] session `costUsd/turns` 与 `baton.session.usage` 仍被采集（DB/事件断言），但不出现在 API 展示/UI/验收报告/总管回答。
- [ ] `pnpm verify` 通过；`pnpm exec playwright test` 全部通过（含现有 54 条回归）。
- [ ] 真实 ego 验收：deepseek 总管创建交付 → 闸门卡出现 → 人点卡片 → 回总管继续 → 交付完成；supervisor `toolCalls` 中无 approve/reject/resolve；证据落 `docs/evidence/2026-11-22-m7-delivery/`。

## Boundary Conditions

- Must support：桌面与移动端总管栏；手动任务、总管任务、交付阶段任务；现有任务详情/看板作为完整证据入口。
- Must not break：总管不获得审批/验收权；`task.status` 单写者；deny 永远优先；kill switch；artifact/annotation/画布数据；现有 54 条 Playwright 回归。
- Performance：闸门卡由 WS 失效驱动，不新增高频轮询；每次只查询当前待处理任务，不拉全量 task detail。
- Security：不使用 `bypassPermissions`；deny fail-closed；工作区授权必须写审计；卡片动作必须是人点击。

## Acceptance Criteria

- Computational：
  - `pnpm verify` 退出码 0。
  - `pnpm exec playwright test` 全部通过。
  - 定向测试：core policy workspace authority、delivery cancel/cascade、budget removal migration、SupervisorGateCards 组件测试。
- Inferential：
  - code review 确认 supervisor `allowedTools` 与 prompt 不含 approve/reject/resolve。
  - 真实 ego 证据包含闸门卡截图、卡片操作后的任务状态、最终交付状态、supervisor 无审批工具调用。

## Negotiation Record

- Generator（第 1 轮）：提出「闸门卡能显示并操作」「工作区授权自动批」「取消交付可用」「预算移除」「e2e 通过」五类宽泛标准。
- Evaluator（第 1 轮挑战）：
  1. 「能显示」不可测 → 必须给出字段、2 秒时限、WS 触发条件。
  2. 「自动批」不可测 → 必须给出 trusted/autopilot/kill switch 三种上下文和审计字段。
  3. 「取消交付可用」太模糊 → 必须覆盖 UI、总管确认、级联、幂等、artifact 保留。
  4. 「预算移除」范围不清 → 必须区分产品面、协议/API、DB 迁移、内部 cost/turn。
  5. 「e2e 通过」不可复核 → 必须给出具体步骤和 supervisor toolCalls 断言。
- Generator（第 2 轮）：按挑战改写为上方 16 条可二分判定标准，并补 Boundary/Acceptance 传感器。
- Evaluator（第 2 轮）：逐条检查均可由测试或证据判定为 yes/no；接受，无进一步挑战。
- Final consensus：以上 Definition of Done 为 M8 的完成定义。
