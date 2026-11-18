---
spec_topic: m1-claude-adapter
decision_summary: "M1-7a：host-native 直接接入 Claude Agent SDK，含 workspace trust、hooks 可配置、blocked 释放执行槽、baton_report outcome 与关闭 partial 流；Docker 已移除，7b 后置"
design_approved: true
user_approved_at: 2026-11-17T14:08:19+08:00
gates: [user-review-passed]
spec_ref: 2026-11-16-baton-architecture-design.md
---

# M1-7a Claude Agent SDK 适配器与安全基线设计

> 子 spec。回链主架构：`docs/specs/2026-11-16-baton-architecture-design.md`。
> 前置：M1-5a 任务注意力语义、M1-6a 任务控制台（均已合并）。
> 本文只锁定 M1-7a：host-native 真实 Claude + trust/并发/安全基线；7b 明确排除。
> Docker 已从 v1 移除，见 `docs/adr/0003-drop-docker-from-v1.md`。

## 0. 文档信息

- **状态**：设计已确认，待实现。
- **范围**：`packages/adapters` 的 Claude adapter、`packages/protocol` 的最小契约增量、`apps/daemon` 的接线/trust/并发/对账、`apps/web` 的引擎与 trust UX。
- **不在范围**：M1-7b（partial streaming、成本 UI、idle eviction/resume、结构化提问 dialog）、M1-6b、总管、触发器、worktree、多用户、Codex/DSH。
- **文档位置**：spec 落 `docs/specs/`，contract 落 `docs/contracts/`，plan 落 `docs/plans/`。

## 1. 背景

M1-6a 已合并，任务控制台具备看板、详情、审批/回复/验收、可编辑画布与从节点建任务。但当前引擎只有 `agent-fake`：

- `packages/adapters/src/index.ts` 只导出 `FakeAdapter`。
- `apps/daemon/src/runtime/adapter-factory.ts` 对非 `fake` 抛 `unsupported_engine`。
- `apps/daemon/src/runtime/task-service.ts` 建任务时拒绝非 `fake`。
- `apps/web/src/features/canvas/CanvasPanel.tsx` 与 `CreateTaskForm.tsx` 写死 `engine: 'fake'`。

官方 `@anthropic-ai/claude-agent-sdk` 0.3.326 已具备 `query()`、流式输入、`canUseTool`、`resume`、in-process MCP 工具与结构化 `result`，可以覆盖 M1-7 的大部分引擎复杂度。主架构与宪法已锁定：Claude Code 走该 SDK，PTY 仅兜底；SDK 为非 OSI 许可，只作依赖，不 fork、不再分发源码。

同时，二阶分析发现四个必须先处理的系统性问题：

1. `countActiveTasks` 把 `waiting_input` 且 session 活着算作活跃；默认 `maxConcurrency=1` 时，一个提问会占满唯一执行槽。
2. SDK 默认加载 user/project/local settings；project hooks/MCP 可以在 daemon 权限下执行命令。
3. 每个 AG-UI 事件同时写 `ws_event` 与 `event`；开启 partial 会让 token 增量双倍落库。
4. 容器无法可靠复用宿主 Claude Code 登录态/配置；v1 因此移除 Docker，真实引擎只用 host-native。

## 2. 目标与非目标

### 2.1 目标

1. host-native 真实 Claude：本机 `pnpm dev`/`npx` 上完成 `提问 → 回复 → verify → 人工验收`。
2. 引擎边界不泄漏：SDK 类型只出现在 `packages/adapters`；protocol/core 不感知具体引擎。
3. workspace trust：项目 settings 只在显式信任后加载；hooks 默认关、可配置、全局 kill switch。
4. 并发正确：blocked 释放执行槽；独立 `maxLiveSessions` 限制活进程。
5. outcome 确定：`baton_report` 上报 `ready/blocked/dropped`，未上报为 `unreported`。
6. 重启可恢复：丢失的会话进 `waiting_input(stalled)`，可重新 enqueue；不做 resume-on-boot。
7. 事件量可控：7a 关闭 partial，按完整 block 映射；payload 截断。
8. 可测试：CI 用注入的 fake transport，不调用真实 API；本机用 ego-lite 做真实验收。

### 2.2 非目标

- M1-7b：partial streaming、成本/turn UI、idle eviction/resume、`onUserDialog`、会话级 allow。
- M1-6b：连线/上下文多选、group/image/review 节点、`canvas.patch`。
- 总管、外部触发器、worktree、多用户、Codex/DSH、PTY adapter。
- Docker / 容器内 Claude（ADR 0003）。
- 新状态机语义（除 boot 对账所需的最小扩展）。

