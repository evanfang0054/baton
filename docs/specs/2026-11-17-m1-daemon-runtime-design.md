---
spec_topic: m1-daemon-runtime
decision_summary: "M1-5：daemon 运行时闭环——event store/ordinal、task runner、agent-fake 接线、approval、verify executor、WS/REST；web 与 agent-claude 留给 M1-6/M1-7"
design_approved: true
user_approved_at: 2026-11-17T09:15:01+08:00
gates: [user-review-passed]
spec_ref: 2026-11-16-baton-architecture-design.md
---

# M1-5 daemon 运行时闭环设计

> 子 spec。回链主架构：`docs/specs/2026-11-16-baton-architecture-design.md`。
> 前置：`docs/specs/2026-11-17-m1-protocol-state-machine-design.md`（已合并）、`docs/specs/2026-11-17-m1-context-policy-adapter-design.md`（已合并）。
> 本文只锁定 M1-5：把纯状态机、上下文装配、policy、verify 解析与 `agent-fake` 接进 daemon，跑通一条可重放的完整任务闭环；web、真实 Claude、worktree 不在范围内。

## 0. 文档信息

- **状态**：已实现，已随 PR #5 合并；M1-5a 增量见 `docs/specs/2026-11-17-m1-attention-semantics-design.md`。
- **范围**：`apps/daemon/**`；`packages/protocol` 的 `ack.data`、REST DTO 与 `Config.maxConcurrency`；SQLite migration；`apps/daemon/tsup.config.ts` 的打包配置。
- **不在范围**：`apps/web`、`packages/core` 的行为、`packages/adapters` 的行为、`agent-claude`/`agent-pty`、worktree、总管、画布节点/连线的写接口、自动批准 UI、kill switch 持久化、DSH、向量召回、移动端、外部触发器。
- **文档位置**：spec 落 `docs/specs/`，contract 落 `docs/contracts/`，plan 落 `docs/plans/`。

## 1. 背景

M0 与 M1-1/M1-2/M1-3/M1-4 已合并：

- 协议实体、WS 命令/事件、AG-UI 包装与纯状态机就绪。
- `assembleContext`、`evaluateApproval`、`classifyRisk`、`resolveVerifyCommand` 就绪。
- `AgentAdapter` 契约与可确定性测试的 `agent-fake` 就绪。
- daemon 目前只有 health、静态资源与 ping/pong；DB 表已建立，但 `event` 缺 `ordinal`，没有任何任务运行时。

`baton.ai` 草案的核心闭环是“框选上下文 → 投喂 Agent → 授权 → verify → 人工验收”。M1-3/M1-4 解决了“给引擎什么 prompt、哪些操作可放行、跑哪条 verify”的纯逻辑；M1-5 要把这些逻辑接到 daemon 的 IO 上，让这条闭环第一次真正跑起来。M1-6 再把它变成可见的画布/看板，M1-7 换成真实 Claude。

## 2. 目标与非目标

### 2.1 目标

1. **持久化与游标**：新增 `ws_event` 全局重放日志；`event` 增加全局 `ordinal`；修 `approval.request_id` 与 `review.verdict` 的 schema 漂移；提供 fixture DB 升级测试。
2. **事件存储**：全局 ordinal 单写者、session 内 `seq`、`resume { sinceSeq }` 重放、事件先落库再广播。
3. **任务运行时**：`task.create` 装配上下文并落库；`task.enqueue` 入队；`task.cancel`；`review.decide`；`approval.decide`；所有状态变更只经 `packages/core` 的 `transition()`。
4. **调度**：`BATON_MAX_CONCURRENCY` 上限；按 `queued` 创建顺序启动；`running`/`waiting_input`/`verifying` 都占用执行槽。
5. **适配器接线**：`agent-fake` 启动、事件消费、session 生命周期、`RUN_FINISHED` → `verifying`、`RUN_ERROR` → `failed`、取消/中断。
6. **审批**：policy 求值；`ask` 进入 `waiting_input` 并广播 `approval.request`；自动 allow/deny 写审计并直接回传引擎；人工决定写 approval 行与审计。
7. **验收执行器**：解析 verify 命令；`execa` 执行；超时杀进程组；输出头尾截断；环境变量脱敏；`git diff --stat` 统计；写 `review` 与 `verify.result`；失败按 autopilot 重试或进入 review。
8. **WS 路由**：6 个命令的 dispatch；`ack`/`error`；`resume` 重放；慢客户端保护。
9. **REST 读取面**：workspace 列表/创建、canvas、tasks 列表/详情；`/api/*` 统一鉴权；统一错误形状。
10. **重启收敛**：daemon 重启后把失去进程的 `running`/`waiting_input`/`verifying` 任务收敛到明确终态，避免僵尸任务。
11. **测试与文档**：单元 + `agent-fake` 集成 + WS/REST 契约测试；spec/contract/plan 互链。

### 2.2 非目标（本切片不做）

