# M6-2 上下文再注入与轻验收证据：Definition of Done

> 回链 spec：`docs/specs/2026-11-21-m6-2-context-injection-design.md`。
> 前置：M6-1 任务现场已合并到 `main`；本 contract 从 M6-1 收口后开始。
> 分支：spec/contract 在 `feat/m6-2-context-injection`；实现继续使用同一短分支。

## 0. 文档信息

- **状态**：已实现，验收通过；证据见 `docs/evidence/2026-11-21-m6-2-context-injection/`。
- **范围**：`packages/protocol/**`、`packages/core/**`、`apps/daemon/**`、`apps/web/**`、migration 0011、测试与 `docs/**`。
- **预期不改**：状态机允许转移与状态语义；`task.status` 单写者；初始 `ContextSnapshot` 的 `included/dropped` 语义；`assembleContext` 的预算/深度/敏感路径规则；`node`/`edge` 表结构；现有上传接口行为。
- **GDD**：仓库没有 `docs/agent-harness/` 与 GDD 脚本，按 M1/M2/M3/M5/M6-1 先例显式跳过；测试设计由本 contract 的 DoD 与 5 个 plan 的测试矩阵承担。

## 1. 用户可见结果

我可以在画布上选中几个节点，把它们补投给一个已经在跑或排队的任务；任务下一轮会真正带上这些内容，而不用取消重开。任务详情能看到每次投喂了什么、谁投的、什么时候投的；验收时我能看到 cost/turn，verify 失败或跳过时点通过会被要求确认。总管也能在我明确要求时执行投喂，但不会自己乱补，review 里仍然只能由我打回。

## 2. DoD

