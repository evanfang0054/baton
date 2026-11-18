---
spec_topic: m2-autopilot-v0
decision_summary: "M2-2a 无人值守与汇报 v0：workspace 策略控制面 + 全局 kill switch + 自动化审计 + 站内 digest + 看板批量开工；未信任 workspace 不能自行启用自动驾驶"
design_approved: true
user_approved_at: "2026-11-19T04:10:31+08:00"
gates: [design-approved, user-review-passed]
spec_ref: 2026-11-16-baton-architecture-design.md
domain_terms: [autopilot, kill switch, digest, notice, policy version, workspace trust]
---

# M2-2a 无人值守与汇报 v0 设计

> 子 spec。回链主架构：`docs/specs/2026-11-16-baton-architecture-design.md`。
> 前置：M2-1 总管 Router v0（已合并，`main` `0c9eedf`）。
> 背景材料：`baton.ai` 两份材料（讨论稿，不进仓库）；`deepseek-ai/dsh-superagent-prototype`（MIT，research prototype）只借鉴领域语义与安全边界，不复制代码。
> 本 spec 调整 M2-1 §13 的顺序：先做 M2-2a 无人值守与汇报，外部 Source 顺延到 v1 之后；理由见 §1。

## 0. 文档信息

- **状态**：设计已获用户逐项确认；spec 已获用户审阅通过。
- **范围**：`packages/protocol/**`、`packages/core/src/automation/**`、`packages/core/src/policy/**`、`packages/core/src/state-machine/**`、`apps/daemon/**`、`apps/web/**`、migration 与 lockfile、`docs/**`。
- **不在范围**：外部 Source（GitHub/飞书）、移动端只读、总管 `enqueue`/验收/打回工具、自动验收、`allow/deny` 编辑器、DSH、M1-7b 的 partial streaming/cost/turn/idle eviction、画布增强。
- **文档位置**：spec 落 `docs/specs/`，contract 落 `docs/contracts/`，plan 落 `docs/plans/`；不使用 `docs/agent-harness/`。

## 1. 背景

M1 已把单任务闭环跑通：画布上下文 → 建任务 → 真实 Claude 执行 → 审批/提问 → verify → 人工验收。M2-1 又把总管 Router v0 做实：总管能查任务、建任务到 `todo`、带来源与策略快照，但不自动开工。

现在产品最大的缺口不是“再开一个入口”，而是**开工之后仍然要人逐条盯着**：

- 每次低风险审批都要人点「允许」，自动批准引擎已经存在，但没有控制面和可见性。
- verify 失败自动重试的 core 分支已经存在，但默认关闭，且 kill switch 压不住它。
- `digestCron` 只存在于 `PolicySchema`，没有任何消费者；`notice` / `audit` 表没有 API 和 UI。
- 看板只能一条一条开工，3 个任务要来回点 3 次。

架构 spec §7 的 M2 验收写的是：

> 无人值守连续跑 3 个任务并产出汇报；手机上能通过/打回。

§1.3 同时把外部触发器列为 v1 不做。因此本迭代选择 **M2-2a 无人值守与汇报**：把已有引擎变成可控、可见、可汇报的产品能力；移动端拆到 M2-2b，外部 Source 留到 v1 之后。

## 2. 目标与非目标

**目标**

1. Workspace 可查看和修改自动化策略；只开放 `autopilot.enabled`、`retryMax`、`autoApproveMaxRisk` 三个字段。
2. 全局 kill switch 可一键暂停自动批准与自动重试，不需要重启 daemon，不杀运行中会话。
3. 自动批准/自动重试/策略变更全部可审计，并在任务详情与设置页可见。
4. `digestCron` 落地：按 workspace 生成站内汇报，支持手动生成、未读与历史查询。
5. 看板支持多选待办任务批量开工，仍然由人触发。
6. 安全边界：未信任 workspace 的 `.baton/policy.json` 不能自行启用自动驾驶；高风险操作永不被自动批准。

**非目标**

- 外部 Source、Thread 订阅、admission、bot、多身份。
- 移动端只读、外部通知渠道（飞书/邮件/Webhook）。
- 总管新增 `enqueue`/验收/打回/重试工具；总管仍只建 `todo`。
- 自动验收、自动打回、自动开工。
- `allow/deny` 编辑器、policy 可视化管理器。
- 完整事件溯源、通知保留清理策略。

## 3. 关键决策

