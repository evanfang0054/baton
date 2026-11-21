---
spec_topic: m6-2-context-injection
decision_summary: 'M6-2 任务现场 v1：画布节点可再注入已有任务，注入记录 append-only 落 task.context；同时补 cost/turn 与通过确认，现场布局仍只读'
design_approved: true
user_approved_at: '2026-11-21T12:35:10+08:00'
gates: [design-approved]
status: approved
spec_ref: 2026-11-21-m6-task-scene-design.md
domain_terms:
  [
    context-injection,
    context-injection-revision,
    injectable-task,
    context-update-block,
    cumulative-injection-budget,
    enqueued-at,
    session-usage,
    approve-override,
  ]
---

# M6-2 任务现场 v1：上下文再注入与轻验收证据

> 子 spec。回链主架构：`docs/specs/2026-11-16-baton-architecture-design.md`。
> 前置：M6-1 任务现场已合并到 `main`；本 spec 从 `main` 的 M6-1 收口后开始。
> 背景材料：`baton.ai` 三份讨论稿（`dsh-superagent-prototype-架构拆解.md`、`复刻CanvasAgents工作台.md`、`肝了一周…`），不进仓库，只作为产品方向参考。
> 相关 spec：`docs/specs/2026-11-18-m1-6b-canvas-context-design.md`（画布上下文）、`docs/specs/2026-11-19-m3-delivery-acceptance-design.md`（diff/worktree/历史）、`docs/specs/2026-11-20-m4-supervisor-secretary-design.md`（预验收）、`docs/specs/2026-11-21-m5-3-context-handoff-design.md`（上下文交接）、`docs/specs/2026-11-21-m6-task-scene-design.md`（任务现场 v0）。

## 0. 文档信息

- **状态**：设计已获用户确认（2026-11-21）；spec 待用户审阅；尚未实现。
- **范围**：`packages/protocol/**`、`packages/core/**`、`apps/daemon/**`、`apps/web/**`、数据库 migration 0011、测试与 `docs/**`。
- **预期不改**：状态机的允许转移与状态语义；`task.status` 单写者；初始 `ContextSnapshot` 的 `included/dropped` 语义；`assembleContext` 的现有预算/深度/敏感路径规则；`node`/`edge` 表结构；现有上传接口行为。
- **不在范围**：运行中 `running` 注入；AC 清单；现场任务动作（回复/通过/打回/重试）；任务优先级/DAG/模板；外部 Source（GitHub/飞书）；向量检索；任务级独立画布；自动验收/代验收；多用户；手机画布；系统推送；图片 OCR；把注入内容写入事件或审计。
- **命名**：本迭代叫 M6-2；核心概念叫“上下文注入”（context injection），注入记录叫“注入修订”（injection revision），是可追加的事实，不是新的任务状态。
- **文档位置**：仓库没有 `docs/agent-harness/` 与 `scripts/validate-handoff.sh`，按既有约定落 `docs/specs/`、`docs/contracts/`、`docs/plans/`；验收用 `pnpm verify:full`，不伪造 agent-harness 结构。
- **ADR**：本迭代没有不可逆决定。全部协议变更都是增量；数据库只加 nullable 列；不新建表。

## 1. 背景

M6-1 已把“任务现场”做成派生视图：可以从看板/任务详情进入现场，突出该任务的 Agent、上下文节点、origin、相关分组和 review 卡；画布补了 image/group/review 节点；总管能整理画布，看板有“需要我”、stale 和等待排序。

但对照 `baton.ai` 材料，当前闭环还有两个明显的窄口：

1. **输入端**：上下文快照只在 `task.create` 时装配一次并冻结。任务进入 `running` 后，画布上新增的需求、报错、设计图都进不去；只能取消、重开或交接。这直接违背“画布是共享内存、框选/连线是强制注入”的前提。
2. **输出端**：验收证据只有 verify 退出码/输出、diff 统计和验收员初步结论；没有成本/turn，也没有“verify 失败但仍点通过”的确认与审计。人做最终决定时信息不足。

总管在中间已经是合格的显式 Router：16 个工具、不能 approve/reject、不读 transcript/diff 正文。它缺的不是更多自治，而是**能执行“把这几个节点补给它”这类明确的上下文路由**，以及**能看到自己派出的任务的成本与证据摘要**。

本迭代只做这两个窄口在 baton 当前架构下最自然的一步：

1. 允许把画布节点再注入已有任务，注入记录 append-only，初始快照不变；
2. 把 cost/turn 落库并在验收卡/详情展示；verify 失败或跳过时，通过需要二次确认并写审计。

## 2. 目标与非目标

**目标**

1. `todo/queued/waiting_input` 任务可以从画布再注入上下文；`review` 只能通过“打回”携带上下文；`running/verifying/done/failed/cancelled` 明确拒绝。
2. 注入是 append-only：初始 `ContextSnapshot` 不变，`context.injections[]` 只追加；旧数据按空数组解析。
3. 每次注入在 prompt 中只出现一份：`todo/queued` 落独立 `<context_update>`，`waiting_input` 落 `<user_reply>`，`review` 打落独立 `<context_update>`（feedback 仍单独）。
4. 单次 40 节点 / 48k 字符 / 单节点 16k，累计注入 96k；超限整次拒绝，不写半份。
5. 注入不改变队列顺序：新增 `task.enqueuedAt`，调度器按它排序；migration 回填旧 queued 任务。
6. 画布现场能显示注入次数、被注入节点和缺失节点；任务详情能看上下文时间线。
7. 成本/turn 落库并在 review 卡与任务详情展示；verify 失败/跳过时通过需二次确认并写审计。
8. 总管获得 `inject_context`：单任务、用户明确要求、写审计；review 状态不可注入。
9. 覆盖 core/protocol 单测、daemon 集成、web 组件、Playwright 与 ego-lite + 真实 Claude 验收。
10. 不建新表、不改状态机转移语义、不做 AC/现场任务动作/DAG。

