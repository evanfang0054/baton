# Sprint Contract: M1-5 daemon 运行时闭环

> 关联 spec：`docs/specs/2026-11-17-m1-daemon-runtime-design.md`
> 文档位置说明：本仓库 contract 落 `docs/contracts/`，不使用 `docs/agent-harness/contracts/`。

## Outcome（用户视角）

这一轮结束后，daemon 不再只是 health + ping：用 `agent-fake` 通过 WS 就能跑通

`task.create → task.enqueue → running → approval.request → approval.decide(allow) → completed → verifying → verify.result → review → review.decide(approve) → done`

断线后能用 `resume { sinceSeq }` 补回所有事件；verify 会真实执行命令并留下退出码、输出与 diff 证据；任务状态只由 `packages/core` 的状态机写。M1-6 可以直接用这批 DTO/事件做画布与看板，M1-7 只需替换适配器。

## Definition of Done

- [x] **1. Protocol `ack.data`**：`AckEvent.payload` 增加可选 `data: unknown`；`task.create` 返回 `{taskId}`、`resume` 返回 `{cursor,hasMore}`、其余命令返回 `{taskId,status,retryCount}`；既有 `ack` 测试仍通过。
- [x] **2. REST DTO 与 config**：`packages/protocol/src/api.ts` 导出 `WorkspaceCreateInput`、`WorkspaceListResponse`、`WorkspaceCreateResponse`、`CanvasResponse`、`TaskListQuery`、`TaskListResponse`、`TaskDetailResponse`，全部 `z.infer`；`ConfigSchema` 增加 `maxConcurrency`（默认 1，正整数）；`loadConfig` 解析 `BATON_MAX_CONCURRENCY`。
- [x] **3. DB migration**：`event.ordinal` 非空且唯一；新增 `ws_event` 表；`approval.request_id` 列 + 索引；`review.verdict` 可空；旧 fixture DB 能升级并保留数据；迁移可重复执行。
- [x] **4. Event store**：跨 session 的 `ordinal` 单调；同一 session 的 `seq` 单调；`session.event` 同事务写 `ws_event` 与 `event`，两者 `ordinal` 相同；`resume` 按 `ordinal > sinceSeq` 升序返回，最多 5000 条并给出 `hasMore`。
- [x] **5. `task.create`**：校验 workspace、agent 节点、`contextNodeIds`；`workspaceMode='worktree'` 返回 `unsupported`；`engine != 'fake'` 返回 `unsupported_engine`；加载 policy；预读 file 节点时敏感路径不读取；`assembleContext` 结果写入 `Task.prompt`；任务初始 `todo`；`ack.data.taskId` 正确。
- [x] **6. `task.enqueue`**：`todo → queued`；重复 enqueue 返回 `invalid_transition`；`enqueueTask` effect 在提交后触发 `scheduler.kick()`；`ack.data` 含新状态与 retryCount。
- [x] **7. 调度器**：`BATON_MAX_CONCURRENCY` 生效；`running + waiting_input + verifying` 计入占用槽；按 `updated_at,id` 启动最早 queued；满槽返回 `guard_failed` 且不改变状态；任务 settle 后自动启动下一个。
- [x] **8. 状态唯一写入口**：daemon 没有绕过 `transition()` 写 `task.status` 的路径；`applyTransition` 的 effects 顺序与 core 一致，`emitTaskStatus` 永远是最后一个；DB 事务失败回滚且不广播。
- [x] **9. Session 生命周期**：`startSession` 创建 session（`running`）；`RUN_STARTED` 写 `engineSessionId`；`RUN_FINISHED → completed → verifying`；`RUN_ERROR → failed`；事件流意外结束 → `failed`；结束时写 `ended_at`，取消后不再做完成/错误转移。
- [x] **10. 审批**：`CUSTOM approval.request` 建 approval 行（含 `request_id`）；policy `ask` → `waiting_input` + `approval.request` 广播；auto `allow`/`deny` 写 approval 行 + audit 并直接 `run.approve`，不进入 `waiting_input`；人工 `approval.decide` 更新 approval 行、回 `running`、调用 `run.approve`；过期审批返回 `approval_expired`。
- [x] **11. Verify 执行器**：`task > policy > package.verify > pnpm test` 解析正确；命令在 workspace 内执行；超时/取消杀进程组；输出保留头尾各 `maxOutputBytes/2`；`env` 剔除 `BATON_*`、`ANTHROPIC_API_KEY` 与敏感键；`diffStat` 统计 tracked 改动与 untracked 文件数；启动失败退出码 127、超时 124。
- [x] **12. Verify 结果流**：`verify_ok` 只在退出码 0 时进入 `review`；`verify_fail` 在 autopilot 关闭或达到 `retryMax` 时进入 `review`，否则 `queued` + retryCount+1 + feedback；`review` 行只在 verify 后创建；`verify.result` 广播包含 `exitCode/output/diffStat/durationMs`。
- [x] **13. WS 命令路由**：`ping` + 6 个 `ClientMessage` 全部可用；成功返回 `ack`；`invalid_payload` 返回 `error` 且连接保持；畸形 JSON/envelope 关闭 4400；未认证关闭 4401；未知命令返回 `error`。
- [x] **14. `resume` 重放**：断线期间产生的 `task.status`/`session.event`/`approval.request`/`verify.result` 全部按 ordinal 重放；`ack.data.cursor` 是最后一条重放的 ordinal（无重放时为当前最大 ordinal）；重复 `resume` 不丢事件；`hasMore` 时客户端可用 `cursor` 继续。
- [x] **15. 广播顺序**：每个可重放事件先写 `ws_event` 再发送；`ack`/`error` 不写重放日志；慢客户端 `bufferedAmount > 8MB` 关闭 1013，重连后可补齐。
- [x] **16. REST 读取面**：`GET /api/health` 不鉴权；`GET/POST /api/workspaces`、`GET /api/canvas`、`GET /api/tasks`、`GET /api/tasks/:id` 可用；`/api/*` 其余接口无 token/cookie 返回 401；响应经 zod schema 校验。
- [x] **17. 路径 jail**：`resolveWithin` 拒绝绝对路径、`..`、prefix collision 与软链逃逸；`POST /api/workspaces` 校验目录存在且真实路径在 root 内；context 文件读取使用同一 resolver，敏感路径读取前跳过。
- [x] **18. 重启收敛**：启动时 `running/waiting_input` 任务经 `error` 转 `failed`，`verifying` 经 `cancel` 转 `cancelled`；活跃 session 标 `failed` 并写 `ended_at`；pending approval 标 `deny/system` 并写 `audit`；`queued` 保留并在 `runtime.start()` 后继续调度。
- [x] **19. 适配器工厂**：`fake` 返回可注入脚本的 `FakeAdapter`；`claude-sdk`/`pty` 返回 `unsupported_engine`；daemon 不 import fake 的内部步骤类型；`packages/adapters` 行为不变。
- [x] **20. 端到端（happy path）**：集成测试从 WS 完成完整闭环，最终 task `done`、review `approved`、session `ended`、approval `allow/user`；事件顺序与 spec 5.2 一致。
- [x] **21. 失败路径**：approval deny；verify fail 无 autopilot → `review`（非 0 退出码）；verify fail 有 autopilot → `queued` 后第二次 `running`；`review.decide(reject)` → `queued` 且 prompt 追加 feedback；`task.cancel` 在 `running` 与 `verifying` 都进入 `cancelled` 且子进程结束。
- [x] **22. 并发**：`maxConcurrency=1` 时两个任务只有一个 `running`；第一个进入 `review` 后第二个启动；`verifying` 期间第三个 queued 不启动；不存在两个活跃 session 指向同一 workspace。
- [x] **23. 安全与日志**：pino 只记录 id/状态/耗时/退出码；日志不含 token、`BATON_*` 值、prompt 或事件 payload 原文；自动审批写 audit；verify 不暴露通用 shell；`BATON_TOKEN` 不出现在 verify env。
- [ ] **24. 构建与依赖**：`execa`、`pino` 加入 daemon 运行时依赖并更新 `THIRD_PARTY_NOTICES.md`；`tsup` 的 `noExternal` 覆盖 `@baton/core`/`@baton/adapters`；`pnpm pack:check` 通过；`docker:smoke` 手工通过并记录。
- [x] **25. 全量质量**：`pnpm verify`、`pnpm verify:full`、`pnpm check:boundaries`、`pnpm check:protocol`、`pnpm format:check` 全绿；daemon 测试 < 30 秒；`git diff main...HEAD -- apps/web` 为空；`docs/README.md` 列出 M1-5 三份文档；源码无 `TODO`/`FIXME`。

