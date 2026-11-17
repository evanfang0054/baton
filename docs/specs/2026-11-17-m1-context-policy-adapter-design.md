---
spec_topic: m1-context-policy-adapter
decision_summary: "M1-3 + M1-4：core 上下文装配/policy 求值/verify 解析，protocol AgentAdapter 契约，agent-fake；daemon/DB/WS 留给 M1-5"
design_approved: true
user_approved_at: 2026-11-17T08:06:49+08:00
gates: [user-review-passed]
spec_ref: 2026-11-16-baton-architecture-design.md
---

# M1-3 + M1-4 上下文、策略与适配器契约设计

> 子 spec。回链主架构：`docs/specs/2026-11-16-baton-architecture-design.md`。
> 前置：`docs/specs/2026-11-17-m1-protocol-state-machine-design.md`（已合并）。
> 本文只锁定 M1-3（上下文装配 + policy + verify 解析）与 M1-4（`AgentAdapter` + `agent-fake`）；daemon task runner、event store、WS 路由与 verify 执行留给 M1-5。

## 0. 文档信息

- **状态**：设计草案，待用户评审。
- **范围**：`packages/protocol` 的 `AgentAdapter` 契约与 policy 默认规则；`packages/core` 的上下文装配、policy 求值、verify 命令解析；新增 `packages/adapters` 的 `agent-fake`。
- **不在范围**：`apps/daemon`、`apps/web`、SQLite migration、event store、WS 路由、verify 执行器、`agent-claude`、worktree。
- **文档位置**：spec 落 `docs/specs/`，contract 落 `docs/contracts/`，plan 落 `docs/plans/`，与 M0/M1-1 一致。

## 1. 背景

M1-1/M1-2 已合并：协议实体、WS 命令/事件、AG-UI 包装与纯状态机就绪。当前缺口是“运行时接线前的三块地基”：

- daemon 需要知道**给引擎的 prompt 长什么样**，但现在没有上下文装配器。
- 引擎需要知道**哪些工具调用可以自动放行、哪些必须问人**，但现在没有 policy 求值器。
- 任务结束需要**确定跑哪条 verify 命令**，但现在没有解析器。
- 上层需要一个**稳定的 `AgentAdapter` 接口**与可确定性测试的 `agent-fake`，否则 M1-5 会把调度和引擎细节搅在一起。

这四块都是纯函数或纯类型，不依赖 DB/WS/子进程。先把它们和测试锁死，M1-5 的 daemon runner 才能只做“状态机 + effects + IO”的接线，而不是边写边定义语义。

## 2. 目标与非目标

### 2.1 目标

1. 在 `packages/protocol` 定义 `AgentAdapter`、`StartInput`、`AgentRun`、`PolicySnapshot`，供 adapters/daemon 共享。
2. 在 `packages/core` 实现纯函数：
   - `assembleContext`：确定性上下文装配；
   - `evaluateApproval` / `classifyRisk`：policy 求值与风险分级；
   - `resolveVerifyCommand`：verify 命令解析。
3. 新增 `packages/adapters` 与 `agent-fake`：按脚本产生 AG-UI 事件、授权请求与结束事件。
4. 用快照、表驱动与边界测试锁定语义；`packages/core` 覆盖率 ≥ 80%。
5. 给 M1-5 一个可直接调用的“消费形态”示例（类型级 + 测试 fixture），不再二次定义输入/输出。

### 2.2 非目标（本切片不做）

- daemon 的 task runner、session 生命周期、approval/review 持久化。
- `ws_event` 表、`event.ordinal`、`resume` 重放、WS 路由。
- verify 执行器（execa、超时、进程组、diff stat）。
- `agent-claude` / `agent-pty`；真实引擎接入。
- 画布命令、web UI、worktree、自动汇报、DSH、向量召回。
- `ack.data`、`BATON_MAX_CONCURRENCY`、路径 jail、重启恢复。

