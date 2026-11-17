---
spec_ref: ../specs/2026-11-17-m1-context-policy-adapter-design.md
spec_topic: m1-context-policy-adapter
task_count: 5
estimated_phases: [tests, implementation, verification]
dod: "M1-3/M1-4：core assembleContext/evaluateApproval/resolveVerifyCommand、protocol AgentAdapter、agent-fake；apps/** 不动；pnpm verify 全绿"
depends_on: docs/specs/2026-11-17-m1-protocol-state-machine-design.md
---

# M1-3 + M1-4 上下文、策略与适配器实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use agent-harness:subagent-driven-development (recommended) or agent-harness:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 在不改 daemon/web/DB 的前提下，交付 M1-5 可直接调用的三个 core 纯函数、`AgentAdapter` 契约与可确定性测试的 `agent-fake`。

**Architecture:** 自下而上：protocol 先加 type-only 适配器契约与 policy 默认 glob；core 增加 context/policy/verify 三个纯函数模块；adapters 实现 `FakeAdapter`；最后用消费 fixture 证明这些输出能直接接入 M1-5 的 `StartInput` / `AgentRun.approve`。

**Tech Stack:** TypeScript strict ESM、pnpm 10、vitest 5、`@ag-ui/core@1.0.4`、`picomatch@4`（core 运行时）、`@types/picomatch`（core 开发依赖）。

**Scope guard:** 本计划只允许改 `packages/protocol/**`、`packages/core/**`、`packages/adapters/**`、`docs/**`、`THIRD_PARTY_NOTICES.md`、`pnpm-lock.yaml`。`apps/**` 必须为空 diff。

**GDD:** 显式跳过。测试设计由 spec 第 6 节、contract 的 25 条 DoD 与本计划的逐 Task 断言承担。

**Commit strategy:** 按 M1-1/M1-2 先例，每个 Task 结束提交一次；提交前跑该 Task 的定向测试，Task 5 跑全量 `pnpm verify`。

---

## 文件结构

```text
packages/
├── protocol/
│   ├── src/
│   │   ├── adapter.ts                 # 新增：AgentAdapter / StartInput / AgentRun / PolicySnapshot
│   │   ├── index.ts                   # 修改：导出 adapter
│   │   └── policy.ts                  # 修改：默认 Bash 规则改 glob
│   └── test/
│       ├── exports.test.ts            # 修改：adapter 导出
│       └── policy-defaults.test.ts    # 新增：默认数组精确断言
├── core/
│   ├── src/
│   │   ├── context/
│   │   │   ├── types.ts               # 输入/输出类型
│   │   │   ├── sensitive.ts           # isSensitivePath
│   │   │   ├── assemble.ts            # 算法
│   │   │   └── index.ts               # 导出
│   │   ├── policy/
│   │   │   ├── types.ts               # PolicyDecision / PolicyContext
│   │   │   ├── match.ts               # 规则匹配
│   │   │   ├── risk.ts                # classifyRisk
│   │   │   ├── evaluate.ts            # evaluateApproval
│   │   │   └── index.ts
│   │   ├── verify/
│   │   │   ├── types.ts
│   │   │   ├── resolve.ts
│   │   │   └── index.ts
│   │   └── index.ts                   # 修改：导出三个模块
│   └── test/
│       ├── context.test.ts            # 新增
│       ├── policy.test.ts             # 新增
│       ├── verify.test.ts             # 新增
│       └── consumption.test.ts        # 新增：M1-5 消费形态
└── adapters/
    ├── package.json                   # 新增
    ├── tsconfig.json                  # 新增
    ├── src/
    │   ├── fake.ts                    # FakeAdapter
    │   └── index.ts
    └── test/
        └── fake.test.ts               # 新增
```

---

## Task 1: Protocol AgentAdapter 契约与 policy 默认 glob

**Blocking:** none
**Slice type:** tracer-bullet
**Seam:** `import type { AgentAdapter } from '@baton/protocol'`；`PolicySchema.parse({})`

**Files:**
- Create: `packages/protocol/src/adapter.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/src/policy.ts`
- Modify: `packages/protocol/test/exports.test.ts`
- Create: `packages/protocol/test/policy-defaults.test.ts`

**Interfaces:**
- Produces: `AgentAdapter`、`StartInput`、`AgentRun`、`PolicySnapshot`
- Consumes: `AgentEvent`（`./agui.js`）、`Policy`（`./policy.js`）、`Engine`（`./enums.js`）

- [x] **Step 1: 写失败测试（adapter 导出）**

在 `packages/protocol/test/exports.test.ts` 追加：

```ts
import type { AgentAdapter, AgentRun, PolicySnapshot, StartInput } from '../src/adapter.js'
import { PolicySchema } from '../src/policy.js'

it('exports the AgentAdapter contract', async () => {
  const adapter: AgentAdapter = {
    name: 'fake',
    async start(input: StartInput): Promise<AgentRun> {
      const snapshot: PolicySnapshot = input.policy
      expect(snapshot.approval.default).toBe('ask')
      return {
        events: (async function* () {})(),
        approve: async () => {},
        send: async () => {},
        interrupt: async () => {},
        dispose: async () => {},
      }
    },
  }

  const run = await adapter.start({
    prompt: 'demo',
    cwd: '/workspace/demo',
    permissionMode: 'manual',
    policy: PolicySchema.parse({}),
  })
  expect(adapter.name).toBe('fake')
  await run.dispose()
})
```

- [x] **Step 2: 写失败测试（默认 policy glob）**

新建 `packages/protocol/test/policy-defaults.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { PolicySchema } from '../src/policy.js'

describe('policy defaults', () => {
  it('uses glob syntax for the default Bash rule', () => {
    const policy = PolicySchema.parse({})
    expect(policy.approval.allow).toEqual([
      'Read',
      'Grep',
      'Glob',
      'Edit:src/**',
      'Edit:tests/**',
      'Bash:pnpm {test,lint,typecheck,build,install --frozen-lockfile}',
    ])
    expect(policy.approval.deny).toEqual([
      'Bash:sudo *',
      'Bash:rm -rf *',
      'Bash:curl * | sh',
      'Bash:git push *',
      'Edit:**/.env*',
      'Edit:.git/**',
    ])
    expect(policy.approval.allow.some((rule) => rule.includes('(test|'))).toBe(false)
  })
})
```

- [x] **Step 3: 运行测试确认失败**

```bash
pnpm --filter @baton/protocol test
```

Expected: FAIL，`../src/adapter.js` 不存在；默认 allow 数组仍含 `(test|lint|...)`。

- [x] **Step 4: 创建 `packages/protocol/src/adapter.ts`**