| # | 决策 | 结论 | 理由 |
|---|---|---|---|
| D1 | 配置真源 | workspace `.baton/policy.json` 仍是唯一真源；UI 只写三个字段 | 不引入第二套配置；policy 随 workspace 走；新文件通常 untracked，不污染 diff |
| D2 | 信任门槛 | 未信任 workspace 即使 policy 写了 `autopilot.enabled=true`，有效 autopilot 仍为 false；UI 也不允许编辑 | 仓库内文件不能自行启用自动批准，否则 `.baton/policy.json` 就是提权入口 |
| D3 | 人闸门 | 总管仍只建 `todo`；开工只能人触发；看板支持多选批量开工 | 符合架构与文章「派活这一步要我点」；不给总管新增权限面 |
| D4 | kill switch | 全局、持久化、只停自动批准 + 自动重试，不杀运行中会话 | 安全停止但不毁工作；运行中任务仍可人工审批 |
| D5 | 汇报形态 | 站内 `notice` + digest 卡；默认 `0 9,21 * * *`；手动可生成 | v1 本地单用户；`notice` 表已存在；外部通知增加凭据与安全面 |
| D6 | 汇报窗口 | `windowStart = last_digest_at ?? now - 12h`；停机错过的定时不补跑 | 下一轮自然覆盖；避免启动时集中补跑产生噪音 |
| D7 | notice 通道 | 新增可重放 `notice` WS 事件；落库 + 写 `ws_event`；REST 查历史 | 重连可回放；与现有事件模型一致 |
| D8 | 审计 | 自动批准、自动重试、策略变更写 `audit`；任务详情 + 设置页最近变更可见 | 自动决策必须可解释；不引入独立审计页 |
| D9 | 策略版本 | `policyVersion = sha256(stable JSON)` 截 12 位；写入 audit 与 digest | 让「哪条规则放行了它」可回溯 |
| D10 | 批量开工 | 复用 `task.enqueue`，逐条执行，单批上限 20，部分失败逐条报告 | 不新增协议；失败可解释 |
| D11 | 移动端 | 不进本迭代；M2-2b 单独做 | 控制面 + 汇报已是完整闭环；移动端独立可验收 |
| D12 | cron 解析 | 首选 `croner`（MIT，零依赖）；实现前按依赖规范核对 registry/仓库元数据；不满足则退化为默认 9/21 两档 | 不手写 cron 解析；依赖失败有降级路径 |
| D13 | 有效 autopilot 归属 | 规则进 core 纯函数/上下文，不在 web 或 prompt 里判断 | 安全规则用代码契约表达；便于矩阵测试 |
| D14 | 调度范围 | 只有可信 workspace 自动调度 digest；未信任仍可手动生成 | 仓库不能通过 `digestCron` 制造定时噪音 |
| D15 | 策略改动生效 | 只影响新启动的会话；运行中任务继续使用启动时快照 | 与现有 policy 快照语义一致 |

## 4. 领域词汇与不变量

| 词汇 | 定义 |
|---|---|
| autopilot | 自动批准 + verify 失败自动重试的组合；默认关闭 |
| effective autopilot | `policy.autopilot.enabled && workspace.trusted && !killSwitch`；唯一判断口径 |
| kill switch | 全局硬停开关；停自动决策，不停会话 |
| digest | 按 workspace 生成的窗口汇报：当前快照 + 自上次汇报的变化 |
| notice | 站内通知实体；digest 是其中一种 `kind` |
| policy version | policy 稳定 JSON 的 sha256 截 12 位 |
| workspace trust | 用户显式信任 workspace 的状态；自动化的前置条件 |

**七条不变量**

1. 总管仍然只建 `todo`；开工只能人触发。
2. 验收只能人做；autopilot 只影响审批和 verify 失败重试。
3. 自动批准必须同时满足：命中 `allow`、`risk !== high`、`risk <= autoApproveMaxRisk`、`autopilot.enabled`、workspace 已信任、kill switch 关闭。
4. 自动重试必须同时满足：`autopilot.enabled`、workspace 已信任、kill switch 关闭、`retryCount < retryMax`。
5. kill switch 是全局硬停：停自动批准和自动重试，不杀运行中会话，不影响 digest。
6. `.baton/policy.json` 是配置真源；UI 只写三个字段，其余只读。
7. 自动化决策必须写 audit；digest 只读任务摘要，不读 transcript、prompt、文件正文。

## 5. 协议增量

### 5.1 `Notice` 增加 workspace

`packages/protocol/src/entities/notice.ts`：

```ts
export const Notice = z.object({
  id: Id,
  workspaceId: Id.nullable().default(null),
  ts: Timestamp,
  kind: z.string().min(1),
  payload: z.unknown(),
  readAt: Timestamp.nullable(),
})
```