## 3. 关键决策

| # | 决策 | 结论 | 理由 |
|---|---|---|---|
| D1 | 接入方式 | 直接官方 SDK + 窄 `ClaudeTransport` seam | 宪法已锁定；seam 只用于测试与隔离 SDK 类型，不做多引擎 registry |
| D2 | SDK 入口 | `@anthropic-ai/claude-agent-sdk/core` + `@modelcontextprotocol/sdk`（MIT） | baton 已有 zod 4；`/core` 复用同一 zod，避免双实例；减小 eager load |
| D3 | 版本 | pin 精确版本（实现时取最新 0.3.x），`THIRD_PARTY_NOTICES.md` 记录 | 0.3.x 变化快，禁止 `^` 漂移 |
| D4 | 运行位置 | host-native only；Docker 已移除 | 容器无法可靠复用宿主登录态/配置（ADR 0003） |
| D5 | workspace trust | DB 字段 + 首次打开弹窗 + 可撤销 + 审计；默认不信任 | 项目 settings 是供应链面；必须显式确认 |
| D6 | trust 内容 | 信任后加载 CLAUDE.md/skills/MCP；hooks 由 `projectHooks` 单独控制，默认关 | hooks 可绕过 `canUseTool`；必须单独授权 |
| D7 | 权限权威 | `managedSettings.allowManagedPermissionRulesOnly: true`、`disableBypassPermissionsMode`、路径读写边界 | 项目 allow 规则不能绕过 baton policy；deny-first |
| D8 | 工具面 | 核心编码 + 子代理；Web 需审批；禁 worktree/cron/通知/远程/工作流类 | v1 范围；避免模型产生无法解释的副作用 |
| D9 | outcome | in-process MCP `baton_report(outcome, reason?)`；未上报 → `unreported` | 确定性最高；对应文章「window 每轮报告」 |
| D10 | 流式 | 7a 关闭 `includePartialMessages`；按完整 block 映射 | 避免 `ws_event`/`event` 双写膨胀；先跑通真实任务 |
| D11 | blocked 并发 | 释放执行槽；新增 `maxLiveSessions=5` | 一个提问不能占满全局限流；活进程另有上限 |
| D12 | 重启 | 无 live run 的会话标 failed；任务进 `waiting_input(stalled)`；approval 标 expired | 可解释、可重新 enqueue；不做 resume-on-boot |
| D13 | 审批 | allow-once / deny；并发多审批；不做会话级 allow | 避免审批疲劳导致 bypass；7b 再讨论 |
| D14 | 预算 | `maxTurns=30`、`maxBudgetUsd=2`；`BATON_CLAUDE_MAX_*` 可改 | 防止跑飞；默认值保守 |
| D15 | 默认引擎 | 有登录态信号默认 claude；否则 fake 并标「演示引擎」 | 不把新用户带进 fake 任务；macOS Keychain 允许 `unknown` |
| D16 | 测试 | adapter 用注入 transport；daemon/web 用 fake；本机 ego-lite 真实验收 | CI 不依赖真实 API；真实路径有证据 |

## 4. 协议与数据模型

### 4.1 Workspace trust

`packages/protocol/src/entities/workspace.ts`：

```ts
export const WorkspaceTrust = z.object({
  trusted: z.boolean(),
  projectHooks: z.enum(['off', 'on']),
  trustedAt: Timestamp.nullable(),
})
```

`Workspace` 增加 `trusted: boolean`、`projectHooks: 'off' | 'on'`、`trustedAt: Timestamp | null`。

迁移（drizzle）：

- `workspace.trusted` integer boolean，默认 0。
- `workspace.project_hooks` text，默认 `'off'`。
- `workspace.trusted_at` integer nullable。

新工作区的 `trusted` 恒为 false；trust 只能通过显式接口设置。

### 4.2 Trust API

`packages/protocol/src/api.ts`：

```ts
export const WorkspaceTrustInput = z.object({
  trusted: z.boolean(),
  projectHooks: z.enum(['off', 'on']).optional(),
})
export const WorkspaceTrustResponse = z.object({ workspace: Workspace })
```

REST：`PATCH /api/workspaces/:id/trust`，需认证；更新 trust 字段并写审计。

审计动作：

- `workspace.trust` / `workspace.untrust`
- `workspace.project_hooks_changed`

