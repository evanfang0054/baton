# Sprint Contract: M1-5a 任务注意力语义

> 关联 spec：`docs/specs/2026-11-17-m1-attention-semantics-design.md`
> 文档位置说明：本仓库 contract 落 `docs/contracts/`，不使用 `docs/agent-harness/contracts/`。

## Outcome（用户视角）

这一轮结束后，我不再把「agent 停下来问我」误当成「任务做完了」。任务卡会明确显示它在等我回答、等我审批，还是等我验收；我可以直接在任务上回复一句继续，而不必回到终端。daemon 重启时，正在验收的任务不会凭空消失，我会看到一条带 `daemon restarted` 说明的验收证据，而不是一个被静默取消的卡片。

## Definition of Done

- [ ] **1. Protocol 枚举**：`packages/protocol` 导出 `SessionOutcome`（`ready|blocked|dropped|unreported`）、`WaitingReason`（`approval|question|stalled|dropped`）、`Attention`（`none|needs_approval|needs_reply|needs_review`），并有合法/非法值测试。
- [ ] **2. 实体增量**：`Task.waitingReason` 与 `Session.outcome` 为可空字段；合法 `null` 与合法枚举值 round-trip，非法值被拒绝。
- [ ] **3. 会话结局事件**：导出 `SESSION_OUTCOME_EVENT='session.outcome'` 与 `SessionOutcomeValue`；`ready/blocked/dropped/unreported` 均可 parse，空 `reason` 被拒绝。
- [ ] **4. 转移事件**：`TaskTransitionEvent` 增加 `session_reported`（只接受 `blocked|dropped|unreported`）与 `user_input`（`text` 1..16384）；`session_reported.ready` 被拒绝。
- [ ] **5. WS 命令**：`ClientMessage` 增加 `session.reply { taskId, text }`；round-trip 通过；空文本与超长文本被拒绝。
- [ ] **6. 服务端事件**：`TaskStatusEvent.payload` 增加可选 `cause` 与 `attention`；带/不带两者都能 parse；旧 `ws_event` fixture 重放不失败。
- [ ] **7. REST DTO**：`TaskDetailResponse` 增加 `waitingSince: Timestamp | null`；`Task` 响应包含 `waitingReason`；schema round-trip 通过。
- [ ] **8. Core 状态机**：9 状态 × 14 事件矩阵更新；`running + session_reported(blocked|dropped|unreported)` 分别得到 `waiting_input` 与 `question|dropped|stalled`。
- [ ] **9. 回复守卫**：`waiting_input + user_input` 在 `waitingReason='approval'` 或 `null` 时返回 `invalid_transition`；在 `question|stalled|dropped` 时返回 `running` + `sendToSession`。
- [ ] **10. attention**：`attentionFor` 覆盖 `approval→needs_approval`、`question/stalled/dropped→needs_reply`、`review→needs_review`、其余 `none`。
- [ ] **11. Effects 顺序**：新增转移的 effects 以 `emitTaskStatus` 结尾；`sendToSession` 在它之前；effects 快照更新。
- [ ] **12. DB migration**：`task.waiting_reason TEXT NULL` 与 `session.outcome TEXT NULL` 可升级旧 fixture DB；旧数据保留；迁移可重复执行。
- [ ] **13. 状态写入口**：`waitingReason` 只由 transition runner 写入；daemon 没有直接 `UPDATE task SET waiting_reason` 的旁路；非法状态组合被测试拒绝。
- [ ] **14. fake 适配器**：默认 `finish` 自动发 `session.outcome { outcome:'ready' }`；新增 `pause` 步骤发出 `blocked|dropped` 并等待 `send`；`finish` 支持 `unreported`；既有 M1-5 脚本测试保持通过。
- [ ] **15. Session runner（ready）**：`ready` 仍 `RUN_FINISHED → completed → verifying`；happy path 端到端测试通过。
- [ ] **16. Session runner（等待）**：`blocked → waiting_input(question)`、`dropped → waiting_input(dropped)`，两者 session 仍 `waiting_input`、`outcome=null`、run 活跃；缺失 outcome → `waiting_input(stalled)`，session `ended/unreported`。
- [ ] **17. 静默停止与崩溃**：`running` 的流正常结束但无 `RUN_FINISHED` → `waiting_input(stalled)`；`blocked/dropped` 的 `waiting_input` 下流结束或 `RUN_ERROR` → `failed`；`RUN_FINISHED` 出现在非 `ready` 后 → `failed`；session `failed` 且 `outcome=null`。
- [ ] **18. `session.reply`**：`blocked/dropped` 的任务可 `session.reply` → 任务与 session 都回 `running`；用户消息写入 transcript 并可 replay；审批等待、终态、`stalled` 无活跃 run 分别返回 `reply_not_allowed`、`reply_not_allowed`、`session_not_active`。
- [ ] **19. 重启收敛**：`verifying` 重启后存在 review 行，`verifyExitCode=124`、输出含 `daemon restarted during verify`；autopilot 关闭时任务 `review`，开启时 `queued`；不再直接 `cancelled`。
- [ ] **20. REST/WS 可观察**：`GET /api/tasks/:id` 的 `waitingSince` 在 `waiting_input/review` 时非空、其余为 `null`；`task.status` 事件带 `cause/attention`；`session.reply` 的 `ack.data` 正确。
- [ ] **21. 全量质量**：`pnpm verify`、`pnpm verify:full`、`pnpm pack:check`、`pnpm check:boundaries`、`pnpm check:protocol`、`pnpm format:check` 全绿；`git diff main...HEAD -- apps/web` 为空；源码无 `TODO`/`FIXME`。
- [ ] **22. 文档**：新 spec/contract/plan 落库并互链；`docs/README.md` 索引更新；不做完整事件溯源的 ADR 落库；架构 spec 完成事实同步（`event.ordinal`、`ws_event`、`approval.request_id`、里程碑、spike 截止）。