```ts
import type { AgentEvent } from './agui.js'
import type { Engine } from './enums.js'
import type { Policy } from './policy.js'

/** 执行期只读的策略快照；M1-5 由 daemon 从 PolicySchema 解析后传入。 */
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

- [x] **Step 5: 导出 adapter**

在 `packages/protocol/src/index.ts` 的 `agui.js` 导出旁增加：

```ts
export * from './adapter.js'
```

- [x] **Step 6: 修改默认 policy 规则**

在 `packages/protocol/src/policy.ts` 的 `DEFAULT_ALLOW` 中把：

```ts
'Bash:pnpm (test|lint|typecheck|build|install --frozen-lockfile)',
```

改为：

```ts
'Bash:pnpm {test,lint,typecheck,build,install --frozen-lockfile}',
```

- [x] **Step 7: 运行测试确认通过**

```bash
pnpm --filter @baton/protocol test
pnpm --filter @baton/protocol typecheck
```

Expected: PASS；typecheck 退出码 0。

- [x] **Step 8: 提交**

```bash
git add packages/protocol/src/adapter.ts packages/protocol/src/index.ts packages/protocol/src/policy.ts packages/protocol/test/exports.test.ts packages/protocol/test/policy-defaults.test.ts
git commit -m "feat(protocol): 增加 AgentAdapter 契约并统一 policy glob 默认值"
```

---

## Task 2: Core 上下文装配

**Blocking:** Task 1（使用 protocol 的 `Node`/`Edge`/`NodeType` 类型）
**Slice type:** tracer-bullet
**Seam:** `assembleContext(input)` 的确定性 `prompt` 快照

**Files:**
- Create: `packages/core/src/context/types.ts`
- Create: `packages/core/src/context/sensitive.ts`
- Create: `packages/core/src/context/assemble.ts`
- Create: `packages/core/src/context/index.ts`
- Modify: `packages/core/src/index.ts`
- Create: `packages/core/test/context.test.ts`

**Interfaces:**
- Produces:
  ```ts
  assembleContext(input: AssembleContextInput): AssembleContextResult
  isSensitivePath(path: string): boolean
  ```
- Consumes: `Node`、`Edge`、`NodeType` from `@baton/protocol`

- [x] **Step 1: 写失败测试（fixture + 基础渲染）**

新建 `packages/core/test/context.test.ts`：

```ts
import { Edge, Node } from '@baton/protocol'
import { describe, expect, it } from 'vitest'
import { assembleContext, isSensitivePath } from '../src/context/index.js'

const node = (
  id: string,
  type: Node['type'],
  data: unknown,
  x: number,
  y: number,
  groupId: string | null = null,
) =>
  Node.parse({
    id,
    canvasId: 'c1',
    type,
    data,
    x,
    y,
    groupId,
    createdAt: 1,
    updatedAt: 1,
  })

const edge = (id: string, sourceId: string, targetId: string) =>
  Edge.parse({ id, canvasId: 'c1', sourceId, targetId, type: 'context' })

const target = node('n4', 'agent', { title: 'Agent', engine: 'fake', taskId: null }, 0, 0)
const prd = node('n1', 'text', { content: '登录页需求：支持暗黑模式' }, 10, 10)
const design = node('n2', 'image', { src: 'artifacts/design.png', alt: '设计稿' }, 20, 20)
const spec = node('n3', 'file', { path: 'docs/login.md', name: 'login.md' }, 30, 30)
const review = node('n5', 'review', { taskId: 't1' }, 40, 40)
const group = node('n6', 'group', { label: '设计资料', collapsed: false }, 50, 50)
const childA = node('n7', 'text', { content: '分组内说明 A' }, 60, 60, 'n6')
const childB = node('n8', 'text', { content: '分组内说明 B' }, 70, 70, 'n6')

const nodes = [target, prd, design, spec, review, group, childA, childB]
const edges = [edge('e1', 'n1', 'n4'), edge('e2', 'n2', 'n1'), edge('e3', 'n5', 'n4')]

describe('assembleContext', () => {
  it('renders task + explicit/context nodes deterministically', () => {
    const result = assembleContext({
      taskPrompt: '把登录页改成暗黑模式',
      targetNodeId: 'n4',
      selectedNodeIds: ['n3', 'n6'],
      nodes,
      edges,
      contentByNodeId: { n3: '# 登录页规格\n使用暗色变量。' },
    })

    expect(result.prompt).toContain('<task>把登录页改成暗黑模式</task>')
    expect(result.prompt).toContain('<node id="n1" type="text" title="PRD">')
    expect(result.prompt).toContain('<node id="n3" type="file" title="login.md">')
    expect(result.prompt).toContain('使用暗色变量。')
    expect(result.prompt).toContain('分组内说明 A')
    expect(result.prompt).not.toContain('n5') // review 节点排除
    expect(result.included.map((item) => item.id)).toEqual(['n1', 'n3', 'n7', 'n8', 'n2'])
    expect(result.dropped).toEqual([])

    const again = assembleContext({
      taskPrompt: '把登录页改成暗黑模式',
      targetNodeId: 'n4',
      selectedNodeIds: ['n3', 'n6'],
      nodes,
      edges,
      contentByNodeId: { n3: '# 登录页规格\n使用暗色变量。' },
    })
    expect(again).toEqual(result)
  })
})
```

Expected `included` 顺序说明：depth 0 的 `n1`（目标 Agent 直接前驱）、`n3`（显式）、`n7`/`n8`（group 展开）按 `(y,x,id)`；depth 1 的 `n2`（n1 的上游）最后。

- [x] **Step 2: 写失败测试（敏感路径、预算、边界）**

追加：

```ts
it('detects sensitive paths', () => {
  expect(isSensitivePath('.env')).toBe(true)
  expect(isSensitivePath('config/.env.local')).toBe(true)
  expect(isSensitivePath('certs/server.pem')).toBe(true)
  expect(isSensitivePath('secrets/api-key.txt')).toBe(true)
  expect(isSensitivePath('src/index.ts')).toBe(false)
  expect(isSensitivePath('README.md')).toBe(false)
})

it('drops sensitive file content', () => {
  const secret = node('n9', 'file', { path: '.env', name: '.env' }, 0, 80)
  const result = assembleContext({
    taskPrompt: 'demo',
    targetNodeId: 'n4',
    selectedNodeIds: ['n9'],
    nodes: [...nodes, secret],
    edges,
    contentByNodeId: { n9: 'TOKEN=should-not-appear' },
  })
  expect(result.prompt).not.toContain('should-not-appear')
  expect(result.dropped).toContainEqual({ id: 'n9', reason: 'sensitive' })
  expect(result.redactedPaths).toContain('.env')
})

it('truncates over-budget content and marks the dropped nodes', () => {
  const a = node('n10', 'text', { content: 'a'.repeat(50) }, 0, 90)
  const b = node('n11', 'text', { content: 'b'.repeat(50) }, 0, 100)
  const result = assembleContext({
    taskPrompt: 'demo',
    targetNodeId: 'n4',
    selectedNodeIds: ['n10', 'n11'],
    nodes: [...nodes, a, b],
    edges,
    maxChars: 60,
  })
  expect(result.truncated).toBe(true)
  expect(result.prompt).toContain('<truncated nodes="')
  expect(result.included.length + result.dropped.length).toBeGreaterThan(0)
})