- `apps/web` 的任何改动；画布渲染、看板、验收卡、总管对话。
- `node.create/update/delete`、`edge.create/delete`、`context.inject`、`supervisor.send`（M1-6/M2）。
- `agent-claude` / `agent-pty`、S2 spike、真实引擎事件映射（M1-7）。
- worktree 模式（M3）；`workspaceMode='worktree'` 在 M1-5 直接拒绝。
- 自动批准 UI、kill switch 持久化、自动重试 UI、定时汇报（M2）。
- DSH、向量召回、移动端、GitHub/飞书触发器。
- 事件流按帧合并、前端虚拟滚动等性能优化；M1-5 先保证正确性与可重放。

## 3. 关键决策

| # | 决策 | 结论 | 理由 |
|---|---|---|---|
| D1 | 全局重放日志 | 新增 `ws_event` 表，`ordinal INTEGER PRIMARY KEY AUTOINCREMENT`；所有可重放的 WS 服务端消息先写它，再广播；`session.event` 同时写 `event` 明细，`event.ordinal` 复用同一个 ordinal | `event` 是 AG-UI session 明细，装不下 `task.status`/`approval.request`/`verify.result`；让 `event.sessionId` 可空会把领域事件混进 transcript。`ws_event` 是单一重放源，语义清晰 |
| D2 | 执行槽语义 | `TransitionContext.runningCount` 传入的是 `running + waiting_input + verifying` 的任务数，不只 `running` | worktree 默认关，`verifying` 仍在同一 workspace 跑命令；把它算作占用槽，避免两个任务同时改/验同一目录 |
| D3 | effect 执行模型 | 两阶段：一个 DB 事务内写 task 状态/retry/关联行 + 按 effect 顺序写 `ws_event`；提交后先广播，再执行异步动作（startSession/runVerify/interrupt/kick） | 保证“状态已落库但事件丢失”不会发生；异步动作不占用事务；`emitTaskStatus` 永远是最后一个 effect |
| D4 | 审批映射 | `approval` 表新增 `request_id` 列；adapter 的 `requestId` 落库，内存只保留 `approvalId → { run, requestId }` 的活跃映射 | 协议 `Approval` 实体不变；重启后活跃 run 不存在，审批自然过期，不需要恢复 requestId |
| D5 | 自动批准 | 复用 `evaluateApproval`；`allow` 仅自动放行并写 audit，不广播 pending 事件；`deny` 写 audit 并回传引擎；`ask` 才进入 `waiting_input` 并广播 | 自动批准默认关闭（`autopilot.enabled=false`）；M1 不增加自动批准 UI，先把审计与判定接通 |
| D6 | verify 执行 | `resolveVerifyCommand` 只解析；执行器负责 `execa`、超时、进程组、输出截断、env 脱敏与 diff；解析失败/启动失败都进入 review 证据 | 与主 spec 2.9 一致；“命令不可用”也是需要人看见的验收结果，而不是静默失败 |
| D7 | REST 范围 | 只做读取面 + workspace 创建；节点/连线写接口留给 M1-6 | M1-5 的验收通过 WS 驱动；M1-6 需要读 DTO，但不应该把画布交互塞进运行时切片 |
| D8 | 重启收敛 | `running/waiting_input` → `error` → `failed`；`verifying` → `cancel` → `cancelled`；活跃 session 标 `failed`；pending approval 标 `deny/system` 并写 audit | 不新增状态转移事件；复用现有 `error`/`cancel` 分支；避免重启后任务永远卡住 |
| D9 | 协议增量 | `AckEvent.payload.data` 可选；新增 REST DTO schema；`ConfigSchema` 增加 `maxConcurrency` 默认 1 | `task.create` 需要把 `taskId` 回给客户端；`resume` 需要回游标；这些都是 M1-1 明确留给 M1-5 的 `ack.data` |
| D10 | 打包与依赖 | `tsup` 的 `noExternal` 改为 `/^@baton\//`；`@baton/core`/`@baton/adapters` 作为 daemon 的 workspace devDependency；运行时新增 `execa`、`pino` | 内部包不发布，必须打进 CLI；`execa` 负责 verify，`pino` 负责结构化日志与脱敏 |
| D11 | 日志 | 运行时/verify/WS 用 pino；只记录 id、状态、耗时、退出码；不记录 prompt、事件 payload、环境变量 | 满足脱敏红线；M1-5 是第一次有真实执行日志的切片 |

## 4. 数据模型与迁移

### 4.1 `event` 增加全局游标

`event` 最终形状：

```sql
CREATE TABLE event (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES session(id),
  ordinal INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE UNIQUE INDEX event_session_seq_idx ON event(session_id, seq);
CREATE UNIQUE INDEX event_ordinal_idx ON event(ordinal);
```

- `ordinal` 由 `ws_event` 的插入结果提供，保证与 WS 投递顺序一致。
- `seq` 是 session 内序号，由 session runner 单写者递增。
- SQLite 不能直接去掉已有列的 `NOT NULL` 或加 `NOT NULL` 列；迁移用标准 table rebuild（`CREATE event_new` → `INSERT ... SELECT` → `DROP` → `RENAME`），保留旧数据。
- 旧数据没有 `ordinal` 时用 `ROW_NUMBER() OVER (ORDER BY ts, id)` 回填。

### 4.2 `ws_event` 全局重放日志

```sql
CREATE TABLE ws_event (
  ordinal INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX ws_event_ts_idx ON ws_event(ts);
```

