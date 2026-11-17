# M1-6a Plan 4：可编辑画布、节点 CRUD 与任务创建

> **For agentic workers:** 按任务顺序执行，每个 Task 先写失败测试，再实现，最后跑该 Task 的验收命令并提交。步骤用 `- [ ]` 跟踪。

**Goal:** 把中栏从占位变成 6a 可编辑画布：React Flow 渲染 text/file/agent 节点与只读边；支持创建、拖动、缩放、删除与位置持久化；选中 Agent 节点可创建任务；顶栏补齐「新建 Agent 节点」；用 ego-lite 按真实用户路径完成建工作区 → 建节点 → 建任务 → 开工 → 审批 → 验收全链路。

**Architecture:** 协议与 daemon 的 `node.create/update/delete`、`task.create` 已在 Plan 1 完成，本 plan 只做 web 与 e2e。画布用 React Flow + 自定义节点 + `NodeResizer`；所有写操作走 Plan 3 的命令客户端，ack 后 refetch canvas，失败回滚并提示。节点选中状态进 Zustand，右栏在 NodePanel / TaskDetailPanel 之间切换。

**Tech Stack:** React 19、`@xyflow/react` 13、TanStack Query 5、Zustand 5、HeroUI 3.2.7、lucide-react、vitest + Testing Library、Playwright、ego-lite。

**GDD note:** M1 显式跳过 GDD，测试设计由 `docs/contracts/M1-web-console.contract.md` 承担。Plan 4 覆盖 DoD 2（新建 Agent 节点入口）、12、13、16；DoD 14 的节点命令 ack/重拉复用 Plan 3 命令客户端。

**Design sync:** 读根目录 `DESIGN.md`。画布 `bg-background`，节点 `bg-surface` + `border-separator` + `rounded-lg`；选中 `border-accent`；agent 状态用 `StatusChip`；工具条按钮 HeroUI ghost + lucide 图标；不硬编码颜色。

---

## Task 1: 画布模型与 React Flow 渲染

Blocking: none
Slice type: tracer-bullet
Seam: `apps/web/src/features/canvas/model.test.ts`

**Files:**
- Create: `apps/web/src/features/canvas/model.ts`
- Test: `apps/web/src/features/canvas/model.test.ts`
- Create: `apps/web/src/features/canvas/actions.tsx`
- Create: `apps/web/src/features/canvas/nodes/NodeShell.tsx`
- Create: `apps/web/src/features/canvas/nodes/TextNode.tsx`
- Create: `apps/web/src/features/canvas/nodes/FileNode.tsx`
- Create: `apps/web/src/features/canvas/nodes/AgentNode.tsx`
- Modify: `apps/web/src/features/canvas/CanvasPanel.tsx`
- Test: `apps/web/src/features/canvas/CanvasPanel.test.tsx`

**Interfaces:**
- Produces: `toFlowNodes(nodes, tasks): FlowNode[]`、`toFlowEdges(edges): FlowEdge[]`
- Produces: `CanvasActionsContext`、`useCanvasActions()`
- Produces: `<CanvasPanel canvas tasks selectedNodeId onSelectNode />`

- [ ] **Step 1: 写失败测试（模型转换）**

`model.test.ts` 覆盖：

```ts
it('maps protocol nodes to flow nodes with size and task')
it('maps only supported node types to custom node types')
it('maps protocol edges to read-only flow edges')
```

断言 text 节点：

```ts
expect(flow[0]).toMatchObject({
  id: 'n1',
  type: 'text',
  position: { x: 10, y: 20 },
  style: { width: 320, height: 200 },
  data: { node: protocolNode, task: null },
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm --filter @baton/web test
```

- [ ] **Step 3: 实现模型**

`model.ts`：