- digest notice 必须带 `workspaceId`；全局通知可为 `null`。
- 旧行升级后为 `null`，读取端需容忍。

### 5.2 自动化 schema

新增 `packages/protocol/src/automation.ts`：

```ts
export const AutomationPolicyPatch = z
  .object({
    autopilot: z
      .object({
        enabled: z.boolean().optional(),
        retryMax: z.number().int().min(0).max(10).optional(),
      })
      .strict()
      .optional(),
    approval: z
      .object({
        // high 永不自动批准，不提供该选项，避免误导。
        autoApproveMaxRisk: z.enum(['low', 'medium']).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()

export const AutomationSummary = z.object({
  workspaceId: Id,
  trusted: z.boolean(),
  policy: PolicySchema,
  policyVersion: z.string().min(1),
  killSwitch: z.boolean(),
  killSwitchForced: z.boolean(),
  digestCronUnsupported: z.boolean().default(false),
})

export const DigestTaskRef = z.object({
  id: Id,
  title: z.string(),
  status: TaskStatus,
  attention: Attention,
  waitingSince: Timestamp.nullable(),
  retryCount: z.number().int().nonnegative(),
})

export const DigestReport = z.object({
  workspaceId: Id,
  windowStart: Timestamp,
  windowEnd: Timestamp,
  generatedAt: Timestamp,
  policyVersion: z.string().min(1),
  snapshot: z.object({
    total: z.number().int().nonnegative(),
    unplanned: z.number().int().nonnegative(),
    todo: z.number().int().nonnegative(),
    running: z.number().int().nonnegative(),
    waiting: z.number().int().nonnegative(),
    review: z.number().int().nonnegative(),
    done: z.number().int().nonnegative(),
    closed: z.number().int().nonnegative(),
    attention: z.object({
      needsApproval: z.number().int().nonnegative(),
      needsReply: z.number().int().nonnegative(),
      needsAttention: z.number().int().nonnegative(),
      needsReview: z.number().int().nonnegative(),
    }),
  }),
  ready: z.array(DigestTaskRef).max(20),
  blocked: z.array(DigestTaskRef).max(20),
  dropped: z.array(DigestTaskRef).max(20),
  changes: z.object({
    created: z.number().int().nonnegative(),
    updated: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    cancelled: z.number().int().nonnegative(),
    retried: z.number().int().nonnegative(),
    autoAllowed: z.number().int().nonnegative(),
    autoDenied: z.number().int().nonnegative(),
  }),
  oldestWaiting: DigestTaskRef.nullable(),
})

export const TaskAutomationDecision = z.object({
  approvalId: Id,
  decision: ApprovalDecision,
  toolName: z.string().min(1),
  risk: RiskLevel,
  decidedAt: Timestamp,
  policyVersion: z.string().min(1).nullable(),
})

export const TaskAutomationSummary = z.object({
  taskId: Id,
  retryCount: z.number().int().nonnegative(),
  lastVerifyExitCode: z.number().int().nullable(),
  lastPolicyVersion: z.string().min(1).nullable(),
  autoDecisions: z.array(TaskAutomationDecision),
})
```

- `ready` = `review`；`blocked` = `waiting_input`（审批/回答/卡住）；`dropped` = `waitingReason='dropped'`。
- `changes` 是窗口内变化，不是历史总量。
- 所有数组最多 20 条，避免 notice 膨胀。

### 5.3 `NoticeEvent`

`packages/protocol/src/events.ts`：

```ts
export const NoticeEvent = ReplayableBase.extend({
  type: z.literal('notice'),
  payload: Notice,
})
```

- 加入 `ServerMessage` 联合。
- 创建 notice 时同事务写 `ws_event`，广播时带 `seq`；断线用 `sinceSeq` 回放。
- 读取状态（`readAt`）不产生事件；重连后由 REST 重新拉取。

### 5.4 API schema

`packages/protocol/src/api.ts` 增加：

```ts
export const KillSwitchInput = z.object({ enabled: z.boolean() })
export const KillSwitchResponse = z.object({
  killSwitch: z.boolean(),
  killSwitchForced: z.boolean(),
})

export const NoticeListQuery = z.object({
  workspaceId: Id.optional(),
  kind: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.coerce.number().int().nonnegative().optional(),
})
export const NoticeListResponse = z.object({
  notices: z.array(Notice),
  nextBefore: Timestamp.optional(),
})

export const DigestGenerateResponse = z.object({ notice: Notice })

export const AuditListQuery = z.object({
  actionPrefix: z
    .string()
    .regex(/^[a-z.]{1,64}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  before: z.coerce.number().int().nonnegative().optional(),
})
export const AuditListResponse = z.object({
  entries: z.array(Audit),
  nextBefore: Timestamp.optional(),
})
```

