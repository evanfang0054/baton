---
spec_ref: ../specs/2026-11-18-m1-6b-canvas-context-design.md
spec_topic: m1-6b-canvas-context
task_count: 7
estimated_phases: [tests, implementation, verification]
dod: "粘性多选、连线创建/删除、建任务 chips 与真实 contextNodeIds、详情快照 UI、Playwright 新增段、ego-lite 真实 Claude 证据；pnpm verify:full 与 pack:check 全绿"
depends_on: [2026-11-18-m1-6b-context-core.md]
status: active
---

# M1-6b Web 画布与验收实施计划（Plan 2/2）

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended) or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户能在画布上多选节点、用连线表达关系，并在 Agent 面板里看到上下文 chips；建任务时真实提交 `contextNodeIds`，详情页能核对注入/排除/关系/截断。

**Architecture:** 只改 `apps/web`。选择状态进 Zustand（当前选择 + 粘性上下文），连线走 Plan 1 的 `edge.create/delete`，任务创建复用现有 `task.create`，详情读取 Plan 1 的 `TaskDetail.context`。

**Tech Stack:** React 19、`@xyflow/react` 13、Zustand、TanStack Query、HeroUI v3、Tailwind 4、Playwright。

---

## 计划地图

| Plan | 范围 | 状态 |
|---|---|---|
| 1. 后端 | protocol/core/migration/daemon | 待实施（前置） |
| **2. Web（本计划）** | 选择模型、连线、chips、详情、e2e、真实证据 | 待实施；依赖 Plan 1 |

**GDD:** 按仓库先例显式跳过；测试设计由 contract 21 条 DoD 与任务内测试承担。

**Design sync:** 所有新增控件只用 `DESIGN.md` token；状态不只靠颜色；焦点可见、键盘可达。Task 4 与 Task 7 各检查一次。

**Commit strategy:** 每个 Task 结束提交一次；Task 7 跑 `pnpm verify:full` 与 `pnpm pack:check`。

---

## Task 1: 选择状态与粘性上下文

Blocking: Plan 1 完成
Slice type: tracer-bullet
Seam: `useAppStore` 的 `setSelection` / `contextNodeIds`

**Files:**

- Modify: `apps/web/src/stores/app.ts`
- Create: `apps/web/src/stores/app.test.ts`

**Interfaces:**

- Produces: `selectedNodeIds: string[]`、`contextNodeIds: string[]`、`setSelection(nodes: SelectionNode[])`、`removeContextNode(id)`、`clearContext()`。
- `SelectionNode = { id: string; type: 'text' | 'image' | 'file' | 'agent' | 'review' | 'group' }`。

- [ ] **Step 1: 写失败测试**

`apps/web/src/stores/app.test.ts`：

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { useAppStore } from './app'

const reset = () =>
  useAppStore.setState({
    activeWorkspaceId: 'w1',
    selectedNodeId: null,
    selectedNodeIds: [],
    contextNodeIds: [],
  })