```ts
import type { Edge as ProtocolEdge, Node as ProtocolNode, TaskSummary } from '@baton/protocol'
import type { Edge as FlowEdge, Node as FlowNode } from '@xyflow/react'

export interface CanvasNodeData {
  node: ProtocolNode
  task: TaskSummary | null
}

const CUSTOM_TYPES = new Set(['text', 'file', 'agent'])

export function toFlowNodes(nodes: ProtocolNode[], tasks: TaskSummary[]): FlowNode<CanvasNodeData>[] {
  const taskByNode = new Map(tasks.map((task) => [task.nodeId, task]))
  return nodes.map((node) => ({
    id: node.id,
    type: CUSTOM_TYPES.has(node.type) ? node.type : 'default',
    position: { x: node.x, y: node.y },
    style: { width: node.w, height: node.h },
    data: { node, task: taskByNode.get(node.id) ?? null },
  }))
}

export function toFlowEdges(edges: ProtocolEdge[]): FlowEdge[] {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.sourceNodeId,
    target: edge.targetNodeId,
    selectable: false,
    focusable: false,
    deletable: false,
  }))
}
```

- [ ] **Step 4: 实现 actions context 与节点壳**

`actions.tsx`：

```tsx
export interface CanvasActions {
  updatePosition: (id: string, x: number, y: number) => void
  updateSize: (id: string, w: number, h: number) => void
}
const CanvasActionsContext = createContext<CanvasActions>({ ...noop })
export function CanvasActionsProvider(...)
export function useCanvasActions()
```

`NodeShell.tsx`：

- 接收 `selected`、`children`，渲染 `bg-surface` 卡片 + 隐藏的上下 `Handle`（`opacity:0`，`isConnectable={false}`），保证已有边能渲染。
- 内部 `NodeResizer minWidth={160} minHeight={100} isVisible={selected} onResizeEnd={(_, p) => updateSize(id, p.width, p.height)}`。
- 用 `useNodeId()` 获取节点 id。

`TextNode`：标题「文本」+ `node.data.content` 两行截断。
`FileNode`：文件名 + 路径，mono 小字。
`AgentNode`：标题 + engine Chip + 有 task 时 `StatusChip`；标题用 `text-sm font-medium`。

- [ ] **Step 5: 实现 CanvasPanel**

- 外层 `ReactFlowProvider`；内层 `FlowCanvas` 使用 `useNodesState`、`useReactFlow`。
- props：`canvas: CanvasResponse | null`、`tasks: TaskSummary[]`、`selectedNodeId`、`onSelectNode`。
- `useEffect` 把 `toFlowNodes` 同步进本地 nodes；本地 `onNodesChange` 用 `applyNodeChanges`。
- `<ReactFlow nodes edges nodeTypes={{ text, file, agent }} onNodeDragStop ... onSelectionChange ... onPaneClick ... nodesConnectable={false} edgesFocusable={false} deleteKeyCode={null} fitView={false} defaultViewport={canvas.viewport}>`。
- `onNodeDragStop` 调 `actions.updatePosition`；`onSelectionChange` 取第一个选中节点回调 `onSelectNode(id)`；`onPaneClick` 回调 null。
- 空画布显示居中虚线提示「画布暂无内容」，但工具条仍可用。
- 底部 `<Background gap={16} />`。
- `data-testid="canvas"` 保持在最外层。

- [ ] **Step 6: 测试 CanvasPanel 渲染**

用 `ReactFlowProvider` + QueryClient + CommandProvider 渲染 2 个节点，断言标题可见；点击节点触发 `onSelectNode`。jsdom 下 React Flow 需要 `ResizeObserver`，若缺失在 `src/test/setup.ts` 加 polyfill。

- [ ] **Step 7: 验证并提交**

```bash
pnpm --filter @baton/web test
pnpm --filter @baton/web build
git add apps/web/src/features/canvas apps/web/src/test/setup.ts
git commit -m "feat(web): 增加 React Flow 画布与节点渲染"
```

---

## Task 2: 节点创建、拖动、缩放与删除

Blocking: Task 1
Slice type: tracer-bullet
Seam: `apps/web/src/features/canvas/CanvasPanel.test.tsx`

**Files:**
- Modify: `apps/web/src/features/canvas/CanvasPanel.tsx`
- Create: `apps/web/src/features/canvas/CanvasToolbar.tsx`
- Create: `apps/web/src/features/canvas/CreateFileNodeDialog.tsx`
- Test: `apps/web/src/features/canvas/CanvasToolbar.test.tsx`

