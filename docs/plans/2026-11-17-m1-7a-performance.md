---
spec_ref: ../specs/2026-11-17-m1-claude-adapter-design.md
spec_topic: m1-claude-adapter
task_count: 5
estimated_phases: [baseline, tests, implementation, verification]
dod: "性能热路径：SQLite NORMAL、事件单次序列化、session-cache 快路径、WS 热路径；5k/20k/50k transcript 全量重建 50k p95 < 8ms；增量投影按真实数据触发"
depends_on: []
---

# M1-7a 性能热路径实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended) or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不接真实 Claude 的前提下，先消除 daemon 事件写入与 web transcript 投影的重复 CPU/IO，并建立可复现的基准，为 M1-7a 真实会话提供性能基线。

**Architecture:** daemon 侧把每个会话事件只序列化一次，并用 `ws_event` 的 payload JSON 直接拼 WS 帧；SQLite 保持 WAL，补 `synchronous=NORMAL`。web 侧给 session-cache 加顺序 append 快路径，transcript 保留全量重建并用 5k/20k/50k 基准守住 8ms 预算；增量投影按真实数据触发；WS 热路径减少重复 zod 解析。

**Tech Stack:** TypeScript ESM、better-sqlite3 / Drizzle、vitest / vitest bench、React 19、TanStack Query、Zustand。

---

## 计划地图（M1-7a 共 4 个 plan）

本 plan 是其中第一个，独立于 Claude adapter，可先落地。

| Plan | 范围 | 依赖 | 状态 |
|---|---|---|---|
| **A. 性能热路径（本计划）** | event-store / SQLite / session-cache / transcript / WS | 无 | 本次 |
| B. 契约与并发基座 | workspace trust 字段/migration、`session_reported` 扩展、执行槽/live cap、boot 对账 | 无 | 待写 |
| C. Claude adapter 与 daemon 接线 | S2 spike、transport/adapter、engine/trust API、`StartInput.workspaceTrust` | B | 待写 |
| D. Web UX 与真实验收 | trust 弹窗、引擎选择、多审批卡、ego-lite 证据 | B + C | 待写 |

**Commit strategy:** 按项目约定，每个 Task 结束提交一次；提交前跑该 Task 的定向测试，Task 6 跑全量 `pnpm verify`。

---

## Task 1: 基准工具与 baseline

> 执行期修订：Vitest 5.1 不导出 `bench`，改用 `scripts/bench-m1-7a.ts` + `tsx`；见文末执行记录。

Blocking: none
Slice type: verification
Seam: `vitest bench` 输出；无生产行为变更

**Files:**

- Create: `apps/web/src/features/tasks/transcript.fixture.ts`
- Create: `apps/web/src/features/tasks/transcript.bench.ts`
- Create: `apps/daemon/test/event-store.bench.ts`
- Modify: `package.json`（新增 `bench:web`、`bench:daemon`）

**Interfaces:**

- Produces: `makeTextEvents(count)` 供后续 transcript bench 复用；`bench:web` / `bench:daemon` 命令。

- [ ] **Step 1: 写 transcript fixture**

```ts
// apps/web/src/features/tasks/transcript.fixture.ts
import type { SessionEventRecord } from '@baton/protocol'

export function makeTextEvents(count: number, startSeq = 1): SessionEventRecord[] {
  const events: SessionEventRecord[] = []
  for (let i = 0; i < count; i += 1) {
    const seq = startSeq + i
    const messageId = `m-${Math.floor(i / 3)}`
    const phase = i % 3
    if (phase === 0) {
      events.push({
        seq,
        type: 'TEXT_MESSAGE_START',
        payload: { type: 'TEXT_MESSAGE_START', messageId, role: 'assistant' },
        ts: seq,
      })
    } else if (phase === 1) {
      events.push({
        seq,
        type: 'TEXT_MESSAGE_CONTENT',
        payload: { type: 'TEXT_MESSAGE_CONTENT', messageId, delta: 'x'.repeat(32) },
        ts: seq,
      })
    } else {
      events.push({
        seq,
        type: 'TEXT_MESSAGE_END',
        payload: { type: 'TEXT_MESSAGE_END', messageId },
        ts: seq,
      })
    }
  }
  return events
}
```

