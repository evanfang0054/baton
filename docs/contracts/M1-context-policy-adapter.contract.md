# Sprint Contract: M1-3 + M1-4 上下文、策略与适配器

> 关联 spec：`docs/specs/2026-11-17-m1-context-policy-adapter-design.md`
> 文档位置说明：本仓库 contract 落 `docs/contracts/`，不使用 `docs/agent-harness/contracts/`。

## Outcome（用户视角）

这一轮结束后，M1-5 的 daemon runner 不需要再猜“prompt 长什么样、哪些工具能自动放行、verify 该跑什么”。它可以直接调用 `assembleContext`、`evaluateApproval`、`resolveVerifyCommand` 三个纯函数，并把 `agent-fake` 接到状态机上；接口、边界和失败语义都有测试证明，daemon 只负责 IO 与持久化，不再二次定义领域规则。

## Definition of Done

- [x] **1. Protocol adapter 导出**：`packages/protocol/src/adapter.ts` 导出 `AgentAdapter`、`StartInput`、`AgentRun`、`PolicySnapshot`；`src/index.ts` re-export；`test/exports.test.ts` 逐个 import 并用 `StartInput` 接收 `Policy`；协议包不新增运行时依赖。
- [x] **2. Policy 默认规则**：`DEFAULT_ALLOW` 中 `Bash:pnpm (test|...)` 改为 `Bash:pnpm {test,lint,typecheck,build,install --frozen-lockfile}`；`DEFAULT_DENY` 与路径规则保持 glob；`PolicySchema.parse({})` 返回精确数组；现有默认值测试更新并通过。
- [x] **3. Context API**：`packages/core/src/context/index.ts` 导出 `assembleContext`、`AssembleContextInput`、`AssembleContextResult`、`isSensitivePath`；纯函数；core 不 import `node:*`；`pnpm check:boundaries` 通过。
- [x] **4. Context 种子与闭包**：显式选择 + 目标 Agent 的直接 `context` 前驱为 depth 0；反向 BFS depth ≤ 2、节点 ≤ 40；去重保留最低 depth；目标 Agent、`review`、`agent` 节点排除；group 只在被显式选中时展开子节点；每条规则有测试。
- [x] **5. Context 排序与确定性**：输出顺序为 `(depth, y, x, id)`；同一输入连续调用两次得到逐字节相同的 `prompt`；快照测试锁定；不依赖 Map 迭代顺序。
- [x] **6. Context 渲染**：`text` 取正文、`file` 取 `contentByNodeId`（无内容只输出 path）、`image` 输出 src/alt；`<task>` + `<context>` + `<node>` 包装；v1 不输出空 `<constraints>`；空内容记 `dropped.reason='empty'`。
- [x] **7. Context 预算与脱敏**：默认 `maxChars=48_000`、`maxNodeChars=16_384`；单节点超限截断并标记 `truncated="true"`；总量超限先丢最深上游（同深度按 `(y,x,id)` 倒序），显式节点最后硬截断；`isSensitivePath` 覆盖 `.env*`、`*.pem`、`*.key`、`id_rsa*`、`id_ed25519*`、`*secret*`；`dropped`/`redactedPaths` 有断言。
- [x] **8. Policy 匹配**：`Tool` 精确匹配；`Tool:pattern` 用 picomatch 匹配 `Bash` 命令、`Edit/Write/Read/Grep/Glob` 路径、其他工具稳定 JSON；`deny > allow > ask`；无命中用 `approval.default`；每类工具至少一个测试。
- [x] **9. 风险分级**：`classifyRisk` 表驱动覆盖 low/medium/high；未知工具为 `high`；`evaluateApproval` 最终风险取 `max(request.risk, computed)`；`high` 永不自动批准。
- [x] **10. 自动批准**：命中 allow + risk ≤ `autoApproveMaxRisk` + `autopilot.enabled` + `killSwitch=false` 才 `autoApproved=true`；否则 `ask`；deny 永远 deny；`reason` 不包含完整敏感输入；四条件与 kill switch 各有测试。
- [x] **11. Verify 解析**：优先级 `task > policy > package.verify > pnpm test`；`package.verify` 生成 `${packageManager} run verify`，默认 `pnpm`；无配置回退 `pnpm test`（source `fallback`）；非法输入返回 `AppError` 且 `code='invalid_payload'`；不修改入参。
- [x] **12. Adapters 包**：新增 `packages/adapters`，`name` 为 `@baton/adapters`，`main/types` 指向 `./src/index.ts`，运行时依赖只有 `@baton/protocol`；`tsconfig.json` 与 core 同构；`test` script 可被 `pnpm -r test` 执行。
- [x] **13. FakeAdapter 契约**：实现 `AgentAdapter`；`name='fake'`；构造参数 `{ script, threadId? }`；默认脚本为 `RUN_STARTED → TEXT_MESSAGE_START/CONTENT/END("fake: working") → CUSTOM approval.request → approve → TEXT_MESSAGE_*("fake: approved") → RUN_FINISHED`；每个事件通过 `EventSchemas`。
- [x] **14. FakeAdapter 控制**：`approve('allow')` 继续；`approve('deny')` 输出 `fake: denied` 后结束；`interrupt` 在有限次迭代内结束；`send` 追加一条文本事件；`dispose` 后不再产生事件；不使用定时器/随机数。
- [x] **15. 消费形态**：新增消费 fixture（`packages/core/test/consumption.test.ts` 或 adapters 等价测试），证明 `assembleContext(...).prompt` 可赋给 `StartInput.prompt`、`Policy` 可赋给 `PolicySnapshot`、`PolicyDecision.decision` 可传给 `AgentRun.approve`、`resolveVerifyCommand` 返回的命令是 `string`；`tsc` 通过。
- [x] **16. 变更边界**：`git diff --name-only main...HEAD -- apps` 为空；不新增 migration；不改 `apps/daemon` / `apps/web` 的源代码。
- [x] **17. 分层**：`packages/core` 只依赖 `@baton/protocol` 与 `picomatch`；`packages/adapters` 只依赖 `@baton/protocol`；core 不 import `node:*` 或 `apps/*`；`pnpm check:boundaries`、`pnpm check:protocol` 通过。
- [x] **18. 全量校验**：`pnpm verify`、`pnpm format:check`、`pnpm check:boundaries`、`pnpm check:protocol`、`pnpm --filter @baton/core test`、`pnpm --filter @baton/adapters test`、`pnpm pack:check` 全部退出码 0。
- [x] **19. 覆盖率**：`packages/core` lines/functions/branches/statements 均 ≥ 80%；context/policy/verify 的新增文件被测试覆盖。
- [x] **20. 依赖与许可**：`picomatch@^4.0.7` 加入 core 运行时依赖并写入 `THIRD_PARTY_NOTICES.md`；协议/adapters 不新增运行时第三方依赖；不引入 GPL/AGPL/Sustainable Use，不 fork Claude SDK。
- [x] **21. 文档与占位**：spec/contract/plan 互相链接；`docs/README.md` 列出新 spec；`packages/{protocol,core,adapters}/src` 无 `TODO`/`FIXME`/空实现。
- [x] **22. 性能与确定性**：core 全量测试本地 < 5 秒；context 快照稳定；fake adapter 事件序列可重复。
- [x] **23. 默认值兼容**：`PolicySchema` 类型与既有字段不变；只改默认字符串；既有 protocol 测试全部通过。
- [x] **24. 错误形状**：`resolveVerifyCommand` 不抛异常；非法输入返回 `{ ok: false, error: { code, message } }`；`evaluateApproval` 对未知工具不抛异常，返回 `high`。
- [x] **25. 无占位实现**：三个 core 函数与 `FakeAdapter` 均为完整实现；所有导出至少被一个测试或消费 fixture 使用。

