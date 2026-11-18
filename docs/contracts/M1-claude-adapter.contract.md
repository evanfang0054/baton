# Sprint Contract: M1-7a Claude 适配器与安全基线

> 关联 spec：`docs/specs/2026-11-17-m1-claude-adapter-design.md`
> 文档位置说明：本仓库 contract 落 `docs/contracts/`，不使用 `docs/agent-harness/contracts/`。

## Outcome（用户视角）

我把工作区信任后，从画布上的 Agent 节点建任务、点「立即开工」，真实的 Claude Code 就在本机跑起来：它读代码、改文件、请求授权，我在详情面板里允许或拒绝；它提问时我直接回复；它做完后跑 verify，带着退出码和 diff 回到验收卡，我点通过。整个过程不依赖 fake 引擎，也不需要 Docker；刷新页面后任务状态、transcript、审批与验收记录都还在。一个任务在等我时，不会占住其他任务的执行名额。

## Definition of Done

### 协议与数据

- [ ] **1. Workspace trust 字段**：`Workspace` 增加 `trusted: boolean`、`projectHooks: 'off'|'on'`、`trustedAt: Timestamp|null`；zod round-trip；新工作区默认 `false/off/null`。
- [ ] **2. Trust migration**：drizzle migration 增加三列；旧 fixture DB 可升级；旧数据保留；迁移可重复执行。
- [ ] **3. Trust API**：`PATCH /api/workspaces/:id/trust` 接受 `{ trusted, projectHooks? }`；需认证；更新后返回 workspace；写 `workspace.trust`/`workspace.untrust`/`workspace.project_hooks_changed` 审计；撤销只影响新会话。
- [ ] **4. Engine API**：`GET /api/engines` 返回 `claude-sdk` 与 `fake` 的 `available|unknown|unavailable` + reason；需认证；结果缓存 30s；不调用真实模型。
- [ ] **5. StartInput**：`StartInput.workspaceTrust` 含 `projectSettings` 与 `projectHooks`；fake 忽略；Claude adapter 消费；相关单测更新。

### 状态机与并发

- [ ] **6. `session_reported` 扩展**：`waiting_input` 接受 `unreported` → 保持 `waiting_input` + `stalled`；`blocked/dropped` 更新对应 reason；表驱动测试；不新增事件类型。
- [ ] **7. 执行槽计数**：`countActiveTasks` 只计 `running`/`verifying`；`waiting_input` 不再占执行槽；既有调度测试更新。
- [ ] **8. live session 上限**：新增 `countLiveSessions`（`running|waiting_input`）与 `BATON_MAX_LIVE_SESSIONS=5`；`pump()` 同时检查 `maxConcurrency` 与 `maxLiveSessions`；测试「一个 blocked 任务不阻塞另一个任务」。
- [ ] **9. 重启对账**：所有 `running/waiting_input` session 标 failed；`running` 任务经 `session_reported(unreported)` → `waiting_input(stalled)`；`waiting_input` 任务同样收敛到 stalled；`verifying` 保持 `verify_fail(124) → review`；pending approval 标 deny/expired + 审计；测试覆盖四条路径。
- [ ] **10. 取消与清理**：`task.cancel` → `interrupt()` → `dispose()`；超时 abort；日志记录 exit code/signal；测试使用 fake transport 断言调用顺序；本机 evidence 记录取消后无残留 CLI 进程。

### Adapter

