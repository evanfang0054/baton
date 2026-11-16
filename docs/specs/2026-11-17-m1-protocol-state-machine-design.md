---
spec_topic: m1-protocol-state-machine
decision_summary: "锁定 M1 领域契约与任务状态机：全局 event.ordinal、官方 AG-UI 类型、六类节点、纯转移 + effects；REST、DB migration、daemon 与 UI 后置"
design_approved: true
user_approved_at: 2026-11-17T03:45:24+08:00
gates: [user-review-passed]
spec_ref: 2026-11-16-baton-architecture-design.md
---

# M1-1/M1-2 协议领域模型与状态机设计

> 子 spec。回链主架构设计：`docs/specs/2026-11-16-baton-architecture-design.md`。
> 关联 contract：`docs/contracts/M1-protocol-state-machine.contract.md`；plan：`docs/plans/2026-11-17-m1-protocol-state-machine.md`。
> 本文只锁定 M1 的第一块可测切片；后续任务按第 8 节映射推进。

## 0. 文档信息

- **状态**：设计已确认，等待实现计划。
- **范围**：`packages/protocol` 的 M1 领域契约 + `packages/core` 的任务状态机。
- **不在范围**：daemon、web、adapters、上下文装配、policy 求值、DB migration、Claude 接入。
- **文档位置说明**：本仓库不使用 `docs/agent-harness/`。spec 落 `docs/specs/`，plan 落 `docs/plans/`，与 M0 的约定一致。`scripts/validate-handoff.sh` 不存在，使用 frontmatter、占位符与链接的手工检查替代。

## 1. 背景

M0 已合入 `main`：daemon 可启动、健康检查、WS 鉴权、SQLite schema、三栏壳、Docker 与 CI 均已就绪。当前缺口：

- `packages/core/src/index.ts` 仍是空导出，状态机没有落点。
- `packages/protocol` 只有 `config`、`health`、`ws` 三个基础契约，没有领域实体、WS 命令/事件、AG-UI 与 policy。
- daemon 的 WS 只处理 ping/pong；web 只是空画布。

M1 的价值验证是“一个真实小任务从框选需求跑到 verify 通过并被人工验收”。这条链路要求所有层共享同一套任务状态和事件契约。先定协议与状态机，可以避免 daemon、web、adapter 各自维护一套状态。

## 2. 目标与非目标

### 2.1 目标

1. 在 `packages/protocol` 定义 M1 需要的领域实体、枚举、节点数据判别联合、状态转移事件、WS 命令/事件子集、`AppError`、`PolicySchema` 和 AG-UI 包装。
2. 在 `packages/core` 实现纯函数任务状态机：`transition(ctx, event) => { status, retryCount, effects }`。
3. 用测试锁定转移表、守卫、effects 序列与非法转移。
4. 为后续 daemon/web/adapter 提供唯一类型真源，避免跨层手写镜像类型。

### 2.2 非目标（本 slice 不做）

- daemon 的 repository、task service、event store、WS 路由、verify 执行器。
- web 的画布节点、看板、验收卡、WS 客户端。
- `packages/adapters` 与 `agent-fake` / `agent-claude`。
- 上下文装配、policy 求值、审批自动放行。
- `event.ordinal` 的 DB migration 与 `BATON_MAX_CONCURRENCY` 的环境变量解析。
- REST DTO、画布 `node.* / edge.* / context.inject` 命令、`canvas.patch`、`notice`。
- `auth` WS 命令：M0 已用连接级 token 鉴权，本 slice 不改。

## 3. 关键决策