**非目标**

- 不做运行中 `running` 注入；SDK 虽然支持流式输入，但中途改 prompt 的产品语义要单独设计。
- 不做 AC 清单、验收报告、cost 预算护栏；留给后续验收证据迭代。
- 不做现场任务动作（回复/通过/打回/重试/重开）；现场布局仍然只读。
- 不做任务优先级、due date、labels、DAG、模板、archive。
- 不做外部 Source（GitHub/飞书）、向量检索、任务级画布、多用户、手机画布。
- 不做自动验收/代验收；总管仍然不能 approve/reject。
- 不把注入内容、note、节点正文写进 WS 事件、审计或日志。
- 不做幂等表；连接中断后的手动重试可能重复注入，作为已知限制记录。

## 3. 关键决策

| #   | 决策             | 结论                                                                                                 | 理由                                                                 |
| --- | ---------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| D1  | 迭代范围         | 上下文再注入 + cost/turn + 通过确认；AC 清单、现场任务动作后置                                       | 先补齐闭环两端；一次跨 protocol/daemon/web 的范围已经不小             |
| D2  | 注入时机         | `todo/queued/waiting_input`；`review` 只能由 reject 携带；不做 `running`                             | 三个安全点都能在“下一轮 prompt”生效，不需要中途改运行中的 prompt       |
| D3  | 上下文模型       | 扩展 `task.context.injections[]`；初始快照不变；不建新表                                             | 只有一个读取路径；比新表少一套 repository/迁移，符合 KISS             |
| D4  | 注入语义         | 选中节点 + 其直接上游边 + 上游 2 层；不自动展开目标 Agent 的既有 context 边；沿用排序/预算/敏感路径规则 | 与建任务时的 `assembleContext` 一致，但避免每次注入重复初始上下文；显式连线继续是强制依赖 |
| D5  | prompt 表示      | 追加 `<context_update>` 块；按状态分别包在 `<context_update>` / `<user_reply>` / `<feedback>` 中     | 每次注入可追溯；不重写历史；不重复旧上下文                           |
| D6  | 现场权限         | M6-2 只加“投喂上下文”和“打开详情”；画布布局仍只读                                                   | 最小安全改动；任务动作会修改 M6-1 的 D4，需要单独 spec               |
| D7  | 验收证据         | cost/turn 落库展示；verify 失败/跳过时通过需二次确认；不做 AC 清单                                   | 数据 adapter 已拿到，只差持久化/UI；AC 的“谁写、怎么核”需要单独设计   |
| D8  | 总管工具         | `inject_context`：单任务、用户明确要求、写审计；review 不可注入                                      | 符合“只调度不干活”；批量注入容易制造噪音和越权感                     |
| D9  | 注入说明         | 可选 note；为空时服务端使用默认句“补充以下上下文”                                                     | 保留低摩擦投喂，同时允许解释“为什么补这几个节点”                     |
| D10 | review 语义      | 只在“打回”时携带上下文；单独 `context.inject` 对 review 返回 `task_not_injectable`                  | review 下单独注入不会产生下一轮执行，是 no-op                         |
| D11 | 预算             | 单次 40 节点/48k/单节点 16k；累计注入 96k；超限整次拒绝                                             | 避免 prompt 无界增长；整次拒绝比“悄悄丢一半”更容易解释               |
| D12 | 通过覆盖         | verify 失败/跳过时，通过需二次确认；理由可选；写 `review.approve_override` 审计                     | 低摩擦但可追溯；强制写理由容易变成敷衍填字                           |
| D13 | UI 入口          | 工具栏/现场条 + 任务详情；不做拖拽到 Agent 节点                                                      | 复用现有选择模型，工作量最小；拖拽的命中/预览/取消逻辑留到后续       |
| D14 | 总管定位         | 以 `taskId` 定位；用户选中 Agent 节点时先解析到任务                                                 | 任务才是上下文和执行的单位；同一 Agent 节点可能对应多个任务           |
| D15 | 队列顺序         | 新增 `task.enqueuedAt`；调度器按它排序；注入不改它                                                  | `updatedAt` 会因注入刷新，把 queued 任务挤到队尾；需要独立排序字段   |
| D16 | review 空反馈    | 只选上下文、不写文字反馈时允许打回；用默认反馈句                                                    | 投喂本身表达了意图，不应被空文本框卡住                               |
| D17 | 移动端           | 任务详情只读展示上下文时间线；不提供投喂入口                                                        | 与 M6-1 “手机不挂画布”一致；时间线是验收信息，手机上应看得到         |
| D18 | 原子性           | `user_input` / `reject` 转移增加可选 `contextInjection`，新增纯 DB effect `appendContextInjection` | prompt 追加、注入记录、审计同事务；发送仍在 afterCommit，和现有 reply 一致 |
| D19 | 成本/turn        | 存 `session.cost_usd/turns`；adapter 的 `turn_result` 映射为 `baton.session.usage` CUSTOM 事件        | 不需要改 AG-UI 标准事件；按 session 聚合，review 卡显示最近一次       |
| D20 | 自动开工         | 注入不自动开工；`todo` 仍停在 `todo`，`queued` 仍排队                                               | 开工仍由人/明确指令触发；避免“补资料”变成“偷偷开工”                 |
| D21 | 审计/事件        | 只写 taskId/seq/source/nodeIds/chars；不写 note/正文                                                 | 注入内容可能含敏感信息；prompt 已是唯一执行真相                       |
| D22 | migration        | 0011 只加 nullable 列：`task.enqueued_at`、`session.cost_usd`、`session.turns`；回填 queued          | 旧库可升级；不改 `context_json` 结构语义                             |
| D23 | 已知限制         | 连接中断后的手动重试可能重复注入；不做幂等表                                                        | KISS；UI 提交期间禁用按钮，风险写进 spec                             |
| D24 | 文档/证据        | spec/contract/5 个 plan/evidence 全套；不改 `docs/agent-harness/`                                    | 仓库既有约定；不伪造不存在的脚本                                     |