it('drops missing and empty nodes with reasons', () => {
  const empty = node('n12', 'text', { content: '' }, 0, 110)
  const result = assembleContext({
    taskPrompt: 'demo',
    targetNodeId: 'n4',
    selectedNodeIds: ['n12', 'missing'],
    nodes: [...nodes, empty],
    edges,
  })
  expect(result.dropped).toContainEqual({ id: 'n12', reason: 'empty' })
  expect(result.dropped).toContainEqual({ id: 'missing', reason: 'not_found' })
})
```

- [x] **Step 3: 运行测试确认失败**

```bash
pnpm --filter @baton/core test
```

Expected: FAIL，`../src/context/index.js` 不存在。

- [x] **Step 4: 实现类型与敏感路径**

`packages/core/src/context/types.ts`：

```ts
import type { Edge, Node, NodeType } from '@baton/protocol'

export interface AssembleContextInput {
  taskPrompt: string
  targetNodeId: string
  selectedNodeIds: string[]
  nodes: Node[]
  edges: Edge[]
  contentByNodeId?: Readonly<Record<string, string | null>>
  maxChars?: number
  maxNodeChars?: number
}

export type DropReason =
  | 'budget'
  | 'sensitive'
  | 'limit'
  | 'not_found'
  | 'target'
  | 'empty'

export interface AssembleContextResult {
  prompt: string
  included: Array<{ id: string; type: NodeType; depth: number; chars: number }>
  dropped: Array<{ id: string; reason: DropReason }>
  truncated: boolean
  redactedPaths: string[]
}
```

`packages/core/src/context/sensitive.ts`：

```ts
const SENSITIVE_SEGMENT = /^(\.env.*|.*\.pem|.*\.key|id_rsa.*|id_ed25519.*|.*secret.*)$/i

export function isSensitivePath(path: string): boolean {
  return path
    .split(/[\\/]+/)
    .filter(Boolean)
    .some((segment) => SENSITIVE_SEGMENT.test(segment))
}
```

- [x] **Step 5: 实现装配算法**

`packages/core/src/context/assemble.ts` 按以下顺序实现：

1. `byId = new Map(nodes.map(n => [n.id, n]))`；`incoming` 建反邻接表（只收 `type === 'context'`）。
2. `seedIds = selectedNodeIds ∪ incoming[targetNodeId].map(e => e.sourceId)`；去重。
3. 对 seed 里的 group：展开 `nodes.filter(n => n.groupId === group.id)`，子节点 depth 0；group 本身不加入。
4. BFS：`queue = [...seed]`，`depth` 0；每次取 `incoming[id]`，新节点 depth+1；`depth > 2` 停止；节点数超过 40 时记 `dropped reason='limit'`；同一 id 保留最低 depth。
5. 排除 `id === targetNodeId`、`type === 'review'`、`type === 'agent'`；缺 id 记 `not_found`。
6. 按 `(depth, y, x, id)` 排序。
7. 逐节点渲染：
   - 计算 `raw`；
   - `type === 'file'` 且 `isSensitivePath(data.path)` → `dropped sensitive` + `redactedPaths`；
   - `raw` 为空 → `dropped empty`；
   - 超过 `maxNodeChars` → 截断并设 `truncated=true`；
   - 写入 `included`。
8. 总预算：如果总字符 > `maxChars`，从最大 depth 开始丢；同 depth 按 `(y,x,id)` 倒序；显式 seed 最后才硬截断最后一个节点；`dropped reason='budget'`；`truncated=true`。
9. 拼 `<task>` + `<context>` + 可选 `<truncated nodes="..."/>`；`prompt` 末尾不留多余空行。
10. 返回 `{ prompt, included, dropped, truncated, redactedPaths }`。

渲染片段示例：

```ts
function renderNode(node: Node, content: string | null): string | null {
  if (node.type === 'text') return node.data.content
  if (node.type === 'file') return content ?? node.data.path
  if (node.type === 'image') {
    const alt = node.data.alt ? ` alt="${escapeAttr(node.data.alt)}"` : ''
    return `<image src="${escapeAttr(node.data.src)}"${alt}/>`
  }
  return null
}
```

注意：`text` 节点可能含 XML 特殊字符，正文不转义（保留 Markdown/代码原文）；属性值必须转义 `& < > "`。

- [x] **Step 6: 导出**

`packages/core/src/context/index.ts`：

```ts
export * from './types.js'
export * from './sensitive.js'
export { assembleContext } from './assemble.js'
```

`packages/core/src/index.ts` 追加：

```ts
export * from './context/index.js'
```

- [x] **Step 7: 运行测试与快照**

```bash
pnpm --filter @baton/core test
pnpm --filter @baton/core typecheck
```

Expected: context 测试全部 PASS；如果新增快照，确认快照内容不含本机路径。

- [x] **Step 8: 提交**

```bash
git add packages/core/src/context packages/core/src/index.ts packages/core/test/context.test.ts
git commit -m "feat(core): 增加确定性上下文装配与敏感路径过滤"
```

---

## Task 3: Core policy 求值与 verify 解析

**Blocking:** Task 1（`Policy`/`ApprovalRequest`/`RiskLevel`）
**Slice type:** tracer-bullet
**Seam:** `evaluateApproval(policy, request, { killSwitch })` 的判定表；`resolveVerifyCommand(input)`

**Files:**
- Create: `packages/core/src/policy/types.ts`
- Create: `packages/core/src/policy/match.ts`
- Create: `packages/core/src/policy/risk.ts`
- Create: `packages/core/src/policy/evaluate.ts`
- Create: `packages/core/src/policy/index.ts`
- Create: `packages/core/src/verify/types.ts`
- Create: `packages/core/src/verify/resolve.ts`
- Create: `packages/core/src/verify/index.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/package.json`
- Modify: `THIRD_PARTY_NOTICES.md`
- Create: `packages/core/test/policy.test.ts`
- Create: `packages/core/test/verify.test.ts`

**Interfaces:**
- Produces:
  ```ts
  evaluateApproval(policy: Policy, request: ApprovalRequest, ctx: PolicyContext): PolicyDecision
  classifyRisk(toolName: string, input: unknown): RiskLevel
  resolveVerifyCommand(input: VerifyCommandInput): VerifyCommandResult
  ```
- Consumes: `Policy`、`ApprovalRequest`、`RiskLevel`、`AppError` from `@baton/protocol`

- [x] **Step 1: 安装 picomatch 与类型**

```bash
pnpm --filter @baton/core add picomatch@^4.0.7
pnpm --filter @baton/core add -D @types/picomatch@^4.0.3
```

