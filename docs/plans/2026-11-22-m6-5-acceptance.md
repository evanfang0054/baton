---
spec_ref: ../specs/2026-11-22-m6-5-supervisor-autonomy-design.md
spec_topic: m6-5-supervisor-autonomy
task_count: 3
estimated_phases: [tests, verification, documentation]
dod: "Playwright 五条主链路、ego-lite 真实 Claude 证据、docs 索引与 contract 收口、pnpm verify:full 与 pack:check 全绿"
status: planned
depends_on: [2026-11-22-m6-5-governance.md, 2026-11-22-m6-5-attention-failure.md, 2026-11-22-m6-5-plan-templates-batch.md]
---

# M6-5 Plan D：验收收口

> **For agentic workers:** REQUIRED SUB-SKILL: 使用 `agent-harness:subagent-driven-development`（推荐）或 `agent-harness:executing-plans`，按 task 逐条执行。

**Goal:** 用 Playwright 固化五条主链路，用 ego-lite + 真实 Claude 走一遍人能感知的完整流程，留下脱敏证据，并把 contract 的 DoD 逐条收口。

**Architecture:** Playwright 继续用 mock REST/WS 做确定性回归；ego-lite 用真实 daemon + 真实 Claude 做一次端到端验收。证据只存截图/文字摘要，不含 transcript、绝对路径、token、身份信息。

**Tech Stack:** Playwright（系统 Chrome）、ego-browser CLI、vitest、pnpm verify:full、pack-check。

**Design sync:**
- 验收截图只截关键区域；检查用户名、主机名、路径栏、头像、群名、通知内容后再保存。
- 证据页用 `docs/evidence/` 下的 Markdown 索引，图片放同目录；不写真实绝对路径，用 `<workspace>` 占位。

**Contract mapping:** Contract DoD 1-20 与 Acceptance Criteria（计算/推断两类）逐条勾选；本计划只勾选已被测试或真实验收证明的项。

**Commit strategy:** 每个 task 末尾一次 commit；最终收口 commit 只包含证据与文档。

---

### Task D1: Playwright 五条主链路

Blocking: Plan A/B/C 完成
Slice type: verification
Seam: `pnpm exec playwright test apps/web/e2e/supervisor-autonomy.spec.ts`

**Files:**
- Create: `apps/web/e2e/supervisor-autonomy.spec.ts`（若 Plan C 已创建，则扩展）
- Modify: `apps/web/e2e/board-attention.spec.ts`
- Modify: `apps/web/e2e/m6-helpers.ts`（只在需要复用 fixture 时）
- Test: Playwright

**Interfaces:**
- Consumes: Plan A/B/C 的 UI 与 WS 命令；现有 `mockWorkspace` 模式。
- Produces: 五条可重复的 UI 回归。

- [ ] **Step 1: Write the failing Playwright tests**

在 `apps/web/e2e/supervisor-autonomy.spec.ts` 增加五个 test（mock REST/WS，不依赖真实 daemon）：

```ts
test('observe -> digest proposal -> human apply creates a task', async ({ page }) => {
  // GET /api/notices 返回 digest，attention.items 含一条 failed + apply_proposal
  // 点击「应用建议」，断言 WS 发出 supervisor.action.decide(decision=apply)
  // mock ack 后 GET /api/tasks 返回新任务，断言看板出现标题
})

test('plan apply is idempotent and shows created count', async ({ page }) => {
  // supervisor messages 返回 plan_tasks 结果
  // 点击「应用全部」两次（第二次按钮已消失或禁用）
  // 断言只发送一次 supervisor.action.decide(apply)
  // GET /api/supervisor/actions/a1 返回 applied + createdTaskIds，断言「已创建 1 个」
})

test('mandate_revoked -> reauthorize -> retry continues', async ({ page }) => {
  // task.retry 第一次返回 error code=mandate_revoked
  // 任务详情出现「重新授权并继续」
  // 点击后发送 task.reauthorize；再次点击重试，发送 task.retry
})

test('task detail shows failure summary without transcript', async ({ page }) => {
  // GET /api/tasks/t1 返回 lastFailure
  // 断言「最近失败」「verify」「自动校验未通过」「src/login.ts」
  // 断言页面没有 transcript 文本（mock 的 transcript 内容不出现）
})

test('kill switch stops auto but observe still records a proposal', async ({ page }) => {
  // automation summary killSwitch=true, autonomy mode=auto
  // 触发 failed 通知后，断言 digest 出现 proposed 建议（observe 仍记录）
  // 断言没有 task.retry 的 WS 命令发出（auto 被 kill switch 停）
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm exec playwright test apps/web/e2e/supervisor-autonomy.spec.ts
```