## 6. 数据模型与 migration 0007

### 6.1 `setting` 表

```sql
CREATE TABLE `setting` (
  `key` text PRIMARY KEY NOT NULL,
  `value_json` text NOT NULL,
  `updated_at` integer NOT NULL
);
```

- `kill_switch`：`{ "enabled": boolean }`。
- `digest:last:<workspaceId>`：`{ "at": number }`。
- 只存小型 JSON；不存策略全文。

### 6.2 `notice` 增加 workspace

```sql
ALTER TABLE `notice` ADD `workspace_id` text REFERENCES `workspace`(`id`);
CREATE INDEX `notice_workspace_ts_idx` ON `notice` (`workspace_id`, `ts`);
```

### 6.3 查询索引

```sql
CREATE INDEX `audit_action_ts_idx` ON `audit` (`action`, `ts`);
CREATE INDEX `task_workspace_idx` ON `task` (`workspace_id`);
CREATE INDEX `session_task_idx` ON `session` (`task_id`);
CREATE INDEX `review_task_idx` ON `review` (`task_id`);
```

- 支撑 digest、任务自动化记录、设置页最近变更。
- 迁移用 drizzle-kit 生成；fixture 覆盖空库升级与已有数据升级。

### 6.4 不新增业务列

- 不给 `task` 加 `policy_version`；策略版本从 audit 的自动决策/重试记录读取。
- 不改 `audit` 表结构；按 `detail_json` 的 `taskId`/`approvalId` 查询；新写入的 audit 补齐 `policyVersion` 与 `workspaceId`。
- `notice.workspace_id` 是唯一新增的业务列，已在 §6.2 说明。

## 7. core

### 7.1 有效 autopilot

新增 `packages/core/src/automation/effective.ts`：

```ts
export interface AutomationGate {
  workspaceTrusted: boolean
  killSwitch: boolean
}

export function effectiveAutopilot(policy: Policy, gate: AutomationGate): Policy['autopilot'] {
  return {
    ...policy.autopilot,
    enabled: policy.autopilot.enabled && gate.workspaceTrusted && !gate.killSwitch,
  }
}
```

- `PolicyContext` 增加 `workspaceTrusted?: boolean`；`evaluateApproval` 的 auto 条件增加 `workspaceTrusted === true`。
- `TransitionContext` 增加 `workspaceTrusted?: boolean`、`killSwitch?: boolean`；`verify_fail` 的重试分支要求 `workspaceTrusted === true && killSwitch === false`。Plan 1 先以“缺省即 fail-closed”保持全量 verify 绿，Plan 2 再传真实值。
- 所有 core 测试使用同一口径；矩阵覆盖 `enabled × trusted × killSwitch`。
- daemon 不再自己拼规则，只传事实。

### 7.2 digest 纯函数

新增 `packages/core/src/automation/digest.ts`：

```ts
export interface DigestInput {
  workspaceId: string
  now: number
  windowStart: number
  policyVersion: string
  tasks: Task[]
  autoDecisions: Array<{ decision: 'allow' | 'deny'; decidedAt: number }>
  retryAudits: Array<{ ts: number }>
  completedAtByTask: Map<string, number>
}

export function buildDigest(input: DigestInput): DigestReport
```

- 复用 `packages/core/src/tasks/board.ts` 的 `boardColumn`、`needsPerson`、`waitingSinceFor`。
- `ready`：`review`。
- `blocked`：`waiting_input`；按 attention 细分。
- `dropped`：`waiting_input` 且 `waitingReason='dropped'`。
- `oldestWaiting`：`waiting_input`/`review` 中 `waitingSince` 最小者。
- `changes`：`createdAt >= windowStart`、`updatedAt >= windowStart`、完成/失败/取消/重试/自动决策计数。
- 边界：`>= windowStart`；数组按等待时长/更新时间倒序，截断 20。
- 快照测试必须断言不含 prompt、transcript、文件内容字段。

## 8. daemon

### 8.1 policy 写入

`apps/daemon/src/workspace/policy.ts` 增加 `writePolicy`：

```ts
export function writePolicy(workspacePath: string, policy: Policy): { policyVersion: string }
```

流程：

