# M1-6a Plan 3：任务详情、Transcript 与人闸门

> **For agentic workers:** 按任务顺序执行，每个 Task 先写失败测试，再实现，最后跑该 Task 的验收命令并提交。步骤用 `- [ ]` 跟踪。

**Goal:** 让右栏从占位详情变成可操作的任务控制台：加载任务详情与 session 历史，渲染 transcript，支持审批、回复、验收、立即开工与取消；WebSocket 实时追加并按 `sessionId+seq` 去重。

**Architecture:** 先给 `session.event` 补 session 内序号（协议 + daemon），再做命令客户端与 realtime provider，然后用纯函数把 AG-UI 事件投影为 transcript，最后把详情面板拆成 header / actions / 三类人闸门卡 / transcript。命令全部走 WS，10 秒无 ack 视为失败；状态不做乐观更新，ack 后 invalidate。

**Tech Stack:** React 19、TanStack Query 5、Zustand 5、HeroUI 3.2.7、lucide-react、`@tanstack/react-virtual` 3.14、vitest + Testing Library、Playwright、ego-lite 浏览器。

**GDD note:** M1 显式跳过 GDD，测试设计由 `docs/contracts/M1-web-console.contract.md` 承担。Plan 3 覆盖 DoD 9、10；DoD 14 在本 plan 补齐命令 ack/超时与 `session.event` 去重；DoD 15 覆盖 WS error toast 与只读 transcript；DoD 12/13/16 仍由 Plan 4 交付。

**Design sync:** 读根目录 `DESIGN.md`。详情面板 `bg-surface`，section 间 `border-separator`；审批卡 `border-warning` + 左侧 2px 竖线；验收卡 `border-accent`；transcript 不用聊天气泡，左侧角色标签 + 右侧内容，工具输出用 mono 块；不硬编码颜色。

---

## Task 1: `session.event` 携带 session 内 seq

Blocking: none
Slice type: contract-first
Seam: `packages/protocol/test/events.test.ts`

**Files:**
- Modify: `packages/protocol/src/events.ts`
- Modify: `packages/protocol/test/events.test.ts`
- Modify: `apps/daemon/src/db/event-store.ts`
- Modify: `apps/daemon/test/event-store.test.ts`
- Test: `apps/daemon/test/ws-router.test.ts`（如有 payload 断言）

**Interfaces:**
- Produces: `session.event.payload.seq?: number`
- Consumes: daemon `appendSessionEvent({ sessionId, seq, event })`

- [ ] **Step 1: 写失败测试**

在 `packages/protocol/test/events.test.ts` 的 `session.event` 用例中，把 payload 改为：

```ts
['session.event', { sessionId: 's1', seq: 7, event: aguiEvent }]
```

并增加：

```ts
it('accepts session.event replay rows without seq', () => {
  const parsed = ServerMessage.parse({
    v: 1,
    ts: 1,
    type: 'session.event',
    payload: { sessionId: 's1', event: { type: 'RUN_STARTED', threadId: 't', runId: 'r' } },
  })
  expect(parsed.type).toBe('session.event')
})
```

在 `apps/daemon/test/event-store.test.ts` 断言广播 payload：

```ts
expect(appended.payload).toMatchObject({ sessionId: 's1', seq: 1 })
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm --filter @baton/protocol test
pnpm --filter @baton/daemon test
```

Expected: FAIL，`seq` 不在 payload。

- [ ] **Step 3: 实现**

`packages/protocol/src/events.ts`：

```ts
export const SessionEvent = ReplayableBase.extend({
  type: z.literal('session.event'),
  payload: z.object({
    sessionId: Id,
    /** 会话内序号；旧 ws_event 行可能没有，读取端需容忍。 */
    seq: z.number().int().nonnegative().optional(),
    event: EventSchemas,
  }),
})
```

`apps/daemon/src/db/event-store.ts` 的 `appendSessionEvent`：