- [ ] **Step 2: 写 baseline bench（仅全量投影）**

```ts
// apps/web/src/features/tasks/transcript.bench.ts
import { bench, describe } from 'vitest'
import { buildTranscript } from './transcript-model'
import { makeTextEvents } from './transcript.fixture'

describe('transcript 5k events', () => {
  const events = makeTextEvents(5000)
  bench('full rebuild', () => {
    buildTranscript(events)
  })
})
```

- [ ] **Step 3: 写 event-store bench**

```ts
// apps/daemon/test/event-store.bench.ts
import { EventSchemas } from '@baton/protocol'
import { randomUUID } from 'node:crypto'
import { bench, describe } from 'vitest'
import { createEventStore } from '../src/db/event-store.js'
import { createTestDb, seedTask } from './helpers/db.js'

const deps = { now: () => 1, newId: () => randomUUID() }
const event = EventSchemas.parse({
  type: 'TEXT_MESSAGE_CONTENT',
  messageId: 'm',
  delta: 'x'.repeat(32),
})

describe('event store 5k events', () => {
  bench('append 5k session events', () => {
    const { raw, db } = createTestDb()
    const seeded = seedTask(raw)
    const store = createEventStore(db, deps)
    for (let seq = 1; seq <= 5000; seq += 1) {
      store.appendSessionEvent({ sessionId: seeded.sessionId!, seq, event, ts: seq })
    }
    raw.close()
  })
})
```

- [ ] **Step 4: 加 bench 命令**

`package.json` 的 scripts 增加：

```json
"bench:web": "pnpm --filter @baton/web exec vitest bench --run",
"bench:daemon": "pnpm --filter @evanfang0054/baton exec vitest bench --run"
```

- [ ] **Step 5: 跑 baseline 并记录**

```bash
pnpm bench:web
pnpm bench:daemon
```

Expected: 两个命令退出码 0，输出 `full rebuild` 与 `append 5k session events` 的 ops/s 或 mean。把数字记到临时记录，Task 6 写入 evidence。

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/tasks/transcript.fixture.ts \
  apps/web/src/features/tasks/transcript.bench.ts \
  apps/daemon/test/event-store.bench.ts package.json
git commit -m "test(perf): 增加 transcript 与 event-store 基准"
```

---

## Task 2: SQLite 与事件写入

Blocking: none
Slice type: tracer-bullet
Seam: `openDb` 的 pragma；`createEventStore.appendSessionEvent` 返回的 `payloadJson` 与 `buildWsFrame`

**Files:**

- Modify: `apps/daemon/src/db/index.ts`
- Modify: `apps/daemon/src/db/event-store.ts`
- Modify: `apps/daemon/src/ws/hub.ts`
- Test: `apps/daemon/test/event-store.test.ts`
- Test: `apps/daemon/test/db-pragmas.test.ts`（新建）

**Interfaces:**

- Produces: `BroadcastEvent.payloadJson: string`；`buildWsFrame(event: BroadcastEvent): string`；`appendSessionEvent` 仍返回 `BroadcastEvent`。

- [ ] **Step 1: 写失败测试（pragma + 帧序列化）**

```ts
// apps/daemon/test/db-pragmas.test.ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openDb } from '../src/db/index.js'

const dirs: string[] = []
afterEach(() => {
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
})

describe('sqlite pragmas', () => {
  it('uses WAL and NORMAL synchronous mode', () => {
    const dir = mkdtempSync(join(tmpdir(), 'baton-db-'))
    dirs.push(dir)
    const db = openDb(join(dir, 'test.db'))
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(db.pragma('synchronous', { simple: true })).toBe(1)
    db.close()
  })
})
```

在 `event-store.test.ts` 增加：

```ts
import { buildWsFrame } from '../src/ws/hub.js'

