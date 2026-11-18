# Sprint Contract: M2-2a 无人值守与汇报 v0

> 关联 spec：`docs/specs/2026-11-19-m2-autopilot-design.md`
> 文档位置说明：本仓库 contract 落 `docs/contracts/`，不使用 `docs/agent-harness/contracts/`。

## Outcome（用户视角）

开启自动驾驶后，我只需要在开始时批量点一次开工，低风险审批和 verify 失败重试由系统自己处理；我随时能看到哪些任务在等我、哪些被自动批准/重试、哪些被放弃，kill switch 一按就停且不会杀掉正在跑的任务。到了预设时间或我手动触发，总管给我一份站内汇报，告诉我 ready/blocked/dropped、变化计数和最长等待；我仍然只做最终的通过或打回。

## Definition of Done

- [ ] **1. 协议与类型**：`Notice` 增加 `workspaceId`；新增 `packages/protocol/src/automation.ts`，导出 `AutomationPolicyPatch`、`AutomationSummary`、`DigestTaskRef`、`DigestReport`、`TaskAutomationDecision`、`TaskAutomationSummary`；`NoticeEvent` 加入 `ServerMessage`；`api.ts` 增加 automation/notice/audit/task-automation 的请求与响应 schema；protocol 测试覆盖合法/非法 payload、`workspaceId=null` 兼容与导出。
- [ ] **2. effective autopilot**：core 新增 `effectiveAutopilot(policy, {workspaceTrusted, killSwitch})`；`PolicyContext` 增加 `workspaceTrusted`，`evaluateApproval` 的 auto 条件同时检查 trust/kill switch；`TransitionContext` 增加 `workspaceTrusted`、`killSwitch`，`verify_fail` 重试分支同时检查两者；矩阵测试覆盖 `enabled × trusted × killSwitch`，并断言 `risk === 'high'` 永不自动批准。
- [ ] **3. digest 纯函数**：core 新增 `buildDigest`；输入只含任务摘要、自动决策、重试 audit、完成时间；输出 `snapshot`（按看板列 + attention）、`ready`（review）、`blocked`（waiting_input）、`dropped`（waitingReason=dropped）、`changes`、`oldestWaiting`；数组最多 20 条；快照测试覆盖空 workspace、混合状态、window 边界、20 条截断；断言输出不含 prompt、transcript、文件内容字段。
- [ ] **4. migration 0007**：新增 `setting(key, value_json, updated_at)`；`notice` 增加 `workspace_id`（nullable）与 `(workspace_id, ts)` 索引；新增 `audit(action, ts)`、`task(workspace_id)`、`session(task_id)`、`review(task_id)` 索引；fixture DB 覆盖空库升级与已有任务/notice 升级；旧 notice 的 `workspaceId` 为 null。
- [ ] **5. policy 读写**：`GET /api/workspaces/:id/automation` 返回 `AutomationSummary`（policy、policyVersion、trusted、killSwitch、killSwitchForced、digestCronUnsupported）；`PATCH` 只接受 `autopilot.enabled/retryMax` 与 `approval.autoApproveMaxRisk`（low/medium）；未信任返回 409 `workspace_untrusted`，非法返回 400 `invalid_policy`；写入 `.baton/policy.json` 使用 `.baton` realpath jail + 同目录临时文件 + `rename`；运行中任务继续使用启动时 policy 快照；policyVersion 为稳定 JSON sha256 截 12 位，单测断言插入顺序不影响 hash。
- [ ] **6. kill switch**：`setting.kill_switch` 持久化；`PUT /api/automation/kill-switch` 更新内存状态并写 audit；`BATON_KILL_SWITCH=1` 强制为 true，UI 不允许关闭，尝试关闭返回 409 `kill_switch_forced`；开启后下一次审批回到 ask、`verify_fail` 进入 review 而不是 queued；运行中 session 不被中断；daemon 重启后状态保留。
- [ ] **7. 自动化审计**：自动批准/拒绝 audit 增加 `policyVersion`（保留 `taskId/approvalId/risk/matchedRule`）；`task.retry` audit 增加 `workspaceId/policyVersion`；`GET /api/tasks/:id/automation` 返回 `autoDecisions/retryCount/lastVerifyExitCode/lastPolicyVersion`；`GET /api/audit?actionPrefix=automation.` 返回最近变更；所有响应不含 prompt、工具入参全文、transcript。
- [ ] **8. digest 调度与 notice**：`generateDigest` 支持 manual/schedule；`windowStart = last_digest_at ?? now - 12h`；按时钟触发时无任务跳过，手动始终生成；只对可信 workspace 自动调度；同事务写 `notice` + `setting` + `ws_event`，提交后广播 `NoticeEvent`；`GET /api/notices` 支持 workspace/kind/before/limit；`POST /api/notices/:id/read` 更新 readAt；断线重连可回放 notice；历史最多 5 条在 UI 展开。
- [ ] **9. Web 自动化控制面**：`AutomationSettingsDialog` 提供三个可编辑字段、allow/deny/verify/digestCron 只读展示、未信任提示、保存/错误/最近变更；顶栏三态「自动化关闭/运行中/已暂停」+ 一键 kill switch；`DigestCard` 显示待验收/待处理/已放弃、变化计数、最长等待、前 3 个 blocked、生成/已读/历史；`TaskAutomationCard` 显示自动批准/拒绝/重试记录；全部使用 `DESIGN.md` token，键盘可达，状态不只靠颜色。
- [ ] **10. 批量开工**：`TaskBoard` 支持选择模式，只允许 `todo`，显示已选/上限 20，支持全选待办；逐条发送 `task.enqueue`，ack 计数，部分失败 toast「已开工 X 个，Y 个失败」并保留失败任务原状态；成功后退出选择模式并 invalidate tasks；没有总管 `enqueue` 工具。
- [ ] **11. Playwright（mock）**：覆盖设置弹窗读取/保存/未信任/错误、kill switch 三态、digest 卡生成/已读/历史/任务跳转、任务自动化卡、看板选择/全选/部分失败/上限；全部 REST/WS mock，不依赖本机 daemon。
- [ ] **12. 真实验收（ego-lite + 真实 Claude）**：信任 workspace，开启 autopilot（retryMax=1、low）；创建 3 个任务并批量开工；低风险审批自动通过，verify 失败自动重试一次并进入 review；digest 的 ready/blocked/dropped、变化计数、最长等待与看板一致；开启 kill switch 后下一次审批不自动通过、verify 失败不自动重试；人工通过/打回仍生效；证据落 `docs/evidence/2026-11-19-m2-autopilot/`，截图脱敏。
- [ ] **13. 安全与隐私**：未信任 workspace 即使 policy 写了 `autopilot.enabled=true`，有效 autopilot 仍为 false；session-runner 每次审批读取当前 trust；高风险永不自动批准；policy 写入阻断软链逃逸；digest/audit/日志不含 prompt、transcript、文件正文；`actionPrefix` 只接受 `[a-z.]{1,64}` 并参数化查询；没有外部通知渠道。
- [ ] **14. 全量质量与范围**：`pnpm verify`、`pnpm verify:full`、`pnpm pack:check`、`pnpm check:boundaries`、`pnpm check:protocol`、`pnpm format:check` 全绿；新增源码无 `TODO`/`FIXME`；`croner`（或降级方案）许可已进 `THIRD_PARTY_NOTICES.md`；`docs/README.md` 的 spec/contract/plan 索引完整；没有实现外部 Source、移动端、总管 `enqueue`/验收/打回、自动验收、`allow/deny` 编辑器、M1-7b。