```ts
const ws = appendWs(tx, {
  type: 'session.event',
  payload: { sessionId: input.sessionId, seq: input.seq, event: input.event },
  ts,
})
```

- [ ] **Step 4: 验证并提交**

```bash
pnpm --filter @baton/protocol test
pnpm --filter @baton/daemon test
pnpm typecheck
git add packages/protocol apps/daemon
git commit -m "feat(protocol): session.event 携带会话内 seq"
```

---

## Task 2: 命令客户端、RealtimeProvider 与 session events 查询

Blocking: Task 1
Slice type: tracer-bullet
Seam: `apps/web/src/lib/ws.test.ts`

**Files:**
- Modify: `apps/web/src/lib/ws.ts`
- Test: `apps/web/src/lib/ws.test.ts`
- Create: `apps/web/src/lib/command-context.tsx`
- Create: `apps/web/src/features/realtime/RealtimeProvider.tsx`
- Test: `apps/web/src/features/realtime/RealtimeProvider.test.tsx`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/lib/query.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/main.tsx`
- Modify: `apps/web/src/App.test.tsx`

**Interfaces:**
- Produces: `CommandInput`、`WsClient.sendCommand(input): Promise<unknown>`
- Produces: `CommandContext`、`useCommand()`、`<RealtimeProvider workspaceId>`
- Produces: `listSessionEvents(sessionId, sinceSeq?, limit?)`
- Produces: `queryKeys.sessionEvents(sessionId)`

- [ ] **Step 1: 写失败测试（命令 ack / 错误 / 超时）**

在 `apps/web/src/lib/ws.test.ts` 增加：

```ts
it('resolves a command on ack and rejects on command error', async () => {
  const client = createWsClient({ onStatus: vi.fn(), onEvent: vi.fn() })
  const socket = FakeSocket.instances[0]!
  socket.open()

  const first = client.sendCommand({ type: 'task.enqueue', payload: { taskId: 't1' } })
  const sent = JSON.parse(socket.sent[0]!) as { id: string; type: string }
  expect(sent.type).toBe('task.enqueue')
  socket.message({
    v: 1,
    ts: 2,
    type: 'ack',
    payload: { commandId: sent.id, ok: true, data: { taskId: 't1' } },
  })
  await expect(first).resolves.toEqual({ taskId: 't1' })

  const second = client.sendCommand({ type: 'task.cancel', payload: { taskId: 't1' } })
  const sent2 = JSON.parse(socket.sent[1]!) as { id: string }
  socket.message({
    v: 1,
    ts: 3,
    type: 'error',
    payload: { commandId: sent2.id, code: 'task_not_found', message: 'task not found' },
  })
  await expect(second).rejects.toMatchObject({ code: 'task_not_found' })
  client.close()
})

it('rejects commands after 10s without ack and when offline', async () => {
  const client = createWsClient({ onStatus: vi.fn(), onEvent: vi.fn() })
  const socket = FakeSocket.instances[0]!
  socket.open()

  const pending = client.sendCommand({ type: 'task.enqueue', payload: { taskId: 't1' } })
  vi.advanceTimersByTime(10_000)
  await expect(pending).rejects.toMatchObject({ code: 'ack_timeout' })

  const offline = client.sendCommand({ type: 'task.enqueue', payload: { taskId: 't1' } })
  await expect(offline).rejects.toMatchObject({ code: 'ws_offline' })
  client.close()
})
```

RealtimeProvider 测试：用 fake WS 与 QueryClient，断言 `session.event` 写入 `sessionEvents` 缓存并按 seq 去重。

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm --filter @baton/web test
```

Expected: FAIL，`sendCommand` 不存在。

- [ ] **Step 3: 扩展 ws 客户端**

`apps/web/src/lib/ws.ts` 增加：

```ts
export type CommandInput = DistributiveOmit<ClientMessage, 'v' | 'id' | 'ts'>
export class CommandError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'CommandError'
  }
}
```

内部维护 `pending: Map<string, { resolve; reject; timer }>`；`sendCommand`：