## 4. 领域模型与数据结构

### 4.1 上下文注入（ContextInjection）

```ts
export const ContextInjection = z.object({
  seq: z.number().int().positive(),
  at: Timestamp,
  source: z.enum(['user', 'supervisor']),
  note: z.string().max(2000).nullable(),
  nodeIds: z.array(Id).min(1),
  included: z.array(ContextNodeRef),
  dropped: z.array(ContextDropped),
  truncated: z.boolean(),
  relations: z.array(ContextRelation),
  relationsTruncated: z.boolean(),
  chars: z.number().int().nonnegative(),
})
```

- `seq` 在单个 task 内从 1 单调递增，由 daemon 在事务内计算（`injections.length + 1`）。
- `nodeIds` 是用户/总管显式选择的节点；`included` 是装配后实际进入 prompt 的节点（含边闭包），`dropped` 记录预算/敏感路径/空内容/缺失。
- `chars` 是本次注入的预算字符数；`assembleContextInjection().chars` 只算节点正文，daemon 用 `contextUpdateChars(assembled, note)` 加上转义后的 note 长度后写入 `ContextInjection.chars`，累计预算以 `ContextInjection.chars` 为准；不含包装标签。
- `note` 只存在 `task.context.injections[]` 和 `task.prompt`；事件/审计不写。未传 note 时由服务端填默认句“补充以下上下文”。
- 不存节点正文：正文只在 `task.prompt` 中；时间线显示 `included[].title/type/chars`，节点 chip 点击回画布。
- `included[].depth` 是本次注入内部的深度，不是相对初始上下文的深度。
- 不做跨注入去重：用户显式选择的节点即使已在初始上下文里也会再次注入（内容可能已变）；累计预算兜底。

### 4.2 注入状态矩阵

| 任务状态                                      | 入口                             | prompt 效果                                  | 执行效果                | 状态变化                               |
| --------------------------------------------- | -------------------------------- | -------------------------------------------- | ----------------------- | -------------------------------------- |
| `todo`                                        | `context.inject`                 | 追加 `<context_update>`                      | 不启动 session          | 仍为 `todo`                            |
| `queued`                                      | `context.inject`                 | 追加 `<context_update>`                      | 不启动 session          | 仍为 `queued`，`enqueuedAt` 不变       |
| `waiting_input`（question/stalled/dropped）    | `context.inject`                 | `<user_reply>` 内包含 `<context_update>`     | 发送给存活 session      | 走现有 `user_input`，变 `running`      |
| `waiting_input`（approval/null）               | —                                | —                                            | —                       | `task_not_injectable`（先处理审批）    |
| `review`                                      | `review.decide(reject)` 携带上下文 | 独立 `<context_update>` + 可选 `<feedback>`  | 打回后重新入队          | 走现有 `reject`，变 `queued`           |
| `review`                                      | 单独 `context.inject`            | —                                            | —                       | `task_not_injectable`（请用打回）      |
| `running/verifying`                           | —                                | —                                            | —                       | `task_not_injectable`                  |
| `done/failed/cancelled`                       | —                                | —                                            | —                       | `task_not_injectable`（先 reopen/handoff） |

**原子性**：

- `todo/queued`：daemon 的 `injectContext` 在一个事务里完成 prompt 追加、`context.injections[]` 追加、审计、`context.injected` 事件；不经过状态机。
- `waiting_input`：`context.inject` 组装块后调用 `applyTransition(taskId, { type: 'user_input', text: blockWithNote, contextInjection })`。`user_input` 的 effects 增加 `appendContextInjection`；prompt 的 `<user_reply>` 由现有 `appendUserReply` 追加。发送仍在 afterCommit，和现有 `session.reply` 一致。
- `review reject`：`review.decide` 组装块后调用 `applyTransition(taskId, { type: 'reject', feedback, contextInjection, contextBlock })`。`reject` 的 effects 增加 `appendContextInjection`；`feedback` 与 `contextBlock` 分开追加，避免 feedback 的 16k 截断吃掉 48k 上下文。
- 允许的转移和状态语义不变；只是给已有转移增加一个可选 effect 和可选事件字段。