## 3. 关键决策

| # | 决策 | 结论 | 理由 |
|---|---|---|---|
| D1 | 切片范围 | M1-3 + M1-4，只做纯函数与适配器契约 | 先把输入/输出与测试锁死；M1-5 只做接线 |
| D2 | `AgentAdapter` 位置 | `packages/protocol` 放 type-only 契约；`packages/adapters` 实现 | daemon/adapters 共享稳定边界；core 不依赖适配器 |
| D3 | 上下文装配 | core 纯函数；调用方预读文件内容并传入 `contentByNodeId` | core 不碰 IO；快照可复现 |
| D4 | 上下文选择 | 显式选择 + 目标 Agent 的直接 `context` 前驱为 depth 0；反向闭包 depth ≤ 2、节点 ≤ 40 | 对应 baton.ai 的“框选 + 连线硬投喂”；不引入向量召回 |
| D5 | policy 规则语法 | 统一 glob（`picomatch@4`，MIT）；`Tool` 精确、`Tool:pattern` glob | 当前默认值混用 glob/正则，必须先统一 |
| D6 | 风险判定 | core 计算 `classifyRisk`，最终取 `max(adapter 声明, 计算值)`；未知工具按 `high` | deny-first，不信任单一来源 |
| D7 | 自动批准 | 命中 allow + risk ≤ 阈值 + autopilot.enabled + killSwitch=false；否则 ask；deny 永远 deny | 与主 spec 2.8 一致；审计由 M1-5 写 |
| D8 | verify 解析 | 任务级 > policy > `package.json` 的 `verify` script > `pnpm test`；运行时失败再提示配置 | 与主 spec 2.9 一致；纯函数 |
| D9 | fake adapter | 构造时注入步骤脚本；默认 text → approval → text → finish | 确定性；测试可换脚本；不解析模型输出 |
| D10 | 默认 policy 规则 | `Bash:pnpm (test|...)` 改为 glob 写法；其余 glob 规则保持 | 只改默认字符串，不改 `PolicySchema` 类型 |

## 4. 契约

### 4.1 `AgentAdapter`（packages/protocol）

新增 `packages/protocol/src/adapter.ts`，只放类型与别名，不引入运行时依赖：

```ts
import type { AgentEvent } from './agui.js'
import type { Policy } from './policy.js'
import type { Engine } from './enums.js'

export type PolicySnapshot = Policy

export interface StartInput {
  prompt: string
  cwd: string
  systemPrompt?: string
  resumeSessionId?: string
  permissionMode: 'manual' | 'acceptEdits' | 'plan'
  policy: PolicySnapshot
}

export interface AgentRun {
  events: AsyncIterable<AgentEvent>
  approve(requestId: string, decision: 'allow' | 'deny', note?: string): Promise<void>
  send(text: string): Promise<void>
  interrupt(): Promise<void>
  dispose(): Promise<void>
}

export interface AgentAdapter {
  readonly name: Engine
  start(input: StartInput): Promise<AgentRun>
}
```

约定：

- 适配器不写 DB、不发 WS；只返回事件流并接受控制调用。
- `CUSTOM` 事件的 name 约定：`approval.request`；`value` 形状为 `{ requestId: string; request: ApprovalRequest }`。
- `AgentRun.events` 结束表示本次执行结束；`interrupt` 后事件流必须在有限时间内结束。
- `send` 在 M1 仅保留接口，用于后续打回/追加指令；本切片的 fake 会把它映射为一条文本事件。
- `PolicySnapshot` 不接受外部可变对象语义；调用方传入的是只读快照（`Policy` 的只读视图）。

### 4.2 上下文装配（packages/core/src/context）