Expected: `packages/core/package.json` 出现 `picomatch` 依赖与 `@types/picomatch` 开发依赖；lockfile 更新。

- [x] **Step 2: 写失败测试（policy 判定表）**

新建 `packages/core/test/policy.test.ts`：

```ts
import { PolicySchema, type ApprovalRequest, type Policy } from '@baton/protocol'
import { describe, expect, it } from 'vitest'
import { classifyRisk, evaluateApproval } from '../src/policy/index.js'

const policy = (overrides: Partial<Policy> = {}): Policy => {
  const base = PolicySchema.parse({})
  return {
    ...base,
    ...overrides,
    approval: { ...base.approval, ...(overrides.approval ?? {}) },
    autopilot: { ...base.autopilot, ...(overrides.autopilot ?? {}) },
  }
}

const request = (toolName: string, input: unknown, risk: ApprovalRequest['risk'] = 'low') => ({
  toolName,
  input,
  risk,
})

describe('classifyRisk', () => {
  it.each([
    ['Read', { file_path: 'src/a.ts' }, 'low'],
    ['Edit', { file_path: 'src/a.ts', cwd: '/workspace/demo' }, 'medium'],
    ['Edit', { file_path: '/etc/passwd', cwd: '/workspace/demo' }, 'high'],
    ['Bash', { command: 'pnpm test' }, 'medium'],
    ['Bash', { command: 'git push origin main' }, 'high'],
    ['WebFetch', { url: 'https://example.com' }, 'high'],
    ['UnknownTool', { x: 1 }, 'high'],
  ] as const)('%s -> %s', (tool, input, expected) => {
    expect(classifyRisk(tool, input)).toBe(expected)
  })
})

describe('evaluateApproval', () => {
  it('asks when an allow rule matches but autopilot is off', () => {
    const d = evaluateApproval(policy(), request('Read', { file_path: 'src/a.ts' }), {
      killSwitch: false,
    })
    expect(d).toMatchObject({
      decision: 'ask',
      matchedRule: 'Read',
      autoApproved: false,
      risk: 'low',
    })
  })

  it('auto-approves a low-risk allow rule when autopilot is on', () => {
    const p = policy({ autopilot: { enabled: true, retryMax: 2, digestCron: '0 9,21 * * *' } })
    const d = evaluateApproval(p, request('Read', { file_path: 'src/a.ts' }), { killSwitch: false })
    expect(d).toMatchObject({ decision: 'allow', autoApproved: true, risk: 'low' })
  })

  it('does not auto-approve when the kill switch is on', () => {
    const p = policy({ autopilot: { enabled: true, retryMax: 2, digestCron: '0 9,21 * * *' } })
    const d = evaluateApproval(p, request('Read', { file_path: 'src/a.ts' }), { killSwitch: true })
    expect(d).toMatchObject({ decision: 'ask', autoApproved: false })
  })

  it('denies before allowing', () => {
    const d = evaluateApproval(
      policy(),
      request('Bash', { command: 'rm -rf /tmp/demo' }, 'low'),
      { killSwitch: false },
    )
    expect(d).toMatchObject({
      decision: 'deny',
      matchedRule: 'Bash:rm -rf *',
      autoApproved: false,
      risk: 'high',
    })
  })

  it('does not auto-approve medium risk with the default low threshold', () => {
    const p = policy({ autopilot: { enabled: true, retryMax: 2, digestCron: '0 9,21 * * *' } })
    const d = evaluateApproval(p, request('Bash', { command: 'pnpm test' }), { killSwitch: false })
    expect(d).toMatchObject({ decision: 'ask', autoApproved: false, risk: 'medium' })
  })

  it('asks for unknown tools with high risk', () => {
    const d = evaluateApproval(policy(), request('UnknownTool', { x: 1 }), { killSwitch: false })
    expect(d).toMatchObject({ decision: 'ask', risk: 'high', autoApproved: false })
  })

  it('matches path globs and does not match outside them', () => {
    const inside = evaluateApproval(
      policy(),
      request('Edit', { file_path: 'src/pages/login.tsx', cwd: '/workspace/demo' }, 'low'),
      { killSwitch: false },
    )
    expect(inside.matchedRule).toBe('Edit:src/**')
    const outside = evaluateApproval(
      policy(),
      request('Edit', { file_path: 'docs/readme.md', cwd: '/workspace/demo' }, 'low'),
      { killSwitch: false },
    )
    expect(outside.matchedRule).toBeUndefined()
    expect(outside.decision).toBe('ask')
  })

  it('never leaks the full input in the reason', () => {
    const d = evaluateApproval(
      policy(),
      request('Bash', { command: 'TOKEN=super-secret pnpm test' }, 'low'),
      { killSwitch: false },
    )
    expect(d.reason).not.toContain('super-secret')
  })
})
```

- [x] **Step 3: 写失败测试（verify 解析）**

新建 `packages/core/test/verify.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { resolveVerifyCommand } from '../src/verify/index.js'

describe('resolveVerifyCommand', () => {
  it('prefers the task command', () => {
    expect(
      resolveVerifyCommand({
        taskCommand: 'pnpm test:unit',
        policyCommand: 'pnpm verify',
        packageScripts: { verify: 'vitest run' },
      }),
    ).toEqual({ ok: true, command: 'pnpm test:unit', source: 'task' })
  })

  it('falls back to policy, then package.json, then pnpm test', () => {
    expect(resolveVerifyCommand({ policyCommand: 'pnpm verify' })).toEqual({
      ok: true,
      command: 'pnpm verify',
      source: 'policy',
    })
    expect(
      resolveVerifyCommand({ packageScripts: { verify: 'vitest run' }, packageManager: 'pnpm' }),
    ).toEqual({ ok: true, command: 'pnpm run verify', source: 'package' })
    expect(
      resolveVerifyCommand({ packageScripts: { verify: 'vitest run' }, packageManager: 'npm' }),
    ).toEqual({ ok: true, command: 'npm run verify', source: 'package' })
    expect(resolveVerifyCommand({})).toEqual({
      ok: true,
      command: 'pnpm test',
      source: 'fallback',
    })
  })

  it('rejects empty explicit commands', () => {
    const result = resolveVerifyCommand({ taskCommand: '   ' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('invalid_payload')
  })
})
```

- [x] **Step 4: 运行测试确认失败**

```bash
pnpm --filter @baton/core test
```

Expected: FAIL，`../src/policy/index.js` 与 `../src/verify/index.js` 不存在。

- [x] **Step 5: 实现 policy 类型与匹配**

`packages/core/src/policy/types.ts`：

```ts
import type { RiskLevel } from '@baton/protocol'

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
```

`packages/core/src/policy/match.ts`：

