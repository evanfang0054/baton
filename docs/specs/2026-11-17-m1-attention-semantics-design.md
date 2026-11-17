---
spec_topic: m1-attention-semantics
decision_summary: "M1-5a：新增会话结局、等待原因与直接回复；status 保持投影并补 cause/attention；不做完整事件溯源，不新增 task_event"
design_approved: true
user_approved_at: 2026-11-17T10:56:16+08:00
gates: [user-review-passed]
spec_ref: 2026-11-16-baton-architecture-design.md
---

# M1-5a 任务注意力语义设计

> 子 spec。回链主架构：`docs/specs/2026-11-16-baton-architecture-design.md`。
> 前置：`docs/specs/2026-11-17-m1-protocol-state-machine-design.md`（已合并）、`docs/specs/2026-11-17-m1-daemon-runtime-design.md`（已合并）。
> 本文只锁定 M1-5a：把「任务停在等人」做成状态机的一等公民。web、真实 Claude、总管、触发器不在范围。

## 0. 文档信息

- **状态**：设计草案，待用户评审。
- **范围**：`packages/protocol`、`packages/core`、`packages/adapters` 的 fake 脚本、`apps/daemon/**`、SQLite migration、`docs/**`。
- **不在范围**：`apps/web`、`agent-claude`/`agent-pty`、worktree、总管与 `supervisor.send`、外部触发器、通知、移动端、多窗口聚合。
- **文档位置**：spec 落 `docs/specs/`，contract 落 `docs/contracts/`，plan 落 `docs/plans/`。

## 1. 背景

M1-5 已合并：daemon 可以用 `agent-fake` 通过 WS 跑通
`task.create → enqueue → running → approval → verify → review → done`。
但当前实现对「会话为什么停下」只有一个假设：

- `apps/daemon/src/runtime/session-runner.ts:164` 把 `RUN_FINISHED` 无条件当作任务完成。
- `apps/daemon/src/runtime/session-runner.ts:180` 把事件流意外结束无条件当作 `failed`。
- `packages/core/src/state-machine/transition.ts:73` 的 `waiting_input` 只能由 `approval_requested` 进入。
- `apps/daemon/src/runtime/boot.ts:36` 在 `verifying` 期间重启直接 `cancelled`，丢掉验收证据。

结果是：

1. agent 说「我需要你确认一下」后结束，会被当成 `completed → verifying → review`；
2. agent 停下来等人时，用户没有回复通道，只能 allow/deny 工具审批；
3. 会话静默停止与真实崩溃都落到 `failed`，看板无法区分「等我」和「挂了」；
4. 任务卡无法回答「为什么停在这、等了多久」。

`baton.ai/肝了一周，我把 Super Agent 的架构融入到了我的 AI Native 工作台中.md` 里的
`ready / blocked / dropped / unreported` 与「谁最需要我，谁说了算」正好补这一块。
本文只取这个语义，不引入它的触发器、多窗口与 Cloudflare 方案。

## 2. 目标与非目标

### 2.1 目标

1. 定义 `SessionOutcome`，让适配器在会话结束时报告 `ready / blocked / dropped / unreported`。
2. 让 `waiting_input` 携带 `waitingReason`，区分 `approval / question / stalled / dropped`。
3. 新增 `session.reply` 命令与 `user_input` 转移，让用户可以直接回复等待中的会话。
4. 让 `task.status` 事件携带 `cause` 与 `attention`，任务详情能得到 `waitingSince`。
5. 重启时 `verifying` 合成 `verify_fail` 进入 `review`，保留验收证据。
6. 用 fake 适配器覆盖上述路径，为 M1-6 看板与 M1-7 真实 Claude 提供稳定契约。

### 2.2 非目标

- 不做完整事件溯源，不新增 `task_event` 表；`ws_event` 继续承担任务状态历史。
- 不做 `task.retry` / `reopen`；`failed` 仍要求新建任务，恢复语义留 M2。
- 不做多 window 聚合；一个任务同一时刻仍只有一个活跃 session。
- 不做总管、外部触发器、通知、移动端、worktree。
- 不修改 `TaskStatus` 枚举；`waiting_input` 仍是唯一「等人」状态，原因放进 `waitingReason`。
- 不把 `Review.verdict` 用于机器结果；verify 仍看 `verifyExitCode`。