## Boundary Conditions

- **Must support**：Node 22 与 24；pnpm 10；TypeScript strict；现有 SQLite 文件可升级；`agent-fake` 默认脚本与自定义脚本；本机 `127.0.0.1` 与 token 模式。
- **Must not break**：M0 health/静态资源/auth；M1-1/M1-2 状态机测试（除明确变更的「流意外结束→failed」）；M1-3/M1-4 core/adapters 测试与快照；M1-5 的 WS/REST/verify/approval 路径；`PolicySchema` 既有字段语义。
- **Dependency**：不新增运行时依赖；fake 适配器只改脚本类型；不引入 GPL/AGPL/Sustainable Use；不 fork Claude SDK。
- **Security**：`session.reply` 有状态守卫与长度上限；回复原文不写 pino 日志；仍不暴露通用 shell；路径 jail 与 verify env 脱敏不变。
- **Performance**：daemon 测试 < 30 秒；单个 fake 等待-回复闭环 < 2 秒；事件流仍逐条持久化，不做额外全量重建。
- **Scope**：只改 `packages/protocol/**`、`packages/core/**`、`packages/adapters/**` 的 fake、`apps/daemon/**`、`docs/**`、migration 与 lockfile；`apps/web` 不动。

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

### Inferential

- 人工对照 spec §5.2 与 `packages/core/src/state-machine/transition.ts`：新增转移、守卫、waitingReason 与 effects 一一对应。
- 人工评审 `apps/daemon/src/runtime/session-runner.ts` 的五条分支：ready / blocked / dropped / unreported / error 的终态与 session 字段一致。
- 人工评审 `session.reply`：审批等待时确实拒绝；回复路径确实调用 `AgentRun.send`，并把用户消息写入 transcript。
- 人工评审重启收敛：`verifying` 任务有 review 证据，输出能让人看懂是 daemon 重启导致。
- 人工评审范围：没有提前实现 web、真实 Claude、总管、触发器、`task.retry/reopen`、`task_event`。