```ts
const sendCommand = (input: CommandInput): Promise<unknown> => {
  if (socket?.readyState !== WebSocket.OPEN) {
    return Promise.reject(new CommandError('ws_offline', 'WebSocket 未连接'))
  }
  const message: ClientMessage = ClientMessage.parse({
    ...input,
    v: 1,
    id: createId(),
    ts: Date.now(),
  })
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pending.delete(message.id)
      reject(new CommandError('ack_timeout', '命令 10 秒内未确认'))
    }, 10_000)
    pending.set(message.id, { resolve, reject, timer })
    socket!.send(JSON.stringify(message))
  })
}
```

消息处理：

- `ack`：先按 `payload.commandId` 找 pending，命中则 `clearTimeout` + resolve `payload.data`；否则走 `handleAck`（resume 翻页）。
- `error`：命中 pending 则 reject `CommandError(code, message, details)`；没有 `commandId` 的广播 error 交给 `onEvent`。
- `close`：`rejectAll(new CommandError('ws_closed', '连接已断开'))`。

返回 `{ close, lastSeq, sendCommand }`。

- [ ] **Step 4: 实现 command context 与 RealtimeProvider**

`lib/command-context.tsx`：

```tsx
export type CommandSender = (input: CommandInput) => Promise<unknown>

const CommandContext = createContext<CommandSender>(() =>
  Promise.reject(new CommandError('ws_offline', 'WebSocket 未连接')),
)

export function CommandProvider({
  send,
  children,
}: {
  send: CommandSender
  children: ReactNode
}) {
  return <CommandContext.Provider value={send}>{children}</CommandContext.Provider>
}

export function useCommand() {
  return useContext(CommandContext)
}
```

`features/realtime/RealtimeProvider.tsx`：

- props `{ workspaceId: string | null; children }`。
- `useQueryClient()`、`setWsStatus`。
- effect：无 workspace 时 `setWsStatus('offline')` 并返回；有 workspace 时 `createWsClient`。
- `onEvent`：
  - `session.event`：若 `payload.seq` 是 number，构造 `SessionEventRecord.parse({ seq, type: event.payload.event.type, payload: event.payload.event, ts: event.ts })`，用 `appendSessionEvent` 写入 `queryKeys.sessionEvents(sessionId)`；否则忽略。
  - `task.status` / `approval.request` / `verify.result`：100ms 合并后 invalidate 任务列表与当前任务详情。
  - `error`：`toast.danger(event.payload.message)`（`import { toast } from '@heroui/react/toast'`）。
- 渲染 `<CommandProvider send={client?.sendCommand ?? fallback}>{children}</CommandProvider>`。
- 缓存追加函数放 `features/realtime/session-cache.ts`，纯函数，便于测试。

- [ ] **Step 5: API / queryKeys**

```ts
export async function listSessionEvents(sessionId: string, sinceSeq = 0, limit = 500) {
  const query = new URLSearchParams({ sinceSeq: String(sinceSeq), limit: String(limit) })
  return SessionEventsResponse.parse(
    await request(`/api/sessions/${encodeURIComponent(sessionId)}/events?${query}`),
  )
}
```

`queryKeys.sessionEvents(sessionId)`。

- [ ] **Step 6: 接入 App / main**

`App.tsx` 删除 WS effect，改为：

```tsx
<RealtimeProvider workspaceId={activeWorkspaceId}>
  <div className="flex h-screen ...">...</div>
</RealtimeProvider>
```

`main.tsx` 增加 `<Toast.Provider>` 包裹 `<App />`（`@heroui/react/toast`）。

`App.test.tsx` 的 fake WebSocket 已存在；补一个断言：没有 workspace 时不创建 socket；有 workspace 时创建。

- [ ] **Step 7: 运行测试与构建**

```bash
pnpm --filter @baton/web test
pnpm --filter @baton/web build
```

Expected: PASS。

- [ ] **Step 8: 提交**

```bash
git add apps/web
git commit -m "feat(web): 增加 WS 命令客户端与实时事件提供者"
```