- 只存可重放事件：`task.status`、`session.event`、`approval.request`、`verify.result`。
- `ack`/`error` 不落库、不重放。
- `resume` 只读这张表：`WHERE ordinal > ? ORDER BY ordinal ASC`。
- `payload_json` 存服务端事件的 `payload`，`type` 存 `ServerMessage['type']`；重放时重建 `{ v: 1, id, type, ts, seq: ordinal, payload }`。
- 单次 `resume` 最多重放 5000 条；超出时先重放到 5000 条，`ack.data.hasMore=true`，客户端用最后一个 `ordinal` 再次 `resume`。

### 4.3 `approval` 增加 `request_id`

```sql
ALTER TABLE approval ADD COLUMN request_id TEXT;
CREATE INDEX approval_session_request_idx ON approval(session_id, request_id);
```

- 新写入的 approval 行必须带 `request_id`；旧行允许为 `NULL`。
- `request_json` 仍只存协议 `ApprovalRequest`，不混入 adapter 字段。

### 4.4 `review.verdict` 允许为空

协议 `Review.verdict` 是 `approved | rejected | null`，但 M0 的 DB schema 是 `NOT NULL`。M1-5 修这个漂移：

```sql
-- table rebuild
CREATE TABLE review_new (
  id TEXT PRIMARY KEY NOT NULL,
  task_id TEXT NOT NULL REFERENCES task(id),
  verdict TEXT,
  verify_exit_code INTEGER,
  verify_output TEXT,
  diff_stat_json TEXT,
  decided_at INTEGER
);
INSERT INTO review_new SELECT id, task_id, verdict, verify_exit_code, verify_output, diff_stat_json, decided_at FROM review;
DROP TABLE review;
ALTER TABLE review_new RENAME TO review;
```

- `review` 行只在 verify 执行后创建；`verifyExitCode`/`verifyOutput`/`diffStat` 在 M1-5 写入时必填，DB 列保持可空是为了兼容旧数据与未来迁移。
- 读取时若 verify 字段为空，视为没有 review；REST 的 `review` 返回 `null`，不把半成品行交给 `Review.parse`。
- `verdict` 只在人工决定后写入，机器结果看 `verifyExitCode`。

### 4.5 索引与迁移策略

- 新增索引：`event_ordinal_idx`、`approval_session_request_idx`、`ws_event_ts_idx`。
- 旧索引 `event_session_seq_idx`、`task_status_idx`、`node_canvas_idx`、`audit_ts_idx`、`workspace_rel_path_unique` 保留。
- migration 用 `drizzle-kit generate` 生成；涉及 table rebuild 的部分手工修正 SQL，并在 fixture DB（旧 schema + 数据）上跑升级测试。
- 迁移脚本只使用 SQL，不 import 应用代码。

## 5. 运行时设计

### 5.1 组件与依赖方向

```text
apps/daemon
├── bootstrap/start        # open DB → migrate → reconcile → buildApp → listen → runtime.start
├── config                 # host/port/token/dataDir/workspacesRoot/maxConcurrency
├── log                    # pino + redact
├── workspace              # resolveWithin / readWorkspaceText
├── policy                 # loadPolicy(.baton/policy.json)
├── db
│   ├── schema             # ws_event / event.ordinal / approval.request_id / review nullable
│   ├── event-store        # ordinal 分配、session event 落库、resume 查询
│   └── repositories       # task/session/approval/review/canvas/node 读写
├── runtime
│   ├── task-service       # create/enqueue/cancel/review/approval + applyTransition
│   ├── effects            # 两阶段 effect executor
│   ├── scheduler          # pump / maxConcurrency
│   ├── session-runner     # adapter 事件循环 + 审批 + 结束
│   └── boot               # 重启收敛
├── verify
│   ├── executor           # execa + 超时 + 进程组 + diff
│   ├── output             # 头尾截断
│   └── env                # 环境变量脱敏
├── ws
│   ├── hub                # socket 集合、broadcast、backpressure
│   └── router             # ClientMessage dispatch
└── http
    ├── api-auth           # /api/* 鉴权（health 除外）
    ├── workspaces         # GET/POST
    ├── canvas             # GET
    ├── tasks              # GET list/detail
    └── errors             # AppError → HTTP 状态码
```

约束：

- `packages/core` 保持纯函数；daemon 只消费 `transition()`、`assembleContext()`、`evaluateApproval()`、`resolveVerifyCommand()`，不复制领域规则。
- 适配器只通过 `AgentAdapter` 调用；daemon 不感知 fake 的内部脚本。
- 所有 DB 写在事务内；事件先落库再广播。
- 所有路径操作经 `resolveWithin`；verify 只执行项目配置里的命令，不暴露通用 shell。

### 5.2 命令流

#### `task.create`