**Interfaces:**
- Produces: `CanvasPanelHandle.addNode(type)`
- Consumes: `node.create` / `node.update` / `node.delete` ack `{ nodeId }`

- [ ] **Step 1: 写失败测试**

`CanvasToolbar.test.tsx`：三个添加按钮 + fit view/zoom 按钮可见；点击「添加文本」调用 `onAdd('text')`。

CanvasPanel 测试：

```ts
it('creates an agent node at the viewport center and selects it')
it('sends node.update after drag stop')
it('rolls back by refetching when node.update fails')
```

发送命令用 `CommandProvider send={vi.fn()}`；断言 payload。

- [ ] **Step 2: 实现工具条**

`CanvasToolbar.tsx`：

- 左上浮动条：`添加文本`（Type 图标）、`添加文件`（FileText）、`添加 Agent`（Bot）、`适应视图`（Maximize）、`放大` / `缩小`。
- 每个按钮 `aria-label` 中文；ghost 变体；`pointer-events-auto`。
- 点击 fit/zoom 调 `useReactFlow().fitView/zoomIn/zoomOut`。

- [ ] **Step 3: 创建节点**

`CanvasPanel` 增加 `forwardRef<CanvasPanelHandle>` + `useImperativeHandle`，暴露 `addNode(type)`：

- 无 canvas 时忽略。
- 位置：容器 `getBoundingClientRect()` 中心 → `screenToFlowPosition` → 减去默认宽高一半（320x200）。
- 文本：`{ type:'text', data:{ content:'新文本节点' } }`。
- Agent：`{ type:'agent', data:{ title:`Agent ${count+1}`, engine:'fake', taskId:null } }`。
- 文件：打开 `CreateFileNodeDialog`，提交后创建；path/name 非空。
- 公共 node 字段 `x,y,w:320,h:200,groupId:null`。
- `await send({type:'node.create', payload:{canvasId, node}})`；读取 `{nodeId}`；`await invalidateQueries(canvas)`；`onSelectNode(nodeId)`。
- 失败 `toast.danger`。

顶栏的「新建 Agent 节点」也调用同一个 handle（Task 4 接入）。

- [ ] **Step 4: 拖动与缩放**

- `onNodeDragStop(_, node)` → `updatePosition(node.id, node.position.x, node.position.y)`。
- `NodeShell` 的 `onResizeEnd` → `updateSize(id, width, height)`。
- 两者都：`sendCommand('node.update', {nodeId, patch})` → `invalidateQueries(canvas)`；失败时同样 invalidate（回滚）并 `toast.danger`。
- 不做乐观持久化标记；本地 React Flow 视觉即时更新，ack 后以服务端为准。

- [ ] **Step 5: 删除**

- `CanvasActions` 增加 `requestDelete(id)` → 选中节点并打开 NodePanel 的删除确认；实际删除在 NodePanel（Task 3）。
- CanvasPanel 不监听 Delete 键，避免误删。

- [ ] **Step 6: 验证并提交**

```bash
pnpm --filter @baton/web test
pnpm --filter @baton/web build
git add apps/web/src/features/canvas
git commit -m "feat(web): 增加画布节点创建、拖动缩放与删除入口"
```

---

## Task 3: 节点面板、创建任务与删除守卫

Blocking: Task 2
Slice type: tracer-bullet
Seam: `apps/web/src/features/canvas/NodePanel.test.tsx`

**Files:**
- Create: `apps/web/src/features/canvas/NodePanel.tsx`
- Create: `apps/web/src/features/tasks/CreateTaskForm.tsx`
- Test: `apps/web/src/features/canvas/NodePanel.test.tsx`
- Test: `apps/web/src/features/tasks/CreateTaskForm.test.tsx`
- Modify: `apps/web/src/features/canvas/CanvasPanel.tsx`
- Modify: `apps/web/src/features/canvas/CanvasToolbar.tsx`

**Interfaces:**
- Produces: `<NodePanel node task onOpenTask onDeleted />`
- Produces: `<CreateTaskForm nodeId workspaceId defaultTitle onCreated />`

- [ ] **Step 1: 写失败测试**