### 4.3 预算

| 限制         | 值                    | 说明                                             |
| ------------ | --------------------- | ------------------------------------------------ |
| 单次节点数   | 40                    | 与 `assembleContext` 的 `MAX_CONTENT_NODES` 一致 |
| 单次总字符   | 48,000                | 与现有总预算一致                                 |
| 单节点字符   | 16,384                | 与现有单节点预算一致                             |
| 累计注入字符 | 96,000                | 只累计 `context.injections[].chars`，不含初始上下文 |
| 关系边       | 200 条 / 4,000 字符   | 与现有关系预算一致                               |

- 超单次限制：装配阶段按现有规则截断/丢弃，并在 `dropped/truncated` 中体现；如果最终 `included` 为空，返回 `context_empty`。
- 超累计限制：整次拒绝 `context_budget_exceeded`，不写 prompt、不写 metadata、不写审计。
- 初始上下文的 48k 不计入累计注入预算；避免把“建任务时已花掉的预算”重复计算。

### 4.4 队列顺序（enqueuedAt）

- `Task.enqueuedAt: Timestamp | null`。
- 进入 `queued` 时设为 `now`：`enqueue`、`reject`、`verify_fail` 自动重试、`retry`。
- 离开 `queued` 或进入 `todo` 时保持原值或置 null（`reopen` → `todo` 置 null）。
- 调度器只对 `queued` 使用新查询 `listQueuedTasksByEnqueuedAt`：`coalesce(enqueued_at, updated_at) ASC, id ASC`；`boot` 的 `running/waiting_input/verifying` 仍用 `updatedAt` 排序。
- 注入 `queued` 任务不修改 `enqueuedAt`，因此不会改变排队位置。

### 4.5 成本/turn（SessionUsage）

- `session.cost_usd`、`session.turns` 为 nullable；旧 session 为 null。
- adapter 把 `turn_result.costUsd/turns` 映射为 `CUSTOM` 事件 `baton.session.usage`；`session-runner` 消费后更新当前 session 行。
- `TaskDetailResponse.sessions` 已返回 session 列表；web 聚合 `ΣcostUsd`、`Σturns`，review 卡显示最近一次 session 的数值。
- fake/pty 没有 usage 时显示“—”，不阻塞验收。
- 不在本迭代做预算护栏、cost 告警或按任务限额。

### 4.6 通过覆盖（ApproveOverride）

- `ReviewDecideInput` 的 `approve` 增加可选 `reason`（≤2000）。
- UI 仅在 `verifyExitCode !== 0` 或 `VERIFY_SKIPPED` 时弹二次确认；理由可选。
- daemon 写 `review.approve_override` 审计：`reviewId`、`taskId`、`verifyExitCode`、`reasonProvided`；不改变状态机 `approve` 语义。
- 正常 verify 通过且未提供 reason 的 approve 不写 override 审计。

## 5. 协议与 API 变更

### 5.1 Protocol

- `packages/protocol/src/context.ts`：
  - 新增 `ContextInjection`；
  - `ContextSnapshot` 增加 `injections: z.array(ContextInjection).default([])`。
- `packages/protocol/src/commands.ts`：
  - 新增 `ContextInjectInput`：

```ts
export const ContextInjectInput = z.object({
  taskId: Id,
  nodeIds: z.array(Id).min(1).max(40),
  note: z.string().max(2000).optional(),
})
```

  - `ClientMessage` 增加 `context.inject`。
  - `ReviewDecideInput` 的 reject 分支改为：

```ts
z.object({
  reviewId: Id,
  decision: z.literal('reject'),
  feedback: z.string().max(16_384).optional(),
  contextNodeIds: z.array(Id).min(1).max(40).optional(),
  contextNote: z.string().max(2000).optional(),
}).strict()
```

  - refine：`feedback` 与 `contextNodeIds` 至少一个。
  - approve 分支增加 `reason: z.string().max(2000).optional()`。
- `packages/protocol/src/entities/task.ts`：
  - `Task` 增加 `enqueuedAt: Timestamp.nullable().default(null)`。
- `packages/protocol/src/entities/session.ts`：
  - `Session` 增加 `costUsd: z.number().nonnegative().nullable().default(null)`、`turns: z.number().int().nonnegative().nullable().default(null)`。
- `packages/protocol/src/events.ts`：
  - 新增 server event `context.injected`：

```ts
{
  taskId: Id
  seq: number
  at: Timestamp
  source: 'user' | 'supervisor'
  nodeIds: Id[]
  chars: number
}
```

  - 新增 CUSTOM 事件名 `SESSION_USAGE_EVENT = 'baton.session.usage'` 与 payload：

```ts
{ costUsd?: number; turns?: number }
```

- `packages/protocol/src/transitions.ts`：
  - `user_input` 的 `text` 上限从 16_384 放宽到 64_000（上下文块 + note）；
  - `user_input` 增加可选 `contextInjection?: ContextInjection`；
  - `reject` 增加可选 `contextInjection?: ContextInjection` 与 `contextBlock?: string`（≤64_000）。
  - 不新增转移类型；不改变允许的 from/to。