```ts
export interface AssembleContextInput {
  taskPrompt: string
  targetNodeId: string
  selectedNodeIds: string[]
  nodes: Node[]
  edges: Edge[]
  /** 调用方预读的文件内容；key 为 node id；null 表示已判定不可读。 */
  contentByNodeId?: Readonly<Record<string, string | null>>
  maxChars?: number // default 48_000（约 12k token）
  maxNodeChars?: number // default 16_384
}

export interface AssembleContextResult {
  prompt: string
  included: Array<{ id: string; type: NodeType; depth: number; chars: number }>
  dropped: Array<{
    id: string
    reason: 'budget' | 'sensitive' | 'limit' | 'not_found' | 'target' | 'empty'
  }>
  truncated: boolean
  redactedPaths: string[]
}

export function assembleContext(input: AssembleContextInput): AssembleContextResult
```

算法：

1. **种子集**：`selectedNodeIds` 与“目标 Agent 的直接 context 前驱”合并；depth 0。
2. **闭包**：沿 `context` 边反向 BFS，depth ≤ 2，节点总数 ≤ 40；去重保留最低 depth。
3. **排除**：目标 Agent 自身；`review` 节点；`agent` 节点不作为内容源。
4. **group**：只有 group 被显式选中时才展开其子节点（`groupId === group.id`），子节点按 depth 0 处理；group 本身不产出内容。
5. **排序**：`(depth, y, x, id)`；不依赖 Map 迭代顺序。
6. **渲染**：
   - `text` 取 `data.content`；
   - `file` 取 `contentByNodeId[id]`，无内容时只输出 `path`；
   - `image` 输出 `src` 与可选 `alt`；
   - 每段包成 `<node id="..." type="..." title="...">...</node>`。
   - `title` 规则：`text` 取首个非空行（截断 60 字符）；`file` 取 `name`；`image` 取 `alt` 或 `image`。
7. **脱敏**：`isSensitivePath(path)` 命中 `.env*`、私钥、`*secret*` 时跳过并记入 `dropped` 与 `redactedPaths`；调用方读取前也必须再判一次。
8. **预算**：单节点超过 `maxNodeChars` 时截断并标记 `truncated="true"`；总量超过 `maxChars` 时先丢最深上游（同深度按 `(y,x,id)` 倒序），显式节点最后才硬截断。
9. **输出**：`<task>...</task>` + `<context>...</context>` + 可选 `<truncated nodes="..."/>`；v1 不输出空的 `<constraints>`。
10. **确定性**：同一输入必须逐字节相同；测试用快照锁定。

`isSensitivePath(path)` 由 core 导出，规则固定为：路径任一段匹配 `.env*`、`*.pem`、`*.key`、`id_rsa*`、`id_ed25519*`、`*secret*`（大小写不敏感）。它只做字符串判断，不读文件。

**去重规则**：同一节点被显式选中、又通过边/group 到达时，保留最低 depth；同一 depth 保留排序最靠前的一次。`included` 按最终渲染顺序输出。

### 4.3 Policy 求值（packages/core/src/policy）

```ts
export interface PolicyContext {
  killSwitch: boolean
}

export interface PolicyDecision {
  decision: 'allow' | 'deny' | 'ask'
  risk: RiskLevel
  matchedRule?: string
  autoApproved: boolean
  reason: string
}

export function evaluateApproval(
  policy: Policy,
  request: ApprovalRequest,
  ctx: PolicyContext,
): PolicyDecision

export function classifyRisk(toolName: string, input: unknown): RiskLevel
```

规则语法：

- `Tool`：精确匹配 `toolName`。
- `Tool:pattern`：用 `picomatch` 匹配 `toolName` 对应的“匹配目标”：
  - `Bash` / `Shell`：匹配 command 字符串；
  - `Edit` / `Write` / `Read` / `Grep` / `Glob`：匹配文件路径（`input.file_path` / `input.path`）；
  - 其他工具：匹配 `JSON.stringify(input)` 的稳定序列化结果；
  - 无目标时视为不匹配。
  - picomatch 使用 `{ dot: true, bash: true }`：`*` 可跨 `/`，以匹配整条 shell 命令字符串。