- [x] **1. 注入状态矩阵**：`context.inject` 对 `todo` 与 `queued` 保持原状态、不启动 session；对 `waiting_input`（question/stalled/dropped）走 `user_input` 变 `running`；对 `waiting_input`（approval/null）、`review`、`running`、`verifying`、`done`、`failed`、`cancelled` 返回 `task_not_injectable`，且 reason 分别为 `approval_pending`、`use_review_reject`、`running`、`terminal`；拒绝时不写 prompt、不写 context、不写 audit。
- [x] **2. Review 打回携带上下文**：`review.decide(reject)` 可只带 `contextNodeIds`、不带文字 feedback；任务回 `queued`，review verdict 为 `rejected`，prompt 中 `<feedback>` 与本次独立 `<context_update>` 各恰好一份，`context.injections` 增加一条；只有 feedback 或只有 context 都合法，两者都空返回 `invalid_payload`。
- [x] **3. append-only 快照**：注入后初始 `ContextSnapshot` 的 `included/dropped/truncated/redactedPaths/relations/relationsTruncated` 不变；`context.injections[]` 按 `seq` 递增追加；旧 `context_json` 没有 `injections` 字段时按 `[]` 解析，旧任务详情不报错；不新建表。
- [x] **4. prompt 单份与标签**：每次注入在 `task.prompt` 中只出现一份；`todo/queued` 落在 `<context_update>`，`waiting_input` 落在 `<user_reply>`，`review reject` 落在独立 `<context_update>`（feedback 单独）；`<context_update>` 含 `seq/at/source` 属性、可选 `<note>`、节点与关系 XML；不重写历史 prompt，不重复旧上下文。
- [x] **5. 预算与原子性**：单次 40 节点 / 48k 字符 / 单节点 16k 按现有规则截断/丢弃；累计注入 96k（只累计 `injections[].chars`）超限返回 `context_budget_exceeded`；超限时 prompt、`context_json`、audit 与注入前逐字节一致；敏感路径按现有规则丢弃并标记 `sensitive`，正文不进入 prompt、事件、审计或日志；装配后 `included` 为空返回 `context_empty`。
- [x] **6. 队列顺序**：`task.enqueued_at` 在进入 `queued`（enqueue/reject/verify_fail 自动重试/retry）时设为 `now`，`reopen` 回 `todo` 时清空；调度器按 `enqueued_at ASC, id ASC` 取 queued；给两个 queued 任务中的第一个注入后，第一个仍先启动；migration 0011 把旧 queued 任务的 `enqueued_at` 回填为 `updated_at`。
- [x] **7. 现场感知**：`buildTaskScene` 的 `relatedNodeIds` 纳入 `context.injections[].nodeIds`；现场条显示「上下文 N 个 · 已注入 M 次」；被注入节点有文字/图标「已投喂」标记；已删除的注入节点计入 `missingNodeIds`；现场布局仍只读，不出现节点拖动/编辑入口。
- [x] **8. 上下文时间线**：任务详情显示初始快照 + 每次注入的 seq/时间/来源/note/included chips/dropped/truncated；节点 chip 可定位画布节点；已删除节点显示占位；手机视口显示同一只读时间线，不出现「投喂」按钮；时间线不提供编辑/删除注入。
- [x] **9. cost/turn**：Claude adapter 的 `turn_result.costUsd/turns` 经 `baton.session.usage` 落库到 `session.cost_usd/turns`；`TaskDetailResponse.sessions` 返回新字段；review 卡显示最近一次「本次 $x · y turns」，任务详情头部显示 `ΣcostUsd/Σturns`；缺失显示「—」；fake/pty 无 usage 不报错。
- [x] **10. 通过覆盖**：`review.decide(approve)` 支持可选 `reason`；UI 仅在 `verifyExitCode !== 0` 或 `VERIFY_SKIPPED` 时弹二次确认；确认后写 `review.approve_override` 审计，含 `reviewId/taskId/verifyExitCode/reasonProvided`；正常 verify 通过且无 reason 不写该审计；状态机 `approve` 语义不变。
- [x] **11. 总管边界**：`SUPERVISOR_POLICY.allowedTools` 16 → 17，真实引擎请求体包含 17 个工具；`inject_context` 只接受 `taskId/nodeIds/note?`，单任务、用户明确要求、review 不允许；成功写 `supervisor.context.inject` 审计（taskId/seq/nodeIds/chars/dropped），失败不写成功审计；`get_task` 返回 `injectable` 与 `context.injections` 计数/最后时间，不返回正文；prompt 明确不自动补上下文、不自动打回。
- [x] **12. 协议兼容**：`ContextInjectInput`、`ContextInjection`、`context.injected`、`baton.session.usage`、`Task.enqueuedAt`、`Session.costUsd/turns`、review reject/approve 新字段均可解析；旧字段语义不变；不新增 `NodeType`；不新增 REST 接口；`appendWs` 对 `context.injected` 写 taskId。
- [x] **13. 安全与隐私**：不新增文件读取面；图片仍只输出路径/URL；`note` 只进 `task.prompt` 与 `context.injections[].note`；`context.injected` 与审计不含 note/正文；错误信息不回显节点正文；UI 纯文本渲染；截图按仓库脱敏规则处理。
- [x] **14. 测试覆盖**：protocol 字段/命令/事件解析；core `canInjectContext` 全矩阵、`assembleContextInjection` 选中/直接边/深度 2/group/敏感路径/空内容/预算/排序/默认 note 快照、`buildContextUpdateBlock`、`cumulativeInjectedChars`、转移 effects；daemon migration/回填/注入事务/预算原子性/队列顺序/waiting_input 单份/review 携带/usage 落库/override 审计/supervisor 审计；web 对话框/现场条/时间线/review 打回/approve 确认/手机只读；Playwright 覆盖 waiting_input 投喂、review 打回、approve 确认；ego-lite + 真实 Claude 跑通一次 waiting_input 投喂到 review 并截图。
- [x] **15. 命令、迁移与收口**：migration 0011 在 fixture DB 上从 0010 升级通过；`pnpm verify`、`pnpm verify:full`、`pnpm pack:check`、`pnpm check:boundaries`、`pnpm check:protocol`、`pnpm format:check` 全绿；docs 索引包含 spec/contract/5 个 plan/evidence；证据落 `docs/evidence/<date>-m6-2-context-injection/`；不建新表、不改转移语义、不做 AC/现场任务动作/DAG。

### 2.1 验收证据

- **单元/集成**：`pnpm verify`（protocol/core/adapters/daemon/web）+ `pnpm verify:full`（44 条 Playwright）全绿。
- **Playwright**：`apps/web/e2e/context-injection.spec.ts` 覆盖 `waiting_input` 投喂、review 打回携带选择、verify 失败通过确认；queued 保序由 `apps/daemon/test/context-inject-command.test.ts` 的 FIFO 测试覆盖。
- **真实链路**：`docs/evidence/2026-11-21-m6-2-context-injection/`；真实 Claude `blocked → 投喂 → ready → review`，截图含看板、投喂对话框、时间线、usage、override 确认。
- **验收中发现并修复**：resumed turn 的 `baton_report` 被会话级 `reported` 标志静默丢弃（任务停在 running）；现已每轮 `send` 重置，并有 `createBatonReportHandler` 单测。
- **已知限制**：临时验收环境未配置 verify，review 显示「未执行自动校验」；通过覆盖走 UI 确认与 daemon 审计测试。

## 3. Boundary Conditions