## Boundary Conditions

- **Must support**：Node 22 与 24；pnpm 10；TypeScript strict；`@ag-ui/core@1.0.4` 既有用法不变。
- **Must not break**：M0 的 daemon/web/CI；M1-1/M1-2 的协议导出、状态机、108 矩阵与测试；现有 `PolicySchema` 字段语义。
- **Dependency**：新增运行时依赖只有 `picomatch`（MIT）；`packages/adapters` 无第三方运行时依赖；不引入 GPL/AGPL/Sustainable Use。
- **Security**：core 无 IO、无 shell、无文件路径读取、无凭据；fixture 只用占位值；`isSensitivePath` 只做字符串判断。
- **Performance**：core 测试 < 5 秒；context 单次装配 < 50ms（fixture 规模 ≤ 40 节点）；fake adapter 无线程/定时器。
- **Scope**：不动 `apps/**`、DB、WS、verify executor、Claude SDK、worktree、画布命令。

## Acceptance Criteria

### Computational

以下命令均以退出码 0 为准：

```bash
pnpm verify
pnpm check:boundaries
pnpm check:protocol
pnpm format:check
pnpm --filter @baton/core test
pnpm --filter @baton/adapters test
pnpm pack:check
git diff --name-only main...HEAD -- apps   # 输出必须为空
```