`CreateTaskForm.test.tsx`：

```ts
it('requires title and prompt before submit')
it('sends task.create with fake engine, main mode and empty context')
```

断言 payload：

```ts
{
  type: 'task.create',
  payload: {
    workspaceId: 'w1',
    nodeId: 'n1',
    title: '演示任务',
    prompt: '请完成演示',
    contextNodeIds: [],
    engine: 'fake',
    workspaceMode: 'main',
    verifyCommand: 'node -e "console.log(1)"',
  },
}
```

`NodePanel.test.tsx`：

- Agent 无 task：显示「创建任务」表单。
- Agent 有 task：显示任务标题/状态 +「打开任务」。
- 删除确认后发送 `node.delete`；`node_in_use` 显示「节点被任务引用」。
- 非 agent 节点不显示创建任务。

- [ ] **Step 2: 实现 CreateTaskForm**

- 字段：标题（默认 agent 标题）、prompt、verifyCommand（可选）。
- `Input` / `TextArea` 带 `aria-label`。
- 提交禁用：title/prompt 为空或 pending。
- `useCommandAction` 发送 `task.create`；成功后 `invalidateQueries(tasks)` + `onCreated(taskId)`。
- engine/workspaceMode 固定，不在 UI 暴露。

- [ ] **Step 3: 实现 NodePanel**

- `data-testid="node-detail"`，宽度 380。
- 顶部节点类型 + 标题；文本显示 content，文件显示 path，Agent 显示 engine。
- Agent 无 task：`CreateTaskForm`。
- Agent 有 task：任务摘要（标题、StatusChip、attention）+「打开任务」按钮。
- 删除：两步确认；`node.delete` 成功 → `invalidateQueries(canvas)` + `onDeleted()`；`node_in_use` → 文案「节点被任务引用，先处理任务」。
- 关闭按钮清空选中。

- [ ] **Step 4: 验证并提交**

```bash
pnpm --filter @baton/web test
pnpm --filter @baton/web build
git add apps/web/src/features/canvas apps/web/src/features/tasks/CreateTaskForm.tsx apps/web/src/features/tasks/CreateTaskForm.test.tsx
git commit -m "feat(web): 增加节点面板、创建任务与删除守卫"
```

---

## Task 4: App 集成、顶栏入口与选中状态

Blocking: Task 3
Slice type: tracer-bullet
Seam: `apps/web/src/App.test.tsx`

**Files:**
- Modify: `apps/web/src/stores/app.ts`
- Modify: `apps/web/src/App.tsx`
- Test: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/features/tasks/TaskBoard.tsx`（选中任务时清空节点选中）

**Interfaces:**
- Produces: `selectedNodeId`、`setSelectedNode`
- Produces: 顶栏「新建 Agent 节点」

- [ ] **Step 1: 写失败测试**

App 测试：

- 有 workspace + canvas 时顶栏显示「新建 Agent 节点」；点击后发送 `node.create`（通过 fake WebSocket / CommandProvider 断言）。
- 点击任务卡后右栏显示任务详情，节点选中被清空。
- 点击画布 Agent 节点后右栏显示 `node-detail` 与创建任务表单。

- [ ] **Step 2: Store**

```ts
selectedNodeId: string | null
setSelectedNode: (id: string | null) => void
setWorkspace: (id) => set({ activeWorkspaceId: id, activeTaskId: null, selectedNodeId: null })
```

- [ ] **Step 3: App 集成**

- `canvasRef = useRef<CanvasPanelHandle>(null)`。
- 顶栏 `<Button variant="secondary" isDisabled={!activeWorkspaceId} onPress={() => canvasRef.current?.addNode('agent')}>新建 Agent 节点</Button>`。
- `<CanvasPanel ref={canvasRef} canvas={canvas.data ?? null} tasks={tasks.data ?? []} selectedNodeId={selectedNodeId} onSelectNode={...} />`。
- `onSelectNode(id)`：`setSelectedNode(id)`；不自动改 activeTaskId。
- 任务卡选择：`setSelectedNode(null)` 后 `setTask(id)`。
- 右栏：
  ```tsx
  {selectedNode && !selectedTask ? (
    <NodePanel node={selectedNode} task={taskByNode} onOpenTask={(id)=>{setSelectedNode(null); setTask(id)}} onDeleted={()=>setSelectedNode(null)} />
  ) : (
    <TaskDetailPanel />
  )}
  ```
- CanvasPanel 的 `node.create` 成功后 `onSelectNode(newId)`。

- [ ] **Step 4: 验证并提交**

```bash
pnpm --filter @baton/web test
pnpm --filter @baton/web build
pnpm verify
git add apps/web/src
git commit -m "feat(web): 接入可编辑画布、节点面板与顶栏建节点"
```

---

## Task 5: ego-lite 用户路径 E2E 与全量收尾

Blocking: Task 4
Slice type: verification
Seam: ego-lite 会话 + 截图

**Files:**
- Modify: `docs/plans/2026-11-17-m1-web-canvas.md`（执行记录）
- Create: `docs/evidence/2026-11-17-m1-6a-canvas/`（截图）

**Interfaces:**
- Produces: 真实浏览器验收证据

- [ ] **Step 1: 准备环境**

```bash
rm -rf /tmp/baton-e2e-data /tmp/baton-e2e-workspaces
mkdir -p /tmp/baton-e2e-data /tmp/baton-e2e-workspaces/demo
printf '{"name":"demo","private":true,"scripts":{"verify":"node -e \\"console.log(1)\\""}}' \
  > /tmp/baton-e2e-workspaces/demo/package.json