- [ ] **11. 依赖与边界**：`packages/adapters` 精确依赖 `@anthropic-ai/claude-agent-sdk@0.3.327`（实现时再查最新）与 `@modelcontextprotocol/sdk@1.32.2`；SDK import 只出现在 `packages/adapters/src/claude/**`；`check:boundaries` 覆盖。
- [ ] **12. 事件映射**：init → `RUN_STARTED` 且 threadId=session_id；text/tool_use/tool_result → `TEXT_MESSAGE_*`/`TOOL_CALL_*`；`includePartialMessages=false`；未知消息忽略并记 debug；fixture 测试。
- [ ] **13. 审批桥**：transport 生成唯一 requestId + pending Map；支持并发审批；allow/deny 正确解析；`signal` abort → deny；未知/已解析 request 幂等；返回 `null` 被禁止；fixture 测试并发 allow/deny。
- [ ] **14. Outcome**：`baton_report` in-process MCP 工具；`mcpServer.source==='sdk'` 时自动 allow、不弹审批；首次上报生效；未上报 → `unreported`；`blocked/dropped` 保持 query 打开；`ready` → outcome + `RUN_FINISHED`；SDK `result` 不直接映射 `RUN_FINISHED`；测试覆盖 ready/blocked/dropped/unreported/重复上报。
- [ ] **15. send/interrupt/dispose**：`send` push 用户消息；query 已关闭时抛 `session_closed`；`interrupt` resolve pending deny；`dispose` 优雅关闭 + 超时 abort；测试覆盖关闭后 send/approve 拒绝。
- [ ] **16. 设置矩阵**：不可信 `settingSources: []`、`strictMcpConfig: true`、`plugins: []`、`disableAllHooks: true`；可信 `settingSources: ['project']`、`strictMcpConfig: false`、`plugins: []`；hooks 由 `projectHooks` 与全局 `BATON_CLAUDE_PROJECT_HOOKS=off` 决定；两种都设置 `allowManagedPermissionRulesOnly`、`disableBypassPermissionsMode`、路径读写边界；`permissionMode: 'default'`；`allowDangerouslySkipPermissions` 永不开启；transport fixture 断言实际 options。
- [ ] **17. 工具面**：允许核心编码工具 + 子代理；`WebFetch/WebSearch` 走 ask；显式禁用 worktree/cron/notification/remote/workflow/monitor/projects/artifact/ClaudeDesign；未知 MCP 工具 ask/deny；测试覆盖 allow/ask/deny 三类。
- [ ] **18. 预算与错误**：`maxTurns=30`、`maxBudgetUsd=2`；`BATON_CLAUDE_MAX_TURNS`/`BATON_CLAUDE_MAX_BUDGET_USD` 可覆盖；`result` 错误 subtype 映射 `RUN_ERROR`；测试断言 options 与错误映射。

### Daemon 与存储

- [ ] **19. 引擎接线**：`adapter-factory` 动态加载 `claude-sdk`，未安装/不可用时返回 `engine_unavailable`；`task-service` 不再拒绝非 fake；`task.create` 允许建任务，`task.enqueue` 在不可用时给出可操作错误；测试覆盖。
- [ ] **20. 事件存储**：`appendSessionEvent` 只序列化一次；tool result 16KB、text block 64KB 截断并标记；`event`/`ws_event` 同时写入；分页/回放测试保持通过；截断测试覆盖。
- [ ] **21. SQLite 性能**：保留 WAL，补 `synchronous=NORMAL`；旧 DB 可打开；写入/读取测试通过；文档记录断电最多丢最后几条未提交事务的取舍。
- [ ] **22. Web 热路径**：session-cache 顺序 append 快路径（乱序才排序）；`session.event` 轻量解析、控制消息完整校验；32ms 合批保留；5k/20k transcript 全量重建 p95 < 8ms；50k 为边界（mean <8ms，p95 约 8–10ms）；真实会话 >50k 或持续 p95 超预算时才引入增量投影。
- [ ] **23. Web UX**：首次打开/创建 workspace 弹 trust 弹窗（默认不信任、hooks 默认关、列出 CLAUDE.md/skills/MCP/plugins 与 hooks 风险）；header 徽标与撤销；引擎选择与 `available/unknown/unavailable`；fake 标「演示引擎」；多个审批卡并发；截断提示；组件测试。
- [ ] **24. 认证与分发**：host-native 优先复用 `~/.claude`；`ANTHROPIC_API_KEY`/`CLAUDE_CODE_OAUTH_TOKEN` 可选；Docker 保持移除；`docs/runbooks/local.md` 说明启动、token、数据目录、远程反代；`THIRD_PARTY_NOTICES.md` 记录 SDK 0.3.327 与 MCP SDK 1.32.2。