## Boundary Conditions

- **Must support**：Node 22 与 24；多 workspace；trusted/untrusted 切换；daemon 重启；WS 断线 `sinceSeq` 回放；批量开工部分失败；`BATON_KILL_SWITCH=1`；`digestCron` 默认 `0 9,21 * * *`；cron 不支持时的降级路径。
- **Must not break**：M1-5/M1-5a/M1-6a/M1-6b/M1-7a/M1-7c/M2-1 的 REST/WS 契约；`task.status` 单写者；人工审批/回复/验收；verify 与 review 流程；总管三工具白名单；policy 快照语义；画布上下文注入；现有 Playwright journey/shell/canvas-context/supervisor 用例。
- **Performance**：digest 只查 `task/approval/review/audit/setting/notice`，不查 `event`/`ws_event` payload；1,000 任务 + 500 条自动决策的 fixture 上，手动 digest p95 < 500ms；notice/audit 查询分页，单页 ≤ 100。
- **Security / Privacy**：policy 在 workspace 内，因此必须过 trust gate；kill switch 环境变量最高优先级；高风险永不自动批准；日志与 UI 不出现 prompt/transcript；截图脱敏。
- **Scope**：只改 `packages/protocol/**`、`packages/core/src/automation/**`、`packages/core/src/policy/**`、`packages/core/src/state-machine/**`、`apps/daemon/**`、`apps/web/**`、migration、lockfile、`docs/**`；不做外部 Source、移动端、总管 `enqueue`/验收/打回、自动验收、`allow/deny` 编辑器、M1-7b、画布增强。

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

