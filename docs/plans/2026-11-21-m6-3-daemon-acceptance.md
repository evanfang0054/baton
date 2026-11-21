---
spec_ref: ../specs/2026-11-21-m6-3-acceptance-evidence-design.md
spec_topic: m6-3-acceptance-evidence
task_count: 8
estimated_phases: [tests, implementation, verification]
dod: "验收合同/条目/运行落库；验收员结构化输出可解析；报告/HTTP/总管只读字段可用；review 决策冻结合同"
status: active
depends_on: 2026-11-21-m6-3-protocol-core.md
---

# M6-3 Plan 2：daemon 验收合同、报告与总管只读证据

> **For agentic workers:** 使用 `agent-harness:subagent-driven-development`（推荐）或 `executing-plans` 按 task 执行。

**Goal:** 让任务进入 review 时真正生成 AC 合同与 run，验收员输出能落库，报告与 HTTP/总管字段可读，review 决策冻结合同。

**Architecture:** 新增 `db/acceptance-repository.ts` 与 `runtime/acceptance-service.ts`；review 创建点（`effects.ts` 的 `persistVerifyResult`）同事务创建合同/run；验收员在 `supervisor/observe.ts` + `service.ts` 中产出与解析；报告在 `acceptance/report-service.ts` 派生；总管 `get_task`/`list_tasks` 只读扩字段。预算/自动批准上限/注入幂等留给 Plan 3。

**Tech Stack:** Fastify 5、better-sqlite3 + drizzle、zod、vitest。

**Commit strategy:** 每个 task 末尾一次 commit。

---

### Task 1: 验收仓储

Blocking: Plan 1
Slice type: tracer-bullet
Seam: DB 读写 + 批量摘要

**Files:**
- Create: `apps/daemon/src/db/acceptance-repository.ts`
- Test: `apps/daemon/test/acceptance-repository.test.ts`

**Interfaces:**
- Produces:
  - `insertAcceptanceContract(tx, input)`
  - `insertAcceptanceItems(tx, items)`
  - `insertAcceptanceRun(tx, input)`
  - `getAcceptanceBundle(db, taskId)` → `{ contract, items, run } | null`（取最新 contract + 对应 run）
  - `getLatestFrozenContract(db, taskId)`
  - `listAcceptanceSummaries(db, taskIds)` → `Map<taskId, TaskAcceptanceSummary>`
  - `replaceAcceptanceItems(tx, contractId, expectedRevision, items, now)` → `{ ok: true } | { ok: false, code: 'revision_conflict' }`
  - `freezeAcceptanceContract(tx, contractId, at)`
  - `updateAcceptanceRun(tx, id, patch)`

- [ ] **Step 1: 写失败测试**

```ts
it('round-trips contract/items/run and freezes', () => {
  const { db } = createTestDb()
  const tx = db.transaction((t) => {
    insertAcceptanceContract(t, contract())
    insertAcceptanceItems(t, items())
    insertAcceptanceRun(t, run())
    freezeAcceptanceContract(t, 'ac1', 10)
  })
  tx()
  const bundle = getAcceptanceBundle(db, 't1')
  expect(bundle?.contract.status).toBe('frozen')
  expect(bundle?.items).toHaveLength(2)
  expect(bundle?.run.reviewId).toBe('r1')
})

it('rejects stale revision', () => {
  // insert contract revision=2; replace with expectedRevision=1 → revision_conflict
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @evanfang0054/baton exec vitest run test/acceptance-repository.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

- 使用 `db/schema.ts` 新表；所有写操作接收 `Tx`。
- `replaceAcceptanceItems` 先用 `select revision` 校验，再在同一事务里删除旧 items、插入新 items、`revision += 1`。
- `listAcceptanceSummaries` 用一次查询 join 最新 contract + run（按 `task_id` 分组取 `max(version)`；SQLite 可用子查询），返回 `TaskAcceptanceSummary`；topFailures 取最多 3 条 fail/pending。
- 旧任务无 contract 返回 null。

- [ ] **Step 4: 跑测试**

Run: `pnpm --filter @evanfang0054/baton exec vitest run test/acceptance-repository.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/daemon/src/db/acceptance-repository.ts apps/daemon/test/acceptance-repository.test.ts
git commit -m "feat(daemon): 验收合同/条目/运行仓储"
```

---

### Task 2: review 入口创建合同与 run

Blocking: Task 1
Slice type: tracer-bullet
Seam: `persistVerifyResult` 同事务

**Files:**
- Create: `apps/daemon/src/runtime/acceptance-service.ts`
- Modify: `apps/daemon/src/runtime/effects.ts:114-137`
- Test: `apps/daemon/test/review-acceptance.test.ts`

**Interfaces:**
- Produces: `ensureAcceptanceForReview(tx, { task, reviewId, now, newId })` → `{ contractId, runId }`；克隆最近 frozen 合同，状态重置，version+1；无则 v1。

- [ ] **Step 1: 写失败测试**

```ts
it('creates v1 draft and running run on first review', () => {
  // applyTransition verify_ok → review
  expect(getAcceptanceBundle(db, taskId)?.contract).toMatchObject({ version: 1, status: 'draft' })
  expect(getAcceptanceBundle(db, taskId)?.run).toMatchObject({ status: 'running', reviewId })
})