| # | 决策 | 结论 | 理由 |
|---|---|---|---|
| D1 | 本 slice 范围 | M1-1 协议 + M1-2 状态机 | 只做协议没有可观察行为；整个 M1 需要拆子 spec；两者合起来是最小可测切片 |
| D2 | 事件重放游标 | `event.ordinal` 全局单调 + `event.seq` 会话内顺序；WS `sinceSeq` 映射全局 ordinal | 单 WS 通道承载多 session，全局游标重连最简单，不会漏事件 |
| D3 | AG-UI 来源 | 官方 `@ag-ui/core@1.0.4`（MIT）；protocol re-export，不手写事件模型 | 避免两套事件模型漂移；主入口 type-only，zod 为可选 peer（^3.25 或 ^4） |
| D4 | 节点类型 | `text / image / file / agent / review / group` 六类 | M1 需求包含分组；group 只做视觉容器，成本可控 |
| D5 | group 语义 | group 有 `label/color/collapsed`，节点通过 `group_id` 归属；group 本身不是内容源，投喂时展开子节点 | 避免空上下文；保留“整组投喂”的合理交互 |
| D6 | 任务创建 | `task.create` 产出 `todo`；`task.enqueue` 转 `queued` | 与 spec 2.5 一致；看板能真实展示待办；为后续排队/审批策略留出位置 |
| D7 | review 打回 | `reject` 不递增 `retry_count`；只有 `verify_fail` 实际重试时递增 | 人工打回和自动重试是两种语义，不能共用一个上限 |
| D8 | 并发上限 | `BATON_MAX_CONCURRENCY`，默认 1；本 slice 只把它作为 `TransitionContext.maxConcurrency` 输入，M1-5 接线 | 并发是运行时容量，不是项目 policy；worktree 默认关，1 可避免两个任务改同一 workspace |
| D9 | migration 时机 | `event.ordinal` 随 M1-5 event store 落 migration | 本 slice 不碰 DB；提前加列没有消费者 |
| D10 | 协议范围 | 领域实体 + WS 命令/事件；REST DTO 后置 | 本 slice 没有 HTTP 消费者；WS/domain 是状态机测试的直接依赖 |
| D11 | 状态机形态 | 纯转移 + effects 列表 | 一张转移表同时表达状态变化与后续动作；core 保持纯函数，daemon 只执行 effects |
| D12 | 终态与异常 | `done/failed/cancelled` 终态；`error` 可从 `running/waiting_input` 到 `failed`；verify 执行器异常按 `verify_fail` 处理；`cancel` 可从 `review` 进入 `cancelled` | 覆盖引擎阻塞死亡、验收执行失败与人工取消三个真实边界，同时保留验收证据 |

## 4. 协议模型

### 4.1 通用类型

```ts
type Id = string            // z.string().min(1)
type Timestamp = number     // epoch ms，z.number().int().nonnegative()

interface DiffStat {
  filesChanged: number
  insertions: number
  deletions: number
}

interface Viewport {
  x: number
  y: number
  zoom: number // 协议层要求 > 0；0 缩放无意义
}
```

### 4.2 枚举

```ts
type TaskStatus =
  | 'todo' | 'queued' | 'running' | 'waiting_input'
  | 'verifying' | 'review' | 'done' | 'failed' | 'cancelled'

type NodeType = 'text' | 'image' | 'file' | 'agent' | 'review' | 'group'
type EdgeType = 'context'
type SessionStatus = 'running' | 'waiting_input' | 'ended' | 'failed'
type ApprovalDecision = 'allow' | 'deny'
type RiskLevel = 'low' | 'medium' | 'high'
type ReviewVerdict = 'approved' | 'rejected'
type Engine = 'claude-sdk' | 'pty' | 'fake'
type WorkspaceMode = 'main' | 'worktree'
```

### 4.3 实体

| 实体 | 字段 |
|---|---|
| `Workspace` | `id, name, relPath, createdAt` |
| `Canvas` | `id, workspaceId, viewport { x, y, zoom }` |
| `Node` | 公共字段 `id, canvasId, type, x, y, w, h, groupId, createdAt, updatedAt`，`data` 按 `type` 判别 |
| `Edge` | `id, canvasId, sourceId, targetId, type: 'context'` |
| `Task` | `id, workspaceId, nodeId, title, prompt, status, engine, workspaceMode, branch, worktreePath, verifyCommand, retryCount, createdAt, updatedAt` |
| `Session` | `id, taskId, adapter, engineSessionId, status, startedAt, endedAt` |
| `Event` | `id, sessionId, ordinal, seq, type, payload, ts` |
| `Approval` | `id, sessionId, request, decision, decidedBy, decidedAt` |
| `Review` | `id, taskId, verdict, verifyExitCode, verifyOutput, diffStat, decidedAt` |
| `Audit` | `id, ts, actor, action, detail` |
| `Notice` | `id, ts, kind, payload, readAt` |