信任/撤销只影响新会话；运行中的会话保持已加载配置。

### 4.3 Engine availability

`packages/protocol/src/api.ts`：

```ts
export const EngineStatus = z.object({
  engine: Engine,
  status: z.enum(['available', 'unknown', 'unavailable']),
  reason: z.string().optional(),
})
export const EngineListResponse = z.object({ engines: z.array(EngineStatus) })
```

REST：`GET /api/engines`，需认证。daemon 只做轻量探测，不调用真实模型。

### 4.4 StartInput 增量

`packages/protocol/src/adapter.ts`：

```ts
export interface WorkspaceTrustSnapshot {
  projectSettings: boolean
  projectHooks: boolean
}
export interface StartInput {
  // ...existing
  workspaceTrust: WorkspaceTrustSnapshot
}
```

`FakeAdapter` 忽略该字段；测试 fixture 更新。daemon 从 workspace 记录 + 全局 kill switch 计算。

### 4.5 状态机最小扩展

`session_reported` 目前只在 `running` 处理。M1-7a 允许在 `waiting_input` 处理：

- `unreported` → 保持 `waiting_input`，`waitingReason='stalled'`，记录 outcome/reason。
- `blocked/dropped` → 保持 `waiting_input`，更新对应 reason（用于未来重复上报，幂等）。

只改 `packages/core/src/state-machine/transition.ts` 的分支与测试，不新增事件类型。

## 5. Claude adapter

### 5.1 模块

- `packages/adapters/src/claude/transport.ts`：唯一 import SDK 的文件；定义窄接口。
- `packages/adapters/src/claude/adapter.ts`：`ClaudeAdapter implements AgentAdapter`。
- `packages/adapters/src/claude/mapping.ts`：SDK/transport message → AG-UI。
- `packages/adapters/src/claude/outcome.ts`：`baton_report` MCP server + prompt 片段。
- `packages/adapters/src/index.ts`：导出 `ClaudeAdapter` 与类型。
- `packages/adapters/package.json`：加 SDK `/core` 与 `@modelcontextprotocol/sdk` 依赖。

`ClaudeTransport` 最小形态：

```ts
export interface ClaudeTransport {
  events: AsyncIterable<ClaudeEvent>
  send(text: string): Promise<void>
  approve(requestId: string, decision: 'allow' | 'deny', note?: string): Promise<void>
  interrupt(): Promise<void>
  dispose(): Promise<void>
}
export type ClaudeTransportFactory = (input: ClaudeTransportInput) => Promise<ClaudeTransport>
```

`ClaudeAdapter` 构造函数注入 `transportFactory`，默认使用真实 SDK；测试注入 fake。SDK 类型不越过 `transport.ts`。

### 5.2 事件映射

| transport 事件 | AG-UI |
|---|---|
| init（session_id） | `RUN_STARTED`，threadId = session_id |
| text block | `TEXT_MESSAGE_START/CONTENT/END` |
| tool_use block | `TOOL_CALL_START/ARGS/END` |
| tool_result block | `TOOL_CALL_RESULT` |
| approval request | `CUSTOM { name: 'approval.request', value: { requestId, request } }` |
| outcome report | `CUSTOM { name: 'session.outcome', value: { outcome, reason? } }` |
| turn result success | 记录 cost/turns；按 outcome 收尾或保持打开 |
| turn result error | `RUN_ERROR` |
| 子代理消息 | 在 tool call payload 带 `parentToolUseId`；如边界清晰，发 `CUSTOM { name:'subagent.started'|'subagent.finished' }`（不新增 AG-UI 类型） |

7a 不映射 thinking/partial；`includePartialMessages=false`。

### 5.3 审批桥

- `canUseTool` → transport 为每个请求生成唯一 `requestId`，维护 `Map<requestId, deferred>`，并发出 approval request 事件。
- adapter 原样映射为 `CUSTOM { name: 'approval.request' }`；`AgentRun.approve(requestId, ...)` 直接转发给 `transport.approve`。
- 支持并发：多个工具调用可同时 pending；未知/已解析 request 幂等忽略并记日志。
- `options.signal` abort 时 transport 自动 resolve deny。
- allow 返回 `{ behavior: 'allow', updatedInput: input }`；deny 返回 `{ behavior: 'deny', message }`；不返回 `null`（fail-closed）。
- 不设置 `updatedPermissions`，避免静默扩大权限。

### 5.4 Outcome 协议

`createSdkMcpServer({ name: 'baton', tools: [tool('baton_report', ...)] })`：