覆盖率以 `@vitest/coverage-v8` 的阈值为准：`packages/core` 四项指标均 ≥ 80%。

### Inferential

- 人工对照 spec 4.2–4.5 与实现：种子集、闭包、排序、预算、脱敏、匹配、风险、解析优先级一一对应，没有多出或遗漏。
- 人工评审 context 快照：可读、稳定、没有本机路径或敏感内容。
- 人工评审 policy 判定：deny 优先、未知工具 high、自动批准四条件没有遗漏。
- 人工评审适配器契约：`AgentAdapter` 与主 spec 2.6 一致；fake 不依赖 daemon/DB/WS。
- 人工评审消费 fixture：M1-5 可以直接照抄，不需要二次定义类型。

## Negotiation Record

**Round 1 — Generator（初版，16 条）**

- protocol 有 AgentAdapter；core 有 assembleContext/evaluateApproval/resolveVerifyCommand；新增 adapters + fake；默认 policy 改 glob；测试与覆盖率；不改 apps。

**Round 1 — Evaluator（挑战）**

- “有 AgentAdapter”不可判定：必须列出确切导出，并用 import/类型测试证明。
- “assembleContext 可用”不可判定：必须给出种子集、闭包、排序、预算、脱敏、去重的具体断言。
- “policy 可用”不可判定：必须给出匹配语义、风险表、自动批准四条件与 kill switch 的测试。
- “fake adapter”不可判定：必须给出默认事件序列、approve allow/deny、interrupt、send 的断言。
- “不改 apps”不可判定：必须给出 `git diff ... -- apps` 的空输出。
- “覆盖率”不可判定：必须绑定 coverage 工具与四项阈值。
- 缺少“M1-5 消费形态”验证：必须有一个类型级 fixture，证明输出能直接接入 `StartInput` / `AgentRun.approve`。

**Round 2 — Generator（修订，23 条）**

- 加入确切导出、context 规则测试、policy 表驱动、fake 控制测试、消费 fixture、allowed paths、覆盖率命令。
- 加入默认 policy 精确数组、`resolveVerifyCommand` 错误形状、`pack:check`、无 TODO 扫描。

**Round 2 — Evaluator（再次挑战）**

- context 的去重与 `included` 顺序没有说明：必须写“保留最低 depth，按最终渲染顺序输出”。
- context 超预算“先丢最深上游”的同深度顺序没有说明：必须写 `(y,x,id)` 倒序，显式节点最后硬截断。
- `classifyRisk` 的未知工具没有说明：必须固定为 `high`，且 high 永不自动批准。
- `evaluateApproval` 的 `reason` 可能泄露输入：必须断言不包含完整敏感输入。
- `resolveVerifyCommand` 的“无配置”与“非法输入”容易混淆：必须区分 fallback 与 `invalid_payload`。
- fake adapter 的 `interrupt` 没有说事件流是否结束：必须断言有限次迭代内结束。
- 消费 fixture 只测类型不够：必须同时跑一次 fake adapter 的 approval allow/deny。
- 默认 policy 改动必须证明只改字符串、不改 schema 类型。

**Round 3 — Generator（最终，25 条）**

- 接受以上全部挑战，写入第 1–25 条。
- 明确 context 去重/排序/截断顺序、未知工具 high、reason 脱敏、fallback 与非法输入、interrupt 结束、消费 fixture 运行、默认值兼容。
- 明确 `git diff -- apps` 为空、`pack:check`、覆盖率与无占位。

**Final consensus**

25 条 DoD，3 轮 generator-evaluator，无剩余挑战。验收以命令退出码、测试断言、快照与人工对照 spec 为准。

## Out of Scope（本 contract 不验收）

- daemon task runner、session 生命周期、approval/review 持久化。
- `ws_event` / `event.ordinal` / `resume` / WS 路由。
- verify executor（execa、超时、进程组、diff stat）与路径 jail。
- `agent-claude` / `agent-pty`、worktree、画布命令、web UI。
- `ack.data`、`BATON_MAX_CONCURRENCY`、重启恢复。
