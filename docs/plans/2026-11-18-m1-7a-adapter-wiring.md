---
spec_ref: ../specs/2026-11-17-m1-claude-adapter-design.md
spec_topic: m1-claude-adapter
task_count: 7
estimated_phases: [tests, implementation, verification]
dod: "Engine API + StartInput.workspaceTrust；Claude adapter（transport/mapping/outcome/settings/tools）；daemon 引擎接线与 trust 快照；事件截断；notices/runbook"
depends_on: [2026-11-17-m1-7a-foundation.md]
---

# M1-7a Claude adapter 与 daemon 接线实施计划（Plan C）

> **For agentic workers:** REQUIRED SUB-SKILL: `subagent-driven-development`（推荐）或 `executing-plans`，按 Task 顺序执行。

**Goal:** 把真实 Claude Agent SDK 接到 `AgentAdapter` 边界内，并让 daemon 完成 engine/trust/预算/截断的最小接线；CI 只用注入 transport，不调用真实 API。

**Architecture:** protocol 增量 → adapters（transport/adapter/mapping/outcome）→ daemon（engine/trust/接线/截断）。SDK 类型只出现在 `packages/adapters/src/claude/**`；daemon 通过 `AdapterFactory` 拿到 `AgentAdapter`。

**Tech Stack:** `@anthropic-ai/claude-agent-sdk@0.3.327`、`@modelcontextprotocol/sdk@1.32.2`、zod 4、TypeScript ESM、vitest。

---

## 计划地图

| Plan | 范围 | 状态 |
|---|---|---|
| A. 性能热路径 | SQLite/event-store/session-cache/WS | 已完成（PR #12） |
| B. 契约与并发基座 | trust、状态机、并发、boot | 已完成（PR #13） |
| **C. Claude adapter 与 daemon 接线（本计划）** | engine、adapter、trust、截断 | 已完成（2026-11-18） |
| D. Web UX 与真实验收 | trust 弹窗、引擎选择、ego-lite | 待写；依赖 C |

**Commit strategy:** 每个 Task 提交一次；Task 7 跑全量验证。

---

## Task 1: Protocol 增量（StartInput / Engine DTO）

**Files:**

- Modify: `packages/protocol/src/adapter.ts`
- Modify: `packages/protocol/src/api.ts`
- Test: `packages/protocol/test/adapter.test.ts`（新建或扩展）
- Test: `packages/protocol/test/api.test.ts`

**Interfaces:**

- `WorkspaceTrustSnapshot { projectSettings: boolean; projectHooks: boolean }`
- `StartInput.workspaceTrust`
- `EngineStatus` / `EngineListResponse`

- [ ] **Step 1: 写失败测试**（断言 `StartInput` 类型由 typecheck 覆盖；API schema round-trip）
- [ ] **Step 2: 实现 schema 与字段**
- [ ] **Step 3: 跑 `pnpm --filter @baton/protocol test`**
- [ ] **Step 4: Commit** `feat(protocol): engine 状态与 workspace trust 快照`

---

## Task 2: Claude transport（SDK 边界）

**Files:**

- Create: `packages/adapters/src/claude/transport.ts`
- Create: `packages/adapters/src/claude/meta.ts`
- Modify: `packages/adapters/package.json`（exports 子路径）
- Test: `packages/adapters/test/claude/transport.test.ts`

**Interfaces:**

```ts
export interface ClaudeTransportInput {
  prompt: string
  cwd: string
  workspaceTrust: WorkspaceTrustSnapshot
  projectHooksGlobal: boolean
  systemPromptAppend: string
  maxTurns: number
  maxBudgetUsd: number
}
export type ClaudeEvent = /* init | text | tool_use | tool_result | approval_request | outcome | turn_result | error */
export interface ClaudeTransport {
  events: AsyncIterable<ClaudeEvent>
  send(text: string): Promise<void>
  approve(requestId: string, decision: 'allow' | 'deny', note?: string): Promise<void>
  interrupt(): Promise<void>
  dispose(): Promise<void>
}
export type ClaudeTransportFactory = (input: ClaudeTransportInput) => Promise<ClaudeTransport>
```