- 不新增 `NodeType`；不修改 `Node` 联合类型；不新增 REST 接口。

### 5.2 WS / REST

- WS 命令 `context.inject`：成功 ack data 为 `{ taskId, seq, truncated, dropped: number }`；失败走统一错误。
- WS 事件 `context.injected`：写 `ws_event`，`taskId` 列由 event-store 的 `appendWs` 推导；web 收到后失效 canvas/tasks/task。
- 不新增 REST：任务详情已返回 `task.context` 和 `sessions`；画布已返回 nodes/edges。
- `appendWs` 的 taskId 推导扩展为 `task.status` 和 `context.injected`；`task.history` 仍只返回状态事件/session/review，注入时间线从 `task.context` 读。

### 5.3 总管工具

- `SUPERVISOR_POLICY.allowedTools` 16 → 17：新增 `inject_context`。
- 输入：

```ts
{
  taskId: Id
  nodeIds: Id[]   // 1..40
  note?: string   // ≤2000
}
```

- 校验：任务在当前 workspace；`canInjectContext` 为 true；节点属于当前 canvas；节点类型合法；预算通过。
- 不允许 `review`（返回 `task_not_injectable`，提示用户去打回）；不允许自动注入；一次只处理一个 task。
- 审计：`supervisor.context.inject`，记录 taskId、seq、nodeIds、chars、dropped 数量；不写 note/正文。
- `get_task` 增加：
  - `injectable: { ok: boolean; reason?: string }`
  - `context.injections: { count: number; lastAt: Timestamp | null; lastSeq: number | null }`
  - 不返回注入正文。
- Prompt 增加：
  - 只有用户明确说“补给它/把这几个节点给它/加上这些上下文”才调用；
  - 不自动补上下文、不自动打回；
  - review 状态只能提示用户去打回；
  - 不声称注入成功，除非工具成功。

## 6. Core 纯函数

新增 `packages/core/src/context/inject.ts`：

- `canInjectContext(task: Pick<Task, 'status' | 'waitingReason'>): { ok: boolean; reason?: string }`
  - `todo/queued` → true
  - `waiting_input` → `canAcceptUserInput(task)`（question/stalled/dropped）
  - `review` → false，reason `use_review_reject`
  - `running/verifying` → false，reason `running`
  - `done/failed/cancelled` → false，reason `terminal`
- `assembleContextInjection(input)`：
  - 输入：`selectedNodeIds`、`nodes`、`edges`、`contentByNodeId`；不接收目标 Agent；
  - 复用 `assembleContext` 的 `isContentNode`、group 展开、直接上游边、上游深度 2、排序 `(depth, y, x, id)`、敏感路径、空内容丢弃、单节点/总预算；不自动展开目标 Agent 的既有 context 边；
  - 返回 `{ included, dropped, truncated, redactedPaths, relations, relationsTruncated, chars }`；
  - `chars` 只算节点正文；daemon 用 `contextUpdateChars(assembled, note)` 加转义后的 note 长度；
  - 不返回最终 prompt，只返回本次内容和元数据。
- `buildContextUpdateBlock({ seq, at, source, note, assembled })`：
  - 输出 `<context_update seq="..." at="..." source="...">`；
  - note 非空时输出 `<note>...</note>`；
  - 节点与关系沿用现有 XML 结构；
  - 字符数只计算块内内容（节点正文 + note），不含外层标签。
- `cumulativeInjectedChars(snapshot: ContextSnapshot): number`
  - `sum(injections[].chars)`；旧数据无 injections 时为 0。
- 所有纯函数先写失败测试，再实现；不读时间/文件/随机数（`at` 由调用方传入）。

## 7. daemon 实现

### 7.1 数据库 / migration 0011

```sql
ALTER TABLE task ADD COLUMN enqueued_at integer;
UPDATE task SET enqueued_at = updated_at WHERE status = 'queued';
ALTER TABLE session ADD COLUMN cost_usd real;
ALTER TABLE session ADD COLUMN turns integer;
```

- 旧 `context_json` 不动；`ContextSnapshot.parse` 用 `injections: []` 兼容。
- `toTask` / `toSession` 增加新字段解析。
- 在 fixture DB 上验证升级；不做 destructive migration。

### 7.2 Repository

- `appendTaskContextInjection(tx, taskId, injection)`：
  - 读 `context_json`，parse，追加 `injections`，写回；保留 `included/dropped/...` 原值；
  - 若 context_json 为空（旧任务/异常），创建一个 `injections` 数组并保留其余空数组字段；
  - 不修改 `task.prompt`（prompt 由调用方追加）。
- `setTaskEnqueuedAt(tx, taskId, at)` / `clearTaskEnqueuedAt(tx, taskId)`。
- `listQueuedTasksByEnqueuedAt(db)`：`status = 'queued'`，`orderBy(asc(enqueuedAt), asc(id))`。
- `updateSessionUsage(tx, sessionId, { costUsd, turns })`。
- 新增 `appendTaskPromptRaw(tx, taskId, text, maxChars, updatedAt)`：把已经带外层标签的 `<context_update>` 原样追加到 prompt；`appendTaskPromptBlock` 仍只处理 `feedback/user_reply/reopen_note`，避免双重包裹。

### 7.3 注入服务

新增 `apps/daemon/src/runtime/context-service.ts`：

