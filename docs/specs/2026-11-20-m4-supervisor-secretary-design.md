---
spec_topic: m4-supervisor-secretary
decision_summary: "总管可创建节点/任务并开工；完成感知已实现；总管派独立验收 Agent 做初步验收，最终通过仍由人决定"
design_approved: false
gates: []
spec_ref: 2026-11-18-m2-supervisor-design.md
domain_terms: [Router, Worker, default engine, auto-start, delegated acceptance, completion observation]
---

# M4：总管从 Router v0 到“秘书”设计

> 回链：`docs/specs/2026-11-18-m2-supervisor-design.md`（M2 Router v0）与 `docs/specs/2026-11-19-m3-delivery-acceptance-design.md`。
> 背景：用户实测反馈——总管只会建待办、要求人选 engine/建节点、验收和审批都要人介入，与“我是老板、它是秘书”的预期不符。

## 1. 背景与问题

M2 的 Router v0 是刻意保守的：只暴露 `list_tasks` / `get_task` / `create_task`，目标必须在当前选择里，任务只能到 `todo`，审批和验收都归人。它解决了“不要自动改代码”的安全问题，但把调度成本又推回给人：

- 用户说“去做一件事”，总管要求先选 Agent、先指定 engine。
- 总管不能建节点，不能把资料/Agent 组织到画布上。
- 任务建完后还要人点“立即开工”。
- 运行中每个工具审批都要人点；验收也要人点。
- 任务完成后总管没有主动感知，用户要自己回看板。

## 2. 目标与非目标

**目标（Phase 1，已实现）**

1. 总管可以创建文本节点、Agent 节点和 context 边。
2. 总管可以自动选择默认引擎，不再反问用户。
3. 总管可以在没有目标 Agent 时自动建一个，并在同一次 `create_task` 里指定 `agentTitle`。
4. 用户明确说“开工/开始/去做”时，`create_task(start=true)` 直接入队，不需要二次点击。
5. 同一轮最多一个任务；模型先建错标题再补一次时，todo 任务允许被纠正标题。
6. 工具卡如实显示 `待办` / `已开工`，并以最后一次调用为准。
7. 总管仍然不能替用户验收/打回/重试；高风险操作仍按策略审批。

**目标（Phase 2，已实现）**

1. 总管感知自己创建的 task 进入 `review` / `failed` / `waiting_input`，在对话里追加一条汇总。
2. 预验收：总管**不亲自验收**，而是派一个新的验收 Agent 任务做初步检查；验收员最后一行给出 `VERDICT: PASS/FAIL`。
3. 验收员结论只是建议，任务始终停在 `review`，必须由人 approve 才进入 `done`；验收员不能替老板结束任务。
4. 验收员自身进入 review 时由系统自动关闭，不再递归派验收员。

**非目标**

- 不改变 M2 的 explicit mode 默认值；总管不会在没人要求时主动开工。
- 不允许总管读 transcript/日志/代码；仍只读任务元数据、review 摘要和工具结果。
- 不引入外部 Source（GitHub/飞书）；仍是本地对话入口。
- 不做多 Agent DAG 自动编排；本迭代只做单任务创建与开工。

## 3. 关键决策

| # | 决策 | 结论 | 理由 |
|---|---|---|---|
| D1 | 工具面 | 增加 `create_text`、`create_agent`、`create_edge`、`enqueue_task`；`create_task` 增加 `agentTitle` / `engine` / `start` | 总管要组织画布和派活，不能只写待办 |
| D2 | 默认引擎 | workspace 有 claude-sdk 时默认 `claude-sdk`；用户显式指定才用 fake | 不让“演示引擎”成为默认交付 |
| D3 | 目标 Agent | 优先 `targetNodeId` → 当前选择 → 自动创建 | 解决“还要我先建 Agent”的摩擦 |
| D4 | 开工 | 默认 `start=false`；用户明确说开工时 `start=true` | 保持“无要求不开工”的安全边界 |
| D5 | 同一轮去重 | 同一轮只保留一个任务；todo 阶段允许改标题 | 模型可能先建错再补，不能留下两张工单 |
| D6 | 完成感知 | 已实现；只在 `review` / `failed` / `waiting_input`（非审批）时追加通知；先模板后异步模型润色，失败回退模板 | 事件即时可见，同时让汇报更像秘书而不是系统日志 |
| D7 | 预验收 | 已实现；总管派独立验收 Agent 给初步意见；任务保持 review，最终由人通过或打回；写 recommendation 审计 | 老板需要结果，但“结束只能由我来” |
| D8 | 代审批 | 已实现：`autopilot.delegatedAuthority` 对总管任务放开高风险（deny 优先，trust/kill switch 约束，写审计） | 用户 2026-11-20 明确选择“高风险也自动批” |

## 4. 协议与工具增量（Phase 1）

```ts
createTextInput = { content: string, title?: string }
createAgentInput = { title?: string, engine?: Engine }
createEdgeInput = { sourceId: string, targetId: string }
createTaskInput = {
  title: string,
  agentTitle?: string,
  targetNodeId?: string,
  contextNodeIds?: string[],
  engine?: Engine,
  start?: boolean,
}
enqueueTaskInput = { taskId: string }
```

`SupervisorTaskCard.status` 从 `'todo'` 扩为 `'todo' | 'queued'`，UI 对应显示“待办/已开工”。这是向 M2 卡片形状的兼容扩展（旧值仍是合法值）。