- 入参：`outcome: 'ready' | 'blocked' | 'dropped'`，`reason?: string`。
- 第一次上报生效；重复上报记日志并忽略。
- 工具名 `mcp__baton__baton_report` 在 `canUseTool` 中按 `mcpServer.source === 'sdk'` 自动 allow，不弹审批。
- systemPrompt 追加：每轮结束前必须调用 `baton_report`；需要用户输入用 `blocked`；完成用 `ready`；判断不该做用 `dropped`；不要在未上报时结束。
- turn result 到达时：
  - `ready` → emit `session.outcome` + `RUN_FINISHED`，关闭 query。
  - `blocked/dropped` → emit `session.outcome`，保持 query 打开，等 `send`。
  - 无上报 → emit `session.outcome { outcome: 'unreported' }` + `RUN_FINISHED`。
- 不要一看到 SDK `result` 就发 `RUN_FINISHED`；`result` 是 turn 结束，不是 session 结束。

### 5.5 send / interrupt / dispose

- `send(text)`：向流式输入队列 push 一条 `SDKUserMessage`；query 已关闭时抛 `session_closed`。
- `interrupt()`：`Query.interrupt()`；pending approvals resolve deny；不立即 abort，让 SDK 走优雅关闭。
- `dispose()`：关闭输入流 → 等待退出 → 超时后 `abortController.abort()`；记录退出码/信号。
- daemon 在任务取消、失败、进程关闭时调用；boot 对账不尝试恢复。

## 6. Trust 与安全

### 6.1 设置矩阵

| 配置 | 不可信 workspace | 可信 workspace |
|---|---|---|
| `settingSources` | `[]` | `['project']` |
| `strictMcpConfig` | `true` | `false` |
| `plugins` | `[]` | `[]`（不额外注入；project settings 内的 plugins 属于 trust 范围，弹窗列出） |
| `disableAllHooks` | `true` | hooks off 或全局关时为 `true`；hooks on 时不设置 |
| `permissionMode` | `default` | `default` |
| `allowDangerouslySkipPermissions` | `false` | `false` |

两种都设置：

- `managedSettings.allowManagedPermissionRulesOnly: true`
- `managedSettings.permissions.disableBypassPermissionsMode: 'disable'`
- `managedSettings.permissions.blockReadsOutsideWorkingDirectories: true`
- `managedSettings.permissions.blockWritesOutsideWorkingDirectories: true`

### 6.2 hooks 的边界

- `projectHooks` 默认 `off`；首次 trust 弹窗提供开关并明确警告。
- 全局 `BATON_CLAUDE_PROJECT_HOOKS=off` 可强制关闭，优先于 workspace 设置。
- hooks 开启时，project 的 `PreToolUse`/`PermissionRequest` 可以在 `canUseTool` 之前放行工具；baton 仍记录审计，但不再保证审批卡是最终闸门。信任弹窗必须写出这一点。
- hooks 关闭时，`managedSettings.disableAllHooks: true` 让 project hooks 不运行；CLAUDE.md/skills/MCP 仍可用。

### 6.3 工具面

允许（由 policy 最终裁决）：

- `Read`、`Grep`、`Glob`、`Edit`、`Write`、`NotebookEdit`
- `Bash`
- `Task` / 子代理
- `WebFetch` / `WebSearch`（需审批）

禁用（`disallowedTools` 或 policy deny）：

- `EnterWorktree`、`ExitWorktree`
- `CronCreate`、`CronDelete`、`CronList`、`ScheduleWakeup`
- `PushNotification`、`RemoteTrigger`
- `Workflow`、`Monitor`、`Projects`、`Artifact`、`ClaudeDesign`
- 其他非 v1 工具由 policy 默认 ask/deny

`baton_report` 自动 allow；未知 MCP server 的工具一律 ask/deny，不因 `mcpServer.name` 前缀放行。

### 6.4 信任弹窗

文案必须包含：

- 将加载：`CLAUDE.md`、项目 skills、项目 `.mcp.json`、project settings 中启用的 plugins。
- 可选：project hooks（默认关；开启后可绕过 baton 审批）。
- 来源：当前 workspace 目录；撤销只影响新会话。
- 操作：信任 / 取消；取消则保持不可信。

### 6.5 审计

- trust/untrust、hooks 变更写 `audit`。
- 自动批准仍按 M1-5 规则写审计。
- 不把 prompt、tool 输出、凭据写入 audit detail。