## 3. 关键决策

| # | 决策 | 结论 | 理由 |
|---|---|---|---|
| D1 | 会话结局的传递方式 | 适配器用 AG-UI `CUSTOM{ name: 'session.outcome', value: { outcome, reason? } }` 报告每一轮：`ready` 后跟 `RUN_FINISHED`；`blocked`/`dropped` 保持事件流打开，等待 `AgentRun.send`；session runner 解析后写入 `session.outcome`（仅会话真正结束时） | 复用既有 AG-UI 事件与 transcript，不改 `AgentRun` 接口；真实引擎在 M1-7 只需多映射一个事件 |
| D2 | `ready` 与非 `ready` 的转移 | `ready` 继续走 `completed → verifying`；`blocked/dropped/unreported` 走新事件 `session_reported` → `waiting_input` | 保留 M1-1 已有转移，避免破坏 `completed` 的既有测试 |
| D3 | `waiting_input` 的原因 | `task.waiting_reason` 可空，取值 `approval/question/stalled/dropped`；旧数据为 `null` 时按 `approval` 保守处理 | 不新增状态，看板与回复守卫都能判定 |
| D4 | 用户回复 | 新 WS 命令 `session.reply { taskId, text }`；`waiting_input + user_input → running`，effect `sendToSession` 调 `AgentRun.send` | 用户在等待态直接回复，不经过总管；同时保留审批的 allow/deny 路径 |
| D5 | 静默停止与崩溃 | `running` 的流正常结束但没收到 `RUN_FINISHED` → `unreported` → `waiting_input(stalled)`；`RUN_ERROR` 或流抛错 → `failed` | 区分「停了没说明」与真正失败，避免把可恢复情况直接判死 |
| D6 | 重启中的 verify | `verifying` 重启合成 `verify_fail`（exit 124，输出 `daemon restarted during verify`）→ `review` 或 autopilot 重试 | 保留验收证据，符合「验收必须带可执行证据」 |
| D7 | 状态可解释性 | `task.status` 增加可选 `cause` 与 `attention`；`TaskDetailResponse` 增加 `waitingSince`；`Task` 增加 `waitingReason` | 看板能显示「为什么停、等了多久」；不引入事件溯源 |
| D8 | 事件溯源边界 | 不新增 `task_event`，不做 fold/rebuild；`ws_event` 是任务状态历史 | 当前单用户、单写者、低并发；完整 ES 的收益不抵成本（见 ADR） |
| D9 | 旧客户端与旧数据 | 新字段全部可空/可选；旧 `ws_event` 重放仍能通过 `TaskStatusEvent` | 避免迁移历史事件；M1-6 未上线，兼容成本低 |

## 4. 协议模型

### 4.1 枚举

```ts
export const SessionOutcome = z.enum(['ready', 'blocked', 'dropped', 'unreported'])
export type SessionOutcome = z.infer<typeof SessionOutcome>

export const WaitingReason = z.enum(['approval', 'question', 'stalled', 'dropped'])
export type WaitingReason = z.infer<typeof WaitingReason>

export const Attention = z.enum([
  'none',
  'needs_approval',
  'needs_reply',
  'needs_attention',
  'needs_review',
])
export type Attention = z.infer<typeof Attention>
```

### 4.2 实体增量

```ts
// Task
waitingReason: WaitingReason.nullable()

// Session
outcome: SessionOutcome.nullable()
```

约束：

- `Task.waitingReason` 只在 `status === 'waiting_input'` 时有值；其他状态必须为 `null`。
- `Session.outcome` 只在 session 正常结束时写入；`failed` 的 session 保持 `null`。
- 旧行两列均为 `null`，读取时不做回填。

### 4.3 会话结局事件

```ts
export const SESSION_OUTCOME_EVENT = 'session.outcome'

export const SessionOutcomeValue = z.object({
  outcome: SessionOutcome.exclude(['unreported']),
  reason: z.string().min(1).optional(),
})
export type SessionOutcomeValue = z.infer<typeof SessionOutcomeValue>
```

约定：