1. zod 校验 `TaskCreateInput`。
2. 校验 workspace 存在；`resolveWithin(workspacesRoot, workspace.relPath)` 得到 `workspacePath`。
3. `workspaceMode` 只允许 `main`；`worktree` 返回 `unsupported`。
4. `engine` 只允许 `fake`；`claude-sdk`/`pty` 返回 `unsupported_engine`。
5. 读取 canvas 的 nodes/edges；校验 `nodeId` 是 `agent` 节点且属于该 canvas；校验 `contextNodeIds` 都存在。
6. `loadPolicy(workspacePath)`；非法 policy 返回 `invalid_policy`。
7. 构建 `contentByNodeId`：只预读 `file` 节点，敏感路径在读取前跳过；二进制/超限文件置 `null`。
8. `assembleContext({ taskPrompt: prompt, targetNodeId: nodeId, selectedNodeIds: contextNodeIds, nodes, edges, contentByNodeId })`。
9. 插入 `task` 行：`status='todo'`、`prompt=assembleContext.prompt`、`verifyCommand=input.verifyCommand ?? null`、`retryCount=0`。
10. 返回 `ack`，`data={ taskId }`；不广播 `task.status`（创建不是状态转移）。

#### `task.enqueue`

1. 读取 task；`transition()` 从 `todo` → `queued`。
2. 两阶段执行；`enqueueTask` effect 在提交后 `scheduler.kick()`。
3. `ack.data = { taskId, status, retryCount }`。

#### `task.cancel`

1. 读取 task；`transition()` 处理 `cancel`。
2. 若当前状态是 `running`/`waiting_input`，`interruptSession` effect 会结束 session 并调用 `run.interrupt()`。
3. 若当前状态是 `verifying`，状态机不产生 `interruptSession`；router 在提交后调用 `verifyRunner.cancel(taskId)`。
4. `review`/`queued`/`todo` 直接取消；终态返回 `invalid_transition`。

#### `approval.decide`

1. 读取 approval；必须存在且 `decision IS NULL`，否则 `approval_expired`。
2. 读取 task；必须处于 `waiting_input`。
3. `transition()` 处理 `approval_allow`/`approval_deny`。
4. `resolveApproval` effect：DB 写 `decision/decided_by='user'/decided_at`；提交后调用 `run.approve(requestId, decision, note)`；session 状态回 `running`。
5. 写 audit `approval.user_allow` / `approval.user_deny`。

#### `review.decide`

1. 读取 review；必须存在且 `verdict IS NULL`；task 必须处于 `review`。
2. `transition()` 处理 `approve`/`reject`。
3. `approve`：`persistReviewVerdict('approved')`，任务 `done`。
4. `reject`：`persistReviewVerdict('rejected')` + `appendFeedback(feedback)` + `enqueueTask()`，任务 `queued`。
5. 写 audit `review.approve` / `review.reject`。

#### `resume`

1. 读取 `sinceSeq`（缺省 0）。
2. 从 `ws_event` 按 `ordinal > sinceSeq` 升序读取，最多 5000 条。
3. 逐条重放；每条 `WsEnvelope.seq = ordinal`。
4. 发送 `ack`，`data={ cursor, hasMore }`：`cursor` 是最后一条重放事件的 `ordinal`；没有重放时是当前最大 `ordinal`。`hasMore=true` 时客户端用该 `cursor` 再次 `resume`。

### 5.3 两阶段 effect 执行

`applyTransition(taskId, event)` 的步骤：

1. **读上下文**：task 行、`previousStatus`、`retryCount`、`runningCount`（D2）、`maxConcurrency`、policy autopilot。
2. **求值**：`transition(ctx, event)`；失败返回 `{ ok: false, error }`，不写任何东西。
3. **DB 事务**：
   - 更新 `task.status`、`task.retry_count`、`task.updated_at`。
   - 按 effects 顺序执行 DB 部分：
     - `requestApproval`：session → `waiting_input`；写 `approval.request` 的 `ws_event`。
     - `resolveApproval`：approval 行写决定；session → `running`。
     - `runVerify`：无 DB 写（异步阶段启动）。
     - `persistVerifyResult`：插入 `review` 行；写 `verify.result` 的 `ws_event`。
     - `persistReviewVerdict`：更新 review 行。
     - `appendFeedback`：在 `task.prompt` 末尾追加 `<feedback>` 块（截断到 16k 字符）。
     - `incrementRetry`：写 audit `task.retry`；retryCount 已由 task 更新写入。
     - `startSession`：插入 `session` 行（`running`），返回 `sessionId`。
     - `interruptSession`：session → `ended`，写 `ended_at`。
     - `enqueueTask`：无 DB 写。
     - `emitTaskStatus`：写 `task.status` 的 `ws_event`（必须是最后一个 ws_event）。
   - 提交事务；任何 DB 错误回滚并返回 `internal`。
4. **广播**：按 effects 顺序发送事务中写入的 `ws_event`。
5. **异步动作**：按顺序执行 `startSession`/`runVerify`/`interruptSession`/`scheduler.kick()`；失败写日志，必要时用 `transition({ type:'error' })` 收敛。
6. **返回**：`{ ok: true, status, retryCount, previousStatus, events, data }`；命令层先发 `ack`，再广播，再跑异步动作。

约束：

- `task.status` 只能由 `applyTransition` 写；仓库层不暴露 `updateTaskStatus`。
- `emitTaskStatus` 必须是 effects 的最后一个；测试用 `effects.at(-1)?.type` 断言。
- 事务内不 `await` 适配器/子进程；所有 IO 放在提交后。
- `ws_event` 的 ordinal 在事务内分配；广播失败不影响已落库的事实，客户端可 `resume`。

### 5.4 调度器