- `deny` 先于 `allow`；都未命中时用 `policy.approval.default`（当前固定 `ask`）。
- 风险：core 计算 `classifyRisk`，最终风险取 `max(request.risk, computed)`；`high` 永不自动批准。
- 自动批准条件（全部满足）：命中 `allow`、`risk <= autoApproveMaxRisk`、`policy.autopilot.enabled`、`ctx.killSwitch === false`。
- `decision` 表示**当前可执行动作**：`allow` 只在自动批准条件全部满足时返回；命中 allow 但条件不满足时返回 `ask`，并在 `matchedRule` 中保留规则；`deny` 永远返回 `deny`。
- 返回值：`autoApproved` 仅在自动批准时为 true；`reason` 用于审计，不得包含敏感输入全文。
- 纯函数，无 IO；audit 写入由 M1-5 负责。

风险分级（`classifyRisk`）：

| 级别 | 典型工具/输入 |
|---|---|
| `low` | `Read`、`Grep`、`Glob`、`LS`、`NotebookRead`；只读且不触网的命令 |
| `medium` | `Edit` / `Write` / `NotebookEdit` 且路径在工作区内；`Bash` 中的 test/lint/typecheck/build/status/diff 等本地命令 |
| `high` | `WebFetch` / 网络命令；`sudo`、`rm -rf`、`curl ... | sh`、`git push`、包安装；工作区外写入；未知工具或无法判定的输入 |

未知工具默认 `high`，确保不会被自动批准。工作区边界由 `input.cwd` / `input.file_path` 的字符串前缀判断；本切片不读文件系统，也不做 realpath。

### 4.4 Verify 命令解析（packages/core/src/verify）

```ts
export interface VerifyCommandInput {
  taskCommand?: string
  policyCommand?: string
  packageScripts?: Readonly<Record<string, string>>
  packageManager?: 'pnpm' | 'npm' | 'yarn'
}

export type VerifyCommandSource = 'task' | 'policy' | 'package' | 'fallback'

export type VerifyCommandResult =
  | { ok: true; command: string; source: VerifyCommandSource }
  | { ok: false; error: AppError }

export function resolveVerifyCommand(input: VerifyCommandInput): VerifyCommandResult
```

优先级：

1. `taskCommand`；
2. `policyCommand`；
3. `packageScripts.verify` → `${packageManager} run verify`（默认 `pnpm`）；
4. 回退 `pnpm test`（source `fallback`）；命令不存在时由 M1-5 的 verify executor 失败并进入 review，错误信息提示配置 verify；
5. 只有显式配置冲突/非法输入才返回 `invalid_payload`。

纯函数，不读文件系统；`packageScripts` 与 `packageManager` 由 M1-5 的 daemon 解析后传入。

### 4.5 `agent-fake`（packages/adapters）

- 新 package `@baton/adapters`，`main: ./src/index.ts`，依赖 `@baton/protocol`；不加运行时依赖。
- `FakeAdapter` 构造参数：`{ script: FakeStep[]; threadId?: string }`。
- 默认脚本：`RUN_STARTED` → `TEXT_MESSAGE_START/CONTENT/END("fake: working")` → `CUSTOM approval.request` → 等待 `approve` → `TEXT_MESSAGE_*("fake: approved")` → `RUN_FINISHED`。
- `FakeStep`：
  ```ts
  type FakeStep =
    | { kind: 'text'; text: string }
    | { kind: 'approval'; request: ApprovalRequest }
    | { kind: 'finish' }
    | { kind: 'error'; message: string }
  ```
- `approve(allow)` 后继续；`approve(deny)` 输出 `fake: denied` 后结束；`interrupt` 结束事件流；`send` 追加一条文本事件；`dispose` 清理。
- 事件用 `@baton/protocol` 的 `EventType` 常量构造；测试中用 `EventSchemas` 校验每个事件。
- 适配器不读 DB、不发 WS、不读文件系统；不使用定时器/随机数，保证确定性。