## Boundary Conditions

- **Must support**：Node 22 与 24；pnpm 10；TypeScript strict；现有 SQLite 文件可升级；`agent-fake` 默认脚本与自定义脚本；本机 `127.0.0.1` 与 token 模式。
- **Must not break**：M0 的 health/静态资源/auth；M1-1/M1-2 的协议与状态机测试；M1-3/M1-4 的 core/adapters 测试与快照；`PolicySchema` 既有字段语义；`pnpm pack:check`。
- **Dependency**：新增运行时依赖只有 `execa`、`pino`（均 MIT）；不引入 `p-queue`/`simple-git`（M1 不需要）；不引入 GPL/AGPL/Sustainable Use；不 fork Claude SDK。
- **Security**：路径 jail；verify env 脱敏；日志 redact；不执行模型生成命令；token 不落事件/日志；fixture 只用虚构值。
- **Performance**：daemon 测试 < 30 秒；单任务 FakeAdapter 闭环 < 2 秒；verify 超时可控；事件重放 5000 条上限。
- **Scope**：只改 `apps/daemon/**`、`packages/protocol` 的增量、`docs/**`、`THIRD_PARTY_NOTICES.md`、`pnpm-lock.yaml`、`apps/daemon/tsup.config.ts`；`apps/web` 与 `packages/core`/`packages/adapters` 行为不变。

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
pnpm --filter @evanfang0054/baton test
git diff --name-only main...HEAD -- apps/web   # 输出必须为空
```

`pnpm docker:smoke` 手工执行一次，记录镜像构建、启动与 `/api/health` 结果。

### Inferential

- 人工对照 spec 5.2 的命令流与集成测试：create/enqueue/approval/review/resume 顺序一致，没有多写状态。
- 人工评审 `ws_event` 与 `event` 的写入顺序：同一事务、同 ordinal、先落库后广播。
- 人工评审 verify 证据：review 卡所需的退出码、输出尾部、diff 统计齐全；失败时人能看懂。
- 人工评审安全：日志、事件、audit 不含 token/prompt/env 原文；路径 jail 覆盖软链。
- 人工评审范围：M1-6 需要的 DTO/事件都在，但没有提前实现画布写接口、worktree、Claude、supervisor。

## Negotiation Record

**Round 1 — Generator（初版）**

- 目标：daemon 接上 core/adapters，用 fake 跑通闭环；补 DB/WS/REST/verify；文档与测试。
- 初版风险：`ws_event` 与 `event` 双写、verify 子进程、重启恢复、REST 鉴权都没有可判定标准。

**Round 1 — Evaluator（挑战）**

- “事件可重放”不可判定：必须给出 `ws_event` schema、ordinal 分配、`resume` 顺序、5000 条上限与 `hasMore`。
- “状态只经状态机”不可判定：必须给出 `applyTransition` 两阶段、`emitTaskStatus` 末尾、无直接 `updateTaskStatus` 的检查。
- “审批可用”不可判定：必须区分 ask/auto allow/auto deny、requestId 映射、过期审批、审计。
- “verify 可用”不可判定：必须给出超时、进程组、输出截断、env 脱敏、diff 统计、127/124 退出码。
- “重启恢复”不可判定：必须列出 running/waiting_input/verifying 三种收敛与 pending approval 处理。
- “REST 安全”不可判定：必须给出 `/api/*` 鉴权、health 例外、错误映射与路径 jail 测试。
- 缺少 `apps/web` 空 diff 与 `pack:check`/`docker:smoke`。

**Round 2 — Generator（修订，25 条）**

- 把上述挑战写进 1–25 条；补 `ack.data`、`maxConcurrency`、`tsup noExternal`、pino 脱敏、并发与重放测试。
- 明确 `verifying` 计入执行槽；明确 auto 审批不广播 pending 事件；明确 review 行只在 verify 后创建。

**Final consensus**

25 条 DoD，2 轮 generator-evaluator，无剩余挑战。验收以命令退出码、集成测试断言、DB/WS 断言与人工对照 spec 为准。

## 执行记录（2026-11-17）

- 24/25 条已通过；`pnpm verify`、`pnpm verify:full`、`pnpm pack:check`、`pnpm check:boundaries`、`pnpm check:protocol`、`pnpm format:check` 全绿。
- 第 24 条的 `docker:smoke` 未在本机执行：`node:24-bookworm-slim` 基础镜像未缓存，按“不下载大镜像”的约定延后；CI `docker.yml` 已构建镜像并通过（`1043abb`）。
- CI（`1043abb`）：`verify (22)`、`verify (24)`、`pack-check`、`e2e`、`build` 全部通过，PR #5 可合并。
- daemon 81 tests；protocol 72 tests；core 90 tests；adapters 13 tests；`git diff main...HEAD -- apps/web` 为空。

## Out of Scope（本 contract 不验收）

- `apps/web` 画布/看板/验收卡/总管；`node.create/update/delete`、`edge.create/delete`、`context.inject`、`supervisor.send`。
- `agent-claude`/`agent-pty`、S2 spike、真实引擎事件映射。
- worktree、自动批准 UI、kill switch 持久化、定时汇报、DSH、向量召回、移动端、外部触发器。
- `check:secrets` CI（作为 M1 收口的独立小 PR）。
- 事件流按帧合并、前端虚拟滚动等性能优化。