补充检查：

```bash
grep -RIn "TODO\|FIXME" packages/protocol/src packages/core/src apps/daemon/src apps/web/src
grep -n "croner" apps/daemon/package.json THIRD_PARTY_NOTICES.md
grep -RIn "enqueue_task" apps/daemon/src/supervisor packages/protocol/src
```

前两条必须分别无输出/命中；第三条必须无输出。测试层面还必须满足：

- core：effective autopilot 矩阵、digest 快照、policy patch schema 全绿。
- daemon：policy 读写、kill switch 动态生效、digest 手动/定时、notice 回放、任务自动化记录、migration 0007 fixture 全绿。
- web：设置弹窗、kill switch、digest 卡、任务自动化卡、批量开工组件测试与 Playwright 用例全绿。

### Inferential

- 代码评审逐条对照 spec §2–§11 与本文 DoD；发现未列出的行为变更必须回到 spec/contract 更新，不在实现里“顺手”做。
- ego-lite 真实链路证据包含 3 个任务、digest、kill switch、人工验收；截图只保留 UI 区域，不含用户名、绝对路径、token 或其他窗口。
- 评审确认：没有自动开工、自动验收、总管越权工具、外部通知渠道；kill switch 语义是“停自动决策，不杀会话”。

## Negotiation Record

- **Generator 初始提案（12 条）**：协议类型、effective autopilot、digest 纯函数、migration、policy 读写、kill switch、审计、notice/digest、Web 控制面、批量开工、Playwright、真实验收。
- **Evaluator 质疑**：
  1. “kill switch 动态生效”不可验证——必须写明下一次审批/重试的可观察结果，且不能杀会话。
  2. “未信任 workspace 不能启用”需要具体测试：policy 文件写 true 时仍为 ask，PATCH 返回 409。
  3. digest 的窗口、首次生成、停机错过、notice 回放、未读语义没有写死，容易各自解释。
  4. “Web 控制面”太宽——必须列到设置字段、顶栏三态、digest 卡内容、任务自动化卡、批量开工上限。
  5. 真实验收的“3 个任务无人值守”必须锁定 autopilot 参数、自动通过/重试次数和人工验收仍生效。
  6. 安全条款缺少 policy 写入软链逃逸、actionPrefix 注入、日志/审计最小化。
- **Generator 修订（14 条）**：补充 kill switch 可观察结果、trust 矩阵、digest 窗口/回放/未读、Web 细项、真实验收参数、路径 jail 与查询安全；新增“范围守卫”作为第 14 条。
- **Evaluator 复核**：14 条均可通过命令、测试或截图判定；无未决项。
- **Final consensus**：以上 14 条 Definition of Done、5 条 Boundary Conditions、2 类 Acceptance Criteria。