### 4.6 默认 policy 规则调整（packages/protocol）

只改默认字符串，不改 `PolicySchema` 类型：

- `Bash:pnpm (test|lint|typecheck|build|install --frozen-lockfile)` → `Bash:pnpm {test,lint,typecheck,build,install --frozen-lockfile}`
- 其余 `Bash:rm -rf *`、`Bash:curl * | sh`、`Bash:git push *` 保持 glob 语义；`Edit:src/**` 等路径规则不变。

`PolicySchema` 的空对象 parse 默认值测试同步更新；`@baton/protocol` 仍不引入 picomatch（匹配在 core）。

### 4.7 包与依赖

- `packages/core` 新增运行时依赖 `picomatch@^4.0.7`（MIT）；仍是纯函数层，不 import `node:*`。
- `packages/adapters` 只依赖 `@baton/protocol`；无运行时第三方依赖。
- `packages/protocol` 不新增运行时依赖；`adapter.ts` 只导出类型。
- `THIRD_PARTY_NOTICES.md` 增加 `picomatch`；若已有 transitive 依赖，注明直接依赖。
- 不引入 GPL/AGPL/Sustainable Use 依赖；不 fork Claude SDK。

## 5. M1-5 的消费形态（本切片要固定的接口）

M1-5 的 daemon runner 只应做以下接线，不再定义新语义：

```ts
const assembled = assembleContext({
  taskPrompt: task.prompt,
  targetNodeId: task.nodeId,
  selectedNodeIds: command.contextNodeIds,
  nodes,
  edges,
  contentByNodeId: await readNodeContents(nodes), // daemon IO
})

const verify = resolveVerifyCommand({
  taskCommand: task.verifyCommand ?? undefined,
  policyCommand: policy.verify.command,
  packageScripts: readPackageScripts(workspace),
  packageManager: 'pnpm',
})

const decision = evaluateApproval(policy, request, { killSwitch })

const run = await adapter.start({
  prompt: assembled.prompt,
  cwd: workspacePath,
  permissionMode: 'manual',
  policy, // PolicySnapshot
})

for await (const event of run.events) {
  // persist + broadcast
}
```

测试 fixture 至少要证明：

- `assembleContext` 的输出可以直接作为 `StartInput.prompt`；
- `policy` 可以直接作为 `StartInput.policy`（`PolicySnapshot` 别名）；
- `evaluateApproval` 的 `allow` / `deny` 可以直接传给 `AgentRun.approve`；
- `resolveVerifyCommand` 的输出是 `string` 命令，不需要二次解析。

## 6. 测试与验收

### 6.1 单元测试

- **context**：六类节点、group 展开、显式优先、深度 2/节点 40 边界、去重、预算截断、单节点截断、敏感路径、空内容、缺失节点、确定性快照。
- **policy**：deny > allow > ask、glob 路径/命令、未知工具、风险取 max、四条件自动批准、kill switch、默认规则改写、`reason` 不含敏感全文。
- **verify resolver**：四级优先级、无配置回退、非法输入。
- **agent-fake**：默认脚本事件序列、approval allow/deny、interrupt、send、每个事件通过 `EventSchemas`。
- **protocol**：`AgentAdapter` 导出、`PolicySnapshot` 别名、默认 policy 数组、`PolicySchema` 既有测试。
- **消费形态**：`packages/core/test/consumption.test.ts`（或等价 fixture）验证第 5 节的类型与调用链。

### 6.2 验收命令

```bash
pnpm verify
pnpm check:boundaries
pnpm check:protocol
pnpm format:check
pnpm --filter @baton/core test
pnpm --filter @baton/adapters test
git diff --name-only main...HEAD -- apps   # 必须为空
```