1. `resolveWithin(workspacePath, '.baton')`，确保目录在 workspace 内；不存在则 `mkdir`。
2. 对 `.baton` 目录做 `realpath`，再次校验仍在 workspace 内（防 `.baton` 为软链逃逸）。
3. `PolicySchema.parse(policy)` 再次校验调用方传入的完整 policy。
4. 写临时文件（同目录、0600），`rename` 原子替换。
5. 计算 `policyVersion` 并返回；本函数不写 audit。
6. 文件失败抛 `policy_write_failed`；不更新内存状态。

`loadPolicy` 保持只读；非法文件仍拒绝任务创建。

audit 由 `automation/service.ts` 在文件写入成功后写；失败顺序与已知非原子窗口见 §8.2。

### 8.2 kill switch 与 automation service

`apps/daemon/src/automation/state.ts`：

- 启动时读 `setting.kill_switch`；`config.killSwitch`（env）为 true 时强制 true。
- `state.killSwitch` 可被 service 更新；`killSwitchForced = config.killSwitch`。
- 提供 `isKillSwitchOn(): boolean` 给 runtime。

`apps/daemon/src/automation/service.ts`：

- `getSummary(workspaceId)`：读 workspace、policy、policyVersion、kill switch、trusted、`digestCronUnsupported`。
- `patchPolicy(workspaceId, patch, actor)`：校验 trusted；读当前 policy，只合并允许字段，`PolicySchema.parse`，调用 `writePolicy`，成功后写 audit `automation.policy.update`（detail 只含变更字段名与新值、`policyVersion`），返回 summary。
- `setKillSwitch(enabled, actor)`：env 强制时拒绝；写 setting + audit；更新内存状态。
- `policyVersion(policy)`：稳定 JSON 的 sha256 截 12 位。稳定 JSON 指按对象 key 字典序递归序列化；单测断言同一 policy 两次 hash 相同、字段插入顺序不影响结果。
- 文件写入与 audit 不是同一事务：先落文件，再写 audit。audit 写入失败时返回 `policy_write_failed` 并记 `audit_write_failed` 日志；文件已经更新，UI 下次读取会看到新策略。这个非原子窗口在 v0 接受，风险表登记；不静默失败。

### 8.3 digest

`apps/daemon/src/automation/digest.ts`：

- `generateDigest(workspaceId, trigger: 'manual'|'schedule')`：
  1. 读 workspace、policy、tasks、auto decisions、retry audits、review 完成时间。
  2. `windowStart = setting['digest:last:<id>']?.at ?? now - 12h`。
  3. 调用 core `buildDigest`。
  4. 同事务写 `notice`、`setting`（`digest:last:<workspaceId>`）与 `ws_event`。
  5. 提交后广播 `NoticeEvent`。
- 定时无任务时跳过；手动始终生成。
- 只对可信 workspace 自动调度；trust 撤销时立即停止该 workspace 的 job。
- `trigger` 写入 notice payload 或 audit，便于排查；不写 prompt。

`apps/daemon/src/automation/scheduler.ts`：

- 启动时列出 workspace；可信的按 `digestCron` 建 job。
- policy patch/trust 变更后重排；close 时停止全部 job。
- 使用 `croner`；默认时区为 daemon 本地时区。
- 单次生成失败只记 `digest_generation_failed` 日志，不影响 daemon。