```ts
injectContext(input: {
  taskId: string
  nodeIds: string[]
  note?: string
  source: 'user' | 'supervisor'
  actor: string
}): Result<{ taskId: string; seq: number; truncated: boolean; dropped: number }>
```

流程：

1. 读 task；不存在 → `task_not_found`。
2. `canInjectContext`；不可注入 → `task_not_injectable`。
3. 读 workspace canvas、nodes、edges；节点不存在 → `node_not_found`；节点类型 `agent/review` → `node_type_not_injectable`。
4. `buildContextContent`（复用敏感路径跳过、文件读取限制）。
5. `assembleContextInjection`；`included` 为空 → `context_empty`。
6. 累计预算：`cumulativeInjectedChars(task.context) + assembled.chars > 96_000` → `context_budget_exceeded`。
7. 分派：
   - `todo/queued`：事务内 `appendTaskPromptRaw(..., block)` + `appendTaskContextInjection` + audit + `context.injected` ws event；不 kick 调度器（不自动开工）。
   - `waiting_input`：先检查当前 session 仍存活；不可用返回现有 `session_not_active`。可用时调用 `applyTransition(taskId, { type: 'user_input', text: blockWithNote, contextInjection })`；转移 effects 内完成 `<user_reply>` + `appendContextInjection`；发送 afterCommit。
   - `review`：返回 `task_not_injectable`（reason `use_review_reject`）。
8. 返回 seq/truncated/dropped 数量。

`blockWithNote`：`buildContextUpdateBlock` 的输出；note 已包含在块内。`note` 为空或未传时，服务端使用默认句“补充以下上下文”；显式传入的 note 不重写。

### 7.4 状态机 effect

- `packages/core/src/state-machine/types.ts`：`TaskEffect` 增加 `appendContextInjection: (injection: ContextInjection, block?: string) => TaskEffect`。
- `packages/core/src/state-machine/transition.ts`：
  - `user_input`：effects 追加 `appendContextInjection(event.contextInjection)`（存在时）；
  - `reject`：effects 追加 `appendContextInjection(event.contextInjection, event.contextBlock)`（存在时）；
  - 不改变 from/to、guards、状态语义。
- `apps/daemon/src/runtime/effects.ts`：
  - 处理 `appendContextInjection`：调用 repository；若 `block` 存在，用 `appendTaskPromptRaw` 原样追加；在同一事务里追加 `context.injected` ws event（taskId 由 effect 传入）；
  - 不写 note/正文到事件。
  - `MAX_FEEDBACK_CHARS` 从 16_384 放宽到 64_000，保证 waiting_input 的 `<user_reply>` 能容纳上下文块；普通 UI reply 仍由 `SessionReplyInput` 的 16k 限制。
- `transition-runner.ts`：
  - 在 `updateTaskState` 后，如果 `result.status === 'queued'` 且 previousStatus !== 'queued'，设置 `enqueuedAt = now`；
  - 如果 `result.status === 'todo'`（reopen），清空 `enqueuedAt`；
  - 其余状态不清空（保持事实）。

### 7.5 Review 路径

- `decideReview` 的 reject 分支：
  - 若 `contextNodeIds` 存在：校验 review 属于任务、任务仍在 review、节点合法、预算通过；
  - 组装 `contextInjection`；feedback = `feedback ?? '请结合补充的上下文修改'`；`contextBlock = prepared.block`；
  - 调用 `applyTransition(taskId, { type: 'reject', feedback, contextInjection, contextBlock })`；
  - 不额外的 `context.inject` 事件（`appendContextInjection` effect 已发）。
- approve 分支：
  - 若 `review.verifyExitCode !== 0` / `VERIFY_SKIPPED`，或显式提供了 `reason`，写 `review.approve_override` 审计；
  - 然后走现有 `approve` 转移；不改变状态机。
- `review_context_invalid`：review 不存在、已决定、或不属于该任务。

### 7.6 Session usage

- `packages/adapters/src/claude/adapter.ts`：`turn_result` 成功时，先 yield `CUSTOM baton.session.usage`（若 costUsd/turns 存在），再 yield RUN_FINISHED。
- `packages/adapters/src/fake.ts`：可选支持 usage（测试用）。
- `apps/daemon/src/runtime/session-runner.ts`：消费 `CUSTOM` 事件；`name === SESSION_USAGE_EVENT` 时 `updateSessionUsage`；仍把事件写入 session event 流（供 transcript/debug）。
- `Session` protocol 新字段；`toSession` 默认 null；`TaskDetailResponse.sessions` 自动带出。

### 7.7 总管

- `tools.ts` 新增 `inject_context`；`service.ts` 接线；`prompt.ts` 工具清单与规则更新；`SUPERVISOR_POLICY.allowedTools` 17。
- `get_task` 增加 `injectable` 和 `context.injections` 摘要。
- 审计 `supervisor.context.inject`；失败不写成功审计。
- 工具测试断言真实引擎请求体包含 17 个工具。

## 8. web 实现

### 8.1 画布