- `packages/core` 覆盖率 ≥ 80%；新增 core 代码不得 import `node:*` 或 `apps/*`。
- `pnpm pack:check` 仍通过（新增 workspace 包不得影响 tarball 链路）。
- 测试在本地 10 秒内完成（纯函数 + fake adapter，无子进程）。

### 6.3 DoD 摘要

- 三个 core 纯函数可用、有快照/表驱动测试、无 IO。
- `AgentAdapter` 契约稳定，`agent-fake` 可确定性复现。
- 默认 policy 规则统一为 glob，既有协议测试全绿。
- 不修改 `apps/**`；daemon/DB/WS 留给 M1-5。
- 文档、许可、边界检查与全量 verify 全绿。

## 7. 任务拆分建议（5 个 Task，一个 PR）

1. **protocol adapter + policy 默认规则**：`adapter.ts`、导出、默认 Bash 规则改 glob、协议测试。
2. **core context assembler**：类型、算法、敏感路径、快照与边界测试。
3. **core policy + verify resolver**：picomatch、匹配、风险、自动批准、解析器、表驱动测试、notices。
4. **agent-fake**：`packages/adapters` 脚手架、FakeAdapter、事件脚本、测试。
5. **消费形态 fixture + 文档 + 全量验收**：第 5 节的调用链测试、spec/contract/plan 互链、coverage、`pnpm verify`。

## 8. 风险

| 风险 | 影响 | 对策 |
|---|---|---|
| 上下文格式在 M1-5 前没有真实消费者 | 格式返工 | 第 5 节固定消费形态；M1-5 只接线不重定义 |
| `AgentAdapter` 与真实 Claude SDK 不匹配 | M1-7 返工 | 只保留主 spec 2.6 的最小接口；M1-7 用同一接口验证，差异走新 spec |
| policy glob 与旧默认值不兼容 | 旧配置行为变化 | 只改默认字符串；spec/contract 说明；`PolicySchema` 类型不变 |
| `picomatch` 进入 core 破坏纯净性 | 分层争议 | 零依赖、纯函数、MIT；仍禁止 `node:*`；boundaries 检查 |
| 风险分级过于粗糙 | 自动批准误放行 | 未知工具 high；high 永不自动批准；表驱动测试 |
| fake adapter 过于理想化 | 与真实引擎事件差异 | 只保证 AG-UI 事件形状；M1-7 用同一契约做差异测试 |

## 9. 后续映射

| 后续任务 | 本切片留给它的东西 |
|---|---|
| M1-5 daemon runner | `assembleContext` / `evaluateApproval` / `resolveVerifyCommand` / `AgentAdapter` / `agent-fake` 的稳定输入输出 |
| M1-6 web | 上下文装配结果、policy 判定与 review 数据的展示口径 |
| M1-7 agent-claude | `AgentAdapter`、`StartInput`、`AgentRun`、approval CUSTOM 约定 |
| M2 | 自动批准 UI、kill switch 持久化、自动重试复用 `PolicyDecision` |

## 10. 自审记录

- **占位符扫描**：无 `TODO`/`TBD`/未完成段落；后续任务均有映射。
- **范围检查**：只改 `packages/{protocol,core,adapters}`、docs、notices、lockfile；`apps/**` 不动。
- **内部一致性**：`AgentAdapter` 与主 spec 2.6 一致；`PolicyDecision`/`RiskLevel` 与 `PolicySchema` 一致；`AssembleContextResult` 的 `dropped.reason` 与算法一一对应；第 5 节消费形态与第 4 节类型一致。
- **歧义检查**：`activeCount` 等 daemon 语义不在本切片；`verify` 只解析不执行；`task.create` 的 ack 扩展留给 M1-5；`isSensitivePath` 只做字符串判断。
- **安全**：示例数据均为占位值；不写本机路径、token、个人信息。
- **结构校验替代**：仓库无 `scripts/validate-handoff.sh`；按项目约定手工检查 frontmatter、链接与占位符。