### 8.4 REST

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/workspaces/:id/automation` | 返回 `AutomationSummary` |
| PATCH | `/api/workspaces/:id/automation` | body `AutomationPolicyPatch`；返回 summary |
| PUT | `/api/automation/kill-switch` | body `KillSwitchInput`；返回 `KillSwitchResponse` |
| GET | `/api/notices` | `NoticeListQuery` → `NoticeListResponse`，按 ts 倒序 |
| POST | `/api/notices/:id/read` | 标记已读；返回 `{ ok: true }` |
| POST | `/api/workspaces/:id/digest` | 手动生成；返回 `DigestGenerateResponse` |
| GET | `/api/tasks/:id/automation` | 返回 `TaskAutomationSummary` |
| GET | `/api/audit` | `AuditListQuery` → `AuditListResponse`，按 ts 倒序 |

- 所有写操作要求认证；未信任 workspace 的 `PATCH` 返回 `workspace_untrusted`。
- 读取 `/automation` 允许未信任（只读），返回 `trusted:false`。
- `actionPrefix` 只接受 `[a-z.]{1,64}`；查询用参数化 SQL + 转义 `%`/`_`，禁止拼接。
- `GET /api/audit` 只返回 `Audit` 实体；不返回 `detail` 中的 prompt/工具入参全文（新写入的 audit 本身也不含）。

### 8.5 runtime 接线

- `createRuntime` 接收 `automationState`；`createSessionRunner` 的 `killSwitch` 改为 getter：`killSwitch: () => automationState.isKillSwitchOn()`。
- `createTransitionRunner` 在 `start` 时传 `workspaceTrusted = workspace.trusted`；在 `verify_fail` 时同样计算；`autopilot` 由 core 的 effective 规则判断。
- `session-runner` 处理 approval 时，**每次从 workspace 表读取当前 trust**（task.workspaceId → getWorkspace），不依赖启动时快照；`killSwitch` 用动态 getter。trust 撤销后下一次审批立即回到 ask。
- 自动决策 audit detail 增加 `policyVersion`；重试 audit detail 增加 `workspaceId`、`policyVersion`。
- `bootstrap` 加载 kill switch 后创建 runtime；`close` 时先停 digest scheduler，再释放 supervisor/session。
- workspace trust 变更时触发 digest scheduler 重排；撤销信任立即停止该 workspace 的定时任务。

### 8.6 依赖

- `apps/daemon` 增加 `croner`（候选，MIT）；更新 `THIRD_PARTY_NOTICES.md`。
- 实现前核对 registry 的 license、版本、维护状态；不满足则改为只支持默认 `0 9,21 * * *`，并在 `AutomationSummary` 增加 `digestCronUnsupported: true`（仅降级路径，不默认实现）。

## 9. web

### 9.1 自动化设置

`AutomationSettingsDialog`，入口在 workspace 菜单（`WorkspaceSwitcher` 下拉）与顶栏自动化状态。

- 可编辑：
  - `autopilot.enabled`：Switch，默认关。
  - `retryMax`：0–10 的 NumberInput，默认 2。
  - `autoApproveMaxRisk`：low / medium，默认 low；high 不提供。
- 只读：
  - `approval.allow` / `approval.deny` 列表。
  - `verify.command` / `timeoutSec`。
  - `digestCron`。
- 说明文案：
  - 「修改只影响新启动的会话；运行中的任务使用启动时的策略快照。」
  - 「高风险操作永远不会自动批准。」
  - 未信任：「先信任工作区，才能启用自动化。」
- 保存：调用 `PATCH`；成功 toast + invalidate automation/tasks 查询；失败内联错误，不关闭弹窗。
- 最近变更：调用 `GET /api/audit?actionPrefix=automation.&limit=20`；只展示动作、时间、actor；不展示 prompt。

### 9.2 顶栏自动化状态

- 三态：
  - 「自动化关闭」：autopilot 关。
  - 「自动化运行中」：autopilot 开且 kill switch 关。
  - 「自动化已暂停」：kill switch 开或 env 强制。
- kill switch 一键暂停；暂停立即生效，不弹确认。
- 恢复需要进设置弹窗确认；env 强制时按钮禁用并显示原因。
- 状态只用 `DESIGN.md` token；状态不能只靠颜色，必须有文字。

### 9.3 digest 卡

- 位置：`SupervisorPanel` 顶部，消息列表之前。
- 内容：
  - 标题「本轮汇报」+ 生成时间 + 未读圆点。
  - 三个计数：待验收 / 待处理 / 已放弃。
  - 变化行：新建、完成、失败、重试、自动批准、自动拒绝。
  - 最长等待任务（标题 + 等待时长）。
  - 前 3 个 blocked 任务，点击打开任务详情。
- 操作：
  - 「生成汇报」：`POST /api/workspaces/:id/digest`。
  - 「知道了」：`POST /api/notices/:id/read`。
  - 「历史」：展开最近 5 条 digest notice；不新增独立页面。
- 空态：没有 digest 时显示一句说明 + 生成按钮。
- 新 notice 到达：`NoticeEvent` → invalidate notices；不自动抢焦点；`aria-live="polite"` 只播报摘要，不逐字。

### 9.4 任务自动化记录

`TaskAutomationCard` 放在任务详情：

- 「自动批准 N 次 / 自动拒绝 N 次」：工具名、风险、时间、policyVersion。
- 「自动重试 N 次」：retryCount、最近一次 verify 退出码。
- 空态：「本任务没有自动决策」。
- 不展示 transcript、日志、文件内容。
- 数据：`GET /api/tasks/:id/automation`，只在任务详情打开时查询。

### 9.5 看板批量开工

- `TaskBoard` 增加选择模式：
  - 顶部按钮「批量开工」进入选择模式。
  - 只有 `todo` 卡片可选；`queued/running/...` 置灰。
  - 显示「已选 N / 上限 20」。
  - 「全选待办」。
  - 主按钮「开工 N 个」。
- 执行：逐条发送 `task.enqueue`，使用现有 WS 命令客户端；每条 ack 后计数。
- 部分失败：toast「已开工 X 个，Y 个失败」；失败任务保持原状态；不自动重试。
- 成功后退出选择模式并 invalidate tasks。
- 键盘可达；选择框有 label；不使用颜色作为唯一状态。

### 9.6 视觉与无障碍

- 只用 `DESIGN.md` token：`bg-surface`、`border-separator`、`bg-field`、`text-muted`、`bg-accent`、`bg-warning`、`bg-success`、`bg-danger`。
- 禁止硬编码 hex、字号、圆角、间距。
- 设置弹窗、digest 卡、任务自动化卡均支持键盘焦点与 `focus-visible`。
- 移动端不在本迭代；但组件不能假设固定 400px 宽度导致明显破版。

## 10. 安全与隐私

- **信任门槛**：`.baton/policy.json` 来自 workspace，可能是仓库文件；未信任 workspace 的有效 autopilot 恒为 false，UI 也拒绝写。session-runner 每次审批读取当前 trust，trust 撤销立即回到 ask。
- **kill switch 最高优先级**：`BATON_KILL_SWITCH=1` 强制暂停；UI 不允许关闭；自动批准与自动重试都受影响。
- **高风险永不自动批准**：`risk === 'high'` 直接 ask；`autoApproveMaxRisk` 只允许 low/medium。
- **路径 jail**：写入前对 `.baton` 目录做 realpath 校验，阻断软链逃逸；临时文件与目标文件同目录，`rename` 原子替换。
- **审计最小化**：audit 只写 `taskId`、`approvalId`、`risk`、`matchedRule`、`policyVersion`；不写 prompt、工具入参全文、文件内容。
- **digest 最小化**：只含任务标题、状态、attention、等待时长、重试次数；不读 transcript/prompt/文件；不接外部通知。
- **日志**：pino 只记 `workspaceId`、`action`、`policyVersion`、`durationMs`、错误码；不记任务标题、prompt、allow/deny 全量内容。
- **调度防噪**：只有可信 workspace 自动调度 digest；`digestCron` 非法时停用定时，保留手动。
- **保留**：notice 内容不改写，只更新 `readAt`；audit 只追加。v0 不做自动清理，后续按真实体积加保留策略。

## 11. 错误码

| 错误码 | HTTP | 场景 |
|---|---|---|
| `invalid_policy` | 400 | patch/schema 非法，或字段越界 |
| `workspace_untrusted` | 409 | 未信任 workspace 尝试修改自动化 |
| `policy_write_failed` | 500 | policy 落盘失败 |
| `kill_switch_forced` | 409 | env 强制暂停时尝试关闭 |
| `notice_not_found` | 404 | notice 不存在 |
| `digest_generation_failed` | 500 | digest 生成失败 |

工具内部沿用 `workspace_not_found`、`task_not_found`、`invalid_payload`。

## 12. 测试与验收

### 12.1 core

- effective autopilot 矩阵：`enabled × trusted × killSwitch`；覆盖 `evaluateApproval` 与 `verify_fail`。
- `buildDigest` 快照：空 workspace、混合状态、attention 细分、window 边界、dropped、20 条截断、无敏感字段。
- policy patch schema：只接受三个字段；负 retryMax、high risk、额外字段被拒绝。
- 现有 transition/policy 快照更新；不改变已锁定的状态机语义。

### 12.2 daemon

- policy 读写：默认 policy、已有文件合并、原子写、软链逃逸拒绝、未信任拒绝。
- kill switch：动态生效（无需重启）、停自动批准、停自动重试、env 强制、audit。
- digest：手动/定时、窗口计算、无任务跳过、notice 落库 + WS 回放、`last_digest_at` 更新。
- 任务自动化记录：自动审批、重试、策略版本；不返回 transcript。
- migration 0007：空库升级与已有任务/notice 升级。
- 批量开工：混合状态部分失败、单批上限、幂等。
- `GET /api/audit` 分页与 prefix 过滤。

### 12.3 web / Playwright

- 设置弹窗：读取、修改、保存、未信任提示、错误回显。
- kill switch：一键暂停、顶栏状态、恢复确认。
- digest 卡：未读、生成、标记已读、历史展开、任务跳转。
- 任务自动化卡：自动批准/重试记录、空态。
- 看板批量开工：选择、全选、部分失败、上限。
- 全部 REST/WS mock，不依赖本机 daemon。

### 12.4 真实链路（ego-lite + 真实 Claude）

1. 信任 workspace，打开自动化设置，开启 autopilot（retryMax=1，风险 low）。
2. 通过总管或画布创建 3 个任务，看板批量开工。
3. 低风险审批自动通过；verify 失败自动重试一次；任务进入 `review`。
4. 打开 digest，断言 ready/blocked/dropped、变化计数、最长等待与看板一致。
5. 开启 kill switch，再触发一个审批/verify 失败，断言不自动批准、不自动重试。
6. 人工验收仍然生效；总管仍不能开工/验收/打回。
7. 截图脱敏，证据落 `docs/evidence/2026-11-19-m2-autopilot/`。

### 12.5 命令

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
grep -RIn "croner" apps/daemon/package.json THIRD_PARTY_NOTICES.md
grep -RIn "killSwitch" packages/core/src apps/daemon/src | head
```