## 7. 并发与生命周期

### 7.1 执行槽 vs live session

- `countActiveTasks` 只计 `running` 与 `verifying`；不再计 `waiting_input`。
- 新增 `countLiveSessions`：session 状态 `running | waiting_input` 计数。
- `SchedulerRuntime` 增加 `countLiveSessions` 与 `maxLiveSessions`。
- `pump()` 同时满足 `active < maxConcurrency` 与 `live < maxLiveSessions` 才启动。
- 默认 `BATON_MAX_LIVE_SESSIONS=5`；`BATON_MAX_CONCURRENCY` 仍默认 1。

### 7.2 重启对账

`apps/daemon/src/runtime/boot.ts`：

1. 所有 `running/waiting_input` session 标 `failed`。
2. `running` task：`session_reported({ outcome:'unreported', reason:'daemon restarted' })` → `waiting_input(stalled)`。
3. `waiting_input` task：同样事件 → 保持 `waiting_input`，`waitingReason='stalled'`（依赖 4.5 扩展）。
4. `verifying` task：保持现有 `verify_fail(124)` → `review`。
5. pending approvals：标 deny/expired + 审计。

### 7.3 取消

- `task.cancel` → `interrupt()` → `dispose()`。
- dispose 超时（例如 10s）后 abort；日志记录 exit code/signal。
- 不留下孤儿进程；S2 spike 验证。

## 8. 事件、transcript 与存储

- 7a `includePartialMessages=false`；只映射完整 block。
- `event-store` 对 payload 截断：
  - tool args/result 单条上限 16KB。
  - text block 单条上限 64KB。
  - 截断追加 `…[truncated]`，保留长度元数据。
- `GET /api/sessions/:id/events` 分页不变；长会话上限仍 1000/页。
- `ws_event` 仍双写；因为关闭 partial，量级可控。7b 若开流式，必须先改持久化策略。
- cost/usage 只写日志（`total_cost_usd`、`num_turns`）；7b 再做 UI。
- `~/.claude` 的 session 文件只用于引擎 resume；baton DB 是 UI/审计唯一真源。删除/导出/保留策略以 baton DB 为准，文档说明 Claude 自己的历史不受 baton 管理。

## 9. 认证与运行

- host-native：daemon 以当前用户运行，SDK 复用 `~/.claude` 与 macOS Keychain。
- 轻量探测（不花 token）：
  - `ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN` 存在 → `available`。
  - `~/.claude/.credentials.json` 或 `~/.claude` 登录相关文件存在 → `available`。
  - 无信号 → `unknown`（macOS Keychain 场景仍允许尝试）。
  - 明确配置了无效 API key 不在探测阶段判断；运行时失败返回 `engine_auth_failed`。
- `task.create` 不因引擎不可用而失败；`task.enqueue`/start 时检查并返回 `engine_unavailable`。
- UI 默认：`available` 或 `unknown` → claude；`unavailable` → fake 并标「演示引擎」。
- `env`：显式展开 `process.env`，保留 `PATH`/`HOME`；设置 `CLAUDE_AGENT_SDK_CLIENT_APP=baton/<version>`；不覆盖 `CLAUDE_CONFIG_DIR`，除非用户显式设置。
- `systemPrompt`：`{ type:'preset', preset:'claude_code', append: batonProtocol }`。
- 预算：`maxTurns=30`、`maxBudgetUsd=2`；env `BATON_CLAUDE_MAX_TURNS`、`BATON_CLAUDE_MAX_BUDGET_USD`。

## 10. Web UX

- **Trust**：首次打开/创建 workspace 弹窗；默认不信任；header 显示「未信任/已信任」徽标；可撤销；hooks 开关默认关。
- **Engine**：agent 节点创建/建任务表单提供引擎选择；显示 `available/unknown/unavailable` 与原因；fake 标「演示引擎」。
- **审批**：支持多个 approval 卡并发；按 `approvalId` 渲染；allow/deny 只影响对应 request。
- **Transcript**：截断提示；长列表继续虚拟滚动；不新增 partial 动画。
- **样式**：全部使用 `DESIGN.md` token；状态不能只靠颜色，需文字/图标。

## 11. 测试与验收

### 11.0 S2 spike（Slice 0，阻塞 Slice 2）

- `canUseTool` 挂起 10 分钟 → allow/deny；无超时、无残留进程。
- 模型提问后 `send()` 在同一会话继续；若不可行，验证 `resume` 两阶段并回写本 spec。
- `baton_report` 可被调用、不触发审批；未上报 → `unreported`。
- Go/No-Go：任一项失败先改设计，不写生产 adapter。