Expected: FAIL because assertions/UI do not exist yet.

- [ ] **Step 3: Implement fixtures and selectors**

- 复用 `apps/web/e2e/m6-helpers.ts` 的 `mockWorkspace`；新增 `digestWithAttention()`、`planMessage()`、`failureDetail()` 三个 fixture 函数，避免每个 test 复制大对象。
- WS mock 用现有 `page.routeWebSocket` 或 `page.on('websocket')` 模式；记录 `supervisor.action.decide`、`task.reauthorize`、`task.retry` 命令到数组，便于断言“只发一次”。
- 选择器优先用可见文案与 `aria-label`：`需要你决定`、`应用建议`、`应用全部`、`重新授权并继续`、`最近失败`。
- 不新增 test-only 按钮或 DOM id；如必须，使用现有 `data-testid` 命名风格。

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm exec playwright test apps/web/e2e/supervisor-autonomy.spec.ts apps/web/e2e/board-attention.spec.ts
```

Expected: PASS；五条链路全部通过，且第二次 apply 不重复发送命令。

- [ ] **Step 5: Commit**

```bash
git add apps/web/e2e
git commit -m "test(web): 覆盖 M6-5 五条主链路"
```

---

### Task D2: ego-lite + 真实 Claude 验收与证据

Blocking: Task D1
Slice type: verification
Seam: 真实 daemon + ego-browser 操作

**Files:**
- Create: `docs/evidence/2026-11-22-m6-5/README.md`
- Create: `docs/evidence/2026-11-22-m6-5/01-observe.png`
- Create: `docs/evidence/2026-11-22-m6-5/02-plan.png`
- Create: `docs/evidence/2026-11-22-m6-5/03-reauthorize.png`
- Create: `docs/evidence/2026-11-22-m6-5/04-failure.png`
- Create: `docs/evidence/2026-11-22-m6-5/05-kill-switch.png`

**Interfaces:**
- Consumes: Plan A/B/C 全部能力；真实 Claude 登录态。
- Produces: 脱敏验收证据与文字结论。

- [ ] **Step 1: Preflight**

```bash
pnpm dev
curl -s http://127.0.0.1:7317/api/health
curl -s http://127.0.0.1:7317/api/supervisor/status
curl -s http://127.0.0.1:7317/api/engines
```

Expected:
- health 返回 `status: ok`。
- supervisor status 返回 `configured: true`。
- engines 包含 `claude-sdk` 且 `status: available`。

若任一条件不满足：停止本 task，记录实际状态并报告阻塞；不得用 fake 引擎冒充真实 Claude 证据。

- [ ] **Step 2: Run the real flow with ego-lite**

用 `ego-browser` skill/CLI 打开 `http://127.0.0.1:5173`，按顺序操作：

1. 新建并信任一个临时工作区（名称用 `m6-5-demo`，不要用真实项目名）。
2. 创建一个会失败的真实 Claude 任务（例如让 verify 命令执行 `node -e "process.exit(3)"`），等待进入 failed/review。
3. 打开总管 digest，确认“需要你决定”出现失败或待验收项；截图 `01-observe.png`。
4. 点击“应用建议”（observe 的 retry proposal），确认任务进入重试；截图。
5. 让总管生成一个 1-2 条的计划，确认计划卡显示模板、上下文数量、验收建议；截图 `02-plan.png`。
6. 点击“应用全部”，确认任务创建；确认验收仍停在“待验收”，没有被自动通过。
7. 在任务详情点击重试，触发 `mandate_revoked`（若策略已变），点击“重新授权并继续”，再次重试；截图 `03-reauthorize.png`。
8. 打开最近失败卡，确认只有 stage/summary/相对路径；截图 `04-failure.png`。
9. 打开自动化设置，开启 kill switch，确认 auto 停止但 observe 仍记录 proposed；截图 `05-kill-switch.png`。

- [ ] **Step 3: Redact and write evidence index**

```bash
mkdir -p docs/evidence/2026-11-22-m6-5
```

检查每张截图：不得出现用户名、主机名、路径栏、头像、群名、通知内容、token。必要时裁剪或重新截图。

`docs/evidence/2026-11-22-m6-5/README.md` 内容：