---

## Task 3: Transcript 投影与虚拟列表

Blocking: Task 2
Slice type: tracer-bullet
Seam: `apps/web/src/features/tasks/transcript.test.ts`

**Files:**
- Create: `apps/web/src/features/tasks/transcript.ts`
- Test: `apps/web/src/features/tasks/transcript.test.ts`
- Create: `apps/web/src/features/tasks/Transcript.tsx`
- Test: `apps/web/src/features/tasks/Transcript.test.tsx`
- Modify: `apps/web/package.json`（`@tanstack/react-virtual`）
- Modify: `THIRD_PARTY_NOTICES.md`

**Interfaces:**
- Produces: `buildTranscript(events: SessionEventRecord[]): TranscriptEntry[]`
- Produces: `<Transcript events={...} loading={...} />`

- [ ] **Step 1: 写失败测试**

`transcript.test.ts` 覆盖：

```ts
it('merges assistant text chunks by messageId')
it('renders user.message custom events as user entries')
it('renders approval.request and session.outcome as system entries')
it('renders tool call args/result as mono tool entries')
it('drops duplicate seq values')
```

示例事件：

```ts
const events = [
  { seq: 1, ts: 1, type: 'TEXT_MESSAGE_START', payload: { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' } },
  { seq: 2, ts: 2, type: 'TEXT_MESSAGE_CONTENT', payload: { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: '你好' } },
  { seq: 3, ts: 3, type: 'CUSTOM', payload: { type: 'CUSTOM', name: 'user.message', value: { text: '继续' } } },
] satisfies SessionEventRecord[]
```