**Node 数据判别联合**：

| `type` | `data` |
|---|---|
| `text` | `{ content: string }` |
| `image` | `{ src: string, alt?: string }` |
| `file` | `{ path: string, name: string, mime?: string }` |
| `agent` | `{ title: string, engine: Engine, taskId: Id \| null }` |
| `review` | `{ taskId: Id }` |
| `group` | `{ label: string, color?: string, collapsed: boolean }` |

约束：

- `Node.w` 默认 320，`Node.h` 默认 200；`groupId` 可为 `null`。
- `Task.nodeId` 可为 `null`（为总管后续派活预留），但 `TaskCreateInput.nodeId` 必填。
- `Task.engine` 使用 `Engine`；M1 实际使用 `fake` 与 `claude-sdk`。
- `Session.endedAt`、`Approval.decidedAt`、`Review.decidedAt` 可为 `null`。
- `Approval.decision` / `Approval.decidedBy` 在待审批时为 `null`，决定后写入。
- `Review.verifyExitCode` / `verifyOutput` / `diffStat` 必填：review 行只在 verify 执行后创建；`Review.verdict` / `decidedAt` 在人工决定前为 `null`。
- `Review.verdict` 表示**人的决定**，取值 `approved | rejected | null`；verify 是否通过由 `verifyExitCode` 表达。不得把机器结果写进 `verdict`。
- `Approval.request` 使用通用结构 `{ toolName, input: unknown, risk: RiskLevel, reason?: string }`；适配器负责把引擎的授权请求映射到该结构。

**事件游标语义**：

- `Event.ordinal`：全局单调递增，用于 WS 断线重放；`WsEnvelope.seq` 与 `resume.sinceSeq` 都映射它。
- `Event.seq`：同一 session 内单调递增，用于引擎事件顺序；不参与跨 session 重放。
- `Event.type` 存 AG-UI 事件类型字符串；`payload` 存完整 AG-UI 事件对象。
- DB 的 `event.ordinal` 列与唯一索引在 M1-5 随 migration 增加；本 slice 只定义协议。

### 4.4 状态转移事件

`TaskTransitionEvent` 是**领域事件**，不是 AG-UI 事件：

```ts
type TaskTransitionEvent =
  | { type: 'enqueue' }
  | { type: 'start' }
  | { type: 'approval_requested'; approvalId: Id }
  | { type: 'approval_allow'; approvalId: Id }
  | { type: 'approval_deny'; approvalId: Id; note?: string }
  | { type: 'completed' }
  | { type: 'verify_ok'; reviewId: Id; exitCode: 0; output: string; diffStat: DiffStat }
  | { type: 'verify_fail'; reviewId: Id; exitCode: number; output: string; diffStat: DiffStat }
  | { type: 'approve'; reviewId: Id }
  | { type: 'reject'; reviewId: Id; feedback: string }
  | { type: 'cancel'; reason?: string }
  | { type: 'error'; message: string }
```

约束：

- `verify_ok.exitCode` 固定为 0；`verify_fail.exitCode` 必须非 0。
- `reject.feedback` 必填且非空。
- `approval_deny.note` 可选，但一旦提供必须非空。

### 4.5 WS 客户端命令

统一信封沿用 M0 的 `{ v: 1, id, ts, type, payload }`；命令的 `id` 必填，用于 `ack`。本 slice 只定义以下 6 个命令：