describe('app store selection', () => {
  beforeEach(reset)

  it('keeps only content nodes as context', () => {
    useAppStore.getState().setSelection([
      { id: 't1', type: 'text' },
      { id: 'a1', type: 'agent' },
      { id: 'f1', type: 'file' },
    ])
    expect(useAppStore.getState().selectedNodeIds).toEqual(['t1', 'a1', 'f1'])
    expect(useAppStore.getState().contextNodeIds).toEqual(['t1', 'f1'])
  })

  it('preserves sticky context when the selection is agent-only or empty', () => {
    useAppStore.getState().setSelection([{ id: 't1', type: 'text' }])
    useAppStore.getState().setSelection([{ id: 'a1', type: 'agent' }])
    expect(useAppStore.getState().contextNodeIds).toEqual(['t1'])
    useAppStore.getState().setSelection([])
    expect(useAppStore.getState().contextNodeIds).toEqual(['t1'])
  })

  it('removes one context node and clears all', () => {
    useAppStore.getState().setSelection([
      { id: 't1', type: 'text' },
      { id: 't2', type: 'text' },
    ])
    useAppStore.getState().removeContextNode('t1')
    expect(useAppStore.getState().contextNodeIds).toEqual(['t2'])
    useAppStore.getState().clearContext()
    expect(useAppStore.getState().contextNodeIds).toEqual([])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @baton/web test -- stores/app`
Expected: FAIL，`setSelection` 不存在。

- [ ] **Step 3: 实现 store**

`apps/web/src/stores/app.ts` 增加：

```ts
import type { Node } from '@baton/protocol'

export type SelectionNode = Pick<Node, 'id' | 'type'>

const CONTEXT_TYPES = new Set<Node['type']>(['text', 'file', 'image', 'group'])

interface AppState {
  // ...现有字段
  selectedNodeIds: string[]
  contextNodeIds: string[]
  setSelection: (nodes: SelectionNode[]) => void
  removeContextNode: (id: string) => void
  clearContext: () => void
}

export const useAppStore = create<AppState>((set) => ({
  // ...现有初始值
  selectedNodeIds: [],
  contextNodeIds: [],
  setSelection: (nodes) =>
    set((state) => {
      const contentIds = nodes.filter((node) => CONTEXT_TYPES.has(node.type)).map((node) => node.id)
      return {
        selectedNodeIds: nodes.map((node) => node.id),
        ...(contentIds.length > 0 ? { contextNodeIds: contentIds } : {}),
      }
    }),
  removeContextNode: (id) =>
    set((state) => ({ contextNodeIds: state.contextNodeIds.filter((item) => item !== id) })),
  clearContext: () => set({ contextNodeIds: [] }),
  // setWorkspace 里追加 selectedNodeIds: [], contextNodeIds: []
}))
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @baton/web test -- stores/app`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/stores/app.ts apps/web/src/stores/app.test.ts
git commit -m "feat(web): 画布选择与粘性上下文状态"
```

---

## Task 2: 多选、连线与删除

Blocking: Task 1
Slice type: tracer-bullet
Seam: React Flow `onSelectionChange` / `onConnect` / `onEdgesDelete`

**Files:**

- Modify: `apps/web/src/features/canvas/CanvasPanel.tsx`
- Modify: `apps/web/src/features/canvas/nodes/NodeShell.tsx`
- Modify: `apps/web/src/features/canvas/model.ts`
- Modify: `apps/web/src/features/canvas/model.test.ts`
- Modify: `apps/web/src/features/canvas/CanvasPanel.test.tsx`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**

- `CanvasPanelProps` 新增 `onSelectNodes: (nodes: SelectionNode[]) => void`。
- `model.ts` 新增 `isValidConnection(connection, edges)`。

**Imports to add in `CanvasPanel.tsx`:** `Button`（`@heroui/react/button`）、`type Connection` / `type Edge as FlowEdge`（`@xyflow/react`）、`isValidConnection`（`./model`）。

- [ ] **Step 1: 写失败测试**

`apps/web/src/features/canvas/model.test.ts` 追加：

```ts
import { isValidConnection } from './model'
import type { Edge as ProtocolEdge } from '@baton/protocol'

const edges: ProtocolEdge[] = [
  { id: 'e1', canvasId: 'c1', sourceId: 'n1', targetId: 'n2', type: 'context' },
]

describe('isValidConnection', () => {
  it('rejects self loops, duplicates and empty endpoints', () => {
    expect(isValidConnection({ source: 'n1', target: 'n1' }, edges)).toBe(false)
    expect(isValidConnection({ source: 'n1', target: 'n2' }, edges)).toBe(false)
    expect(isValidConnection({ source: null, target: 'n2' }, edges)).toBe(false)
  })

  it('allows the reverse and new pairs', () => {
    expect(isValidConnection({ source: 'n2', target: 'n1' }, edges)).toBe(true)
    expect(isValidConnection({ source: 'n1', target: 'n3' }, edges)).toBe(true)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @baton/web test -- canvas/model`
Expected: FAIL，`isValidConnection` 未导出。

- [ ] **Step 3: 改 model 与 NodeShell**

`apps/web/src/features/canvas/model.ts`：

```ts
export function isValidConnection(
  connection: { source: string | null; target: string | null },
  edges: ProtocolEdge[],
): boolean {
  if (!connection.source || !connection.target) return false
  if (connection.source === connection.target) return false
  return !edges.some(
    (edge) =>
      edge.sourceId === connection.source &&
      edge.targetId === connection.target &&
      edge.type === 'context',
  )
}
```

`toFlowEdges` 改为可选中/可聚焦/可删除：

```ts
return edges.map((edge) => ({
  id: edge.id,
  source: edge.sourceId,
  target: edge.targetId,
  selectable: true,
  focusable: true,
  deletable: true,
}))
```

`apps/web/src/features/canvas/nodes/NodeShell.tsx`：

- 根 div 加 `group` class。
- 两个 `Handle` 去掉 `isConnectable={false}`，加可见性：

```tsx
<Handle
  type="target"
  position={Position.Top}
  className="opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
/>
<Handle
  type="source"
  position={Position.Bottom}
  className="opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
/>
```

- [ ] **Step 4: 改 CanvasPanel**

Props 增加 `onSelectNodes`。React Flow：

```tsx
<ReactFlow
  // ...现有 props
  selectionOnDrag
  selectionKeyCode="Shift"
  multiSelectionKeyCode={['Meta', 'Control']}
  panOnDrag={[1, 2]}
  onSelectionChange={({ nodes: selected }) =>
    onSelectNodes(selected.map((node) => ({ id: node.id, type: node.data.node.type })))
  }
  nodesConnectable
  edgesFocusable
  deleteKeyCode={['Backspace', 'Delete']}
  isValidConnection={(connection) => isValidConnection(connection, canvas.edges)}
  onConnect={(connection) => void connect(connection)}
  onEdgesDelete={(deleted) => void removeEdges(deleted)}
  onEdgeClick={(_, edge) => setSelectedEdgeId(edge.id)}
  onPaneClick={() => {
    setSelectedEdgeId(null)
    onSelectNode(null)
  }}
>
```

同文件实现：

```tsx
const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)

const connect = async (connection: Connection) => {
  if (!canvas || !isValidConnection(connection, canvas.edges)) return
  try {
    await send({
      type: 'edge.create',
      payload: { sourceId: connection.source, targetId: connection.target },
    })
  } catch (cause) {
    toast.danger(cause instanceof Error ? cause.message : '连线创建失败')
  } finally {
    await refreshCanvas()
  }
}

const removeEdges = async (deleted: FlowEdge[]) => {
  try {
    await Promise.all(
      deleted.map((edge) => send({ type: 'edge.delete', payload: { edgeId: edge.id } })),
    )
  } catch (cause) {
    toast.danger(cause instanceof Error ? cause.message : '连线删除失败')
  } finally {
    setSelectedEdgeId(null)
    await refreshCanvas()
  }
}

const deleteSelectedEdge = () => {
  const edge = canvas?.edges.find((item) => item.id === selectedEdgeId)
  if (edge) void removeEdges([{ id: edge.id } as FlowEdge])
}
```

在工具栏下方渲染删除按钮：

```tsx
{selectedEdgeId ? (
  <div className="absolute top-3 right-3 z-10">
    <Button variant="danger" onPress={deleteSelectedEdge}>
      删除连线
    </Button>
  </div>
) : null}
```

- [ ] **Step 5: App 接线**

`apps/web/src/App.tsx` 从 store 取 `setSelection`，传给 `CanvasPanel`：

```tsx
<CanvasPanel
  // ...现有 props
  onSelectNodes={(nodes) => setSelection(nodes)}
/>
```

- [ ] **Step 6: 跑 web 测试**

Run: `pnpm --filter @baton/web test -- canvas`
Expected: PASS（现有 CanvasPanel 用例可能需要补 `onSelectNodes={vi.fn()}`）。

- [ ] **Step 7: 提交**

```bash
git add apps/web/src/features/canvas apps/web/src/App.tsx
git commit -m "feat(web): 画布多选、连线与删除"
```

---

## Task 3: Agent 面板 chips 与真实 contextNodeIds

Blocking: Task 1
Slice type: tracer-bullet
Seam: `task.create` payload 的 `contextNodeIds`

**Files:**

- Create: `apps/web/src/features/canvas/node-title.ts`
- Modify: `apps/web/src/features/canvas/NodePanel.tsx`
- Modify: `apps/web/src/features/tasks/CreateTaskForm.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/features/tasks/CreateTaskForm.test.tsx`
- Modify: `apps/web/src/features/canvas/NodePanel.test.tsx`

**Interfaces:**

- `CreateTaskForm` 新增可选 `contextNodes?: ProtocolNode[]`。
- `NodePanel` 新增 `contextNodes: ProtocolNode[]`。
- `nodeTitle(node)` 共享标题函数。

- [ ] **Step 1: 写失败测试**

`apps/web/src/features/tasks/CreateTaskForm.test.tsx` 增加用例（沿用现有 render helper）：

```tsx
it('shows context chips and sends their ids', async () => {
  stubEngines([{ engine: 'fake', status: 'available' }])
  const send = vi.fn().mockResolvedValue({ taskId: 't1' })
  const contextNodes: ProtocolNode[] = [
    {
      id: 't1',
      canvasId: 'c1',
      type: 'text',
      x: 0,
      y: 0,
      w: 320,
      h: 200,
      groupId: null,
      data: { content: '需求 A' },
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: 't2',
      canvasId: 'c1',
      type: 'file',
      x: 0,
      y: 0,
      w: 320,
      h: 200,
      groupId: null,
      data: { path: 'docs/a.md', name: 'a.md' },
      createdAt: 1,
      updatedAt: 1,
    },
  ]
  renderForm(send, false, 'Agent 1', contextNodes)
  expect(screen.getByText('需求 A')).toBeInTheDocument()
  expect(screen.getByText('a.md')).toBeInTheDocument()
  await waitFor(() => expect(screen.getByLabelText('执行引擎')).toHaveValue('fake'))
  fireEvent.change(screen.getByLabelText('任务说明'), { target: { value: '开始' } })
  fireEvent.click(screen.getByRole('button', { name: '创建任务' }))
  await waitFor(() =>
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'task.create',
        payload: expect.objectContaining({ contextNodeIds: ['t1', 't2'] }),
      }),
    ),
  )
})
```

同时把现有 helper 扩成：

```ts
function renderForm(
  send = vi.fn().mockResolvedValue({ taskId: 't1' }),
  workspaceTrusted = false,
  defaultTitle = 'Agent 1',
  contextNodes: ProtocolNode[] = [],
) {
  // ...
  <CreateTaskForm
    // ...现有 props
    contextNodes={contextNodes}
    onCreated={onCreated}
  />
}
```

并在文件顶部导入 `type Node as ProtocolNode`。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @baton/web test -- CreateTaskForm`
Expected: FAIL，chips 不渲染，payload 为 `[]`。

- [ ] **Step 3: 共享标题函数**

`apps/web/src/features/canvas/node-title.ts`：

```ts
import type { Node } from '@baton/protocol'

export function nodeTitle(node: Node): string {
  switch (node.type) {
    case 'text': {
      const first = node.data.content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length > 0)
      return (first ?? '文本节点').slice(0, 60)
    }
    case 'file':
      return node.data.name
    case 'image':
      return node.data.alt ?? '图片'
    case 'agent':
      return node.data.title
    case 'group':
      return node.data.label
    case 'review':
      return '验收节点'
  }
}
```

`NodePanel.tsx` 删除本地 `titleOf`，改用 `nodeTitle`。

- [ ] **Step 4: 改 CreateTaskForm**

新增 prop 与 chips：

```tsx
import type { Engine, EngineStatus, Node as ProtocolNode } from '@baton/protocol'
import { useAppStore } from '../../stores/app'
import { nodeTitle } from '../canvas/node-title'
export function CreateTaskForm({
  nodeId,
  workspaceId,
  workspaceTrusted,
  defaultTitle,
  contextNodes = [],
  onCreated,
}: {
  // ...现有 props
  contextNodes?: ProtocolNode[]
  onCreated: (taskId: string) => void
}) {
  const removeContextNode = useAppStore((state) => state.removeContextNode)
  // ...
  const contextNodeIds = contextNodes.filter((node) => node.id !== nodeId).map((node) => node.id)
```

表单顶部渲染：

```tsx
<div className="mt-2 flex flex-col gap-2">
  <div className="flex flex-wrap items-center gap-2" data-testid="context-chips">
    {contextNodes.length > 0 ? (
      contextNodes.map((node) => (
        <span
          key={node.id}
          className="inline-flex items-center gap-1 rounded-full border border-separator px-2 py-1 text-xs"
        >
          {nodeTitle(node)}
          <button
            type="button"
            aria-label={`移除 ${nodeTitle(node)}`}
            className="text-muted hover:text-danger"
            onClick={() => removeContextNode(node.id)}
          >
            ×
          </button>
        </span>
      ))
    ) : (
      <p className="text-xs text-muted">按住 Shift 框选画布节点，或在打开面板前先多选。</p>
    )}
  </div>
  {contextNodes.length > 0 ? (
    <p className="text-xs text-muted">连线依赖会自动包含，可在任务详情核对。</p>
  ) : null}
```

提交 payload：

```tsx
contextNodeIds,
```

- [ ] **Step 5: App 与 NodePanel 接线**

`App.tsx`：

```tsx
const contextNodeIds = useAppStore((state) => state.contextNodeIds)
const contextNodes = useMemo(
  () =>
    (canvas.data?.nodes ?? []).filter((node) => contextNodeIds.includes(node.id)),
  [canvas.data?.nodes, contextNodeIds],
)
```

`NodePanel` 调用处：

```tsx
<CreateTaskForm
  // ...现有 props
  contextNodes={contextNodes}
  onCreated={...}
/>
```

`NodePanel` props 增加 `contextNodes: ProtocolNode[]` 并透传。

- [ ] **Step 6: 跑测试**

Run: `pnpm --filter @baton/web test -- CreateTaskForm NodePanel`
Expected: PASS；现有 `contextNodeIds: []` 断言改为无上下文时的期望。

- [ ] **Step 7: 提交**

```bash
git add apps/web/src/features/canvas/node-title.ts apps/web/src/features/canvas/NodePanel.tsx apps/web/src/features/tasks/CreateTaskForm.tsx apps/web/src/App.tsx apps/web/src/features/tasks/CreateTaskForm.test.tsx apps/web/src/features/canvas/NodePanel.test.tsx
git commit -m "feat(web): 建任务上下文 chips 与 contextNodeIds"
```

---

## Task 4: 任务详情上下文快照

Blocking: Task 3, Plan 1 Task 5
Slice type: tracer-bullet
Seam: `TaskDetailResponse.task.context` 渲染

**Files:**

- Create: `apps/web/src/features/tasks/ContextSnapshotCard.tsx`
- Create: `apps/web/src/features/tasks/ContextSnapshotCard.test.tsx`
- Modify: `apps/web/src/features/tasks/TaskDetailPanel.tsx`
- Modify: `apps/web/src/features/tasks/TaskDetailPanel.test.tsx`

**Interfaces:**

- `ContextSnapshotCard({ context }: { context: ContextSnapshot | null })`。

- [ ] **Step 1: 写失败测试**

`ContextSnapshotCard.test.tsx`：

```tsx
import type { ContextSnapshot } from '@baton/protocol'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ContextSnapshotCard } from './ContextSnapshotCard'

const snapshot: ContextSnapshot = {
  included: [
    { id: 'n1', type: 'text', title: '需求 A', depth: 0, chars: 12 },
    { id: 'n2', type: 'file', title: 'spec.md', depth: 1, chars: 40 },
  ],
  dropped: [{ id: 'n3', reason: 'sensitive', title: '.env' }],
  truncated: true,
  redactedPaths: ['.env'],
  relations: [
    {
      from: 'n1',
      to: 'n2',
      type: 'context',
      fromTitle: '需求 A',
      toTitle: 'spec.md',
      includedFrom: true,
      includedTo: true,
    },
  ],
  relationsTruncated: false,
}

describe('ContextSnapshotCard', () => {
  it('shows included, dropped and relations', () => {
    render(<ContextSnapshotCard context={snapshot} />)
    expect(screen.getByText('上下文快照')).toBeInTheDocument()
    expect(screen.getByText('需求 A')).toBeInTheDocument()
    expect(screen.getByText('spec.md')).toBeInTheDocument()
    expect(screen.getByText('敏感文件已排除')).toBeInTheDocument()
    expect(screen.getByText(/需求 A → spec.md/)).toBeInTheDocument()
    expect(screen.getByText('关系已截断')).toBeInTheDocument()
  })

  it('handles old tasks without a snapshot', () => {
    render(<ContextSnapshotCard context={null} />)
    expect(screen.getByText('该任务创建于上下文快照上线前，未记录')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @baton/web test -- ContextSnapshotCard`
Expected: FAIL，组件不存在。

- [ ] **Step 3: 实现组件**

`ContextSnapshotCard.tsx`：

```tsx
import type { ContextSnapshot } from '@baton/protocol'

const reasonLabels: Record<string, string> = {
  budget: '超出预算',
  sensitive: '敏感文件已排除',
  limit: '超出节点上限',
  not_found: '节点已不存在',
  target: '目标 Agent 本身',
  empty: '内容为空',
}

export function ContextSnapshotCard({ context }: { context: ContextSnapshot | null }) {
  if (!context) {
    return (
      <section className="rounded-lg border border-separator bg-background p-3">
        <h3 className="text-sm font-medium">上下文快照</h3>
        <p className="mt-1 text-xs text-muted">该任务创建于上下文快照上线前，未记录</p>
      </section>
    )
  }

  const totalChars = context.included.reduce((sum, item) => sum + item.chars, 0)

  return (
    <section className="rounded-lg border border-separator bg-background p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">上下文快照</h3>
        {context.relationsTruncated ? (
          <span className="text-xs text-warning">关系已截断</span>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-muted">
        注入 {context.included.length} 个 · 排除 {context.dropped.length} 个 · {totalChars} 字符
        {context.truncated ? ' · 内容已截断' : ''}
      </p>

      <ul className="mt-2 flex flex-col gap-1 text-xs">
        {context.included.map((item) => (
          <li key={item.id} className="flex justify-between gap-2">
            <span>{item.title}</span>
            <span className="text-muted">{item.type} · {item.chars} 字</span>
          </li>
        ))}
      </ul>

      {context.dropped.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1 text-xs">
          {context.dropped.map((item) => (
            <li key={item.id} className="flex justify-between gap-2 text-muted">
              <span>{item.title ?? item.id}</span>
              <span>{reasonLabels[item.reason] ?? item.reason}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {context.relations.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1 text-xs">
          {context.relations.map((relation) => (
            <li key={`${relation.from}-${relation.to}`}>
              {relation.fromTitle} → {relation.toTitle}
            </li>
          ))}
        </ul>
      ) : null}

      {context.redactedPaths.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1 text-xs text-muted">
          {context.redactedPaths.map((path) => (
            <li key={path}>已排除敏感文件：{path}</li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
```

- [ ] **Step 4: 接入详情**

`TaskDetailPanel.tsx` 的 `DetailContent` 在 `<TaskHeader ... />` 后渲染：

```tsx
<ContextSnapshotCard context={task.context} />
```

- [ ] **Step 5: 跑测试**

Run: `pnpm --filter @baton/web test -- ContextSnapshotCard TaskDetailPanel`
Expected: PASS；现有 `TaskDetailResponse` fixture 若无 `context`，由 `TaskDetail` 默认 `null` 兼容。

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/features/tasks/ContextSnapshotCard.tsx apps/web/src/features/tasks/ContextSnapshotCard.test.tsx apps/web/src/features/tasks/TaskDetailPanel.tsx apps/web/src/features/tasks/TaskDetailPanel.test.tsx
git commit -m "feat(web): 任务详情上下文快照"
```

---

## Task 5: Playwright 新增段

Blocking: Task 2, Task 3, Task 4
Slice type: verification
Seam: `apps/web/e2e/canvas-context.spec.ts`

**Files:**

- Create: `apps/web/e2e/canvas-context.spec.ts`

- [ ] **Step 1: 写 e2e**

```ts
import { expect, test } from '@playwright/test'

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

test('creates a task with canvas context', async ({ page }) => {
  const commands: Array<{ type?: string; payload?: unknown }> = []
  let created = false

  await page.routeWebSocket('**/ws', (ws) => {
    ws.onMessage((raw) => {
      const message = JSON.parse(String(raw)) as { id?: string; type?: string; payload?: unknown }
      if (!message.id) return
      commands.push(message)
      if (message.type === 'task.create') created = true
      ws.send(
        JSON.stringify({
          v: 1,
          id: `ack-${message.id}`,
          type: 'ack',
          ts: Date.now(),
          payload: {
            commandId: message.id,
            ok: true,
            data: created ? { taskId: 't1' } : { cursor: 0, hasMore: false },
          },
        }),
      )
    })
  })

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    if (path === '/api/workspaces') {
      return route.fulfill({
        json: {
          workspaces: [
            {
              id: 'w1',
              name: 'demo',
              relPath: 'demo',
              trusted: true,
              projectHooks: 'off',
              trustedAt: 1,
              createdAt: 1,
            },
          ],
        },
      })
    }
    if (path === '/api/canvas') {
      return route.fulfill({
        json: {
          canvas: { id: 'c1', workspaceId: 'w1', viewport: { x: 0, y: 0, zoom: 1 } },
          nodes: [
            {
              id: 't1',
              canvasId: 'c1',
              type: 'text',
              x: 80,
              y: 80,
              w: 240,
              h: 120,
              groupId: null,
              data: { content: '需求 A' },
              createdAt: 1,
              updatedAt: 1,
            },
            {
              id: 't2',
              canvasId: 'c1',
              type: 'text',
              x: 80,
              y: 260,
              w: 240,
              h: 120,
              groupId: null,
              data: { content: '需求 B' },
              createdAt: 1,
              updatedAt: 1,
            },
            {
              id: 'a1',
              canvasId: 'c1',
              type: 'agent',
              x: 480,
              y: 160,
              w: 240,
              h: 120,
              groupId: null,
              data: { title: 'Agent 1', engine: 'fake', taskId: null },
              createdAt: 1,
              updatedAt: 1,
            },
          ],
          edges: [],
        },
      })
    }
    if (path === '/api/tasks') {
      return route.fulfill({ json: { tasks: [] } })
    }
    if (path === '/api/engines') {
      return route.fulfill({
        json: { engines: [{ engine: 'fake', status: 'available' }] },
      })
    }
    if (path === '/api/tasks/t1') {
      return route.fulfill({
        json: {
          task: {
            id: 't1',
            workspaceId: 'w1',
            nodeId: 'a1',
            title: 'Agent 1',
            prompt: '<task>开始</task>',
            status: 'todo',
            waitingReason: null,
            engine: 'fake',
            workspaceMode: 'main',
            branch: null,
            worktreePath: null,
            verifyCommand: null,
            dangerouslySkipPermissions: false,
            retryCount: 0,
            createdAt: 1,
            updatedAt: 1,
            context: {
              included: [
                { id: 't1', type: 'text', title: '需求 A', depth: 0, chars: 6 },
                { id: 't2', type: 'text', title: '需求 B', depth: 0, chars: 6 },
              ],
              dropped: [],
              truncated: false,
              redactedPaths: [],
              relations: [],
              relationsTruncated: false,
            },
          },
          sessions: [],
          approvals: [],
          review: null,
          waitingSince: null,
          attention: 'none',
        },
      })
    }
    return route.fulfill({ status: 404, json: { code: 'not_found', message: 'not found' } })
  })

  await page.goto('/?workspace=w1')
  await expect(page.getByText('需求 A')).toBeVisible()

  await page.locator('.react-flow__node', { hasText: '需求 A' }).click({ modifiers: [modifier] })
  await page.locator('.react-flow__node', { hasText: '需求 B' }).click({ modifiers: [modifier] })
  await page.locator('.react-flow__node', { hasText: 'Agent 1' }).click()

  const panel = page.getByTestId('node-panel')
  await expect(panel.getByTestId('context-chips')).toContainText('需求 A')
  await expect(panel.getByTestId('context-chips')).toContainText('需求 B')

  await page.getByLabel('任务说明').fill('总结两个需求')
  await page.getByRole('button', { name: '创建任务' }).click()

  await expect
    .poll(() => {
      const create = commands.find((message) => message.type === 'task.create')
      const payload = create?.payload as { contextNodeIds?: string[] } | undefined
      return payload?.contextNodeIds?.slice().sort().join(',') ?? ''
    })
    .toBe('t1,t2')

  await expect(page.getByText('上下文快照')).toBeVisible()
  await expect(page.getByText('注入 2 个')).toBeVisible()
})
```

- [ ] **Step 2: NodePanel 加 testid**

`NodePanel.tsx` 根元素加 `data-testid="node-panel"`（若无）。

- [ ] **Step 3: 跑 e2e**

Run: `pnpm exec playwright test apps/web/e2e/canvas-context.spec.ts`
Expected: PASS。

- [ ] **Step 4: 跑现有 e2e 防回归**

Run: `pnpm exec playwright test`
Expected: 全绿。

- [ ] **Step 5: 提交**

```bash
git add apps/web/e2e/canvas-context.spec.ts apps/web/src/features/canvas/NodePanel.tsx
git commit -m "test(web): 画布上下文建任务 e2e"
```

---

## Task 6: ego-lite 真实 Claude 验收

Blocking: Task 5
Slice type: verification
Seam: 真实 daemon + 真实 Claude + 浏览器

**Files:**

- Create: `docs/evidence/2026-11-18-m1-6b-canvas-context/README.md`
- Create: `docs/evidence/2026-11-18-m1-6b-canvas-context/*.png`

- [ ] **Step 1: 构建并启动**

```bash
pnpm build
mkdir -p /tmp/baton-6b-demo && cd /tmp/baton-6b-demo && git init -q
BATON_DATA_DIR=$(mktemp -d) BATON_WORKSPACES_ROOT=/tmp node apps/daemon/dist/bin.js
```

（在仓库根目录用相对路径启动；端口以终端输出为准。）

- [ ] **Step 2: 浏览器验收（ego-lite）**

用 `ego-browser` skill 打开终端输出的地址，按顺序：

1. 创建并信任工作区 `baton-6b-demo`。
2. 新建文本节点 A，内容 `ALPHA-42: 登录页必须支持暗黑模式`。
3. 新建文本节点 B，内容 `BETA-17: 接口返回字段必须向后兼容`。
4. 从 A 的 source handle 连到 B 的 target handle。
5. 新建 Agent 节点。
6. 选中 A、B，点击 Agent 打开面板，确认 chips 显示 A/B。
7. 任务说明填「列出上下文中的两个标记，并说明它们的关系」，创建任务。
8. 点「立即开工」；按需审批；等待进入待验收。
9. 确认 transcript 同时出现 `ALPHA-42` 与 `BETA-17`。
10. 打开任务详情，确认快照显示 2 个注入、1 条关系。

- [ ] **Step 3: 留证与脱敏**

截图保存到证据目录；README 记录步骤、预期、实际结果、commit、引擎版本。截图不得包含真实用户名、绝对路径、token、其他窗口内容。

- [ ] **Step 4: 提交**

```bash
git add docs/evidence/2026-11-18-m1-6b-canvas-context
git commit -m "docs(evidence): M1-6b 画布上下文真实链路验收"
```

---

## Task 7: 全量验证与收口

Blocking: Task 1-6
Slice type: verification
Seam: `pnpm verify:full` + `pnpm pack:check`

- [ ] **Step 1: 全量验证**

```bash
pnpm verify
pnpm verify:full
pnpm pack:check
```

Expected: 全部退出码 0。

- [ ] **Step 2: 占位符与样式检查**

```bash
grep -RIn "TODO\|FIXME" apps/web/src packages/protocol/src packages/core/src/context apps/daemon/src
```

Expected: 输出为空。

人工对照 `DESIGN.md`：chips、删除连线按钮、快照卡片使用 token；焦点可见；状态有文字，不只靠颜色。

- [ ] **Step 3: 更新计划完成记录**

在 `docs/plans/2026-11-18-m1-6b-context-web.md` 末尾追加：日期、关键 commit、`pnpm verify:full` 结果、ego-lite 证据路径。

- [ ] **Step 4: 提交**

```bash
git add docs/plans/2026-11-18-m1-6b-context-web.md
git commit -m "docs(plan): M1-6b Web 计划完成记录"
```