- 该事件是**一轮的报告**，不是必然的会话终止信号：
  - `ready`：这一轮做完了；适配器随后发 `RUN_FINISHED`，session 结束。
  - `blocked`：需要用户回答；适配器**不发** `RUN_FINISHED`，事件流保持打开，等待 `AgentRun.send`。
  - `dropped`：建议放弃；同样保持打开，等待用户回复或取消。
  - `unreported`：保留给 runner 合成，适配器不得主动发出。
- `blocked`/`dropped` 时 session 进入 `waiting_input`，但仍是活跃 run；`session.outcome` 保持 `null`，直到会话真正结束。
- `RUN_FINISHED` 只允许在 `ready` 之后出现；`blocked`/`dropped` 后出现的 `RUN_FINISHED` 视为协议违约，按 `error → failed` 处理。
- 没有该事件时，session runner 按 `unreported` 处理；`RUN_ERROR` 不读取它，直接 `failed`。
- 该事件作为普通 `session.event` 落库并广播，参与 `resume` 重放。

### 4.4 状态转移事件

在现有 `TaskTransitionEvent` 追加两个分支：

```ts
z.object({
  type: z.literal('session_reported'),
  outcome: z.enum(['blocked', 'dropped', 'unreported']),
  reason: z.string().min(1).optional(),
}),
z.object({
  type: z.literal('user_input'),
  text: z.string().min(1).max(16_384),
}),
```

约束：

- `session_reported` 只接受非 `ready` 的 outcome；`ready` 继续使用 `completed`。
- `user_input` 只在 `waiting_input` 且 `waitingReason !== 'approval'` 时合法。

### 4.5 WS 命令

新增：

```ts
export const SessionReplyInput = z.object({
  taskId: Id,
  text: z.string().min(1).max(16_384),
})
```

`ClientMessage` 增加 `{ type: 'session.reply', payload: SessionReplyInput }`。

行为：

1. 任务必须存在且 `status === 'waiting_input'`，否则 `reply_not_allowed`。
2. `waitingReason === 'approval'` 时拒绝，返回 `reply_not_allowed`；审批仍走 `approval.decide`。
3. 没有活跃 run（例如 daemon 已重启）返回 `session_not_active`。
4. 成功时先 `user_input` 转移，提交后调 `sendToSession`，`ack.data = { taskId, status: 'running' }`。

### 4.6 服务端事件增量

`TaskStatusEvent.payload` 增加可选字段：

```ts
cause: z.object({
  waitingReason: WaitingReason.optional(),
  outcome: SessionOutcome.optional(),
  sessionId: Id.optional(),
  approvalId: Id.optional(),
  reviewId: Id.optional(),
  reason: z.string().min(1).optional(),
}).optional(),
attention: Attention.optional(),
```

- 新事件必须带 `attention`；`cause` 在有上下文时带。
- 旧 `ws_event` 重放时两个字段都可能缺失，客户端按 `status` + `waitingReason` 自行降级。

`TaskDetailResponse` 增加：

```ts
waitingSince: Timestamp.nullable()
```

- `status` 为 `waiting_input` 或 `review` 时取 `task.updatedAt`，否则 `null`。

### 4.7 错误码

新增：

- `reply_not_allowed`：状态不对或正在等待审批。
- `session_not_active`：任务在等待，但没有可回复的活跃 run。

## 5. 状态机

### 5.1 `TransitionContext`

```ts
export interface TransitionContext {
  readonly status: TaskStatus
  readonly retryCount: number
  readonly runningCount: number
  readonly maxConcurrency: number
  readonly autopilot: { readonly enabled: boolean; readonly retryMax: number }
  readonly waitingReason: WaitingReason | null
}
```

`TransitionResult` 增加 `waitingReason: WaitingReason | null`，由 `transition()` 计算并返回。

### 5.2 转移表增量

| From | Event | Guard | To | waitingReason | Effects |
|---|---|---|---|---|---|
| `running` | `session_reported(blocked)` | — | `waiting_input` | `question` | `emitTaskStatus(waiting_input, cause)` |
| `running` | `session_reported(dropped)` | — | `waiting_input` | `dropped` | `emitTaskStatus(waiting_input, cause)` |
| `running` | `session_reported(unreported)` | — | `waiting_input` | `stalled` | `emitTaskStatus(waiting_input, cause)` |
| `waiting_input` | `enqueue` | `waitingReason === 'stalled'` | `queued` | `null` | `enqueueTask` + `emitTaskStatus(queued)` |
| `waiting_input` | `user_input` | `canAcceptUserInput(waitingReason)` | `running` | `null` | `sendToSession(text)` + `appendUserReply(text)` + `emitTaskStatus(running)` |