it('clones the last frozen contract on re-review', () => {
  // first review: freeze contract with item text '登录成功'
  // reject → queued → verify_ok → review
  expect(getAcceptanceBundle(db, taskId)?.contract.version).toBe(2)
  expect(items[0]).toMatchObject({ text: '登录成功', status: 'pending', evidence: null })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @evanfang0054/baton exec vitest run test/review-acceptance.test.ts`
Expected: FAIL，没有合同。

- [ ] **Step 3: 实现**

- `ensureAcceptanceForReview`：读 `getLatestFrozenContract`；构造新 contract（`version = prev.version + 1`，`createdBy='verifier'`，`revision=0`，`truncated=false`）；克隆 items；插入 run（`status='running'`，`reviewId`）。
- 在 `effects.ts` 的 `persistVerifyResult` 中，`insertReview` 后调用 `ensureAcceptanceForReview(tx, ...)`。
- 不在同一事务里派验收员；`observeTask` 仍走 afterCommit。

- [ ] **Step 4: 跑测试**

Run: `pnpm --filter @evanfang0054/baton exec vitest run test/review-acceptance.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/daemon/src/runtime/acceptance-service.ts apps/daemon/src/runtime/effects.ts apps/daemon/test/review-acceptance.test.ts
git commit -m "feat(daemon): review 入口生成 AC 合同与 run"
```

---

### Task 3: 验收员结构化输出与解析

Blocking: Task 1, Task 2
Slice type: tracer-bullet
Seam: verifier prompt → `<acceptance_report>` → run/items

**Files:**
- Create: `apps/daemon/src/supervisor/acceptance-parse.ts`
- Modify: `apps/daemon/src/supervisor/observe.ts:28-64`, `apps/daemon/src/supervisor/service.ts:500-607`
- Test: `apps/daemon/test/supervisor-acceptance.test.ts`

**Interfaces:**
- Produces: `VERIFIER_PROMPT_MARKER='<verifier_task>'`（prompt 首行）；`parseAcceptanceReport(text)` → `{ verdict, summary, items } | null`；`concludeVerifier(task, message, origin)` 写 items/run/`acceptance.updated`，失败标 failed。

- [ ] **Step 1: 写失败测试**

```ts
it('parses the last acceptance_report block', () => {
  const parsed = parseAcceptanceReport(`
    <acceptance_report>{"verdict":"fail","summary":"2 条未过","items":[
      {"text":"登录成功","status":"pass","evidence":"src/login.tsx:42"},
      {"text":"错误提示","status":"fail","evidence":"test/login.test.ts"}
    ]}</acceptance_report>`)
  expect(parsed).toMatchObject({ verdict: 'fail', items: [{ status: 'pass' }] })
})

it('returns null on malformed json and marks run failed', async () => {
  // concludeVerifier(task, '<acceptance_report>{bad}</acceptance_report>', origin)
  expect(getAcceptanceBundle(db, taskId)?.run.status).toBe('failed')
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @evanfang0054/baton exec vitest run test/supervisor-acceptance.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 parser**

- 用正则取最后一个 `<acceptance_report>([\s\S]*?)</acceptance_report>`；没有则取最后一个 ```json 块。
- `JSON.parse` + zod（verdict/summary/items/text/status/evidence）；items 截断到 8、text/evidence 200、summary 1000；失败返回 null。
- 导出 `VERIFIER_PROMPT_MARKER`，`buildVerifierPrompt` 首行加 marker；prompt 里加输出格式与“只读/相对路径/不要 transcript”。

- [ ] **Step 4: 接入 concludeVerifier**

- `concludeVerifier(task, message, origin)`：
  - `parseAcceptanceReport(message)`；成功 → 用当前 draft contract 写 items（`source=verifier`）、run `complete` + verdict/summary；发 `acceptance.updated`（只带 counts/ids）。
  - 失败 → run `failed` + `verdict=incomplete` + summary；不发正文。
  - 保留原有 `setReviewPreliminary` 与 `review.preliminary` 事件；`preliminaryVerdict` 用 verdict 映射（pass/fail/unknown）。
- `dispatchVerifier` 创建验收员任务时传 `budgetUsd: Math.min(0.5, config.claudeMaxBudgetUsd)`；Plan 3 引入 `BATON_VERIFIER_BUDGET_USD` 后替换为 config。

- [ ] **Step 5: 跑测试**

Run: `pnpm --filter @evanfang0054/baton exec vitest run test/supervisor-acceptance.test.ts`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add apps/daemon/src/supervisor apps/daemon/test/supervisor-acceptance.test.ts
git commit -m "feat(daemon): 验收员结构化输出与落库"
```

---

### Task 4: `acceptance.update` 命令

Blocking: Task 1, Task 2
Slice type: tracer-bullet
Seam: WS 命令 → 事务 + 409/422

**Files:**
- Create: `apps/daemon/src/runtime/acceptance-command.ts`
- Modify: `apps/daemon/src/runtime/index.ts`（WS dispatch）
- Test: `apps/daemon/test/acceptance-command.test.ts`

**Interfaces:**
- Produces: `handleAcceptanceUpdate(deps, input)` → `{ contract, items }`；错误 `invalid_state` / `revision_conflict` / `acceptance_invalid`；成功后 emit `acceptance.updated` + audit `task.acceptance.update`（只写 counts/ids）。

- [ ] **Step 1: 写失败测试**

```ts
it('updates items and increments revision', async () => {
  const res = await send('acceptance.update', { taskId, contractId, expectedRevision: 0, items: [{ text: '新条目', status: 'pending' }] })
  expect(res.ok).toBe(true)
  expect(getAcceptanceBundle(db, taskId)?.contract.revision).toBe(1)
})

it('returns 409 on stale revision', async () => {
  await expect(send('acceptance.update', { ..., expectedRevision: 0 })).rejects.toMatchObject({ code: 'revision_conflict' })
})

it('rejects when task is not in review', async () => {
  // task status queued → invalid_state
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @evanfang0054/baton exec vitest run test/acceptance-command.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

- 校验任务属于当前 workspace、状态 `review`、合同 `draft`、contractId 匹配。
- 调 `validateAcceptanceUpdate`；失败按 code 映射 `invalid_payload`/`acceptance_invalid`。
- 事务里 `replaceAcceptanceItems`；写 audit（taskId/contractId/version/revision/counts，不写正文）。
- 发 `acceptance.updated`。
- `runtime/index.ts` 的 `ClientMessage` switch 加 `acceptance.update`。

- [ ] **Step 4: 跑测试**

Run: `pnpm --filter @evanfang0054/baton exec vitest run test/acceptance-command.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/daemon/src/runtime apps/daemon/test/acceptance-command.test.ts
git commit -m "feat(daemon): acceptance.update 命令与乐观并发"
```

---

### Task 5: 验收报告服务与 HTTP

Blocking: Task 1-4
Slice type: tracer-bullet
Seam: `GET /api/tasks/:id/acceptance` + 列表摘要

**Files:**
- Create: `apps/daemon/src/acceptance/report-service.ts`
- Modify: `apps/daemon/src/http/tasks.ts`
- Test: `apps/daemon/test/acceptance-report.test.ts`

**Interfaces:**
- Produces: `getAcceptanceResponse(db, taskId, config)` → `{ contract, items, run, report }`；`report.hash` 用 `createHash('sha256').update(canonical).digest('hex')`；任务列表/详情带 acceptance/budget 紧凑字段。

- [ ] **Step 1: 写失败测试**

```ts
it('returns report with stable hash', async () => {
  const a = await app.inject({ method: 'GET', url: `/api/tasks/${taskId}/acceptance` })
  const b = await app.inject({ method: 'GET', url: `/api/tasks/${taskId}/acceptance` })
  const ra = a.json(); const rb = b.json()
  expect(ra.report.hash).toBe(rb.report.hash)
  expect(JSON.stringify(ra.report)).not.toContain('diff --git')
})

it('task list carries compact acceptance/budget', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/tasks?workspaceId=w1' })
  expect(res.json().tasks[0]).toMatchObject({ acceptance: { pass: 2, total: 3 }, budget: { limit: 2 } })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @evanfang0054/baton exec vitest run test/acceptance-report.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

- `getAcceptanceResponse`：读 bundle + review + sessions；`buildAcceptanceReport`（Plan 1）；`stableStringify` + sha256；返回。
- `http/tasks.ts`：
  - `GET /api/tasks/:id/acceptance` → parse + 404。
  - `/api/tasks` 用 `listAcceptanceSummaries` 批量填 acceptance/budget；budget 由 `budgetState`（Plan 1）计算。
  - `/api/tasks/:id` 也带 acceptance/budget。
- 不在 HTTP 层读 transcript/diff 正文。

- [ ] **Step 4: 跑测试**

Run: `pnpm --filter @evanfang0054/baton exec vitest run test/acceptance-report.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/daemon/src/acceptance apps/daemon/src/http/tasks.ts apps/daemon/test/acceptance-report.test.ts
git commit -m "feat(daemon): 验收报告、hash 与 HTTP 字段"
```

---

### Task 6: 总管只读字段与 prompt

Blocking: Task 5
Slice type: tracer-bullet
Seam: `get_task` / `list_tasks` 输出

**Files:**
- Modify: `apps/daemon/src/supervisor/tools.ts:312-328,580-670`
- Modify: `apps/daemon/src/supervisor/prompt.ts:3-83`
- Modify: `apps/daemon/src/supervisor/service.ts:883-920`
- Test: `apps/daemon/test/supervisor-tools.test.ts`

**Interfaces:**
- Produces: `taskSummary` 带 `acceptance {pass,total,fail}`、`budget {spent,limit,over}`；`get_task` 带 `acceptance/usage/report`；`filter=attention` 纳入超预算/AC 未过；prompt 规则与版本更新。

- [ ] **Step 1: 写失败测试**

```ts
it('get_task returns acceptance and usage without transcript', async () => {
  const out = await callTool('get_task', { taskId })
  expect(out.acceptance).toMatchObject({ total: 3, pass: 2, fail: 1 })
  expect(out.usage).toMatchObject({ workerCostUsd: 1.2, budgetUsd: 2 })
  expect(JSON.stringify(out)).not.toContain('diff --git')
})

it('list_tasks attention includes over budget', async () => {
  const out = await callTool('list_tasks', { filter: 'attention' })
  expect(out.tasks.some((t) => t.budget.over)).toBe(true)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @evanfang0054/baton exec vitest run test/supervisor-tools.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

- `tools.ts` 的 `taskSummary` 读 `listAcceptanceSummaries` + `budgetState`；`get_task` 增加 acceptance/usage/report summary；`list_tasks` 的 attention 排序纳入 over budget / AC fail。
- `prompt.ts` 增加：用 acceptance/usage/report 回答；不得声称“已通过/已提额/已批准”；不得编造 AC；不读 transcript/代码。`PROMPT_VERSION` 自动变。
- `service.ts` 的 anti-hallucination 加 `已通过|AC 全过|已提额|已批准` 断言，必须有对应工具事实。

- [ ] **Step 4: 跑测试**

Run: `pnpm --filter @evanfang0054/baton exec vitest run test/supervisor-tools.test.ts test/supervisor-observe.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/daemon/src/supervisor apps/daemon/test/supervisor-tools.test.ts
git commit -m "feat(daemon): 总管只读验收/成本/报告摘要"
```

---

### Task 7: 决策冻结与 override 校验

Blocking: Task 2-5
Slice type: tracer-bullet
Seam: `review.decide` 命令 + 状态离开 review

**Files:**
- Modify: `apps/daemon/src/runtime/index.ts`（review.decide handler）
- Modify: `apps/daemon/src/runtime/transition-runner.ts:179-205`
- Test: `apps/daemon/test/review-acceptance.test.ts`

**Interfaces:**
- Produces: approve 时 AC 非全 pass/无 AC 必须带 `overrideReason`；approve/reject 冻结当前合同；review 期间 cancel 也冻结；审计含 contractId/version/revision/reportHash/counts/verdict/overrideReason。

- [ ] **Step 1: 写失败测试**

```ts
it('requires overrideReason when AC has a failure', async () => {
  await expect(decide('approve')).rejects.toMatchObject({ code: 'acceptance_override_reason_required' })
  await expect(decide('approve', { overrideReason: '已知风险' })).resolves.toBeTruthy()
})

it('freezes contract on approve/reject/cancel', async () => {
  await decide('reject', { feedback: '再改' })
  expect(getAcceptanceBundle(db, taskId)?.contract.status).toBe('frozen')
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @evanfang0054/baton exec vitest run test/review-acceptance.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

- review.decide handler：approve 前读 acceptance summary；若 `fail>0 || pending>0 || total===0` 且无 `overrideReason` → 422。
- 计算报告 hash（Task 5）并写入 audit `review.approve_override`（扩展 detail）或正常 `review.approve`。
- `transition-runner` 在状态写完后：若 `previousStatus==='review' && status!=='review'`，`freezeAcceptanceContract` 最新 draft；cancel 也走这条。

- [ ] **Step 4: 跑测试**

Run: `pnpm --filter @evanfang0054/baton exec vitest run test/review-acceptance.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/daemon/src/runtime apps/daemon/test/review-acceptance.test.ts
git commit -m "feat(daemon): 验收决策冻结与 override 审计"
```

---

### Task 8: Plan 2 集成回归

Blocking: Task 1-7
Slice type: verification
Seam: `pnpm --filter @evanfang0054/baton test`

- [ ] **Step 1: 跑 daemon 全量测试**

Run: `pnpm --filter @evanfang0054/baton test`
Expected: PASS；既有 `transition-runner`/`supervisor-observe`/`task-service` 不回归。

- [ ] **Step 2: 跑协议/core/daemon typecheck**

Run: `pnpm --filter @baton/protocol typecheck && pnpm --filter @baton/core typecheck && pnpm --filter @evanfang0054/baton typecheck`
Expected: PASS。

- [ ] **Step 3: Commit（如有测试调整）**

```bash
git add apps/daemon/test
git commit -m "test(daemon): M6-3 验收合同/报告/总管回归"
```

---

## 自检

- [ ] Spec §5-§7、§10 的 daemon 行为均有 task。
- [ ] 验收员失败不阻塞 review；WS 事件不含条目正文。
- [ ] 报告不落库、不含 diff/transcript；hash 稳定。
- [ ] 不实现预算/提额/自动批准上限/注入幂等（Plan 3）。
- [ ] `pnpm --filter @evanfang0054/baton test` 全绿。