- `maxConcurrency` 来自 `BATON_MAX_CONCURRENCY`，默认 1，正整数；`killSwitch` 来自 `BATON_KILL_SWITCH`。
- `pump()`：
  1. 防重入（`pumping` 标志）。
  2. 查 `runningCount = count(status IN ('running','waiting_input','verifying'))`。
  3. 若 `>= maxConcurrency` 返回。
  4. 取 `queued` 任务，按 `updated_at ASC, id ASC` 排序，取第一个。
  5. `applyTransition(taskId, { type:'start' })`；`guard_failed` 或其他错误时记录该任务并在本轮跳过，继续尝试下一个候选，避免单条坏任务永久占住队首。
  6. 循环直到没有 queued 或达到上限。
- 触发 `pump()` 的时机：`enqueue` 后、`startSession` 完成后、任务进入 `review`/`done`/`failed`/`cancelled` 后、daemon 启动后。
- `start` 守卫失败返回 `guard_failed`，不改变任务状态。

### 5.5 Session runner

1. `applyTransition` 的 `startSession` 异步动作：
   - 读取 task/workspace/policy；构建 `StartInput`：
     ```ts
     {
       prompt: task.prompt,
       cwd: workspacePath,
       permissionMode: 'manual',
       policy,
     }
     ```
   - `adapterFactory(task.engine).start(input)`；拿到 `AgentRun`。
   - 注册 `activeRuns.set(sessionId, { taskId, run, requestIdByApprovalId: new Map() })`。
2. 事件循环：
   - `seq += 1`；`eventStore.appendSessionEvent({ sessionId, seq, event })`：分配全局 ordinal，写 `ws_event`（type `session.event`）与 `event` 明细；提交后广播。
   - `RUN_STARTED`：若 `session.engineSessionId` 为空，写 `threadId`。
   - `CUSTOM` name `approval.request`：
     1. 校验 `value = { requestId, request }`；非法则 `RUN_ERROR` 处理。
     2. 插入 approval 行（`request_id`、`request_json`、pending）。
     3. `evaluateApproval(policy, request, { killSwitch: false })`。
     4. `allow`：approval 行写 `allow/auto/now`；audit `approval.auto_allow`；`run.approve(requestId, 'allow')`；任务保持 `running`。
     5. `deny`：approval 行写 `deny/auto/now`；audit `approval.auto_deny`；`run.approve(requestId, 'deny')`；任务保持 `running`。
     6. `ask`：`applyTransition(taskId, { type:'approval_requested', approvalId })`；`activeRuns` 记录 `approvalId → requestId`；session → `waiting_input`；广播 `approval.request`。若转移失败，approval 行标 `deny/system` 并写 audit `approval.expired`，不让孤儿审批留在 pending。
   - `RUN_FINISHED`：`applyTransition(taskId, { type:'completed' })`；session → `ended`；结束循环。
   - `RUN_ERROR`：`applyTransition(taskId, { type:'error', message })`；session → `failed`；结束循环。
   - 其他事件：只落库/广播。
3. 循环结束：
   - 若 task 仍是 `running`/`waiting_input` 且没有收到 `RUN_FINISHED`/`RUN_ERROR`，`applyTransition(taskId, { type:'error', message:'adapter stream ended unexpectedly' })`。
   - `run.dispose()`；`activeRuns.delete(sessionId)`；session 结束时间写入。
   - 若 task 已 `cancelled`，不再做完成/错误转移；取消后的剩余事件不再落库。
4. `approval.decide` 到达时：
   - `activeRuns` 找 `approvalId → { run, requestId }`；找不到返回 `approval_expired`。
   - `applyTransition` 的 `resolveApproval` 提交后调用 `run.approve(requestId, decision, note)`。
   - 若 `run.approve` 抛错，`applyTransition(taskId, { type:'error', message })`。
5. `task.cancel` 到达时：
   - `interruptSession` 提交后调用 `run.interrupt()`；忽略已关闭 run 的错误。

### 5.6 审批策略

- `policy` 在 `task.create` 时加载一次，校验失败直接拒绝创建；执行期作为只读快照传给适配器。verify 使用同一份快照；若 daemon 重启，任务已收敛，不会复用旧快照。
- `killSwitch` 固定为 `false`（M2 持久化）；`autopilot.enabled` 默认 `false`。
- 风险取 `max(request.risk, classifyRisk(...))`，由 `evaluateApproval` 内部完成；`high` 永不自动放行。
- 自动决定写 `audit`：`{ actor: 'auto', action: 'approval.auto_allow'|'approval.auto_deny', detail: { approvalId, taskId, risk, matchedRule } }`；不写完整 `input`。
- 人工决定写 `audit`：`{ actor: 'user', action: 'approval.user_allow'|'approval.user_deny', detail: { approvalId, taskId } }`。
- 待审批期间 session 状态 `waiting_input`；决定后回 `running`；任务状态由状态机同步。

### 5.7 Verify 执行器

**命令解析**

- `task.verifyCommand` > `policy.verify.command` > `package.json` 的 `scripts.verify` > `pnpm test`。
- `packageManager` 读取 `package.json` 的 `packageManager` 字段前缀（`pnpm`/`npm`/`yarn`），缺省 `pnpm`。
- `resolveVerifyCommand` 返回 `{ ok:false }` 时，按 verify 失败处理（退出码 127，输出错误消息），仍然创建 review 证据。