| 命令 | payload |
|---|---|
| `resume` | `{ sinceSeq?: number }` |
| `task.create` | `{ workspaceId, nodeId, title, prompt, contextNodeIds, engine, workspaceMode?, verifyCommand? }` |
| `task.enqueue` | `{ taskId }` |
| `task.cancel` | `{ taskId, reason? }` |
| `approval.decide` | `{ approvalId, decision: 'allow' \| 'deny', note? }` |
| `review.decide` | `{ reviewId, decision: 'approve', feedback?: never }` 或 `{ reviewId, decision: 'reject', feedback: string }` |

说明：

- `ping` / `pong` 保留 M0 行为。
- `task.create.contextNodeIds` 是用户框选的节点 id；daemon 在 M1-3 装配上下文后写入 `Task.prompt`。
- `task.create.workspaceMode` 默认 `main`；worktree 在 M3 才启用。
- `task.cancel` 可以从任意非终态发起；`reason` 进入事件与审计。
- 画布命令 `node.create/update/delete`、`edge.create/delete`、`context.inject` 与 `supervisor.send` 留给 M1-6/M2。

### 4.6 WS 服务端事件

| 事件 | payload |
|---|---|
| `ack` | `{ commandId: string, ok: true }` |
| `error` | `{ commandId?: string, code: string, message: string, details?: unknown }` |
| `task.status` | `{ taskId, status, previousStatus, retryCount, updatedAt }` |
| `session.event` | `{ sessionId, event: AgentEvent }` |
| `approval.request` | `{ approvalId, sessionId, request: ApprovalRequest }` |
| `verify.result` | `{ taskId, reviewId, exitCode, output, diffStat, durationMs }` |

说明：

- 服务端事件的 `WsEnvelope.seq` 使用全局 `ordinal`；客户端用 `resume { sinceSeq }` 重放 `ordinal > sinceSeq` 的事件。
- `task.status` 在每次成功状态转移后发送；daemon 不得绕过状态机自行发送状态变更。
- `session.event` 承载 AG-UI 事件；`approval.request` / `verify.result` 是 UI 友好的领域事件，可以从 AG-UI `CUSTOM` 事件派生，但不得替代状态机。
- `canvas.patch`、`notice` 后置。

### 4.7 AG-UI

- 依赖 `@ag-ui/core@1.0.4`（MIT），从 `@ag-ui/core` re-export `EventType` 等类型，从 `@ag-ui/core/schemas` re-export `EventSchemas`。
- `AgentEvent` 直接使用官方 schema/类型的推导结果；如果 `EventSchemas` 不是单个 union schema，`packages/protocol/src/agui.ts` 做一层薄包装，仍然不手写事件类型。
- `session.event` 的 `event` 字段使用 `AgentEvent`。
- AG-UI `CUSTOM` 事件的 name 约定：`approval.request`、`task.status`、`verify.result`。
- 不引入第二套 Agent 事件模型；适配器只做“引擎事件 → AG-UI”的映射。

### 4.8 PolicySchema

`PolicySchema` 对应项目内 `.baton/policy.json`，本 slice 只定义形状，不求值。

```json
{
  "verify": {
    "command": "pnpm verify",
    "timeoutSec": 900,
    "maxOutputBytes": 262144
  },
  "approval": {
    "default": "ask",
    "allow": [
      "Read", "Grep", "Glob",
      "Edit:src/**", "Edit:tests/**",
      "Bash:pnpm (test|lint|typecheck|build|install --frozen-lockfile)"
    ],
    "deny": [
      "Bash:sudo *", "Bash:rm -rf *", "Bash:curl * | sh", "Bash:git push *",
      "Edit:**/.env*", "Edit:.git/**"
    ],
    "autoApproveMaxRisk": "low"
  },
  "autopilot": {
    "enabled": false,
    "retryMax": 2,
    "digestCron": "0 9,21 * * *"
  }
}
```