断言 `buildTranscript(events)` 返回两条：assistant「你好」、user「继续」。

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm --filter @baton/web test
```

- [ ] **Step 3: 实现纯函数投影**

`transcript.ts`：

```ts
export type TranscriptRole = 'user' | 'assistant' | 'tool' | 'system'
export interface TranscriptEntry {
  id: string
  role: TranscriptRole
  title: string
  text: string
  mono: boolean
  ts: number
}
```

规则：

- 先按 `seq` 去重，再按 `seq` 升序。
- `TEXT_MESSAGE_START/CONTENT/END` 按 `messageId` 聚合为 assistant；缺 START 时用首个 CONTENT 创建。
- `TOOL_CALL_START/ARGS/END/RESULT` 按 `toolCallId` 聚合为 tool；`title` 用 `toolCallName`，`text` 拼接 args 与 result，`mono=true`。
- `CUSTOM`：
  - `user.message` → role `user`，`text=value.text`
  - `approval.request` → role `system`，`title="请求审批"`，`text` 为 `toolName + input` 的 mono JSON
  - `session.outcome` → role `system`，`title` 为 `会话 ${outcome}`，`reason` 可选
  - 其他 → role `system`，`title=name`
- `RUN_STARTED/FINISHED/ERROR` → system。
- 其他 AG-UI 事件忽略。
- 未知 payload 不抛错；用 typeof 守卫。

- [ ] **Step 4: 实现 Transcript 组件**

- 顶部 session 选择器由父组件传入（`sessions` + `value` + `onChange`），或由 TaskDetailPanel 渲染；本组件只负责列表。
- `useVirtualizer({ count, getScrollElement, estimateSize: () => 72, overscan: 8 })`。
- 容器：`min-h-0 flex-1 overflow-y-auto`，`aria-label="会话记录"`，`tabIndex={0}`。
- 每条：左侧固定宽度角色标签（你 / Agent / 工具 / 系统），右侧时间 + 内容；`mono` 用 `font-mono text-xs bg-background border border-separator rounded-lg p-3 whitespace-pre-wrap`。
- 自动滚动：`atBottomRef` + `onScroll`；新条目且 atBottom 时 `scrollToIndex(last, { align: 'end' })`；不在底部时显示「跳到最新」按钮。
- 空态「暂无会话记录」；加载态「加载中…」。

- [ ] **Step 5: 测试 Transcript**

`Transcript.test.tsx` 用 3 条记录断言角色标签与内容可见；jsdom 下虚拟列表可能只渲染首屏，测试用 3 条即可。若虚拟器在 jsdom 不渲染，给 `Transcript` 增加 `virtualize?: boolean`（默认 true，测试传 false）并在组件内二选一渲染；不要为此引入第二套列表组件。

- [ ] **Step 6: 验证并提交**

```bash
pnpm --filter @baton/web test
pnpm --filter @baton/web build
git add apps/web/package.json pnpm-lock.yaml THIRD_PARTY_NOTICES.md apps/web/src/features/tasks
git commit -m "feat(web): 增加 transcript 投影与虚拟列表"
```

---

## Task 4: 详情 header、动作与人闸门

Blocking: Task 3
Slice type: tracer-bullet
Seam: `apps/web/src/features/tasks/TaskDetailPanel.test.tsx`

**Files:**
- Create: `apps/web/src/features/tasks/TaskHeader.tsx`
- Create: `apps/web/src/features/tasks/TaskActions.tsx`
- Create: `apps/web/src/features/tasks/ApprovalCard.tsx`
- Create: `apps/web/src/features/tasks/ReplyComposer.tsx`
- Create: `apps/web/src/features/tasks/ReviewCard.tsx`
- Create: `apps/web/src/features/tasks/useCommandAction.ts`
- Modify: `apps/web/src/features/tasks/TaskDetailPanel.tsx`
- Test: `apps/web/src/features/tasks/ApprovalCard.test.tsx`
- Test: `apps/web/src/features/tasks/ReplyComposer.test.tsx`
- Test: `apps/web/src/features/tasks/ReviewCard.test.tsx`
- Test: `apps/web/src/features/tasks/TaskDetailPanel.test.tsx`

**Interfaces:**
- Consumes: `TaskDetailResponse`、`SessionEventRecord`、`useCommand()`
- Produces: `<TaskHeader>`、`<TaskActions>`、`<ApprovalCard>`、`<ReplyComposer>`、`<ReviewCard>`

- [ ] **Step 1: 写失败测试**

`ApprovalCard.test.tsx`：

```tsx
render(
  <CommandProvider send={send}>
    <ApprovalCard
      approval={{ id: 'a1', sessionId: 's1', request: { toolName: 'Bash', input: { command: 'pnpm test' }, risk: 'medium' }, decision: null, decidedBy: null, decidedAt: null }}
      onDone={vi.fn()}
    />
  </CommandProvider>,
)
expect(screen.getByText('Bash')).toBeInTheDocument()
fireEvent.click(screen.getByRole('button', { name: '允许' }))
await waitFor(() =>
  expect(send).toHaveBeenCalledWith({ type: 'approval.decide', payload: { approvalId: 'a1', decision: 'allow' } }),
)
```

`ReplyComposer.test.tsx`：空文本禁用；输入后发送 `session.reply`。

`ReviewCard.test.tsx`：打回按钮在反馈为空时禁用；填写后发送带 `feedback` 的 `review.decide`。

`TaskDetailPanel.test.tsx`：mock fetch 返回 task detail + session events；断言标题、transcript、当前闸门卡；点击「立即开工」发送 `task.enqueue`；成功后 invalidate（用 QueryClient 查询状态或用 spy 断言 `invalidateQueries`）。

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm --filter @baton/web test
```

- [ ] **Step 3: `useCommandAction`**

```ts
export function useCommandAction(onDone: () => Promise<void> | void) {
  const send = useCommand()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (input: CommandInput) => {
    setPending(true)
    setError(null)
    try {
      await send(input)
      await onDone()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作失败')
    } finally {
      setPending(false)
    }
  }
  return { run, pending, error }
}
```

- [ ] **Step 4: `TaskHeader`**

- 标题 `text-base font-medium`，右上 attention。
- 元信息：StatusChip、engine chip、retryCount>0、waitingSince（复用 WaitingTime）。
- 不改 task 状态。