**执行**

- `cwd` = workspace 绝对路径（`resolveWithin` 结果）。
- `execa(command, { shell: true, cwd, timeout: timeoutSec * 1000, forceKillAfterDelay: 5000, detached: true, reject: false, maxBuffer: maxOutputBytes * 4 })`。
- 超时/取消时对进程组发 `SIGTERM`，5 秒后 `SIGKILL`：`process.kill(-child.pid, signal)`；只杀自己创建的进程组。
- `env` = `process.env` 删除 `BATON_*`、`ANTHROPIC_API_KEY`、键名匹配 `/token|secret|authorization|api[_-]?key/i` 的项；保留 `PATH`/`HOME`/`SHELL`/`LANG`/`LC_*`/`TMPDIR`。
- 组合 stdout+stderr；保留头 `maxOutputBytes/2` 与尾 `maxOutputBytes/2`，中间插入 `\n…[truncated N bytes]…\n`。
- 记录 `exitCode`（启动失败 127，超时 124）、`durationMs`。
- `diffStat`：`git -C cwd diff --numstat` + `git -C cwd ls-files --others --exclude-standard`；`filesChanged` = tracked changed + untracked；`insertions`/`deletions` 来自 numstat；非 git 仓库返回 `{0,0,0}`。M1 不统计 untracked 文件行数，在 review 输出中注明。
- 结果通过 `applyTransition(taskId, { type:'verify_ok'|'verify_fail', reviewId, exitCode, output, diffStat })` 进入状态机；`persistVerifyResult` 写 review 行；`verify.result` 广播。
- `verify.result` 需要 `durationMs`，但 `TaskTransitionEvent` 没有这个字段；执行器在调用 `applyTransition` 前把 `durationMs` 放进 `verifyMetaByReviewId` 的短生命周期 map，`persistVerifyResult` effect 读取后写入事件，随后删除。
- `verify_ok` 要求退出码 0；`verify_fail` 要求非 0。
- 取消：router 调用 `verifyRunner.cancel(taskId)`，中止子进程；状态机已 `cancelled`，不再写 review。verify 完成回调先读 task 状态，若已 `cancelled` 则丢弃结果，避免 `verify_ok` 从终态被拒绝后污染日志。

### 5.8 WS 路由与重放

- 连接升级时沿用 M0 的 token 校验（query/Bearer/cookie）；无 token 关闭 4401。
- `ping` 先于 `ClientMessage` 处理，返回 `pong`。
- `ClientMessage` 用 zod 判别联合解析；未知类型/字段错误 → `error {code:'invalid_payload', commandId?}`，连接保持。
- 每个成功命令返回 `ack`：
  - `task.create` → `{ taskId }`
  - `task.enqueue`/`task.cancel`/`approval.decide`/`review.decide` → `{ taskId, status, retryCount }`
  - `resume` → `{ cursor, hasMore }`
- 命令失败返回 `error {commandId, code, message, details?}`；`invalid_transition`/`guard_failed` 直接透传 core 的 error。
- `ack`/`error` 不写 `ws_event`。
- 广播：只发给已认证且 `readyState===OPEN` 的 socket；`bufferedAmount > 8MB` 时关闭 1013，让客户端重连后用 `resume` 补齐。
- 重放：见 5.2 `resume`；重放期间不阻塞新命令，但事件顺序按 ordinal。

### 5.9 REST 与鉴权

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 不鉴权 |
| GET | `/api/workspaces` | `{ workspaces: Workspace[] }` |
| POST | `/api/workspaces` | `{ name, relPath }` → `{ workspace, canvas }`；创建默认 canvas |
| GET | `/api/canvas?workspaceId=` | `{ canvas, nodes, edges }` |
| GET | `/api/tasks?workspaceId=&status=` | `{ tasks }` |
| GET | `/api/tasks/:id` | `{ task, sessions, approvals, review }` |

- `/api/*`（除 health）统一 `preHandler`：接受 `Authorization: Bearer <token>`、`baton_token` cookie 或 `?token=`（兼容本地调试）；失败 401 `{code:'unauthorized'}`。
- `POST /api/workspaces`：
  - `relPath` 不能是绝对路径、不能含 `..`、不能是空/`.`；`resolveWithin` 校验目录存在且在 root 内；`realpath` 阻断软链逃逸。
  - 重复 `relPath` → 409 `conflict`。
  - 创建 workspace + 一个 `canvas`（viewport `{x:0,y:0,zoom:1}`），同一事务。
- 错误映射：`invalid_payload`/`unsupported`/`unsupported_engine` → 400；`unauthorized` → 401；`not_found` → 404；`conflict`/`invalid_transition`/`guard_failed` → 409；`internal` → 500。
- REST 响应全部经 zod schema 校验后再发送。

### 5.10 重启收敛

`bootstrap` 在 `buildApp` 前执行一次：