默认值：`verify.timeoutSec=900`、`verify.maxOutputBytes=262144`、`approval.default='ask'`、`approval.autoApproveMaxRisk='low'`、`autopilot.enabled=false`、`autopilot.retryMax=2`、`autopilot.digestCron='0 9,21 * * *'`。`verify.command` 可省略，由 M1-3 的解析器按“任务级 > policy > package.json > pnpm test”回退。

### 4.9 AppError

```ts
interface AppError {
  code: string
  message: string
  details?: unknown
}
```

本 slice 使用以下 code：`invalid_transition`、`guard_failed`、`invalid_payload`、`not_found`、`conflict`、`unauthorized`、`internal`。协议层用 `z.string().min(1)`，不锁死枚举，避免后续新增错误码时破坏兼容。

## 5. 状态机

### 5.1 API

```ts
export interface TransitionContext {
  readonly status: TaskStatus
  readonly retryCount: number
  readonly runningCount: number
  readonly maxConcurrency: number
  readonly autopilot: { readonly enabled: boolean; readonly retryMax: number }
}

export type TaskEffect =
  | { type: 'emitTaskStatus'; status: TaskStatus }
  | { type: 'enqueueTask' }
  | { type: 'startSession' }
  | { type: 'requestApproval'; approvalId: string }
  | { type: 'resolveApproval'; approvalId: string; decision: 'allow' | 'deny'; note?: string }
  | { type: 'runVerify' }
  | { type: 'persistVerifyResult'; reviewId: string; exitCode: number; output: string; diffStat: DiffStat }
  | { type: 'persistReviewVerdict'; reviewId: string; verdict: 'approved' | 'rejected' }
  | { type: 'appendFeedback'; feedback: string }
  | { type: 'incrementRetry' }
  | { type: 'interruptSession'; reason?: string }

export type TransitionResult =
  | { ok: true; status: TaskStatus; retryCount: number; effects: TaskEffect[] }
  | { ok: false; error: AppError }

export function transition(ctx: TransitionContext, event: TaskTransitionEvent): TransitionResult
```

`transition` 是纯函数：不读写文件、不访问 DB、不发 WS、不修改入参。所有副作用由 daemon 解释 `effects` 执行。

### 5.2 转移表

| From | Event | Guard | To | Effects（`emitTaskStatus` 统一追加） |
|---|---|---|---|---|
| `todo` | `enqueue` | — | `queued` | `enqueueTask` |
| `queued` | `start` | `runningCount < maxConcurrency` | `running` | `startSession` |
| `running` | `approval_requested` | — | `waiting_input` | `requestApproval` |
| `waiting_input` | `approval_allow` | — | `running` | `resolveApproval(allow)` |
| `waiting_input` | `approval_deny` | — | `running` | `resolveApproval(deny, note)` |
| `running` | `completed` | — | `verifying` | `runVerify` |
| `verifying` | `verify_ok` | `exitCode === 0` | `review` | `persistVerifyResult` |
| `verifying` | `verify_fail` | `autopilot.enabled && retryCount < autopilot.retryMax` | `queued` | `persistVerifyResult` + `incrementRetry` + `appendFeedback` + `enqueueTask` |
| `verifying` | `verify_fail` | 否则 | `review` | `persistVerifyResult` |
| `review` | `approve` | — | `done` | `persistReviewVerdict(approved)` |
| `review` | `reject` | — | `queued` | `persistReviewVerdict(rejected)` + `appendFeedback` + `enqueueTask` |
| 任意非终态 | `cancel` | — | `cancelled` | 会话活跃时 `interruptSession` |
| `running` / `waiting_input` | `error` | — | `failed` | `interruptSession` |

### 5.3 守卫与边界