- [ ] **Step 1: 写 `buildClaudeOptions` 的矩阵测试**：不可信 `settingSources: []`、`strictMcpConfig: true`、`disableAllHooks: true`；可信 `settingSources: ['project']`、`strictMcpConfig: false`；hooks on 时不设 `disableAllHooks`；两种都设 `allowManagedPermissionRulesOnly`、`disableBypassPermissionsMode`、读写边界；`permissionMode: 'default'`；`includePartialMessages: false`；预算/工具面。
- [ ] **Step 2: 实现 `buildClaudeOptions` 与真实 transport**：
  - `query({ prompt: asyncIterable, options })`；首条 user message 由 adapter 提供的 prompt 组成。
  - `canUseTool`：`mcpServer.source === 'sdk'` 且 `toolName === 'mcp__baton__baton_report'` → allow；其余生成 requestId + deferred + `approval_request` 事件；`signal` abort → deny。
  - `baton_report` in-process MCP 工具；首次上报生效，重复忽略。
  - stream 映射为 `ClaudeEvent`；`result` → `turn_result`，不关闭 query；`if ready` 时关闭。
  - `send` push 用户消息；`interrupt` 调用 `Query.interrupt()` 并 resolve 所有 pending 为 deny；`dispose` 关闭输入 → `Query.close()`（超时后 abort）。
- [ ] **Step 3: 跑 transport 测试**（选项矩阵 + fake SDK query 断言调用顺序）
- [ ] **Step 4: Commit** `feat(adapter): Claude transport 与 SDK 选项矩阵`

---

## Task 3: Mapping / Outcome / ClaudeAdapter

**Files:**

- Create: `packages/adapters/src/claude/mapping.ts`
- Create: `packages/adapters/src/claude/outcome.ts`
- Create: `packages/adapters/src/claude/adapter.ts`
- Create: `packages/adapters/src/claude/index.ts`
- Modify: `packages/adapters/src/index.ts`
- Test: `packages/adapters/test/claude/adapter.test.ts`

**Interfaces:**

- `mapClaudeEvent(event): AgentEvent[]`（text → TEXT_MESSAGE_*；tool_use → TOOL_CALL_*；tool_result → TOOL_CALL_RESULT；approval → CUSTOM；outcome → CUSTOM；turn error → RUN_ERROR）。
- `ClaudeAdapter implements AgentAdapter`，构造注入 `ClaudeTransportFactory`。

- [ ] **Step 1: 写 fixture 测试**：text/tool 映射、并发审批、blocked → send → ready、dropped、unreported、重复 `baton_report`、turn error、关闭后 send/approve 拒绝。
- [ ] **Step 2: 实现 mapping/outcome/adapter 并导出**
- [ ] **Step 3: 跑 `pnpm --filter @baton/adapters test`**
- [ ] **Step 4: Commit** `feat(adapter): ClaudeAdapter 事件映射与 outcome`

---

## Task 4: Daemon engine 可用性与接线

**Files:**

- Create: `apps/daemon/src/runtime/engines.ts`
- Create: `apps/daemon/src/http/engines.ts`
- Modify: `apps/daemon/src/runtime/adapter-factory.ts`（async + 动态加载 claude）
- Modify: `apps/daemon/src/runtime/session-runner.ts`（`await adapters(engine)`）
- Modify: `apps/daemon/src/runtime/task-service.ts`（允许 claude）
- Modify: `apps/daemon/src/app.ts`（注册 `/api/engines`）
- Modify: `apps/daemon/src/http/errors.ts`（`engine_unavailable` 503）
- Test: `apps/daemon/test/engines.test.ts`
- Test: `apps/daemon/test/adapter-factory.test.ts`
- Test: `apps/daemon/test/task-service.test.ts`

**Interfaces:**

- `EngineRegistry { list(): EngineStatus[]; isAvailable(engine): boolean }`；30s 缓存；只做文件/环境探测。
- `AdapterFactory = (engine: Engine) => AgentAdapter | Promise<AgentAdapter>`。

- [ ] **Step 1: 写失败测试**：`GET /api/engines` 返回 claude/fake；fake 永远 available；无 auth 信号 claude `unknown`；`task.create` 允许 claude；enqueue 在不可用时 `engine_unavailable`。
- [ ] **Step 2: 实现 registry/route/factory/task-service**
- [ ] **Step 3: Commit** `feat(daemon): engine 可用性与 Claude 接线`

---

## Task 5: Trust 快照与预算配置

**Files:**

- Modify: `packages/protocol/src/config.ts`（`claudeMaxTurns`/`claudeMaxBudgetUsd`/`claudeProjectHooks`）
- Modify: `apps/daemon/src/config.ts`
- Modify: `apps/daemon/src/runtime/types.ts`（`StartSessionInput.workspaceTrust`）
- Modify: `apps/daemon/src/runtime/effects.ts`（传递快照）
- Modify: `apps/daemon/src/runtime/transition-runner.ts`（计算快照）
- Test: `apps/daemon/test/config.test.ts`
- Test: `apps/daemon/test/session-runner-trust.test.ts`