```md
# M6-5 真实链路验收证据

- 日期：2026-11-22
- 环境：本机 daemon + 真实 Claude（host-native），工作区 `<workspace>/m6-5-demo`
- 结论：observe 只记录 proposed；人点击后才执行；计划人确认后才建单；revalidate 拒绝后需重新授权；失败摘要不含 transcript；kill switch 停 auto、observe 仍记录。
- 限制：验收仍由人决定；总管不能 approve/reject、不能执行命令。
- 截图：01-observe.png / 02-plan.png / 03-reauthorize.png / 04-failure.png / 05-kill-switch.png
```

- [ ] **Step 4: Verify evidence has no sensitive data**

```bash
grep -RIn "Users/\|/home/\|token\|apiKey\|secret\|authorization" docs/evidence/2026-11-22-m6-5 || true
```

Expected: 输出为空；若图片中可能有敏感信息，重新裁剪，不要只依赖 grep。

- [ ] **Step 5: Commit**

```bash
git add docs/evidence/2026-11-22-m6-5
git commit -m "docs(m6-5): 增加真实链路验收证据"
```

---

### Task D3: Contract 收口、文档索引与全量门禁

Blocking: Task D1, D2
Slice type: verification
Seam: `pnpm verify:full` + `pnpm pack:check`

**Files:**
- Modify: `docs/contracts/M6-5-supervisor-autonomy.contract.md`
- Modify: `docs/plans/2026-11-22-m6-5-governance.md`
- Modify: `docs/plans/2026-11-22-m6-5-attention-failure.md`
- Modify: `docs/plans/2026-11-22-m6-5-plan-templates-batch.md`
- Modify: `docs/plans/2026-11-22-m6-5-acceptance.md`
- Modify: `docs/README.md`（不存在则创建，至少列出 specs/contracts/plans/evidence 索引）
- Test: 全量门禁

**Interfaces:**
- Consumes: D1 测试结果、D2 证据、Plan A/B/C 实现。
- Produces: contract 勾选、plan 完成状态、全量门禁输出。

- [ ] **Step 1: Run full gates**

```bash
pnpm verify:full
pnpm pack:check
pnpm check:boundaries
pnpm check:protocol
pnpm format:check
```

Expected: 全部通过。记录真实输出摘要到最终回复，不只写“通过”。

- [ ] **Step 2: Check contract DoD line by line**

打开 `docs/contracts/M6-5-supervisor-autonomy.contract.md`，逐条对照：

- 已有自动化测试或证据的条目改为 `- [x]`。
- 没有证据的条目保持 `- [ ]`，在最终回复中列出缺口；不得为了收口强行勾选。
- 如果实现与 spec 有偏离，先改 spec 或写 ADR 回链，不静默漂移。

- [ ] **Step 3: Update plan statuses**

四个 plan 文件 frontmatter 的 `status` 改为 `completed`；如果某个 plan 未完成，保持 `active` 并在最终回复说明。

在 `docs/contracts/M6-5-supervisor-autonomy.contract.md` 末尾追加：

```md
## 实施结果（2026-11-22）

- 实现计划：`docs/plans/2026-11-22-m6-5-governance.md`、`.../attention-failure.md`、`.../plan-templates-batch.md`、`.../acceptance.md`
- 验证：`pnpm verify:full`、`pnpm pack:check`、`pnpm check:boundaries`、`pnpm check:protocol`、`pnpm format:check`
- 证据：`docs/evidence/2026-11-22-m6-5/README.md`
- 保留边界：总管仍不能 approve/reject、不能执行命令、不能读 transcript；计划 apply 只由人触发。
```

- [ ] **Step 4: Final commit**

```bash
git add docs/contracts/M6-5-supervisor-autonomy.contract.md docs/plans docs/evidence docs/README.md
git commit -m "docs(m6-5): 收口总管自治验收"
```

- [ ] **Step 5: Report**

最终回复必须包含：

- 四个 plan 的完成状态。
- `pnpm verify:full` 与 `pnpm pack:check` 的真实结果摘要。
- contract 仍未勾选的条目（如有）与原因。
- ego-lite 证据路径与一条最重要的结论。
- 未做/后置项：外部 Source、DAG、自动验收/合并、模板编辑器、计划卡内联编辑、运行中 `context.inject`。

---

## Plan D 完成标准

- Playwright 五条主链路全绿：observe→digest→apply、计划幂等、revalidate→reauthorize、失败摘要、kill switch。
- ego-lite + 真实 Claude 至少走通 observe、计划、reauthorize、失败摘要、kill switch 五条中的全部；证据脱敏。
- `pnpm verify:full`、`pnpm pack:check`、`pnpm check:boundaries`、`pnpm check:protocol`、`pnpm format:check` 全绿。
- Contract DoD 只勾选有证据的条目；未完成项在最终回复中明确列出。