BATON_DATA_DIR=/tmp/baton-e2e-data \
BATON_WORKSPACES_ROOT=/tmp/baton-e2e-workspaces \
BATON_PORT=7317 pnpm dev
```

- [ ] **Step 2: 按用户思路走完整流程**

用 ego-lite 打开 `http://localhost:5173/`，按真实用户操作：

1. 点「新建工作区」，填写名称 `demo`、相对路径 `demo`，点「创建」；确认工作区选中、画布为空。
2. 点顶栏「新建 Agent 节点」；确认画布出现 `Agent 1`。
3. 用鼠标拖动节点到新位置；刷新页面，确认位置保留。
4. 点工具条「添加文本」「添加文件」，文件对话框填 `README.md` / `README.md`；确认两个节点出现。
5. 点 Agent 节点；右栏出现创建任务表单，填标题「演示画布任务」、prompt「请完成演示」、verifyCommand `node -e "console.log('verify ok')"`，点「创建任务」。
6. 确认右栏出现任务摘要；点「打开任务」→ 状态「待办」→ 点「立即开工」。
7. 审批出现 → 点「允许」→ 验收出现 → 点「通过」→ 已完成。
8. 再点 Agent 节点；点「删除节点」→ 确认；断言出现「节点被任务引用」错误，节点仍在。
9. 刷新页面；确认节点位置、文本/文件节点、任务完成态与 transcript 都还在。
10. 截图保存到 `docs/evidence/2026-11-17-m1-6a-canvas/`：工作区空画布、Agent 节点、创建任务、审批、验收、完成、删除守卫、刷新后画布。

不允许用 seed 脚本或直接 WS 命令代替这些 UI 操作；种子脚本只允许用于 Plan 3 已有的只读验收。

- [ ] **Step 3: 全量命令**

```bash
pnpm verify
pnpm verify:full
pnpm pack:check
pnpm check:boundaries
pnpm check:protocol
pnpm format:check
grep -RIn "TODO\|FIXME" apps/web/src packages/protocol/src apps/daemon/src
```

Expected: 全部 exit 0；grep 输出为空。

- [ ] **Step 4: 更新执行记录**

写：commit 列表、命令输出摘要、ego-lite 截图路径、偏离与已知问题。

- [ ] **Step 5: 提交**

```bash
git add docs/evidence/2026-11-17-m1-6a-canvas docs/plans/2026-11-17-m1-web-canvas.md
git commit -m "docs(plans): 记录 M1-6a 可编辑画布验收结果"
```

---

## 执行记录

（执行后填写真实命令输出、commit、ego-lite 截图与偏离。不要预填。）