it('reuses the payload JSON when building the ws frame', () => {
  const database = db()
  const store = createEventStore(database.db, deps)
  const seeded = seedTask(database.raw)
  const appended = store.appendSessionEvent({
    sessionId: seeded.sessionId!,
    seq: 1,
    event: fakeEvent('frame'),
    ts: 9,
  })
  expect(JSON.parse(appended.payloadJson)).toEqual(appended.payload)
  expect(JSON.parse(buildWsFrame(appended))).toEqual({
    v: 1,
    id: appended.id,
    type: appended.type,
    ts: appended.ts,
    seq: appended.ordinal,
    payload: appended.payload,
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm --filter @evanfang0054/baton exec vitest run test/db-pragmas.test.ts test/event-store.test.ts
```

Expected: FAIL（synchronous 仍为 2；`buildWsFrame` 不存在）。

- [ ] **Step 3: 补 pragma**

```ts
// apps/daemon/src/db/index.ts
db.pragma('journal_mode = WAL')
db.pragma('synchronous = NORMAL')
db.pragma('foreign_keys = ON')
```

- [ ] **Step 4: 让 event-store 只序列化一次并携带 payloadJson**

`apps/daemon/src/db/event-store.ts`：

```ts
export interface BroadcastEvent {
  ordinal: number
  id: string
  type: ServerMessage['type']
  payload: unknown
  payloadJson: string
  ts: number
}

function appendWsJson(
  tx: Tx,
  input: { type: ServerMessage['type']; payload: unknown; payloadJson: string; ts: number },
): BroadcastEvent {
  const id = deps.newId()
  const result = tx
    .insert(wsEvent)
    .values({ id, type: input.type, payloadJson: input.payloadJson, ts: input.ts })
    .run()
  return {
    id,
    ordinal: Number(result.lastInsertRowid),
    type: input.type,
    payload: input.payload,
    payloadJson: input.payloadJson,
    ts: input.ts,
  }
}

function appendWs(tx: Tx, input: WsEventDraft): BroadcastEvent {
  return appendWsJson(tx, { ...input, payloadJson: JSON.stringify(input.payload) })
}

function appendSessionEvent(input: {
  sessionId: string
  seq: number
  event: AgentEvent
  ts?: number
}): BroadcastEvent {
  return db.transaction((tx) => {
    const ts = input.ts ?? deps.now()
    const eventJson = JSON.stringify(input.event)
    const payload = { sessionId: input.sessionId, seq: input.seq, event: input.event }
    const wsPayloadJson = `{"sessionId":${JSON.stringify(input.sessionId)},"seq":${input.seq},"event":${eventJson}}`
    const ws = appendWsJson(tx, {
      type: 'session.event',
      payload,
      payloadJson: wsPayloadJson,
      ts,
    })
    tx.insert(event)
      .values({
        id: deps.newId(),
        sessionId: input.sessionId,
        ordinal: ws.ordinal,
        seq: input.seq,
        type: input.event.type,
        payloadJson: eventJson,
        ts,
      })
      .run()
    return ws
  })
}
```

`toRow` 需要带上 `payloadJson`：

```ts
function toRow(row: typeof wsEvent.$inferSelect): WsEventRow {
  return {
    ordinal: row.ordinal,
    id: row.id,
    type: row.type as ServerMessage['type'],
    payload: JSON.parse(row.payloadJson) as unknown,
    payloadJson: row.payloadJson,
    ts: row.ts,
  }
}
```

- [ ] **Step 5: hub 用 payloadJson 拼帧**

```ts
// apps/daemon/src/ws/hub.ts
export function buildWsFrame(event: BroadcastEvent): string {
  return `{"v":1,"id":${JSON.stringify(event.id)},"type":${JSON.stringify(event.type)},"ts":${event.ts},"seq":${event.ordinal},"payload":${event.payloadJson}}`
}

broadcast(event) {
  const frame = buildWsFrame(event)
  for (const socket of sockets) sendSafely(socket, frame)
}
```

- [ ] **Step 6: 跑测试确认通过**

```bash
pnpm --filter @evanfang0054/baton exec vitest run test/db-pragmas.test.ts test/event-store.test.ts test/replay.test.ts test/ws.test.ts
```

Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add apps/daemon/src/db/index.ts apps/daemon/src/db/event-store.ts \
  apps/daemon/src/ws/hub.ts apps/daemon/test/db-pragmas.test.ts apps/daemon/test/event-store.test.ts
git commit -m "perf(daemon): 单次序列化事件并启用 NORMAL synchronous"
```

---

## Task 3: session-cache 快路径

Blocking: none
Slice type: tracer-bullet
Seam: `appendSessionEvents` / `mergeSessionPage`

**Files:**

- Modify: `apps/web/src/features/realtime/session-cache.ts`
- Test: `apps/web/src/features/realtime/session-cache.test.ts`

**Interfaces:**

- Produces: 顺序 append 时保持已有事件引用、O(k) 追加；乱序时回退到 Set + sort。

- [ ] **Step 1: 写失败测试**

```ts
it('appends ordered events without rebuilding the whole list', () => {
  const first = record(1)
  const second = record(2)
  const previous = page([first])
  const next = appendSessionEvents(previous, [second])!
  expect(next.events.map((event) => event.seq)).toEqual([1, 2])
  expect(next.events[0]).toBe(first)
})

it('falls back to merge when an event is out of order', () => {
  const previous = page([record(2)])
  const next = appendSessionEvents(previous, [record(1)])!
  expect(next.events.map((event) => event.seq)).toEqual([1, 2])
})

it('keeps nextSeq from the page when merging history', () => {
  const previous = page([record(2)], { nextSeq: 3, hasMore: false })
  const merged = mergeSessionPage(previous, {
    sessionId: 's',
    events: [record(1)],
    nextSeq: 2,
    hasMore: true,
  })
  expect(merged.nextSeq).toBe(2)
  expect(merged.hasMore).toBe(true)
  expect(merged.events.map((event) => event.seq)).toEqual([1, 2])
})
```

测试文件顶部补两个本地 helper：

```ts
function record(seq: number): SessionEventRecord {
  return {
    seq,
    type: 'TEXT_MESSAGE_CONTENT',
    payload: { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta: 'x' },
    ts: seq,
  }
}

function page(
  events: SessionEventRecord[],
  overrides: Partial<SessionEventsResponse> = {},
): SessionEventsResponse {
  return { sessionId: 's', events, nextSeq: 0, hasMore: false, ...overrides }
}
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm --filter @baton/web exec vitest run src/features/realtime/session-cache.test.ts
```

Expected: 第一条 FAIL（`next.events[0]` 不是同一引用，当前实现会全量复制/sort）。

- [ ] **Step 3: 实现快路径**

```ts
function isAppendOnly(previous: SessionEventsResponse, records: SessionEventRecord[]): boolean {
  const last = previous.events.at(-1)?.seq ?? 0
  return records.every((record) => record.seq > last)
}

export function appendSessionEvents(
  previous: SessionEventsResponse | undefined,
  records: SessionEventRecord[],
): SessionEventsResponse | undefined {
  if (!previous || records.length === 0) return previous
  if (isAppendOnly(previous, records)) {
    return { ...previous, events: [...previous.events, ...records] }
  }
  const known = new Set(previous.events.map((event) => event.seq))
  const events = [...previous.events]
  for (const record of records) {
    if (known.has(record.seq)) continue
    known.add(record.seq)
    events.push(record)
  }
  if (events.length === previous.events.length) return previous
  events.sort((a, b) => a.seq - b.seq)
  return { ...previous, events }
}
```

`mergeSessionPage` 同理：若 `page.events` 全部大于 `previous` 的最后 seq，直接 `[...previous.events, ...page.events]`；否则走 Set + sort。返回值仍以 `page.nextSeq/hasMore` 为准。

- [ ] **Step 4: 跑测试确认通过**

```bash
pnpm --filter @baton/web exec vitest run src/features/realtime/session-cache.test.ts
```

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/realtime/session-cache.ts \
  apps/web/src/features/realtime/session-cache.test.ts
git commit -m "perf(web): session-cache 顺序 append 快路径"
```

---

## Task 4: transcript 增量投影（Deferred，数据触发）

**状态**：2026-11-17 决定 7a 不做，保留基准与触发条件。

- baseline：5k 0.64ms / 20k 2.24ms / 50k 5.43ms / 100k 11.76ms（mean）。
- 7a 不落 partial，50k 内已满足 spec §8.6 的 p95 < 8ms。
- 触发条件：真实会话 >50k 事件，或 transcript 重建 p95 > 8ms。
- 触发后：在 7b/后续引入 `TranscriptProjector`（只处理新事件），并用全量 `buildTranscript` 做等价测试。
- 本 Task 不产生代码变更；`scripts/bench-m1-7a.ts` 保留以便复测。

## Task 5: WS 热路径减少重复解析

Blocking: none
Slice type: tracer-bullet
Seam: `parseIncomingMessage(raw)`；`RealtimeProvider` 不再对每条 session 事件做 `SessionEventRecord.parse`

**Files:**

- Modify: `apps/web/src/lib/ws.ts`
- Modify: `apps/web/src/features/realtime/RealtimeProvider.tsx`
- Test: `apps/web/src/lib/ws.test.ts`
- Test: `apps/web/src/features/realtime/RealtimeProvider.test.tsx`

**Interfaces:**

- Produces: `parseIncomingMessage(raw: unknown): ServerMessage | null`；控制消息仍走完整 `ServerMessage` 校验。

- [ ] **Step 1: 写失败测试**

```ts
it('parses a session.event with the lightweight path', () => {
  const parsed = parseIncomingMessage({
    v: 1,
    id: 'e1',
    type: 'session.event',
    ts: 1,
    seq: 2,
    payload: {
      sessionId: 's',
      seq: 2,
      event: { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta: 'hi' },
    },
  })
  expect(parsed?.type).toBe('session.event')
})

it('rejects a malformed session.event', () => {
  expect(
    parseIncomingMessage({
      v: 1,
      id: 'e1',
      type: 'session.event',
      ts: 1,
      payload: { sessionId: 's', seq: 'bad', event: {} },
    }),
  ).toBeNull()
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm --filter @baton/web exec vitest run src/lib/ws.test.ts
```

Expected: FAIL（`parseIncomingMessage` 不存在）。

- [ ] **Step 3: 实现轻量解析**

```ts
export function parseIncomingMessage(raw: unknown): ServerMessage | null {
  const envelope = WsEnvelope.safeParse(raw)
  if (!envelope.success) return null
  if (envelope.data.type === 'session.event') {
    const payload = envelope.data.payload as
      | { sessionId?: unknown; seq?: unknown; event?: { type?: unknown } }
      | undefined
    if (
      typeof payload?.sessionId !== 'string' ||
      typeof payload.seq !== 'number' ||
      typeof payload.event?.type !== 'string'
    ) {
      return null
    }
    return envelope.data as ServerMessage
  }
  const event = ServerMessage.safeParse(envelope.data)
  return event.success ? event.data : null
}
```

`createWsClient` 的 `message` 监听改用 `parseIncomingMessage`。

- [ ] **Step 4: RealtimeProvider 直接构造 record**

```ts
const record: SessionEventRecord = {
  seq: event.payload.seq,
  type: event.payload.event.type,
  payload: event.payload.event,
  ts: event.ts,
}
enqueueEvent(sessionId, record)
```

移除 `SessionEventRecord.parse`；非法事件仍走 REST fallback。

- [ ] **Step 5: 跑测试确认通过**

```bash
pnpm --filter @baton/web exec vitest run src/lib/ws.test.ts \
  src/features/realtime/RealtimeProvider.test.tsx src/features/realtime/session-cache.test.ts
```

Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/ws.ts apps/web/src/features/realtime/RealtimeProvider.tsx \
  apps/web/src/lib/ws.test.ts apps/web/src/features/realtime/RealtimeProvider.test.tsx
git commit -m "perf(web): WS 热路径轻量解析 session.event"
```

---

## Task 6: 复测、证据与全量校验

Blocking: Task 2, 3, 5
Slice type: verification
Seam: `pnpm verify` + bench 输出 + evidence 文件

**Files:**

- Create: `docs/evidence/2026-11-17-m1-7a-perf/README.md`
- Modify: 无生产代码（若复测发现回归，回到对应 Task）

- [ ] **Step 1: 复测**

```bash
pnpm bench:m1-7a
```

Expected: transcript 5k/20k/50k/100k 与 event store 5k 的 mean/p95 与 Task 1 baseline 对比；50k p95 < 8ms。

- [ ] **Step 2: 写 evidence**

`docs/evidence/2026-11-17-m1-7a-perf/README.md` 记录：

- 机器与 Node/pnpm 版本（脱敏，不写主机名/用户名）。
- 命令、baseline、复测数字。
- 5k/20k/50k transcript 全量重建 p50/p95（50k p95 < 8ms；100k 作为观察值）。
- 结论：是否达到 spec §8.6 的预算；未达到时的下一步。

- [ ] **Step 3: 全量校验**

```bash
pnpm verify
pnpm verify:full
pnpm pack:check
```

Expected: 全部退出码 0。

- [ ] **Step 4: Commit**

```bash
git add docs/evidence/2026-11-17-m1-7a-perf/README.md
git commit -m "docs(evidence): M1-7a 性能热路径基线"
```

---

## Self-Review

- **Spec coverage**：本计划覆盖 spec §8.6 的 daemon 写入、web 快路径、transcript 基准（增量投影按数据触发）、WS 热路径与预算；trust/adapter/UX 由 Plan B/C/D 覆盖。
- **Placeholder scan**：无 TBD/TODO；每个 Task 都有实际测试与实现片段。
- **Type consistency**：`BroadcastEvent.payloadJson`、`buildWsFrame`、`TranscriptProjector.apply`、`parseIncomingMessage` 在后续 Task 中名称一致。
- **Scope**：只改 `apps/daemon`、`apps/web`、`package.json`、`docs/evidence`；不触 protocol/core/adapters，不接真实 Claude。
- **设计同步**：本计划不改 UI 视觉；Plan D 才改 trust/引擎 UI，必须读根目录 `DESIGN.md` 的 token。

---

## 执行记录

### Task 1（2026-11-17）

- Vitest 5.1 不导出 `bench`，改为 `scripts/bench-m1-7a.ts` + `tsx`；`package.json` 命令为 `bench:m1-7a`。
- baseline（本机 Node 22.23）：
  - transcript full rebuild 5k：mean 0.64ms / p95 0.83ms
  - 20k：mean 2.24ms / p95 3.64ms
  - 50k：mean 5.43ms / p95 6.96ms
  - 100k：mean 11.76ms / p95 17.33ms
  - event store append 5k：mean 231ms / p95 243ms
- 结论：50k 以内 transcript 全量重建已在 spec §8.6 的 8ms 预算内；决定 Task 4 的 stateful 增量投影 **7a 不做**，保留 5k/20k/50k 基准与触发条件（真实会话 >50k 或 p95 >8ms）。event store 写入是更明显的热点，Task 2 优先。

### Task 2（2026-11-17）

- `openDb` 补 `synchronous=NORMAL`；`appendSessionEvent` 只序列化一次；`BroadcastEvent.payloadJson` + `buildWsFrame` 复用 WS payload。
- tests：db-pragmas、event-store、replay、ws 全绿；daemon 115 tests。
- A/B（file DB，5k events，FULL vs NORMAL）：569 vs 470ms；1209 vs 699ms。NORMAL 在同一对比较快；绝对值受磁盘/GC 影响大，evidence 只记录相对趋势。

### Task 3（2026-11-17）

- 新增 `isAppendOnly`；`appendSessionEvents` / `mergeSessionPage` 在严格递增时直接 append，乱序才回退 Set + sort。
- tests：session-cache 4 tests；web 69 tests 全绿。
- 说明：helper 与实现同一步落地；旧实现没有该导出，等价于测试前置失败。
