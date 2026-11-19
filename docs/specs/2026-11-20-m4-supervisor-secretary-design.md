---
spec_topic: m4-supervisor-secretary
decision_summary: "总管从只建待办升级为可创建节点/任务并开工；完成感知与代验收作为第二阶段，需要 workspace 级显式授权"
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

**目标（Phase 2，待确认）**

1. 总管感知自己创建的 task 进入 `review` / `failed` / `waiting_input`，在对话里给出一条汇总。
2. 可选“代验收”：满足证据门槛时，总管可以替老板通过，并写审计；人仍可 reopen。
3. 可选“代审批”：在 workspace 显式授权下，按策略自动批准；deny 仍然优先。

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
| D6 | 完成感知 | Phase 2；只在需要人（review/failed/waiting_input）时投递一条汇总 | 控制注意力成本，不做每条事件都通知 |
| D7 | 代验收 | Phase 2，workspace 级显式开启；仅限总管创建的 task；verify 通过且 diff 在阈值内；写审计；可 reopen | 老板需要结果，但不能让模型无声结束任何任务 |
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

## 5. 完成感知与代验收（Phase 2，待确认）

### 5.1 完成感知

- runtime 在 task 状态转移后调用 `supervisor.observeTask(taskId, status)`。
- 只处理 `origin.source === 'supervisor-chat'` 的 task。
- 只在 `review` / `failed` / `waiting_input(stalled)` 时向 thread 追加一条 assistant 汇总（不额外跑一次模型）。
- 汇总内容：taskId、标题、状态、verify 退出码、diff 统计、下一步按钮。
- 不写 transcript 正文，不把 diff 正文投给模型。

### 5.2 代验收

- workspace policy 增加 `autopilot.delegatedAcceptance: boolean`（默认 false）。
- 条件全部满足才允许：
  1. workspace trusted；
  2. kill switch 关闭；
  3. task.origin.source === 'supervisor-chat'；
  4. task.status === 'review'；
  5. review.verifyExitCode === 0；
  6. diff 在阈值内（例如 ≤ 200 行 / 20 文件）；
  7. 没有未决 approval 或 question。
- 代验收写 `audit`（actor=supervisor，action=supervisor.review.accept，detail 含 taskId/policyVersion）。
- 人仍可 reopen；reopen 后该 task 不再自动验收，除非人再次明确要求。
- 人类创建的 task 永远不代验收。

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

## 7. 开放问题（需要老板确认）

1. 是否开启 Phase 2 的“代验收”？建议先只做“完成汇总”，观察一周再开自动通过。
2. 完成汇总是否需要触发一次模型总结，还是只追加一条模板消息？前者更智能但更贵。

## 8. 验证

- Phase 1：`pnpm verify`；`supervisor-tools` 覆盖 create_text/create_agent、auto agent、start、标题纠正、enqueue 守卫。
- 手工验收：对总管说“用 create_agent 新建 Agent「文档助手」，然后建任务「给 README 增加一节用法说明」，直接开工”，应出现 Agent 节点、任务卡显示“已开工”。
- 代审批：core 单测覆盖高风险自动放行、人类任务不生效、deny 优先、kill switch/未信任不放行；UI 单测覆盖“总管全权”开关保存。
- Phase 2 实现后：补 runtime 观察、policy 开关、代验收审计与 reopen 的集成测试。