```ts
import picomatch from 'picomatch'
import type { ApprovalRequest } from '@baton/protocol'

const PATH_TOOLS = new Set(['Edit', 'Write', 'Read', 'Grep', 'Glob'])

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
  return `{${entries.join(',')}}`
}

export function matchTarget(toolName: string, input: unknown): string | null {
  if (toolName === 'Bash' || toolName === 'Shell') {
    const command = (input as { command?: unknown } | null)?.command
    return typeof command === 'string' ? command : null
  }
  if (PATH_TOOLS.has(toolName)) {
    const record = input as { file_path?: unknown; path?: unknown } | null
    const path = record?.file_path ?? record?.path
    return typeof path === 'string' ? path : null
  }
  return stableStringify(input)
}

export function matchRule(rule: string, request: ApprovalRequest): boolean {
  const index = rule.indexOf(':')
  if (index < 0) return rule === request.toolName
  const tool = rule.slice(0, index)
  if (tool !== request.toolName) return false
  const target = matchTarget(request.toolName, request.input)
  if (target === null) return false
  const pattern = rule.slice(index + 1)
  return picomatch.isMatch(target, pattern, { dot: true })
}
```

- [x] **Step 6: 实现风险分级与求值**

`packages/core/src/policy/risk.ts`：

```ts
import type { RiskLevel } from '@baton/protocol'

const READ_ONLY = new Set(['Read', 'Grep', 'Glob', 'LS', 'NotebookRead'])
const WRITE_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])
const NETWORK = new Set(['WebFetch', 'WebSearch'])

const HIGH_BASH =
  /(^|\s)(sudo|rm\s+-rf|git\s+push|pnpm\s+add|npm\s+install|yarn\s+add)\b|curl[^|]*\|\s*sh/i
const MEDIUM_BASH = /^(pnpm|npm|yarn)\s+(test|lint|typecheck|build)\b|^git\s+(status|diff|log)\b/i

export function classifyRisk(toolName: string, input: unknown): RiskLevel {
  if (READ_ONLY.has(toolName)) return 'low'
  if (NETWORK.has(toolName)) return 'high'
  if (WRITE_TOOLS.has(toolName)) {
    const record = input as { file_path?: unknown; path?: unknown; cwd?: unknown } | null
    const path = record?.file_path ?? record?.path
    const cwd = record?.cwd
    if (typeof path === 'string' && typeof cwd === 'string' && path.startsWith('/')) {
      return path.startsWith(cwd) ? 'medium' : 'high'
    }
    return 'medium'
  }
  if (toolName === 'Bash' || toolName === 'Shell') {
    const command =
      typeof (input as { command?: unknown } | null)?.command === 'string'
        ? (input as { command: string }).command
        : ''
    if (HIGH_BASH.test(command)) return 'high'
    if (MEDIUM_BASH.test(command)) return 'medium'
    return 'high'
  }
  return 'high'
}

export function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  const order = { low: 0, medium: 1, high: 2 } as const
  return order[a] >= order[b] ? a : b
}
```

`packages/core/src/policy/evaluate.ts`：

```ts
import type { ApprovalRequest, Policy, RiskLevel } from '@baton/protocol'
import { matchRule } from './match.js'
import { classifyRisk, maxRisk } from './risk.js'
import type { PolicyContext, PolicyDecision } from './types.js'

const ORDER: RiskLevel[] = ['low', 'medium', 'high']

function within(risk: RiskLevel, max: RiskLevel): boolean {
  return ORDER.indexOf(risk) <= ORDER.indexOf(max)
}

export function evaluateApproval(
  policy: Policy,
  request: ApprovalRequest,
  ctx: PolicyContext,
): PolicyDecision {
  const risk = maxRisk(request.risk, classifyRisk(request.toolName, request.input))

  const denied = policy.approval.deny.find((rule) => matchRule(rule, request))
  if (denied) {
    return {
      decision: 'deny',
      risk,
      matchedRule: denied,
      autoApproved: false,
      reason: `denied by rule ${denied}`,
    }
  }

  const allowed = policy.approval.allow.find((rule) => matchRule(rule, request))
  if (!allowed) {
    return {
      decision: 'ask',
      risk,
      autoApproved: false,
      reason: 'no matching allow rule',
    }
  }

  const auto =
    policy.autopilot.enabled &&
    !ctx.killSwitch &&
    within(risk, policy.approval.autoApproveMaxRisk)

  if (auto) {
    return {
      decision: 'allow',
      risk,
      matchedRule: allowed,
      autoApproved: true,
      reason: `auto-approved by rule ${allowed}`,
    }
  }

  return {
    decision: 'ask',
    risk,
    matchedRule: allowed,
    autoApproved: false,
    reason: `rule ${allowed} matched but auto-approve conditions not met`,
  }
}
```

`packages/core/src/policy/index.ts`：

```ts
export * from './types.js'
export * from './match.js'
export * from './risk.js'
export * from './evaluate.js'
```

- [x] **Step 7: 实现 verify 解析**

`packages/core/src/verify/types.ts`：

```ts
import type { AppError } from '@baton/protocol'

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
```

`packages/core/src/verify/resolve.ts`：

```ts
import type { VerifyCommandInput, VerifyCommandResult } from './types.js'

function invalid(message: string): VerifyCommandResult {
  return { ok: false, error: { code: 'invalid_payload', message } }
}

export function resolveVerifyCommand(input: VerifyCommandInput): VerifyCommandResult {
  const task = input.taskCommand?.trim()
  if (input.taskCommand !== undefined && task === '') {
    return invalid('task verify command cannot be empty')
  }
  if (task) return { ok: true, command: task, source: 'task' }

  const policy = input.policyCommand?.trim()
  if (input.policyCommand !== undefined && policy === '') {
    return invalid('policy verify command cannot be empty')
  }
  if (policy) return { ok: true, command: policy, source: 'policy' }

  const script = input.packageScripts?.verify?.trim()
  if (script) {
    const manager = input.packageManager ?? 'pnpm'
    return { ok: true, command: `${manager} run verify`, source: 'package' }
  }

  return { ok: true, command: 'pnpm test', source: 'fallback' }
}
```

`packages/core/src/verify/index.ts`：

```ts
export * from './types.js'
export * from './resolve.js'
```

- [x] **Step 8: 导出并更新 notices**

`packages/core/src/index.ts` 追加：

```ts
export * from './policy/index.js'
export * from './verify/index.js'
```

`THIRD_PARTY_NOTICES.md` 增加：

```md
- `picomatch@4.0.7` — MIT — core 的 policy glob 匹配
- `@types/picomatch@4.0.3` — MIT — picomatch 类型声明（开发依赖）
```

- [x] **Step 9: 运行测试与类型检查**

```bash
pnpm --filter @baton/core test
pnpm --filter @baton/core typecheck
```

Expected: policy/verify 测试全部 PASS；typecheck 退出码 0。

- [x] **Step 10: 提交**