## 5. 完成感知与预验收（Phase 2，已实现）

### 5.1 完成感知

- runtime 在 task 状态转移提交后调用 `supervisor.observeTask({ taskId, status, waitingReason })`。
- 只处理 `origin.source === 'supervisor-chat'` 与 `supervisor-review` 的任务。
- 在 `review` / `failed` / `waiting_input`（排除审批）时向 thread 追加一条 assistant 模板消息，不额外跑模型。
- 消息用 `(threadId, triggerId)` 去重，内容只含 taskId、标题、verify 退出码、diff 统计与下一步；不写 transcript 正文。
- 通知先落模板并立即推送，再由总管模型异步润色成 2-4 句自然汇报；润色失败或超时保留模板，前端按同一条消息 id 原位更新。
- UI 收到 `supervisor.message`：无 `decision` 的消息是观察者通知，不能误关正在流式的总管气泡。

### 5.2 预验收（验收员模式，最终由人决定）

- 任务进入 review 时，总管创建：
  1. 一个新的 Agent 节点（标题 `验收员 · <任务标题>`）；
  2. 一个新的任务，`origin.source=supervisor-review`，并通过 `reviewOfTaskId` / `reviewOfReviewId` 绑定目标轮次；
  3. 任务 prompt 只带任务元数据、verify/diff 摘要和工人最后回复（截断），不把完整 transcript 交给总管；
  4. 任务立即开工。
- 验收员独立检查 git diff、运行只读校验，最后一行必须输出 `VERDICT: PASS` 或 `VERDICT: FAIL`。
- 验收员任务进入 review 时：
  1. 系统只关闭验收员任务（内部工具任务），**不会改动目标任务状态**；
  2. 解析最后一条 assistant 文本，取最后一次 VERDICT；模型漏写 VERDICT 时，再用 `session.outcome.reason` 的明确结论（满足/通过 vs 不满足/需修改）兜底；仍不明确则视为未验收；
  3. 写 `supervisor.review.dispatch` 与 `supervisor.review.recommend` 审计；
  4. 把“初步验收 PASS/FAIL + 建议通过/打回 + 依据”汇总到总管 thread。
- 目标任务始终停在 `review`；只有人 approve 才进入 `done`，人 reject 则打回重跑。**结束只能由人来。**
- 初步 PASS 但目标 verify 退出码非 0 时，汇报会明确指出机器证据不一致，建议人先排查。
- 验收员回合结束但没上报 outcome 而停在 `waiting_input(stalled)` 时，若 transcript 已有明确 VERDICT，就用 `cancel` 收口验收员任务并继续给出建议；这避免模型漏报 outcome 卡死整条预验收链。
- 人仍可 reopen；reopen 后的新轮次需要新的验收员，旧结论不会误批新尝试。
- worktree 任务：验收员任务复用目标任务的 `worktreePath` 与分支，直接在隔离 worktree 里检查未提交改动并运行校验；目标处于 review，不会并发写。验收员任务自身仍以 worktree 模式启动，但 `createWorktree` 识别已有路径后不再新建。

### 5.3 代审批（已实现）

- 新增 workspace policy `autopilot.delegatedAuthority`（默认 false）。
- 只有同时满足以下条件，`evaluateApproval` 才对**除 deny 外**的所有工具自动放行（含高风险）：
  1. workspace trusted；
  2. kill switch 关闭；
  3. `autopilot.enabled` 与 `autopilot.delegatedAuthority` 都为 true；
  4. 当前 session 的 task 由总管创建（origin.source === 'supervisor-chat'）。
- `AskUserQuestion` 仍由人回答；写操作逃逸 workspace 仍降级为人工确认。
- 所有自动决定写 `approval.auto_allow` audit，kill switch 立即生效。

## 6. 安全与隐私

- 总管仍不读 transcript/日志/代码。
- `create_text` 的内容来自用户消息/模型整理，不读取文件系统。
- 自动创建节点写入 workspace 的 canvas，不写工作区文件。
- 工具结果与卡片不包含本机绝对路径、token 或 diff 正文。
- 所有自动动作可审计、可停止、可 reopen。

## 7. 开放问题

1. ~~是否开启 Phase 2 的“代验收”？~~ 用户 2026-11-20 最终确认：只做初步验收，最终通过/打回必须由人决定。
2. ~~完成汇总是否触发一次模型总结？~~ 采用模板先落、异步润色；模型不可用时保留模板。

## 8. 验证

- Phase 1：`pnpm verify`；`supervisor-tools` 覆盖 create_text/create_agent、auto agent、start、标题纠正、enqueue 守卫。
- 完成感知：`supervisor-service` 覆盖 review 派预验收、验收员 PASS 仍留在 review、FAIL 只建议打回、stalled 结论恢复、模型润色与失败回退。
- worktree：tools 覆盖总管显式创建 worktree 任务；service 覆盖验收员复用目标 worktree 路径与分支。
- 验收员协议：`supervisor-observe` 覆盖 VERDICT 解析（含全角冒号/多次出现）与 prompt 证据。
- 代审批：core 单测覆盖高风险自动放行、人类任务不生效、deny 优先、kill switch/未信任不放行；UI 单测覆盖“总管全权”开关保存。
- 手工验收：对总管说“做 XX，直接开工”，应依次出现：任务卡 → 完成通知 → 新验收员 Agent/任务 → 初步结论 → 任务仍待验收 → 人点通过后才完成。