- `CanvasToolbar` 增加「投喂给任务」：选中至少一个可注入节点时启用；无可用任务时提示。
- `TaskSceneBar` 增加「投喂」按钮（目标默认当前现场任务）和「上下文 N 个 · 已注入 M 次」。
- 新增 `InjectContextDialog`：
  - 目标任务选择器（`canInjectContext` 过滤）；
  - 选中节点摘要（type/title/chars/移除）；
  - note 文本域；
  - 预算预览（节点数/预计字符/dropped/truncated）；超限禁用；
  - 提交 `context.inject`；pending 禁用；成功后 invalidate canvas/tasks/task。
- `buildTaskScene`：`relatedNodeIdSet` 纳入 `context.injections[].nodeIds`；`missingNodeIds` 包含已删除的注入节点。
- 被注入节点加「已投喂」标记（文本 + 图标，不只靠颜色）；`TaskSceneBar` 显示注入次数。
- 不做拖拽到 Agent 节点；不做现场布局编辑。

### 8.2 任务详情

- 新增 `ContextTimeline`：
  - 初始快照（复用 `ContextSnapshotCard`）；
  - 每次注入：seq、时间、来源、note、included chips、dropped/truncated；
  - 节点 chip 点击选中画布节点；缺失节点显示“已删除”；
  - 只读；不提供编辑/删除注入。
- 任务头部显示累计 cost/turn（`Σsessions.costUsd` / `Σturns`），缺失显示“—”。
- 移动端：同一时间线只读；不出现「投喂」按钮。

### 8.3 验收卡

- `ReviewCard` 打回：
  - feedback 改为可选；
  - 增加「附带上下文」：使用当前画布选择或打开节点选择器；显示选中节点 chips；
  - feedback 与 context 至少一个；提交 `review.decide(reject, feedback?, contextNodeIds?, contextNote?)`。
- `ReviewCard` 通过：
  - verify 失败/跳过时弹 `ConfirmDialog`，理由可选；
  - 确认后 `review.decide(approve, reason?)`。
- cost/turn：从 `TaskDetailResponse.sessions` 取最近一次，显示「本次 $x · y turns」；缺失“—”。
- 全局画布 review 卡仍只显示 `TaskSummary` 摘要，不拉详情（延续 M6-1 D13/§5.2）。

### 8.4 设计系统

- 全部使用 `DESIGN.md` token：`bg-surface`、`border-separator`、`text-muted`、`bg-accent`、`bg-warning`、`bg-danger`、`bg-success`；禁止硬编码 hex。
- “已投喂”、预算超限、缺失节点、override 确认都有文字/图标，不只靠颜色；对比度 WCAG AA；焦点可见；键盘可达。
- 时间线不引入第二套 UI 库；复用 HeroUI + 现有 card/chip/button。

## 9. 安全与隐私

- 注入只读画布节点内容，复用 `buildContextContent` 的敏感路径跳过和文件读取限制；不新增文件读取面。
- 图片仍只输出路径/URL，不转 base64；不抓外链。
- `note` 只进入 `task.prompt` 和 `context.injections[].note`；不进入 WS 事件、审计、日志。
- `context.injected` 只含 taskId/seq/at/source/nodeIds/chars；不含正文/note。
- 审计只写 metadata；错误信息不回显节点正文。
- 预算上限防止 prompt 无界增长和 token 成本失控。
- UI 以纯文本渲染 note/标题；不注入 HTML。
- 不新增外部网络请求；不改变 daemon 监听/鉴权。
- 截图验收按仓库脱敏规则处理。

## 10. 测试与验收

### 10.1 单元

- protocol：`ContextInjection` 解析/默认值；`ContextSnapshot.injections` 旧数据兼容；`ContextInjectInput`；review reject refine；approve reason；`Task.enqueuedAt`；`Session.costUsd/turns`；`context.injected`；`SESSION_USAGE_EVENT`。
- core：`canInjectContext` 全状态矩阵；`assembleContextInjection` 的选中/直接边/上游 2 层/group 展开/敏感路径/空内容/预算/排序/默认 note 快照；`buildContextUpdateBlock`；`cumulativeInjectedChars`；`user_input/reject` 带 `contextInjection` 时 effects 包含 `appendContextInjection`。
- daemon：migration 0011 升级与回填；`appendTaskContextInjection` 保留旧快照；`enqueuedAt` 在 enqueue/reject/retry/verify_fail 设置、reopen 清空；`listQueuedTasksByEnqueuedAt` 顺序；注入事务原子性（预算失败不写）；waiting_input 只有一份块；review reject 携带上下文；`session usage` 落库；approve override 审计；supervisor 工具审计。
- web：对话框目标/预算/空内容；现场条计数/已投喂/缺失；时间线；review 打回带上下文；approve 确认；手机只读。

### 10.2 集成 / e2e

- Playwright：
  1. 建任务 → 跑到 `waiting_input` → 选中新节点投喂 → 任务回 `running` → 完成到 `review`；断言 prompt/timeline。
  2. 两个 `queued` 任务，给第一个注入；断言第一个仍先启动（`enqueuedAt` 保序）。
  3. `review` 只选上下文、不写 feedback 打回；断言任务回 `queued`，下一次 prompt 含块。
  4. verify 失败时点通过 → 二次确认 → 审计。
  5. cost/turn 从 fake usage 事件显示到 review 卡与详情。
- ego-lite + 真实 Claude：
  - 真实任务在 `waiting_input` 时投喂一个文本节点，session 继续执行到 `review`；
  - 截图现场条、时间线、review 卡 cost/turn；
  - 证据落 `docs/evidence/<date>-m6-2-context-injection/`，按脱敏规则处理。