现有转移的 `waitingReason`：

| 转移 | waitingReason |
|---|---|
| `running + approval_requested → waiting_input` | `approval` |
| `waiting_input + approval_allow/deny → running` | `null` |
| `running + completed → verifying` | `null` |
| `verifying + verify_ok/fail → review/queued` | `null` |
| `review + approve → done` | `null` |
| `review + reject → queued` | `null` |
| `cancel` / `error` | `null` |

### 5.3 守卫与边界

- `user_input` 在 `waitingReason === 'approval'` 或 `null` 时返回 `invalid_transition`，错误 details 带 `waitingReason`。
- `waitingReason === 'stalled'` 允许 `enqueue` 重新排队，作为静默停止后的恢复路径。
- `session_reported` 从 `running` 之外的状态进入一律 `invalid_transition`。
- `completed` 仍只从 `running` 进入；session runner 只在 `ready` 时发它。
- `attention` 由 `status + waitingReason` 计算：
  - `waiting_input + approval` → `needs_approval`
  - `waiting_input + question/dropped` → `needs_reply`
  - `waiting_input + stalled` → `needs_attention`（可取消或重新 enqueue，不提供直接回复）
  - `review` → `needs_review`
  - 其他 → `none`
- 每个成功转移仍以 `emitTaskStatus` 结尾；`sendToSession` 在它之前。

## 6. Daemon 运行时

### 6.1 Session runner

1. `ActiveRun` 增加 `seq: number`、`outcome: SessionOutcome | null` 与 `outcomeReason?: string`。
2. 收到 `CUSTOM session.outcome`：
   - 解析 `SessionOutcomeValue`；非法或重复报告时按 `RUN_ERROR` 处理（`unreported` 已被 schema 拒绝）；
   - `ready`：只记录 `active.outcome`，等待 `RUN_FINISHED`；
   - `blocked` / `dropped`：记录 outcome，立即 `session_reported` 把任务转 `waiting_input`，session 状态写 `waiting_input`（不是 `ended`），**保持 active run 与事件流打开**，继续消费后续事件。
3. 收到 `RUN_FINISHED`：
   - `active.outcome === 'ready'` → `completed` → `verifying`，session `ended` / `outcome='ready'`；
   - `active.outcome` 为 `blocked` / `dropped`（显式暂停后又结束）→ 协议违约 → `error → failed`；
   - 没有收到 outcome → 按 `unreported` 处理，`session_reported(unreported)`，session `ended` / `outcome='unreported'`。
4. 流自然结束但没有 `RUN_FINISHED`：
   - 任务 `running` → `session_reported(unreported)`，session `ended` / `outcome='unreported'`；
   - 任务 `waiting_input`（blocked/dropped 的活跃 run 死亡）→ `error`，session `failed`（等待中的会话已无法回复）。
5. 流抛错或 `RUN_ERROR`：`error → failed`，session `failed` / `outcome=null`。
6. `session.reply`：
   - 通过 `activeRuns` 找 `taskId` 对应的 run；找不到返回 `session_not_active`（`unreported/stalled` 没有活跃 run）；
   - 增加 `seq`，写入 `CUSTOM{ name: 'user.message', value: { text } }` 到 transcript 并广播；
   - session 状态写回 `running`，清空 `active.outcome` 与 `outcomeReason`；
   - 调 `run.send(text)`；失败时由 session runner 把任务转 `error`、session 转 `failed`，并清理 `activeRuns` / dispose run。
7. 用户回复同时通过 `appendUserReply` effect 追加到 `task.prompt` 的 `<user_reply>` 块，保证 autopilot 重跑或新 session 能看到答案。

### 6.2 持久化