- [ ] **Step 5: `TaskActions`**

- `todo` → 「立即开工」primary，`task.enqueue`。
- `queued` / `running` → 「取消任务」danger-soft；点击后变「确认取消 / 返回」两步，确认发 `task.cancel`（无 reason）。
- `waiting_input` / `verifying` / `review` / 终态 → 不显示开工/取消（由对应卡片处理）。
- 成功后 `invalidateQueries(queryKeys.task(taskId))` + `queryKeys.tasks(workspaceId)`。
- 失败内联 `text-danger`，不弹原生 alert。

- [ ] **Step 6: `ApprovalCard`**

- 取 `approval`（pending）；无 pending 时显示「等待审批记录同步…」。
- 风险 Chip：low=success、medium=warning、high=danger。
- `toolName` + `input` mono JSON + `reason`。
- 「允许」primary / 「拒绝」danger；pending 时都禁用。
- 发送 `approval.decide`；成功后 `onDone()`（父组件 invalidate + 清本地状态）。
- 只展示命令，不执行。

- [ ] **Step 7: `ReplyComposer`**

- `TextArea`，`aria-label="回复内容"`，占位「回复 Agent…」。
- 发送按钮 `isDisabled={!text.trim() || pending}`；`Ctrl/Cmd+Enter` 发送。
- 发送 `session.reply`。成功后清空并 `onDone()`。
- 仅在 `waiting_input` 且 `waitingReason !== 'approval'` 时由父组件渲染。

- [ ] **Step 8: `ReviewCard`**

- 退出码 Chip：0=success，非 0=danger。
- diffStat：`filesChanged` / `+insertions` / `-deletions`。
- `verifyOutput` mono `<pre>`，`max-h-48 overflow-auto`。
- 「通过」primary → `review.decide approve`。
- 「打回」tertiary → 展开反馈 `TextArea`；反馈为空时「确认打回」禁用；发送 `review.decide reject + feedback`。
- 成功后 `onDone()`。

- [ ] **Step 9: `TaskDetailPanel` 组装**

- 查 detail 与 session events（limit 500）。
- 默认 session：`sessions.at(-1)`；`selectedSessionId` 失效时回退最新。
- session 选择器：native `select` + tokens + `aria-label="会话"`。
- 渲染顺序：TaskHeader → 状态对应卡片 → TaskActions → Transcript。
- `waiting_input(approval)`：`ApprovalCard`；`waiting_input` 其他：`ReplyComposer`；`review`：`ReviewCard`。
- `todo` / `queued` / `running`：TaskActions。
- 终态：只读提示。
- session events `hasMore` 时显示「仅显示前 500 条」。
- `data-testid="task-detail"` 保留。

- [ ] **Step 10: 验证并提交**

```bash
pnpm --filter @baton/web test
pnpm --filter @baton/web build
pnpm lint
pnpm format:check
git add apps/web
git commit -m "feat(web): 增加任务详情、transcript 与人闸门"
```

---

## Task 5: ego-lite 真实浏览器验收与全量收尾

Blocking: Task 4
Slice type: verification
Seam: ego-lite 会话 + 截图

**Files:**
- Create: `scripts/e2e-seed-gates.mjs`
- Modify: `THIRD_PARTY_NOTICES.md`（如 Task 3 尚未加）
- Modify: `docs/plans/2026-11-17-m1-web-detail-gates.md`（执行记录）

**Interfaces:**
- Produces: 一个可复用的 gate 场景 seed 脚本
- Produces: ego-lite 截图/快照证据

- [x] **Step 1: 写 seed 脚本**

`scripts/e2e-seed-gates.mjs`：