**Interfaces:**

- `workspaceTrust.projectSettings = workspace.trusted`
- `workspaceTrust.projectHooks = workspace.trusted && workspace.projectHooks === 'on' && config.claudeProjectHooks !== 'off'`
- env：`BATON_CLAUDE_MAX_TURNS=30`、`BATON_CLAUDE_MAX_BUDGET_USD=2`、`BATON_CLAUDE_PROJECT_HOOKS=on|off`（默认 on = 允许 workspace 开关）。

- [ ] **Step 1: 写失败测试**：不可信/可信/hooks 全局关 三种快照；config 默认与覆盖。
- [ ] **Step 2: 实现快照传递与 config**
- [ ] **Step 3: Commit** `feat(daemon): workspace trust 快照与 Claude 预算配置`

---

## Task 6: 事件 payload 截断

**Files:**

- Modify: `apps/daemon/src/db/event-store.ts`
- Test: `apps/daemon/test/event-store.test.ts`

**Interfaces:**

- tool args/result 16KB；text 64KB；截断追加 `…[truncated]` 并保留 `originalBytes` 元数据；只序列化一次。

- [ ] **Step 1: 写失败测试**
- [ ] **Step 2: 实现截断**
- [ ] **Step 3: Commit** `feat(daemon): 会话事件 payload 截断`

---

## Task 7: 文档、notices 与全量验证

**Files:**

- Modify: `THIRD_PARTY_NOTICES.md`
- Modify: `docs/runbooks/local.md`
- Modify: `docs/README.md`（回链）
- Modify: 本计划（执行记录）

- [ ] **Step 1: `pnpm verify` / `pnpm verify:full` / `pnpm pack:check`**
- [ ] **Step 2: 记录 SDK/MCP 版本、测试数量、边界检查结果**
- [ ] **Step 3: Commit** `docs(plan): M1-7a adapter 接线执行记录`

---

## Self-Review

- **Spec coverage**：§4.3 engine、§4.4 StartInput、§5 adapter、§6 trust/安全、§8 截断、§9 认证/预算。
- **Boundary**：SDK import 只在 `packages/adapters/src/claude/**`；daemon 只依赖 `AgentAdapter`。
- **Scope**：不做 web、不做真实 API 测试、不做 7b。

---

## 执行记录（2026-11-18）

分支 `feat/m1-7a-claude-adapter`，基于 `feat/m1-7a-foundation`。

**依赖**

- `@anthropic-ai/claude-agent-sdk@0.3.327`（npm registry 复查仍为最新）
- `@modelcontextprotocol/sdk@1.32.2`

**Commit 序列**

- `feat(protocol)`：`WorkspaceTrustSnapshot`、`StartInput.workspaceTrust`、`EngineStatus` / `EngineListResponse`。
- `feat(adapter)`：`claude/transport.ts`（SDK 边界、选项矩阵、审批桥、`baton_report`）、`mapping.ts`、`outcome.ts`、`adapter.ts`；`index.ts` 只导出 fake/meta，`@baton/adapters/claude` 走子路径按需加载。
- `feat(daemon)`：`/api/engines`（30s 缓存）、动态 adapter factory、`task.create` 允许 claude、`enqueue` 在不可用时返回 `engine_unavailable`、session runner 注入 trust 快照。
- `feat(daemon)`：`BATON_CLAUDE_MAX_TURNS` / `BATON_CLAUDE_MAX_BUDGET_USD` / `BATON_CLAUDE_PROJECT_HOOKS`。
- `feat(daemon)`：事件截断——text 64KB、tool args/result 16KB，`_baton.truncated` + `originalBytes`，单次 event 序列化。

**S2 spike**

- 真实 SDK 可启动并进入事件流；本机 CLI 未登录，返回 `Not logged in · Please run /login`，被正确映射为 `RUN_ERROR`。
- 证据：`docs/evidence/2026-11-17-m1-7-claude/spike.md`。
- 结论：transport/映射 Go；真实 API 闭环需在本机完成 `claude /login` 后才能验收，CI 不依赖。

**验证**

- `pnpm verify`：通过。
- `pnpm verify:full`：通过（e2e 1 passed）。
- `pnpm pack:check`：`pack-check ok`；daemon bundle 含按需加载的 Claude chunk。
- 测试总数 417：protocol 102、adapters 22、core 98、web 68、daemon 127。