- migration 增加 `task.waiting_reason TEXT` 与 `session.outcome TEXT`，均允许 `NULL`。
- `session.outcome` 只在该 session 真正结束时写入（`ready` / `unreported`）；`blocked`/`dropped` 的等待态保持 `NULL`。
- `updateTaskState` 增加 `waitingReason` 参数；只允许 transition runner 调用。
- `updateSessionStatus` 增加可选 `outcome` 参数；结束与等待态都通过它写 session 状态。
- `TaskStatusEvent` 的 `attention` 在 event store 写入前由 core 的 `attentionFor()` 计算；`cause` 由 effect 层合并上下文 id：审批补 `sessionId`，验证/验收补 `reviewId`，会话报告补活跃 `sessionId`。
- `countActiveTasks` 只统计 `running`、`verifying`，以及仍有活跃 session 的 `waiting_input`；`stalled` 不再占并发槽。
- 不新增 `task_event`；任务状态历史继续从 `ws_event` 读取。

### 6.3 重启收敛

`reconcileOnBoot` 修改：

1. `running/waiting_input` 的任务仍 `error → failed`；活跃 session 标 `failed`。
2. `verifying` 的任务不再 `cancel`，改为：
   ```ts
   applyTransition(task.id, {
     type: 'verify_fail',
     reviewId: newId(),
     exitCode: 124,
     output: 'daemon restarted during verify',
     diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
   })
   ```
   有 autopilot 时进入 `queued`，否则进入 `review`；两种情况都保留 review 证据。
3. pending approval 继续 `deny/system` + audit。
4. `reconcileOnBoot` 记录 `applyTransition` 失败（taskId + error code）；`error`/`cancel`/`verify_fail` 不再依赖 workspace/policy 加载，避免 workspace 缺失导致僵尸任务。
5. `bootstrap` 在 reconcile 期间设置 `beginBoot()` 抑制 scheduler kick，`runtime.start()` 在 listen 成功后恢复；`buildApp` 失败时关闭 runtime 与 DB。

### 6.4 WS / REST

- `session.reply` 走 `Runtime.handleCommand`，成功返回 `ack.data = { taskId, status: 'running' }`，失败返回 `reply_not_allowed` / `session_not_active`。
- `TaskDetailResponse.waitingSince` 在 HTTP 路由计算；不写 DB。
- `Task` 响应包含 `waitingReason`；旧数据为 `null`，前端显示「等待处理」。

## 7. 兼容与迁移

- 所有协议新增字段可空/可选；旧客户端与旧 `ws_event` 不受影响。
- `TaskStatus` 枚举不变；不新增数据库状态值。
- fake 适配器的默认 `finish` 自动发 `session.outcome { outcome: 'ready' }`，保持 M1-5 既有测试语义；新增 `pause` 步骤发出 `blocked`/`dropped` 并等待 `send`，新增 `finish` 的 `unreported` 变体用于测试缺失路径。
- M1-5 中「流意外结束 → failed」的测试改为新语义；contract 明确列出该变更。
- 旧任务 `waiting_input` 且 `waiting_reason = null`：回复守卫按 `approval` 拒绝，避免误发。

## 8. 测试与验收

### 8.1 Protocol

- `SessionOutcome` / `WaitingReason` / `Attention` 合法值与非法值。
- `Task` 与 `Session` 新字段 round-trip；`null` 合法。
- `session.reply` round-trip；空文本、超长文本被拒绝。
- `SessionOutcomeValue` 拒绝 `unreported`。
- `session_reported` 只接受三种非 ready outcome；`ready` 被拒绝。
- `TaskStatusEvent` 带 `cause/attention` 可 parse；不带也可 parse。
- `TaskDetailResponse.waitingSince` 为 `Timestamp | null`。

### 8.2 Core

- 9 状态 × 14 事件矩阵更新；新增转移与守卫。
- `running + blocked/dropped/unreported` 分别得到 `waiting_input` 与对应 `waitingReason`。
- `waiting_input + enqueue` 仅在 `stalled` 下回到 `queued`。
- `waiting_input + user_input` 在 `approval`/`null` 下返回 `invalid_transition`，在 `question/dropped` 下返回 `running` + `sendToSession` + `appendUserReply`。
- `attentionFor` 覆盖五种 attention；`stalled → needs_attention`。
- 所有成功转移仍以 `emitTaskStatus` 结尾；`sendToSession` / `appendUserReply` 在它之前。
- effects 快照更新。