- 读取 `BATON_BASE_URL`（默认 `http://127.0.0.1:7317`）与 `BATON_WORKSPACE_DIR`（默认临时目录）。
- `POST /api/workspaces` 创建 workspace（name `demo-<timestamp>`，relPath 为临时目录 basename）。
- 用 `ws` 连接 `/ws`：
  - 发 `node.create` 创建 agent 节点（canvasId 来自创建响应）。
  - 发 `task.create`（title「演示：审批与验收」，prompt「请演示审批与验收」，contextNodeIds `[]`，engine `fake`，workspaceMode `main`，verifyCommand `node -e "console.log('verify ok')"`）。
  - 发 `task.enqueue`。
- 等待 `task.status` 到 `waiting_input`（最长 10s）。
- 输出 `{ workspaceId, taskId }` JSON，供 ego-lite 打开 `http://127.0.0.1:5173/?workspace=...&task=...`。
- 脚本只用于本地/CI e2e，不进入 web runtime；不复用生产启动逻辑。

- [x] **Step 2: 启动服务**

```bash
export BATON_DATA_DIR=$(mktemp -d)
export BATON_WORKSPACES_ROOT=$(mktemp -d)
export BATON_PORT=7317
pnpm --filter @evanfang0054/baton dev
pnpm --filter @baton/web dev
```

> 具体启动命令以根 `pnpm dev` 为准；确保 daemon 监听 7317、Vite 5173 代理 `/api` 与 `/ws`。

- [x] **Step 3: 用 ego-lite 走真实流程**

加载 `ego-browser` skill，按以下步骤操作并保留截图：

1. 打开 seed 输出的 URL。
2. 断言右栏显示任务标题、状态「待审核」、审批卡（Bash / pnpm test / risk）。
3. 点「允许」→ 等待状态进入「验收中」/「待验收」，验收卡出现退出码 0 与 verify 输出。
4. 点「通过」→ 状态「已完成」，transcript 包含 user/assistant/system 条目。
5. 刷新页面，状态与 transcript 仍在。
6. 再 seed 一个 `todo` 任务，点「立即开工」，断言离开待办并进入运行/等待；取消按钮的 payload 与两步确认由 `TaskActions` 单测覆盖。
7. 截图：审批卡、验收卡、完成态、刷新后 transcript。

不允许用静态截图或纯 HTTP 断言替代交互；关键步骤截图附在 PR 或执行记录。

- [x] **Step 4: 全量命令**

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

- [x] **Step 5: 更新执行记录**

在本文档末尾写：commit 列表、真实命令输出摘要、ego-lite 截图路径、偏离与已知问题。

- [x] **Step 6: 提交**

```bash
git add scripts/e2e-seed-gates.mjs THIRD_PARTY_NOTICES.md docs/plans/2026-11-17-m1-web-detail-gates.md
git commit -m "test(web): 增加人闸门 ego-lite 验收场景"
```

---

## 执行记录

执行日期：2026-11-17
分支：`feat/m1-6a-web-ui`（Plan 2 HEAD `04af864`）

### 提交

| 任务 | Commit | 说明 |
|---|---|---|
| Task 1 | `51e69eb` | feat(protocol): session.event 携带会话内 seq |
| Task 2 | `b0c031e` | feat(web): 增加 WS 命令客户端与实时事件提供者 |
| Task 3 | `96e1182` | feat(web): 增加 transcript 投影与虚拟列表 |
| Task 4 | `b9eb494` | feat(web): 增加任务详情、transcript 与人闸门 |
| Task 5 | `7f680f1` | test(web): 增加人闸门 ego-lite 验收场景 |
| E2E 修复 | `675ac6b` | fix(web): 修复 Toast.Provider 吞掉 App 导致白屏 |
| Review 修复 | `322a190` | fix(web): 收紧详情状态、实时事件与命令发送 |

### 验证