## 13. 性能与风险

| 风险 | 影响 | 对策 |
|---|---|---|
| 未信任 workspace 通过 policy 自助提权 | 自动批准危险操作 | effective autopilot 强制 trust；UI 拒绝写；每次审批读取当前 trust；矩阵测试 |
| kill switch 只停批准、不停重试 | 停不干净 | core 同时检查 killSwitch；真实链路验证 |
| policy 文件写入与 audit 非原子 | 极端情况下有文件变更但无 audit | 先文件后 audit；失败返回错误并记 `audit_write_failed`；不静默 |
| policy 写入软链逃逸 | 写穿 workspace | `.baton` 目录 realpath + 同目录临时文件 + audit 失败 |
| digest 定时过密 | DB/CPU 噪音 | 只可信 workspace 调度；cron 非法停用；手动兜底 |
| cron 依赖不合规 | 构建/许可风险 | 实现前核对 registry；不满足退化为默认两档 |
| notice 体积增长 | 查询变慢 | 分页 + 20 条截断；后续保留策略 |
| audit 增长 | 查询变慢 | `(action, ts)` 索引；v0 不清理，按体积再加 |
| 批量开工误触 | 过多任务同时启动 | 单批上限 20；只允许 todo；逐条 ack；部分失败可见 |
| digest 含敏感标题 | 本地泄露 | 只站内、不外部、不日志；截图脱敏 |
| policy 改动影响运行中任务 | 行为漂移 | 启动时快照；UI 明示 |