```bash
git add packages/core/src/policy packages/core/src/verify packages/core/src/index.ts packages/core/package.json packages/core/test/policy.test.ts packages/core/test/verify.test.ts THIRD_PARTY_NOTICES.md pnpm-lock.yaml
git commit -m "feat(core): 增加 policy 求值、风险分级与 verify 命令解析"
```

---

## Task 4: agent-fake 适配器

**Blocking:** Task 1（`AgentAdapter` / `AgentEvent` / `ApprovalRequest`）
**Slice type:** tracer-bullet
**Seam:** `FakeAdapter.start()` 的事件序列 + `approve` / `interrupt` / `send`

**Files:**
- Create: `packages/adapters/package.json`
- Create: `packages/adapters/tsconfig.json`
- Create: `packages/adapters/src/fake.ts`
- Create: `packages/adapters/src/index.ts`
- Create: `packages/adapters/test/fake.test.ts`

**Interfaces:**
- Produces: `FakeAdapter`、`FakeStep`
- Consumes: `AgentAdapter`、`AgentRun`、`StartInput`、`AgentEvent`、`EventSchemas`、`ApprovalRequest`

- [x] **Step 1: 创建 package 骨架**

`packages/adapters/package.json`：

```json
{
  "name": "@baton/adapters",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@baton/protocol": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.9.3",
    "vitest": "^5.1.0"
  }
}
```

`packages/adapters/tsconfig.json`：

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "."
  },
  "include": ["src", "test"]
}
```

- [x] **Step 2: 写失败测试（默认脚本 + approve allow）**

新建 `packages/adapters/test/fake.test.ts`：

```ts
import { EventSchemas, PolicySchema, type AgentEvent, type StartInput } from '@baton/protocol'
import { describe, expect, it } from 'vitest'
import { FakeAdapter } from '../src/index.js'

const startInput = (): StartInput => ({
  prompt: 'demo',
  cwd: '/workspace/demo',
  permissionMode: 'manual',
  policy: PolicySchema.parse({}),
})