- **Must support**：现有 text/file/image/agent/group/review 节点与 context 边；现有任务、旧 context_json、旧 session；fake 与真实 Claude；桌面/平板投喂；手机只读时间线；现有审批、提问、verify、diff、worktree、历史、retry/reopen/handoff。
- **Must not break**：`task.status` 单写者与状态机；`assembleContext` 预算/深度/敏感路径；M6-1 现场只读与 review 卡；总管不能 approve/reject；现有上传接口；旧数据库升级。
- **Performance**：注入装配沿用现有 O(nodes+edges) 与深度 2，不做全画布重复解析；单次/累计预算限制 prompt 大小；UI 提交期间禁用按钮，不轮询。
- **Security**：daemon 不新增外部请求；注入只读写画布节点内容；事件/审计只写 metadata；敏感路径不泄漏；note/正文不写日志。
- **Data**：只加 nullable 列；`context_json` 仍是唯一注入存储；`enqueued_at` 是队列排序唯一来源；session usage 只加列，不改 session 语义。

## 4. Acceptance Criteria

**Computational**

- `pnpm verify`、`pnpm verify:full`、`pnpm pack:check`、`pnpm check:boundaries`、`pnpm check:protocol`、`pnpm format:check` 全部退出码 0。
- migration 0011 在 fixture DB 上升级成功；旧 queued 任务 `enqueued_at = updated_at`；旧 `context_json` 解析为 `injections: []`。
- protocol/core/daemon/web 新增测试全部通过；core 覆盖率不低于现有基线。
- Playwright 覆盖：waiting_input 投喂、review 只带上下文打回、verify 失败通过确认；queued 保序由 daemon 集成测试覆盖；cost/turn 由组件测试覆盖。
- ego-lite + 真实 Claude：`waiting_input` 投喂后 session 继续到 review；截图现场条、时间线、review 卡。

**Inferential**

- 人工 review：现场能否一眼看出“补了什么、补了几次、还缺什么”；时间线是否能解释每次注入的来源与内容；review 卡是否明确 cost/turn 和“最终由人决定”；approve override 是否不制造误点。
- 证据可复核：截图按脱敏规则处理；临时 daemon/workspace 已停止并清理；不把本机绝对路径、transcript 或凭据提交进仓库。

## 5. 不在范围

- 运行中 `running` 注入；SDK 流式输入的 mid-turn 语义。
- AC 清单、验收报告、cost 预算护栏、自动批准次数上限。
- 现场任务动作（回复/通过/打回/重试/重开）；现场布局编辑。
- 任务优先级、due date、labels、DAG、模板、archive。
- 外部 Source（GitHub/飞书）、向量检索、任务级画布、多用户、手机画布。
- 自动验收/代验收；总管 approve/reject。
- 幂等表；连接中断后手动重试可能重复注入，作为已知限制。

## 6. 实施顺序

1. **Plan 1 protocol + core + migration 0011**：schemas、commands、transitions、effects、纯函数、迁移与单测。
2. **Plan 2 daemon**：repository、context service、状态机 effect 接线、review 路径、session usage、supervisor 工具、集成测试。
3. **Plan 3 web canvas**：工具栏/现场条、投喂对话框、现场计数/标记、场景节点收敛。
4. **Plan 4 web tasks**：时间线、review 打回上下文、approve 确认、cost/turn、移动端只读。
5. **Plan 5 验收与文档**：Playwright、ego-lite 真实 Claude、证据、docs 索引、contract 收口。

依赖：Plan 2 依赖 Plan 1；Plan 3 依赖 Plan 1+2；Plan 4 依赖 Plan 2+3；Plan 5 依赖全部。

## 7. Negotiation Record

- **Generator（初稿）**：从 spec 抽出 10 条 DoD：状态矩阵、append-only、prompt、预算、队列、现场、时间线、cost/turn、override、总管。
- **Evaluator（第 1 轮挑战）**：“works”“正常”不可判定；缺 review 只带上下文、拒绝时不写、预算失败逐字节一致、敏感路径 fixture、queued 保序、mobile 只读、17 个工具、no-new-table、已知限制等负向/边界断言。初稿不合格。
- **Generator（修订）**：每条改成可执行断言；补 review refine、原子性、队列双任务、时间线 mobile、supervisor 审计、协议兼容、安全隐私、测试矩阵。
- **Evaluator（第 2 轮挑战）**：“prompt 只出现一份”要给出出现次数断言；cost/turn 要覆盖缺失“—”；approve override 要区分正常通过；旧 `context_json` 要覆盖无 injections；migration 要覆盖 0010→0011；evidence 要包含真实 Claude。修订后再次挑战。
- **Final consensus**：15 条 DoD + Boundary Conditions + Computational/Inferential 验收；Evaluator 接受，无进一步挑战。用户确认后进入 writing-plans。