### 11.1 Adapter

`packages/adapters/test/claude/`：

- text / tool_use / tool_result 映射。
- allow / deny / 并发审批 / signal abort。
- blocked → send → ready；dropped；unreported。
- `baton_report` 自动 allow、重复上报、未上报。
- RUN_ERROR / result error 映射。
- interrupt/dispose 幂等。

### 11.2 Daemon

`apps/daemon/test/`：

- engine allowlist + auth preflight + `engine_unavailable`。
- trust 开/关、hooks 开/关、全局 kill switch。
- `countActiveTasks` 不含 waiting_input；live cap 生效。
- boot 对账：running/waiting_input → stalled；approval expired；verifying 保持。
- payload 截断。
- trust API + 审计。

### 11.3 Web

- trust 弹窗/徽标/撤销。
- 引擎选择与不可用状态。
- 多审批卡并发。
- transcript 截断提示。

### 11.4 E2E

- Playwright：fake 全链路（workspace → node → task → approval → review → approve），CI 不碰真实 API。
- ego-lite：本机 scratch workspace 真实 Claude：提问 → 回复 → verify → 人工验收；截图存 `docs/evidence/2026-11-17-m1-7-claude/`。
- 真实 API 不进 CI；记录本机 SDK 版本与登录方式（不写凭据）。

### 11.5 DoD

- `pnpm verify` / `verify:full` / `pack:check` 全绿。
- CI `verify (22/24)`、`pack-check`、`e2e`、`build` 全绿。
- 真实任务闭环有 ego-lite 证据。
- `THIRD_PARTY_NOTICES.md` 已记录 SDK 与 MCP SDK。
- 无 SDK 类型泄漏到 protocol/core；`check:boundaries` 覆盖。

## 12. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| SDK 0.3.x 变化快 | 适配器返工 | pin 精确版本；transport seam；升级前跑 fixture |
| project hooks/plugins 绕过审批 | 安全边界失效 | hooks 默认关；trust 弹窗明确列出 hooks/plugins；全局 kill switch |
| project MCP 执行命令 | 供应链风险 | 只在可信 workspace 加载；未知 MCP 工具 ask/deny |
| blocked 占用 live 进程 | 内存/进程压力 | `maxLiveSessions=5`；7b 再做 idle eviction/resume |
| 事件量增长 | DB/WS/UI 压力 | 7a 关闭 partial；payload 截断；7b 前先测量 |
| macOS Keychain 无法探测 | 误判不可用 | 使用 `unknown` 状态并允许尝试；运行时错误可解释 |
| 真实 API 不在 CI | 回归盲区 | fixture 覆盖映射；本机 ego-lite 证据 |
| SDK 许可 | 分发合规 | 只作 npm 依赖；Docker 已移除；notices 记录 |

## 13. 实施切片

1. **Slice 0**：本 spec + contract + S2 spike（审批挂起、blocked→reply、`baton_report`）；Go/No-Go。
2. **Slice 1**：并发与对账——`countActiveTasks`/`countLiveSessions`/scheduler/boot + 状态机扩展 + 测试。
3. **Slice 2**：adapter——transport/adapter/mapping/outcome + fixture 测试。
4. **Slice 3**：daemon 接线——engine allowlist、auth/engines API、trust 字段/API/审计、`StartInput.workspaceTrust`。
5. **Slice 4**：web——trust 弹窗/徽标、引擎选择、多审批卡、截断提示。
6. **Slice 5**：真实验收——ego-lite 闭环、Playwright fake 全链路、文档/notices。

估算：5–6 个开发日；S2 spike 阻塞 Slice 2。

## 14. 后续映射

- **M1-7b**：partial streaming + 事件压缩、成本/turn UI、idle eviction/resume、`onUserDialog`、会话级 allow、sandbox。
- **M1-6b**：画布连线/上下文多选、group/image/review、`canvas.patch`。
- **M2**：总管、自动重试、白名单自动批准、定时汇报、移动端只读。
- **Post-v1**：Codex/DSH adapter、Docker/server-mode 重新评估（ADR 0003）。

## 15. 评审记录

- 设计已获用户批准（2026-11-17）。
- 待评审：本 spec 正文。
- S2 spike 作为 plan Task 0 执行；结论写入 `docs/evidence/2026-11-17-m1-7-claude/`；若 No-Go，回到本 spec 更新设计。