- `verify_fail` 的重试守卫是**分支**，不是错误：autopilot 关或达到 `retryMax` 时正常进入 `review`，不返回 `guard_failed`。
- `retryCount` 只在 `verify_fail` 实际重试时递增；`reject` 不递增。
- `start` 的并发守卫失败返回 `ok: false, code: 'guard_failed'`，task 保持 `queued`，由调度器等槽位释放后重试。
- `error` 允许从 `running` 和 `waiting_input` 进入 `failed`；`verifying` 的 verify 执行器自身异常由 daemon 合成为 `verify_fail`（非 0 退出码 + 错误摘要），进入正常的验收/重试分支，避免丢失验收证据。
- `cancel` 从 `review` 进入 `cancelled` 时保留 review 记录，不删除证据。
- `interruptSession` 只在 `running` / `waiting_input` 出现；`verifying` 的 agent session 已结束，取消 verify 子进程由 M1-5 的 verify executor 负责。
- `interruptSession` 的消费者必须同时关闭该 session 的 pending approvals；M1-5 实现。
- 终态 `done/failed/cancelled` 不接受任何转移；失败后重试需要创建新 task。
- 每个成功转移都恰好追加一条 `emitTaskStatus`；daemon 不再重复广播状态。
- 失败转移不产生任何 effects，只返回 `AppError`。

### 5.4 非法转移

非法转移返回：

```ts
{
  ok: false,
  error: {
    code: 'invalid_transition',
    message: `cannot apply ${event.type} from ${ctx.status}`,
    details: { from: ctx.status, event: event.type }
  }
}
```

`start` 守卫失败返回 `code: 'guard_failed'`，`details` 包含 `runningCount` 与 `maxConcurrency`。

## 6. 测试与验收

### 6.1 Protocol 测试

- 每个实体 schema：合法 fixture 解析成功；缺字段/错类型解析失败。
- 六类节点 union：`type` 与 `data` 正确窄化；错配被拒绝。
- WS 命令/事件：6 个命令、6 个事件 round-trip；`review.decide` 的 approve/reject 判别分支。
- `TaskTransitionEvent`：12 个事件 round-trip；`verify_ok` 强制 0、`verify_fail` 强制非 0、`reject.feedback` 非空。
- `PolicySchema`：空对象得到默认值；非法 risk/负 retryMax 被拒绝。
- AG-UI：用一个真实 `TEXT_MESSAGE_CONTENT` fixture 通过官方 `EventSchemas` 校验。
- `Event`：`ordinal` 与 `seq` 同时存在且为非负整数。

### 6.2 Core 测试

- 表驱动矩阵：9 个状态 × 全部事件类型，覆盖合法/非法转移。
- 四条关键流程的 effects 快照：happy path、approval request/allow/deny、verify_fail 自动重试与不重试、error from waiting_input、reject。
- 守卫测试：并发满、autopilot 开关、`retryMax` 边界（0/1/2）、终态 cancel、非法 event。
- 终态测试：`done/failed/cancelled` 的任意事件都返回 `invalid_transition`。
- `cancel` 在 `todo` 与 `running` 下 effects 不同：前者无 `interruptSession`，后者有。

### 6.3 依赖与配置

- `packages/protocol/package.json` 增加 `@ag-ui/core@^1.0.4`。
- `packages/core/package.json` 增加 `vitest` 与 `@vitest/coverage-v8@^5.1.0`，并增加 `test` script。
- `packages/core/vitest.config.ts` 设置覆盖率阈值 80%（lines/functions/branches/statements），只统计 `src/**`。
- `THIRD_PARTY_NOTICES.md` 已列 `@ag-ui/core`；若加入 `@vitest/coverage-v8`，补一行开发依赖声明。
- 不新增运行时依赖；`packages/core` 只依赖 `@baton/protocol` 与 TypeScript。

### 6.4 Definition of Done

- [ ] `pnpm verify` 退出码 0，包含 protocol 与 core 的测试。
- [ ] `pnpm check:boundaries` 与 `pnpm check:protocol` 通过；core 不 import `node:*` 或 `apps/*`。
- [ ] `packages/core` 覆盖率 ≥ 80%。
- [ ] 状态转移表覆盖 spec 2.5 的全部转移；非法转移有结构化错误测试。
- [ ] `@ag-ui/core` 依赖与 `THIRD_PARTY_NOTICES.md` 一致。
- [ ] 本 slice 不修改 daemon、web、adapters 的源代码。
- [ ] 设计文档与后续 plan 已落库；GitHub Issue 按 `area:protocol` / `area:core` 创建并链接本文。