### 质量与验收

- [ ] **25. 自动化质量**：`pnpm verify`、`pnpm verify:full`、`pnpm pack:check`、`pnpm check:boundaries`、`pnpm check:protocol`、`pnpm format:check` 全绿；CI `verify (22/24)`、`pack-check`、`e2e`、`build` 全绿。
- [ ] **26. 真实闭环**：ego-lite 在本机 scratch workspace 完成 `建任务 → 开工 → tool call → approval allow → blocked → reply → ready → verify → review → approve`；刷新后状态/transcript/审批/验收仍在；证据落 `docs/evidence/2026-11-17-m1-7-claude/`。
- [ ] **27. 拒绝路径**：审批 deny 后工具未执行、模型继续或结束；`baton_report` 未上报进 `waiting_input(stalled)`；`task.cancel` 后无残留进程；三条路径有测试或 evidence。
- [ ] **28. 性能 evidence**：10 分钟真实会话记录 event loop lag（p95 < 50ms）、blocked 时 CPU（< 5% 单核）、5 个 live session RSS、DB 增长；5k/20k transcript 全量重建 p95 < 8ms；50k 为边界；若 RSS > 1.5GB，默认 live cap 降到 3 或提前做 idle eviction。
- [ ] **29. 范围与文档**：未实现 Docker/ACP/PTY/触发器/总管/worktree/M1-6b/7b；spec/contract/plan 互链；`docs/README.md` 与架构 spec 回链更新；无 `TODO`/`FIXME`。

## Boundary Conditions

- **Must support**：Node 22 与 24；pnpm 10；TypeScript strict；现有 SQLite 文件可升级；`agent-fake` 既有脚本；本机 `127.0.0.1` 与 token 模式；macOS Keychain 登录态；可选 `ANTHROPIC_API_KEY`。
- **Must not break**：M0 health/静态资源/auth；M1-1~M1-6a 的状态机、daemon、web 测试；`AgentAdapter`/AG-UI 契约；`agent-fake` 默认行为；现有 WS 重放与 session events 分页。
- **Dependency**：只新增 `@anthropic-ai/claude-agent-sdk`（非 OSI，仅依赖）与 `@modelcontextprotocol/sdk`（MIT）；不 fork、不再分发 SDK 源码；不引入 GPL/AGPL/Sustainable Use。
- **Security**：deny-first；不开启 `bypassPermissions`；项目 allow 规则不能绕过 baton；hooks 默认关；未知 MCP ask/deny；日志/事件/截图脱敏；trust 变更写审计。
- **Performance**：不落 partial；事件级日志仅 debug；单次 JSON 序列化；Web 热路径不做全量重排/重复 zod；`maxConcurrency=1` 控 CPU、`maxLiveSessions=5` 控内存。
- **Scope**：`packages/protocol/**`、`packages/core/**`、`packages/adapters/**`、`apps/daemon/**`、`apps/web/**`、`docs/**`、migration 与 lockfile；不做 M1-7b/M1-6b/M2。

## Acceptance Criteria

### Computational

以下命令均以退出码 0 为准：

```bash
pnpm verify
pnpm verify:full
pnpm pack:check
pnpm check:boundaries
pnpm check:protocol
pnpm format:check
```

### Inferential