## 14. 实施切片

1. **Plan 1 契约 + core + migration**：`automation.ts`、`Notice` 扩展、`NoticeEvent`、effective autopilot、digest 纯函数、migration 0007、协议/core 测试。
2. **Plan 2 daemon**：policy writer、automation state/service、digest/scheduler、notice/audit/task automation REST、runtime 接线、集成测试。
3. **Plan 3 web**：设置弹窗、顶栏状态、digest 卡、任务自动化卡、看板批量开工、组件测试。
4. **Plan 4 验收**：Playwright、ego-lite 真实链路、证据、`docs/README.md` 索引。

每片结束跑 `pnpm verify`；第 4 片结束跑 `pnpm verify:full` 与 `pnpm pack:check`。

## 15. 未来路线（不在本 spec）

- **M2-2b 移动端只读**：手机看板 + 任务详情 + 通过/打回；不提供画布编辑。
- **外部 Source**：v1 之后再做；GitHub 先、飞书后；需要 actor/admission/policy version/Subscription。
- **M1-7b**：partial streaming、cost/turn、idle eviction/resume、session-level allow，按真实痛点插队。
- **`check:secrets`**：gitleaks 或等价工具进 CI，v1 收口前完成。
- **notice/audit 保留策略**：按真实体积决定。
- **allow/deny 编辑器**：等真实配置痛点出现再做。
- **observe/auto**：仍只建 `todo`，不自动开工。

## 16. 评审记录

- 2026-11-19：用户确认下一迭代为「无人值守与汇报 v0」；配置真源为 workspace `.baton/policy.json`，UI 只写三个字段；保持人工开工 + 看板批量开工；kill switch 只停自动批准/重试、不杀会话；digest 站内 + 9/21 + 手动；移动端拆到 M2-2b；审计为任务详情 + 设置页最近变更；批量开工 P0。设计通过。
- 2026-11-19：用户审阅 spec 正文通过；进入 sprint contract 与实施计划。