async function waitFor(
  events: AgentEvent[],
  predicate: (event: AgentEvent) => boolean,
): Promise<AgentEvent> {
  for (;;) {
    const found = events.find(predicate)
    if (found) return found
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

async function collect(runEvents: AsyncIterable<AgentEvent>) {
  const events: AgentEvent[] = []
  for await (const event of runEvents) events.push(event)
  return events
}

describe('FakeAdapter', () => {
  it('emits the default text -> approval -> text -> finish sequence', async () => {
    const adapter = new FakeAdapter()
    const run = await adapter.start(startInput())

    const events: AgentEvent[] = []
    const consumed = (async () => {
      for await (const event of run.events) events.push(event)
    })()

    const approval = await waitFor(events, (event) => event.type === 'CUSTOM')
    expect(approval).toMatchObject({ type: 'CUSTOM', name: 'approval.request' })
    const requestId = (approval as { value: { requestId: string } }).value.requestId

    await run.approve(requestId, 'allow')
    await consumed

    expect(events.map((event) => event.type)).toEqual([
      'RUN_STARTED',
      'TEXT_MESSAGE_START',
      'TEXT_MESSAGE_CONTENT',
      'TEXT_MESSAGE_END',
      'CUSTOM',
      'TEXT_MESSAGE_START',
      'TEXT_MESSAGE_CONTENT',
      'TEXT_MESSAGE_END',
      'RUN_FINISHED',
    ])
    for (const event of events) expect(() => EventSchemas.parse(event)).not.toThrow()
  })
})
```

注意：测试里的 `setTimeout` 只用于等待事件，不在适配器实现里使用定时器。

- [x] **Step 3: 写失败测试（deny / interrupt / send / 自定义脚本）**

追加：

```ts
it('emits denied text and finishes when approval is denied', async () => {
  const adapter = new FakeAdapter()
  const run = await adapter.start(startInput())
  const events: AgentEvent[] = []
  const consumed = (async () => {
    for await (const event of run.events) events.push(event)
  })()
  const approval = await waitFor(events, (event) => event.type === 'CUSTOM')
  await run.approve((approval as { value: { requestId: string } }).value.requestId, 'deny')
  await consumed
  expect(events.some((event) => event.type === 'TEXT_MESSAGE_CONTENT' && event.delta === 'fake: denied')).toBe(true)
  expect(events.at(-1)?.type).toBe('RUN_FINISHED')
})

it('ends the stream on interrupt', async () => {
  const adapter = new FakeAdapter()
  const run = await adapter.start(startInput())
  const consumed = collect(run.events)
  await run.interrupt()
  await expect(consumed).resolves.toBeDefined()
})

it('send appends a text event', async () => {
  const adapter = new FakeAdapter()
  const run = await adapter.start(startInput())
  const events: AgentEvent[] = []
  const consumed = (async () => {
    for await (const event of run.events) events.push(event)
  })()
  const approval = await waitFor(events, (event) => event.type === 'CUSTOM')
  await run.send('extra instruction')
  await run.approve((approval as { value: { requestId: string } }).value.requestId, 'allow')
  await consumed
  expect(events.some((event) => event.type === 'TEXT_MESSAGE_CONTENT' && event.delta === 'extra instruction')).toBe(true)
})
```

补一个 `startInput()` helper 与 `waitFor` helper（`waitFor` 轮询 `events`，用 `setTimeout(0)`）。

- [x] **Step 4: 运行测试确认失败**

```bash
pnpm install
pnpm --filter @baton/adapters test
```

Expected: FAIL，`../src/index.js` 不存在。

- [x] **Step 5: 实现 `FakeAdapter`**

`packages/adapters/src/fake.ts` 的核心结构：

```ts
import {
  EventSchemas,
  type AgentAdapter,
  type AgentEvent,
  type AgentRun,
  type ApprovalRequest,
  type StartInput,
} from '@baton/protocol'

export type FakeStep =
  | { kind: 'text'; text: string }
  | { kind: 'approval'; request: ApprovalRequest }
  | { kind: 'finish' }
  | { kind: 'error'; message: string }

interface FakeOptions {
  script?: FakeStep[]
  threadId?: string
}

const DEFAULT_SCRIPT: FakeStep[] = [
  { kind: 'text', text: 'fake: working' },
  {
    kind: 'approval',
    request: { toolName: 'Bash', input: { command: 'pnpm test' }, risk: 'medium' },
  },
  { kind: 'text', text: 'fake: approved' },
  { kind: 'finish' },
]

function event(value: unknown): AgentEvent {
  return EventSchemas.parse(value)
}

export class FakeAdapter implements AgentAdapter {
  readonly name = 'fake' as const
  private readonly script: FakeStep[]
  private readonly threadId: string

  constructor(options: FakeOptions = {}) {
    this.script = options.script ?? DEFAULT_SCRIPT
    this.threadId = options.threadId ?? 'fake-thread'
  }

  async start(_input: StartInput): Promise<AgentRun> {
    const threadId = this.threadId
    const script = this.script
    const runId = 'fake-run'
    const queue: string[] = []
    let pending: { resolve: (decision: 'allow' | 'deny') => void } | null = null
    let interrupted = false
    let messageSeq = 0

    const text = function* (delta: string) {
      const messageId = `fake-msg-${++messageSeq}`
      yield event({ type: 'TEXT_MESSAGE_START', messageId, role: 'assistant' })
      yield event({ type: 'TEXT_MESSAGE_CONTENT', messageId, delta })
      yield event({ type: 'TEXT_MESSAGE_END', messageId })
    }

    const events = (async function* () {
      yield event({ type: 'RUN_STARTED', threadId, runId })
      for (const step of script) {
        if (interrupted) return
        if (step.kind === 'text') {
          yield* text(step.text)
        } else if (step.kind === 'approval') {
          const decision = new Promise<'allow' | 'deny'>((resolve) => {
            pending = { resolve }
          })
          yield event({
            type: 'CUSTOM',
            name: 'approval.request',
            value: { requestId: 'req-1', request: step.request },
          })
          const result = await decision
          pending = null
          if (result === 'deny') {
            yield* text('fake: denied')
            return
          }
        } else if (step.kind === 'error') {
          yield event({ type: 'RUN_ERROR', message: step.message })
          return
        }
        while (queue.length > 0) {
          const delta = queue.shift()!
          yield* text(delta)
        }
      }
      yield event({ type: 'RUN_FINISHED', threadId, runId })
    })()

    return {
      events,
      approve: async (_requestId, decision) => {
        pending?.resolve(decision)
      },
      send: async (delta) => {
        queue.push(delta)
      },
      interrupt: async () => {
        interrupted = true
        pending?.resolve('deny')
        pending = null
      },
      dispose: async () => {
        interrupted = true
        pending?.resolve('deny')
        pending = null
      },
    }
  }
}
```

实现注意：

- `TEXT_MESSAGE_START` 的 `role` 字段如果官方 schema 不接受，按 `EventSchemas` 报错调整；以实际 schema 为准。
- `RUN_STARTED` 的 `threadId` / `runId` 必填；`CUSTOM` 的 `name` / `value` 必填。
- `events` 必须是 `AsyncIterable<AgentEvent>`；`EventSchemas.parse` 返回的类型可直接使用。
- `send` 的文本在下一个 step 边界或完成前被 drain；`interrupt` 后不再 drain。
- 不使用 `Math.random()` / `Date.now()`。

`packages/adapters/src/index.ts`：

```ts
export * from './fake.js'
```

- [x] **Step 6: 运行测试与类型检查**

```bash
pnpm install
pnpm --filter @baton/adapters test
pnpm --filter @baton/adapters typecheck
```

Expected: PASS；typecheck 退出码 0。

- [x] **Step 7: 提交**

```bash
git add packages/adapters pnpm-lock.yaml
git commit -m "feat(adapters): 增加可确定性测试的 agent-fake"
```

---

## Task 5: 消费形态 fixture、文档与全量验收

**Blocking:** Tasks 1–4
**Slice type:** verification
**Seam:** `pnpm verify` + `git diff -- apps` 为空

**Files:**
- Create: `packages/core/test/consumption.test.ts`
- Modify: `docs/specs/2026-11-17-m1-context-policy-adapter-design.md`（如实现偏离）
- Modify: `docs/contracts/M1-context-policy-adapter.contract.md`（核对记录）
- Modify: `docs/plans/2026-11-17-m1-context-policy-adapter.md`（执行记录）
- Modify: `docs/README.md`（已列 spec；确认 link）
- Modify: `THIRD_PARTY_NOTICES.md`（确认 picomatch）

**Interfaces:**
- Consumes: `assembleContext`、`evaluateApproval`、`resolveVerifyCommand`、`AgentAdapter`、`StartInput`、`PolicySnapshot`

- [x] **Step 1: 写消费形态测试**

新建 `packages/core/test/consumption.test.ts`：

```ts
import {
  Edge,
  Node,
  PolicySchema,
  type AgentAdapter,
  type AgentRun,
  type PolicySnapshot,
  type StartInput,
} from '@baton/protocol'
import { describe, expect, it } from 'vitest'
import { assembleContext } from '../src/context/index.js'
import { evaluateApproval } from '../src/policy/index.js'
import { resolveVerifyCommand } from '../src/verify/index.js'

const text = Node.parse({
  id: 'n1',
  canvasId: 'c1',
  type: 'text',
  data: { content: '需求：暗黑模式' },
  x: 0,
  y: 0,
  groupId: null,
  createdAt: 1,
  updatedAt: 1,
})

const target = Node.parse({
  id: 'n2',
  canvasId: 'c1',
  type: 'agent',
  data: { title: 'Agent', engine: 'fake', taskId: null },
  x: 100,
  y: 0,
  groupId: null,
  createdAt: 1,
  updatedAt: 1,
})

const edge = Edge.parse({
  id: 'e1',
  canvasId: 'c1',
  sourceId: 'n1',
  targetId: 'n2',
  type: 'context',
})

describe('M1-5 consumption shape', () => {
  it('feeds assembled prompt into StartInput and policy decisions into approve', async () => {
    const assembled = assembleContext({
      taskPrompt: '把登录页改成暗黑模式',
      targetNodeId: 'n2',
      selectedNodeIds: ['n1'],
      nodes: [text, target],
      edges: [edge],
    })

    const policy = PolicySchema.parse({})
    const snapshot: PolicySnapshot = policy
    const verify = resolveVerifyCommand({ packageScripts: { verify: 'vitest run' } })
    expect(verify.ok).toBe(true)
    if (verify.ok) expect(typeof verify.command).toBe('string')

    const adapter: AgentAdapter = {
      name: 'fake',
      async start(input: StartInput): Promise<AgentRun> {
        expect(input.prompt).toContain('<task>把登录页改成暗黑模式</task>')
        expect(input.policy.approval.default).toBe('ask')
        return {
          events: (async function* () {})(),
          approve: async (_requestId, decision) => {
            const allowed: 'allow' | 'deny' = decision
            expect(['allow', 'deny']).toContain(allowed)
          },
          send: async () => {},
          interrupt: async () => {},
          dispose: async () => {},
        }
      },
    }

    const run = await adapter.start({
      prompt: assembled.prompt,
      cwd: '/workspace/demo',
      permissionMode: 'manual',
      policy: snapshot,
    })

    const decision = evaluateApproval(
      policy,
      { toolName: 'Read', input: { file_path: 'src/a.ts' }, risk: 'low' },
      { killSwitch: false },
    )
    expect(decision.decision).toBe('ask')
    await run.approve('req-1', decision.decision === 'deny' ? 'deny' : 'allow')
  })
})
```

- [x] **Step 2: 运行消费 fixture**

```bash
pnpm --filter @baton/core test
```

Expected: PASS；如果类型不匹配，先修类型而不是断言。

- [x] **Step 3: 运行全量校验**

```bash
pnpm verify
pnpm check:boundaries
pnpm check:protocol
pnpm format:check
pnpm --filter @baton/core test
pnpm --filter @baton/adapters test
pnpm pack:check
git diff --name-only main...HEAD -- apps
```

Expected: 前 7 条退出码 0；最后一条输出为空。

- [x] **Step 4: 更新执行记录**

在 plan 的“执行记录”表追加每个 Task 的 commit 与测试结果；在 contract 的 25 条核对表逐条填证据。

- [x] **Step 5: 提交**

```bash
git add packages/core/test/consumption.test.ts docs THIRD_PARTY_NOTICES.md pnpm-lock.yaml
git commit -m "test(core): 增加 M1-5 消费形态验收并完成全量校验"
```

---

## Self-Review

**1. Spec coverage**

- spec 4.1 → Task 1；4.2 → Task 2；4.3/4.4 → Task 3；4.5 → Task 4；4.6 → Task 1；4.7 → Tasks 3/4；第 5 节 → Task 5。
- spec 6.1 的 context/policy/verify/agent-fake/protocol/消费形态均有对应测试。
- spec 6.2 的验收命令全部在 Task 5 执行。

**2. Placeholder scan**

- 无 `TODO`/`TBD`/“类似 Task N”；每个代码步骤都有可执行片段。
- `agent-fake` 的 AG-UI 字段以 `EventSchemas.parse` 为准，若 `TEXT_MESSAGE_START.role` 不被接受，按实际 schema 调整并在执行记录注明。

**3. Type consistency**

- `PolicySnapshot` 是 `Policy` 别名，不在 core 里重复定义。
- `AssembleContextResult.dropped.reason` 与 `DropReason` 一致。
- `PolicyDecision.decision` 在 Task 3/5 中一致：`allow` 仅自动批准时返回；否则 `ask`。
- `VerifyCommandResult` 在 Task 3/5 中一致：成功分支有 `command/source`，失败分支有 `error.code`。

**4. Boundary check**

- `packages/core` 只依赖 `@baton/protocol` + `picomatch`；`packages/adapters` 只依赖 `@baton/protocol`。
- `apps/**` 无改动。

---

## 执行记录

| 日期 | Task | 结果 | Commit | 备注 |
|---|---|---|---|---|
| 2026-11-17 | Task 1 | protocol 66 tests；typecheck 通过 | `c6477bc` | `AgentAdapter` type-only；默认 Bash 规则改 glob |
| 2026-11-17 | Task 2 | core 71 tests（含 context）；coverage 89%+ branches | `1757b21` | context 快照；敏感路径；深度/预算/40 节点边界 |
| 2026-11-17 | Task 3 | core 71 tests；typecheck 通过；picomatch 接入 | `62dedea` | policy 快照；风险表；verify 解析；notices |
| 2026-11-17 | Task 4 | adapters 5 tests；typecheck 通过 | `cc99e0f` | fake 默认脚本 / allow / deny / interrupt / send / error |
| 2026-11-17 | Task 5 | `pnpm verify`、`check:boundaries`、`check:protocol`、`format:check`、`pack:check` 全绿；`apps` 空 diff | `ba5a03f` | 消费 fixture；快照；执行记录 |

**实现偏离（已同步 spec）**：

- `picomatch` 使用 `{ dot: true, bash: true }`：`*` 需跨 `/` 才能让 `Bash:rm -rf *` 命中 `rm -rf /tmp/demo`。
- `FakeAdapter` 的 deny 分支以 `RUN_FINISHED` 收尾；interrupt 直接结束事件流。
- context 的 `title` 规则：text 取首个非空行（截断 60 字符），file 取 `name`，image 取 `alt`。

### Contract 25 条核对

| Contract | 证据 |
|---|---|
| 1 Protocol adapter 导出 | `packages/protocol/test/exports.test.ts` 的 AgentAdapter 用例；`pnpm --filter @baton/protocol typecheck` |
| 2 Policy 默认规则 | `packages/protocol/test/policy-defaults.test.ts` 精确数组断言 |
| 3 Context API | `packages/core/src/context/index.ts`；`check:boundaries` 无违规 |
| 4 种子与闭包 | `context.test.ts` 的显式/前驱/group/深度/40 节点用例 |
| 5 排序与确定性 | `context.test.ts` 两次调用 `toEqual` + prompt 快照 |
| 6 渲染 | `context.test.ts` 的 text/file/image 与 title/path 断言 |
| 7 预算与脱敏 | `context.test.ts` 的 sensitive/empty/budget/truncated 用例 |
| 8 Policy 匹配 | `policy.test.ts` 的 matchRule/路径/命令/稳定 JSON 用例 |
| 9 风险分级 | `policy.test.ts` 的 classifyRisk 表与 max 行为 |
| 10 自动批准 | `policy.test.ts` 的 autopilot/kill switch/medium/unknown 用例 |
| 11 Verify 解析 | `verify.test.ts` 的优先级/回退/空命令用例 |
| 12 Adapters 包 | `packages/adapters/package.json` + workspace 安装 + `pnpm -r test` |
| 13 FakeAdapter 契约 | `packages/adapters/test/fake.test.ts` 默认序列 + `EventSchemas` 校验 |
| 14 FakeAdapter 控制 | `fake.test.ts` 的 deny/interrupt/send/custom error 用例 |
| 15 消费形态 | `packages/core/test/consumption.test.ts` |
| 16 变更边界 | `git diff --name-only main...HEAD -- apps` 输出为空 |
| 17 分层 | `pnpm check:boundaries`（104 modules, 201 deps, no violations） |
| 18 全量校验 | `pnpm verify` 退出码 0；`format:check` / `check:protocol` / 两个包测试 / `pack:check` 通过 |
| 19 覆盖率 | core `All files`：Stmts 95.91 / Branch 89.62 / Funcs 96.15 / Lines 97.5 |
| 20 依赖与许可 | `packages/core/package.json` 的 picomatch；`THIRD_PARTY_NOTICES.md` 的 picomatch/types |
| 21 文档与占位 | `docs/README.md` 三份链接；`grep -rn "TODO\|FIXME" packages/*/src` 无输出 |
| 22 性能与确定性 | core 测试 < 1s；fake 无定时器/随机数；快照稳定 |
| 23 默认值兼容 | protocol 既有 66 tests 全绿；`PolicySchema` 类型未变 |
| 24 错误形状 | `verify.test.ts` 空命令返回 `invalid_payload`；未知工具返回 high 不抛错 |
| 25 无占位实现 | 三个 core 函数与 FakeAdapter 均有实现与测试；无 TODO/FIXME |