- 人工对照 spec §4/§6/§7：trust 矩阵、状态机扩展、boot 对账、scheduler 双上限逐条一致。
- 人工评审 adapter：SDK 类型只在 `packages/adapters/src/claude/**`；`result` 不直接 `RUN_FINISHED`；并发审批 Map 正确。
- 人工评审安全：不可信 workspace 不加载 hooks/MCP；可信 workspace 的 hooks 开关与全局 kill switch 生效；未知工具不被前缀放行。
- 人工评审性能：给出 10 分钟真实会话与 5k 事件投影的 evidence；优化前后有对比数据。
- 人工评审范围：没有提前实现 Docker、ACP、PTY、触发器、总管、worktree、M1-6b/7b。

## Negotiation Record

**Round 1 — Generator（初版，12 条）**

1. 接真实 Claude。
2. 加 trust。
3. 加 hooks 开关。
4. blocked 不占槽。
5. 重启可恢复。
6. baton_report。
7. 关闭 partial。
8. 引擎选择。
9. 多审批。
10. 测试。
11. 性能。
12. 文档。

**Round 1 — Evaluator（挑战）**

- “接真实 Claude”不可判定：必须给出事件映射、审批 allow/deny、blocked→reply、ready→verify→review 的完整序列。
- “加 trust”不可判定：必须给出字段、默认值、migration、API、审计、撤销语义。
- “加 hooks 开关”不可判定：必须给出不可信/可信两套 SDK options，以及全局 kill switch 的优先级。
- “blocked 不占槽”不可判定：必须给出 `countActiveTasks`/`countLiveSessions` 的计算口径和「两个任务」的测试。
- “重启可恢复”不可判定：必须给出 running/waiting_input/verifying/pending approval 四条路径的终态。
- “baton_report”不可判定：必须给出工具名、首次上报、未上报、blocked/dropped 保持 query 打开的行为。
- “关闭 partial”不可判定：必须断言 `includePartialMessages=false` 且不产生 partial 事件。
- “性能”不可判定：必须给出测量方法、阈值、evidence 路径，以及不达阈值时的动作。
- “测试”不可判定：必须列出 adapter fixture、daemon 集成、web 组件、Playwright、ego-lite 五层。

**Round 2 — Generator（修订）**

- 把 12 条拆成 29 条可判定项：协议 5 条、状态机/并发 5 条、adapter 8 条、daemon/存储 5 条、web 4 条、质量 5 条（部分合并）。
- 每条都写明触发条件、期望结果、测试层级或 evidence。
- 性能项改为可测量：event loop lag p95、blocked CPU、RSS、5k 投影 p95，并写明超阈值动作。
- trust/hook 项改为可断言：transport fixture 断言实际 SDK options；trust API 断言审计行；撤销断言只影响新会话。
- 把「无残留进程」改为「fake transport 断言调用顺序 + 本机 pgrep evidence」，避免 CI 依赖真实进程。

**Round 2 — Evaluator（复核）**

- 仍有两个模糊点：`engine_unavailable` 的触发时机（create vs enqueue）与「trusted 加载 MCP」的验证方式。
- 修订：明确 `task.create` 允许建任务、`task.enqueue` 返回 `engine_unavailable`；trusted 用 transport fixture 断言 `strictMcpConfig=false`，真实 MCP 加载只在本机 evidence 中验证。

**Final — Evaluator 接受**

- 29 条均可由测试、命令或 evidence 判定；无“应该/正常/可用”这类主观词；范围、边界、性能与安全均有明确约束。

## 备注

- S2 spike（Slice 0）未通过时，本 contract 的 adapter 条目暂缓，先回到 spec 改设计；不把 spike 风险带进实现。
- 真实 API 不进 CI；`pnpm verify:full` 使用 fake/系统 Chrome；真实闭环由 ego-lite evidence 承担。
- 执行期调整（2026-11-17）：baseline 显示 5k 0.64ms、20k 2.24ms、50k 5.43ms、100k 11.76ms；7a 无 partial，50k 内已达标。决定 7a 不做 stateful 增量投影，保留基准；触发条件为真实会话 >50k 事件或 p95 >8ms。