1. `session.status IN ('running','waiting_input')` → `failed`，写 `ended_at`。
2. `task.status IN ('running','waiting_input')` → `applyTransition(taskId, {type:'error', message:'daemon restarted'})`。
3. `task.status = 'verifying'` → `applyTransition(taskId, {type:'cancel', reason:'daemon restarted during verify'})`。
4. 这些 session 的 pending approval → `decision='deny'`, `decided_by='system'`, `decided_at=now`；audit `approval.expired`。
5. `queued` 任务保留；`runtime.start()` 后 `scheduler.pump()`。
6. 收敛失败只记录日志，不阻塞启动；下一次启动会再次尝试。

## 6. 协议增量

### 6.1 `AckEvent.payload.data`

```ts
export const AckEvent = EventBase.extend({
  type: z.literal('ack'),
  seq: z.number().int().nonnegative().optional(),
  payload: z.object({
    commandId: Id,
    ok: z.literal(true),
    data: z.unknown().optional(),
  }),
})
```

- 兼容旧客户端：`data` 可选。
- `data` 的具体形状由 daemon 约定：`task.create` 为 `{taskId}`，`resume` 为 `{cursor,hasMore}`，其余为 `{taskId,status,retryCount}`。

### 6.2 REST DTO

新增 `packages/protocol/src/api.ts`：

```ts
export const WorkspaceCreateInput = z.object({
  name: z.string().min(1),
  relPath: z.string().min(1),
})
export const WorkspaceListResponse = z.object({ workspaces: z.array(Workspace) })
export const WorkspaceCreateResponse = z.object({ workspace: Workspace, canvas: Canvas })
export const CanvasResponse = z.object({
  canvas: Canvas,
  nodes: z.array(Node),
  edges: z.array(Edge),
})
export const TaskListQuery = z.object({
  workspaceId: Id,
  status: TaskStatus.optional(),
})
export const TaskListResponse = z.object({ tasks: z.array(Task) })
export const TaskDetailResponse = z.object({
  task: Task,
  sessions: z.array(Session),
  approvals: z.array(Approval),
  review: Review.nullable(),
})
```

- 类型全部 `z.infer`，不手写镜像类型。
- `packages/protocol/src/index.ts` re-export。

### 6.3 `Config.maxConcurrency`

```ts
export const ConfigSchema = z.object({
  // ...
  maxConcurrency: z.number().int().positive().default(1),
  killSwitch: z.boolean().default(false),
})
```

- `loadConfig` 解析 `BATON_MAX_CONCURRENCY`，非正整数直接启动失败。
- `loadConfig` 解析 `BATON_KILL_SWITCH`（`1`/`true`）；开启时自动批准一律降级为人工审批。
- 测试配置对象需要显式带 `maxConcurrency` / `killSwitch`（`Config` 是输出类型）。

### 6.4 不变的部分

- `TaskTransitionEvent`、`TransitionContext`、`TaskEffect`、`AgentAdapter`、`StartInput`、`AgentRun`、`Policy`、`PolicyDecision` 均不新增字段。
- `session.event` 的 AG-UI 事件形状不变。
- `Task.status` 仍只能经 `transition()` 写。

## 7. 测试与验收

### 7.1 单元与集成测试

- **迁移**：旧 schema + 旧数据 → 升级后 `event.ordinal` 非空唯一、`ws_event` 存在、`approval.request_id` 存在、`review.verdict` 可空；索引集合符合预期。
- **event store**：跨 session 的 ordinal 单调；同一 session 的 seq 单调；`resume` 按 ordinal 升序、过滤正确、5000 条上限与 `hasMore`。
- **workspace resolver**：绝对路径、`..`、prefix collision、软链逃逸、缺失目录、合法子目录。
- **policy loader**：缺失 → 默认；合法 → 解析；非法 JSON/schema → `invalid_policy`。
- **context input**：敏感路径不读取；二进制/超限文件置 `null`；文本文件读取；缺失文件置 `null`。
- **task service**：create 校验、assembled prompt 落库、enqueue、cancel、review decide、approval decide；状态只经 `transition()`；effect 顺序与 `emitTaskStatus` 末尾。
- **scheduler**：maxConcurrency=1；两个 queued 只有一个 running；`verifying` 计入槽；任务 settle 后启动下一个；`guard_failed` 不改变状态。
- **session runner**：FakeAdapter 默认脚本；approval ask/auto allow/auto deny；RUN_FINISHED → verifying；RUN_ERROR → failed；流意外结束 → failed；取消后不再转移；session 状态与 endedAt。
- **verify executor**：成功 0；失败非 0；超时杀进程组；输出头尾截断；env 脱敏；diff stat（含 untracked 文件计数）；非 git 仓库；解析失败 127。
- **WS router**：6 个命令 + ping；ack.data；invalid payload 保持连接；malformed envelope 关闭 4400；未认证 4401；慢客户端 1013。
- **REST**：health 不鉴权；其他接口 401/200；workspace 创建路径校验；canvas/tasks 读取；错误形状与状态码。
- **boot**：running/waiting_input/verifying 收敛；pending approval 过期；queued 保留。
- **端到端**：`task.create → enqueue → running → approval.request → approval.decide(allow) → completed → verify.result → review → review.decide(approve) → done`；断言 DB 行与 WS 事件顺序。
- **失败路径**：approval deny；verify fail 无 autopilot → review；verify fail 有 autopilot → queued → 第二次 running；cancel running/verifying；reject → queued + feedback。
- **重放**：断线后 `resume {sinceSeq}` 收到全部缺失事件，顺序正确、无重复；`ack.data.cursor` 正确。