## Negotiation Record

**Round 1 — Generator（初版，10 条）**

1. 加 `SessionOutcome`。
2. 加 `waitingReason`。
3. 加 `session.reply`。
4. 加 `cause/attention`。
5. 重启不丢 verify。
6. fake 支持新结局。
7. 测试覆盖。
8. 不改 web。
9. 文档更新。
10. `pnpm verify` 通过。

**Round 1 — Evaluator（挑战）**

- “加 `SessionOutcome`”不可判定：必须列出四个值、CUSTOM 事件名、与 `completed` 的分工。
- “加 `waitingReason`”不可判定：必须给出四个原因、状态组合、旧数据为 `null` 的保守处理。
- “加 `session.reply`”不可判定：必须给出命令 schema、三个错误码、审批等待时拒绝、活跃 run 校验。
- “重启不丢 verify”不可判定：必须给出 exit code、输出文本、review 行与 autopilot 分支。
- “静默停止”与“崩溃”没有边界：必须明确流正常结束、流抛错、`RUN_ERROR` 三种情况。
- 没有旧事件兼容：必须证明旧 `task.status` 重放仍可 parse。
- 没有范围边界：必须列出不改 web、Claude、task_event、retry/reopen。

**Round 2 — Generator（修订，22 条）**

- 把上述挑战写进 1–22 条；补协议 round-trip、core 矩阵、DB migration、effects 顺序、WS/REST 可观察性。
- 明确 `ready` 走 `completed`，非 ready 走 `session_reported`；`session_reported.ready` 被拒绝。
- 明确 `waiting_input + user_input` 在 `approval` 与 `null` 下都拒绝。
- 明确重启 `verifying` 合成 `verify_fail(124)`，autopilot 开时 `queued`。
- 明确 fake 默认 `finish` 发 ready，保持 M1-5 happy path。
- 明确 `git diff -- apps/web` 为空与文档/ADR 要求。

**Round 2 — Evaluator（再次挑战）**

- `session.reply` 的用户消息如果不落 transcript，replay 会看不到：必须写入 `session.event` 并可重放。
- `session.reply` 如果先 `send` 后转移，可能状态与消息不一致：必须先转移、提交后 `send`，失败再 `error`。
- `waiting_input` 下流结束如果直接 `failed`，会与「停了没说明」冲突：必须区分「running 静默结束」与「waiting_input 下流结束」。
- `Task.waitingReason` 如果可由 daemon 任意写，会破坏状态机唯一写入口：必须只由 transition runner 写。
- 旧 `task.status` 事件没有 `attention`：字段必须可空，并有旧 fixture 测试。
- `verifying` 重启合成 review 可能被误认为真实 verify：输出必须含 `daemon restarted during verify`。

**Round 3 — Generator（最终，22 条）**

- 接受以上挑战：补 transcript 重放、先转移后发送、两种流结束、唯一写入口、旧事件兼容、重启输出标记。
- 明确 `waiting_input` 下流结束 → `failed`，`running` 下静默结束 → `waiting_input(stalled)`。
- 明确 `user_input` 的 effects 顺序为 `sendToSession` 后 `emitTaskStatus`。
- 明确 `TaskStatusEvent.attention` 可选，新事件必带。

**Final consensus**

22 条 DoD，3 轮 generator-evaluator，无剩余挑战。验收以命令退出码、测试矩阵、DB/WS/REST 断言与人工对照 spec 为准。

## Out of Scope（本 contract 不验收）

- `apps/web` 画布、看板、任务详情、回复输入框。
- `agent-claude` / `agent-pty` 与真实引擎 outcome 映射（M1-7）。
- `task.retry` / `task.reopen`、`task_event`、完整事件溯源。
- 总管、`supervisor.send`、外部触发器、通知、移动端、worktree、多窗口聚合。
- 事件流按帧合并、前端虚拟滚动等性能优化。