- `pnpm verify:full`：exit 0；Playwright `apps/web/e2e/shell.spec.ts` 1 passed
- web 单测：46 passed（含 WS 命令 ack/超时、session cache、五类闸门卡、Root provider 组合）
- protocol 98、daemon 113、core/adapters 维持原测试数
- `pnpm pack:check`：`pack-check ok`
- `pnpm check:protocol`：`protocol single-source ok`
- `pnpm check:boundaries`：`✔ no dependency violations found (224 modules, 611 dependencies cruised)`
- `pnpm format:check`：`All matched files use Prettier code style.`
- `grep -RIn "TODO\|FIXME" apps/web/src packages/protocol/src apps/daemon/src`：无输出
- `git diff --name-only 04af864...HEAD`：仅 `packages/protocol/**`、`apps/daemon/**`、`apps/web/**`、`docs/**`、`scripts/**`；无 `packages/core`

### ego-lite 验收

启动（临时数据目录）：

```bash
BATON_DATA_DIR=/tmp/baton-e2e-data \
BATON_WORKSPACES_ROOT=/tmp/baton-e2e-workspaces \
BATON_PORT=7317 pnpm dev

BATON_WORKSPACES_ROOT=/tmp/baton-e2e-workspaces \
BATON_WEB_URL=http://localhost:5173 \
node scripts/e2e-seed-gates.mjs
```

真实浏览器流程与截图：

1. 审批卡：`docs/evidence/2026-11-17-m1-6a-gates/01-approval.png`
2. 点「允许」后验收卡：`docs/evidence/2026-11-17-m1-6a-gates/02-review.png`
3. 点「通过」后完成态：`docs/evidence/2026-11-17-m1-6a-gates/03-done.png`
4. 刷新后 transcript 与状态保留：`docs/evidence/2026-11-17-m1-6a-gates/04-refresh.png`
5. todo 任务「立即开工」前：`docs/evidence/2026-11-17-m1-6a-gates/05-todo.png`
6. 开工后进入审批：`docs/evidence/2026-11-17-m1-6a-gates/06-started.png`

种子脚本创建 2 个 agent 节点与 2 个任务：一个直接 enqueue 到 `waiting_input(approval)`，一个保留 `todo` 用于「立即开工」。验收确认了真浏览器中的命令发送、WS 实时刷新、状态流转、transcript 渲染与刷新持久化。

### 偏离与已知问题

1. **Toast.Provider 白屏**：HeroUI 的 `Toast.Provider` 只渲染 toast region，不渲染 children；最初包住 `<App />` 导致整页空白，ego-lite 首轮发现。已改为与 App 平级，新增 `Root.test.tsx` 断言 provider 组合。
2. **session.event seq 可选**：为兼容旧 `ws_event` 回放行，`payload.seq` 可选；缺失时 web 回退 REST 重新拉取，不阻塞新事件。
3. **文件命名**：`transcript.ts` 重命名为 `transcript-model.ts`，避免 macOS 大小写不敏感文件系统把 `./Transcript` 解析到纯函数模块。
4. **seed 脚本位置**：`scripts/e2e-seed-gates.mjs` 使用 Node 内置模块，放在 `apps/web` 会触发 `web-no-node-builtins`；因此作为仓库级 e2e 脚本。
5. **Review 后修复**：任务切换时 `DetailContent` 以 taskId 作 key，避免回复草稿/验收反馈/取消确认串任务；实时事件按 32ms 合批写入缓存；命令 `send` 异常清理 pending；transcript 加 `role="log"`、按 session 重置滚动、流式文本增长继续跟随；高风险审批的「允许」降为 secondary；seed 命令加 10s 超时。
6. **ego-lite 未覆盖回复闸门**：默认 `agent-fake` 只产生 approval，不产生 `user.message`/pause；回复框与打回反馈必填由组件测试覆盖。审批→验收→通过→刷新→立即开工已由 ego-lite 覆盖。
7. **长会话**：仍只加载前 500 条，`hasMore` 仅提示；最新事件在超长会话刷新后不可见，后续用 `nextSeq` 做尾部翻页。
8. **旧迁移回填**：`0001` 迁移回填的 `session.event` payload 无 `seq`，保留不改历史；客户端回退 REST 处理。
9. **构建告警**：web 产物约 616 KB（gzip 186 KB），Vite 提示超出 500 KB；不作为本次验收失败项。