### 7.2 验收命令

```bash
pnpm verify
pnpm verify:full
pnpm pack:check
pnpm check:boundaries
pnpm check:protocol
pnpm format:check
git diff --name-only main...HEAD -- apps/web   # 必须为空
```

- daemon 测试套件本地 < 30 秒；集成测试用 `agent-fake`，不 mock 状态机/上下文/policy。
- 不引入基于真实网络的测试；verify 用 `node -e` 或临时脚本。
- `pack:check` 验证新增依赖被打进 tarball；`docker:smoke` 在实现完成时手工跑一次并记录。

## 8. 任务拆分建议（8 个 Task，一个 PR）

1. **Protocol 增量**：`ack.data`、REST DTO、`Config.maxConcurrency`、导出与测试。
2. **DB migration + event store**：schema、迁移、ordinal/seq、重放、fixture 升级测试。
3. **Workspace + policy + context input**：路径 jail、policy 加载、文件预读、`task.create` 的纯 IO 准备。
4. **Transition runner + scheduler**：两阶段 effect、状态唯一写入口、并发上限、测试。
5. **Session runner + approval**：适配器工厂、事件循环、审批、重启收敛、测试。
6. **Verify executor**：execa、超时/进程组、输出截断、env、diff、测试。
7. **WS router + REST + 鉴权 + 日志**：命令 dispatch、resume、REST、pino、测试。
8. **端到端验收 + 文档 + 全量校验**：完整闭环、失败路径、重放、并发、`pnpm verify`/`pack:check`/`docker:smoke`。

## 9. 风险

| 风险 | 影响 | 对策 |
|---|---|---|
| `ws_event` 与 `event` 双写不一致 | 重放漏事件/重复 | 同一事务内先写 `ws_event` 拿 ordinal，再写 `event`；`event.ordinal` 唯一索引；测试断言两者一致 |
| effect 两阶段部分失败 | 状态与证据不一致 | DB 阶段全事务；异步动作失败写日志并 `transition(error)`；`emitTaskStatus` 最后写 |
| 重启后僵尸任务 | 看板永远 running | 5.10 收敛；测试覆盖 running/waiting_input/verifying |
| verify 子进程杀不干净 | 资源泄漏/工作区被占用 | `detached: true` + 进程组 kill + 5 秒后 SIGKILL；超时/取消测试 |
| 事件量导致 WS 卡顿 | UI 掉帧 | M1-5 只保证正确性；M1-6 按帧合并/虚拟滚动；慢客户端 1013 重连 |
| `agent-fake` 与真实 Claude 事件差异 | M1-7 返工 | 只依赖 `AgentAdapter`/AG-UI 契约；M1-7 用同一套集成测试跑真实适配器 |
| 路径 jail 漏软链 | 越权读文件 | `resolveWithin` + `realpath` + 测试；敏感路径读取前跳过 |
| REST 鉴权遗漏 | 本机数据暴露 | `/api/*` 统一 preHandler；health 例外；测试 401 |
| `tsup` 未打包内部包 | `npx`/Docker 启动找不到模块 | `noExternal: [/^@baton\//]`；`pack:check` 覆盖 |
| pino 日志泄露 prompt/token | 隐私事故 | 只记录 id/状态/耗时/退出码；redact 配置；测试断言日志不含 token |

## 10. 后续映射

| 后续任务 | 本切片留给它的东西 |
|---|---|
| M1-6 web 画布/看板/验收卡 | REST DTO、WS 命令/事件、`resume`、approval/review 结构、稳定状态投影 |
| M1-7 agent-claude | `AgentAdapter` 接线、session runner、approval 映射、verify 证据链 |
| M2 自动化 | `PolicyDecision`、audit 表、`autopilot` 输入、verify 重试分支 |
| M3 worktree | `workspaceMode` 校验点、session/verify 的 `cwd` 注入点 |
| CI 合规 | `check:secrets` 作为 M1 收口的独立小 PR，不在本切片实现 |

## 11. 自审记录

- **占位符扫描**：无 `TODO`/`TBD`/未完成段落；后续任务均有映射。
- **范围检查**：只改 `apps/daemon`、`packages/protocol` 的增量、docs、notices、lockfile；`apps/web` 与 `packages/core`/`packages/adapters` 行为不变。
- **内部一致性**：`ws_event` 与 `event.ordinal` 语义一致；`runningCount` 在状态机输入与调度器中都按 D2 计算；verify 的 `review` 行与 `Review` 实体一致；`ack.data` 与命令表一致。
- **歧义检查**：`approvalId` 与 adapter `requestId` 分开；`verdict` 只表示人的决定；`verify_fail` 的重试是分支；`resume` 的 `sinceSeq` 是全局 ordinal；`session.event` 的 `seq` 只是 session 内序号。
- **安全**：prompt/事件不写日志；env 脱敏；路径 jail；verify 命令只来自任务/项目配置；不实现通用 shell。
- **结构校验替代**：仓库无 `scripts/validate-handoff.sh`；按项目约定手工检查 frontmatter、链接与占位符。