### 8.3 Daemon

- fake `finish` 默认 ready：happy path 不变，仍到 `review`。
- fake `pause: blocked`：任务 `waiting_input(question)`，session 仍 `waiting_input` 且 run 活跃；`session.reply` 后任务与 session 都回 `running`，再 `ready` → verify → review；`task.prompt` 追加 `<user_reply>`。
- fake `pause: dropped`：任务 `waiting_input(dropped)`；`session.reply` 可继续，`cancel` 可结束。
- fake 不发 outcome：任务 `waiting_input(stalled)`，session `ended/unreported`，不是 `failed`；`stalled` 可通过 `enqueue` 重新排队，且不占并发槽。
- `RUN_ERROR`：任务 `failed`，session `failed`。
- 流自然结束且任务 `running`：`waiting_input(stalled)`；任务 `waiting_input`：`failed`。
- `session.reply` 在审批等待、终态、无活跃 run 下分别返回正确错误码；`send` 失败时清理 active run。
- `task.status` 的 `cause` 带 `sessionId`（审批/会话报告）与 `reviewId`（verify/验收）。
- 重启 `verifying`：review 行存在，`verifyExitCode=124`，输出包含 `daemon restarted`；autopilot 开时进入 `queued`；workspace 缺失也能收敛。
- REST `GET /api/tasks/:id` 返回 `waitingSince`；`GET /api/tasks` 返回 `waitingReason`。
- WS replay 旧 `task.status` 事件仍可解析。

### 8.4 全量

- `pnpm verify`、`pnpm verify:full`、`pnpm pack:check`、`pnpm check:boundaries`、`pnpm check:protocol`、`pnpm format:check` 全绿。
- `git diff main...HEAD -- apps/web` 为空。
- 无 `TODO`/`FIXME`；docs/README 索引更新。

## 9. 风险

| 风险 | 影响 | 对策 |
|---|---|---|
| 适配器忘记发 `session.outcome` | 所有任务进入 `waiting_input(stalled)` | fake 默认发 ready；M1-7 映射测试；contract 明确 |
| `user_input` 与 approval 串线 | 审批等待时用户发文本，适配器状态错乱 | 守卫按 `waitingReason` 拒绝；旧数据按 approval 处理 |
| `session.reply` 在 run 已关闭后调用 | 任务已 running 但消息丢失 | run 的 `send` 抛错 → `error`；测试覆盖 |
| 重启合成 review 被误认为真实 verify | 看板误判 | output 明确 `daemon restarted during verify`；`durationMs=0` |
| 旧事件重放缺 `attention` | 客户端解析失败 | 字段可选；客户端按 status 降级 |
| 新增 `waiting_reason` 与 `outcome` 迁移失败 | 启动失败 | fixture DB 升级测试；列可空 |

## 10. 后续映射

| 后续任务 | 本 slice 留给它的东西 |
|---|---|
| M1-6 web 看板 | `waitingReason`、`attention`、`waitingSince`、7 列投影 |
| M1-7 agent-claude | `SESSION_OUTCOME_EVENT` 映射、`session.reply` 的 SDK `send`、outcome 测试 |
| M2 总管 | 任务状态读取与 `session.reply` 直连边界；Router 只调度不干活 |
| M2 恢复 | `task.retry` / `reopen` 语义；本 slice 不做 |
| M2 通知 | `waitingSince` 作为 30 分钟升级的输入 |

## 11. 自审记录

- **占位符扫描**：无 `TBD`/`TODO`；所有新增字段、转移、错误码都有消费者或测试。
- **内部一致性**：`SessionOutcome` 在实体、CUSTOM 事件、`session_reported` 三处取值一致；`ready` 只走 `completed`，非 ready 只走 `session_reported`。
- **范围检查**：只改 protocol/core/adapters-fake/daemon/docs；web 与真实 Claude 不动。
- **歧义检查**：`waiting_input` 仍是唯一等待状态；审批与用户回复靠 `waitingReason` 区分；`unreported` 与 `failed` 的边界按「流是否正常结束」划分。
- **安全**：`session.reply` 有长度上限、状态守卫与活跃 run 校验；不暴露通用 shell；不记录回复原文到日志。