## 7. 依赖与许可

| 组件 | 版本 | 许可 | 用途 | 处理 |
|---|---|---|---|---|
| `@ag-ui/core` | `^1.0.4` | MIT | AG-UI 事件类型与校验 | 运行时依赖；已在 `THIRD_PARTY_NOTICES.md` |
| `@vitest/coverage-v8` | `^5.1.0` | MIT | core 覆盖率 | 开发依赖；补 notices |
| `zod` | `^4.6.7` | MIT | schema | 已有 |
| `vitest` | `^5.1.0` | MIT | 测试 | 已有；core 新增 |

不引入 `tldraw`、Monaco、GPL/AGPL/Sustainable Use 依赖；不 fork Claude Agent SDK。

## 8. 后续任务映射

| 后续任务 | 本 slice 留给它的东西 |
|---|---|
| M1-3 上下文装配 + policy | `PolicySchema`、`TaskTransitionEvent`、`Node`/`Edge` 实体；装配器消费 `contextNodeIds` |
| M1-4 adapters + agent-fake | `AgentAdapter` 接口、AG-UI `AgentEvent`、`approval.request` 形状 |
| M1-5 daemon task runner + event store | `event.ordinal` migration、`BATON_MAX_CONCURRENCY` 解析、REST DTO、`task.status`/`session.event`/`approval.request`/`verify.result` 的广播 |
| M1-6 web 画布/看板/验收卡 | 六类节点、`WsCommand` 子集、`task.status` 投影、`review.decide` |
| M1-7 agent-claude | `approval.decide`、`resume`、`TaskTransitionEvent` 的 approval/error/verify 分支 |

## 9. 风险

| 风险 | 影响 | 对策 |
|---|---|---|
| `@ag-ui/core` 的 `EventSchemas` 导出形态与预期不符 | `agui.ts` 需要调整 | 装包后先写一个最小 parse 测试；必要时做薄包装，不手写事件类型 |
| `seq` 与 `ordinal` 语义混淆 | 重放漏事件或顺序错乱 | 在协议注释、spec、daemon 实现中统一：`ordinal` 全局，`seq` 仅 session 内 |
| `PolicySchema` 本 slice 只定义不求值，后续实现可能二次定义 | 契约漂移 | M1-3 必须直接消费 `PolicySchema`，禁止另写一份 |
| effects 词汇在 M1-5 膨胀 | core 与 daemon 耦合变重 | 只添加有真实消费者的 effect；新增 effect 必须同时加测试与 spec 更新 |
| `Review.verdict` 被误用为 verify 结果 | UI/统计口径错误 | spec 与类型注释写死：verify 看 `verifyExitCode`，`verdict` 只表示人的决定 |

## 10. 自审记录

- **占位符扫描**：无 `TBD`、`TODO`、未完成的占位段落；后续任务均在第 8 节明确映射。
- **内部一致性**：范围（第 2 节）、协议模型（第 4 节）、转移表（第 5.2 节）、测试（第 6 节）使用同一组枚举与字段；`Review.verdict` 在实体、状态机、风险三处语义一致。
- **范围检查**：本 slice 只改 `packages/protocol`、`packages/core`、测试、docs 与 notices；daemon/web/adapters 不在范围。
- **歧义检查**：`sinceSeq` 明确为全局 `ordinal`；`verify_fail` 的重试是分支而非 guard failure；`error` 的来源明确为 `running/waiting_input`；`cancel` 在 `review` 允许。
- **结构校验替代**：仓库不存在 `docs/agent-harness/index.md` 与 `scripts/validate-handoff.sh`；已按项目约定使用 `docs/specs/`，并手工检查 frontmatter 五个必需字段、链接与占位符。该替代方式与 M0 的处理一致。