### 10.3 命令

`pnpm verify`、`pnpm verify:full`、`pnpm pack:check`、`pnpm check:boundaries`、`pnpm check:protocol`、`pnpm format:check` 全绿；新增源码无未完成项。

### 10.4 DoD

1. `todo/queued/waiting_input` 可注入；`review` 只能通过打回携带；`running` 等状态明确拒绝。
2. 初始快照不变；`injections` 只追加；旧数据按 `[]` 解析。
3. 每次注入在 prompt 中只出现一份；按状态分别落在 `<context_update>` / `<user_reply>` / `<feedback>`。
4. 单次与累计预算原子生效；敏感路径不泄漏；事件/审计不含内容与 note。
5. `enqueuedAt` 稳定队列顺序；migration 回填旧 queued 任务；注入 queued 不改顺序。
6. 现场相关节点包含注入节点；现场条计数正确；缺失节点可见；被注入节点有文字/图标标记。
7. 任务详情/手机只读时间线可用；节点 chip 可定位。
8. cost/turn 落库并在 review 卡/详情展示；verify 失败/跳过时通过需二次确认并写审计。
9. 总管 `inject_context` 仅单任务、明确指令、写审计；review 不可注入。
10. 不建新表、不改转移语义、不做 AC/现场任务动作/DAG；`pnpm verify:full` 与证据落库。

## 11. 风险与缓解

| 风险                       | 影响                               | 缓解                                                                 |
| -------------------------- | ---------------------------------- | -------------------------------------------------------------------- |
| prompt 无界增长            | token 成本、上下文窗口溢出         | 单次 48k + 累计 96k + 整次拒绝；后续另立 spec 做摘要/裁剪             |
| queued 注入改变队列顺序    | 任务被“补资料”挤到队尾             | `enqueuedAt` 独立排序；migration 回填；e2e 覆盖                        |
| waiting_input 发送失败     | 注入已记录但 session 没收到        | 复用现有 afterCommit 语义；UI 明示；用户可查看 session/retry          |
| 重复注入                   | prompt 重复、时间线重复            | UI 提交期禁用；已知限制写 spec；后续再评估 requestId/幂等表            |
| review 打回空 feedback     | 语义不清                           | 默认反馈句；context 块显式标注来源；时间线可追溯                      |
| cost/turn 缺失             | fake/pty 显示“—”                   | 不阻塞验收；adapter 可选上报；后续补 fake usage                       |
| 注入内容含敏感信息         | 泄漏到 prompt/截图                 | 复用敏感路径过滤；事件/审计只写 metadata；截图脱敏                    |
| 现场被误操作               | 布局被打乱                         | 现场布局仍只读；只有投喂入口；不做拖拽/编辑                           |
| 协议/迁移范围偏大          | 一次跨 protocol/core/daemon/web    | 5 个 plan 隔离；每片独立 `pnpm verify`；不混入 AC/现场动作            |

## 12. 实施切片

1. **Plan 1 protocol + core + migration 0011**：schemas、commands、transitions、effects、纯函数、迁移与单测。
2. **Plan 2 daemon**：repository、context service、状态机 effect 接线、review 路径、session usage、supervisor 工具、集成测试。
3. **Plan 3 web canvas**：工具栏/现场条、投喂对话框、现场计数/标记、场景节点收敛。
4. **Plan 4 web tasks**：时间线、review 打回上下文、approve 确认、cost/turn、移动端只读。
5. **Plan 5 验收与文档**：Playwright、ego-lite 真实 Claude、证据、docs 索引、contract 收口。

依赖：Plan 2 依赖 Plan 1；Plan 3 依赖 Plan 1+2；Plan 4 依赖 Plan 2+3；Plan 5 依赖全部。

## 13. 后续路线

- **M6-3 验收证据**：AC 清单、验收报告、cost 预算护栏；与 M5-4 合并考虑。
- **M6-4 现场任务动作**：现场条承载回复/通过/打回/重试；需要新 spec 回链 M6-1 D4。
- **M6-5 总管主动注意力**：每日计划、优先级、observe 模式；先做只观察/审计，再放开自动动作。
- **M5-2 外部 Source**：GitHub/飞书入口；在站内注意力闭环稳定后再接。
- **运行中注入**：如果真实使用证明需要，再评估 SDK 流式输入的产品语义与安全边界。

## 14. 评审记录

- 2026-11-21：三轮 frontier + assumption audit；确认范围、注入状态、上下文模型、注入语义、prompt 表示、现场权限、验收深度、总管工具、note、review、预算、override、UI 入口、总管定位、队列顺序、空反馈、移动端；设计通过。
- 2026-11-21：用户确认 Section 1（架构与数据模型）与 Section 2（状态矩阵、UI、错误处理、验收）；进入 spec 落库。
- 2026-11-21：Plan 1 实现评审修正：D4 改为“选中节点 + 直接上游边 + 上游 2 层，不自动展开目标 Agent 的既有 context 边”，避免每次注入重复初始上下文（回链 Plan 1 Task 2）；review 上下文改为独立 `<context_update>` 块，避免 feedback 16k 截断；`user_input` 上限放宽到 64k；新增 `contextUpdateChars` 统计转义后的 note。
