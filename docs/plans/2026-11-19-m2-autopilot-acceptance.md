---
spec_ref: ../specs/2026-11-19-m2-autopilot-design.md
spec_topic: m2-autopilot-v0
task_count: 4
estimated_phases: [verification, evidence]
dod: "Playwright 回归、ego-lite 真实 Claude 3 任务无人值守、kill switch/trust/人工验收 adversarial 检查、证据与全量验证完成"
depends_on: [2026-11-19-m2-autopilot-web.md]
status: blocked
---

# M2-2a 无人值守与汇报：验收与证据实施计划（Plan 4/4）

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`（推荐）或 `executing-plans` 逐任务执行。步骤用 `- [ ]` 勾选。

**Goal:** 用 Playwright 锁定 UI 回归，用 ego-lite + 真实 Claude 跑 3 个任务无人值守，验证 kill switch、trust 门槛和人工验收仍生效，最后收口证据与全量命令。

**Architecture:** Playwright 只 mock REST/WS，不启动 daemon；真实验收用临时 `BATON_DATA_DIR`/`BATON_WORKSPACES_ROOT` + host-native Claude + `~/.baton/supervisor.json`；证据只放脱敏截图与步骤记录。

**Tech Stack:** Playwright（系统 Chrome）、ego-lite、真实 Claude Agent SDK、`pnpm verify:full`、`pnpm pack:check`。

---

## 计划地图

| Plan | 范围 | 状态 |
|---|---|---|
| 1. 契约层 | protocol / core / migration / 仓储 | 前置 |
| 2. daemon | policy / kill switch / digest / notice & audit / runtime | 前置 |
| 3. web | 设置弹窗 / 顶栏状态 / digest 卡 / 任务自动化卡 / 批量开工 | 前置 |
| **4. 验收（本计划）** | Playwright 回归 / ego-lite / adversarial / 证据 | 实施中 |

**GDD:** 按仓库先例显式跳过；测试设计由 contract 14 条 DoD 与任务内测试承担。

**Commit strategy:** 每个 Task 结束提交一次；Task 4 跑全量验证。

---

## Task 1: Playwright 回归复核与 journey 兼容

Blocking: Plan 3
Slice type: verification
Seam: `pnpm exec playwright test` 全绿

**Files：**

- Modify: `apps/web/e2e/automation.spec.ts`（Plan 3 已创建）
- Modify: `apps/web/e2e/supervisor.spec.ts`（如 notice/digest 影响现有 mock）
- Modify: `apps/web/e2e/journey.spec.ts`（如新增自动化入口影响首屏）

**Interfaces：**

- Consumes: `GET/PATCH /api/workspaces/:id/automation`、`PUT /api/automation/kill-switch`、`GET /api/notices`、`POST /api/workspaces/:id/digest`、`GET /api/tasks/:id/automation`；WS `notice`。
- Produces: 稳定的 UI 回归证据。

- [ ] **Step 1: 跑现有 Playwright**

```bash
pnpm exec playwright test
```

Expected: PASS；如果 journey/supervisor 因新增 header 或右栏元素失败，按运行时可见行为修正 mock，不放宽断言。

- [ ] **Step 2: 补齐自动化回归断言**

`apps/web/e2e/automation.spec.ts` 至少覆盖：

- 设置弹窗：读取 summary、修改 `retryMax`、保存 payload 只有三个字段、未信任提示。
- 顶栏：自动化关闭 → 运行中 → 已暂停三态；暂停按钮调用 kill switch；env 强制时按钮禁用。
- digest：生成、未读圆点、知道了、历史展开、任务跳转。
- 任务自动化卡：自动批准/重试记录、空态。
- 批量开工：只选 `todo`、全选、上限 20、部分失败 toast、`task.enqueue` 次数正确。
- 所有 REST/WS 用 `page.route` / `page.routeWebSocket` mock，不依赖本机 daemon。

- [ ] **Step 3: 跑自动化回归**

```bash
pnpm exec playwright test apps/web/e2e/automation.spec.ts
```

Expected: PASS，无 flaky；如出现时序问题，用 `expect.poll` 等待可见文本，不加固定 sleep。

- [ ] **Step 4: Commit**

```bash
git add apps/web/e2e
git commit -m "test(web): 自动化 UI Playwright 回归"
```

---

## Task 2: ego-lite + 真实 Claude 的 3 任务无人值守

Blocking: Task 1
Slice type: verification
Seam: 3 个任务在 autopilot 下进入 review；digest 与看板一致

**Files：**

- Create: `docs/evidence/2026-11-19-m2-autopilot/README.md`
- Create: `docs/evidence/2026-11-19-m2-autopilot/01-settings.png`
- Create: `docs/evidence/2026-11-19-m2-autopilot/02-batch-start.png`
- Create: `docs/evidence/2026-11-19-m2-autopilot/03-digest.png`
- Create: `docs/evidence/2026-11-19-m2-autopilot/04-review.png`

**Interfaces：**

- Consumes: 真实 Claude Agent SDK、`~/.baton/supervisor.json`（仓库外 0600）、临时 data/workspace、ego-lite。
- Produces: 脱敏截图 + 步骤记录 + 结果表。

- [ ] **Step 1: 准备临时环境**

```bash
export BATON_DATA_DIR=<temp-data>
export BATON_WORKSPACES_ROOT=<temp-workspaces>
pnpm --filter @evanfang0054/baton dev
```

- 在临时 workspace 建一个可验证的 fixture：`package.json`、`src/a.ts`、`src/b.ts`、`src/c.ts`、`.baton/policy.json`。
- `.baton/policy.json` 设 `approval.allow` 含 `Read`、`Edit:src/**`、`Bash:pnpm test`，`autopilot.enabled=true`、`retryMax=1`、`autoApproveMaxRisk=low`、`digestCron='0 9,21 * * *'`。
- verify 命令用一个只失败一次的脚本，验证自动重试：
  ```json
  { "verify": { "command": "sh -c 'n=$(cat .verify-count 2>/dev/null || echo 0); echo $((n+1)) > .verify-count; test \"$n\" -ge 1'" } }
  ```
- 不在 README 记录 baseUrl、key、账号或本机绝对路径。

- [ ] **Step 2: 信任工作区并开启自动化**

- 用 ego-lite 打开 daemon 地址，创建/选择 workspace，完成 trust。
- 打开「自动化设置」，确认 `autopilot` 开、`retryMax=1`、low；保存。
- 截图 `01-settings.png`。

- [ ] **Step 3: 建 3 个任务并批量开工**

- 通过总管或画布创建 3 个任务，prompt 分别要求修改 `src/a.ts`、`src/b.ts`、`src/c.ts` 的一行文本；目标 Agent 使用真实 `claude-sdk`。
- 选中 3 个 `todo`，点「开工 3 个」；截图 `02-batch-start.png`。
- 断言：
  - 3 条 `task.enqueue` ack；任务进入 running/queued。
  - 低风险 Read/Edit 审批自动通过，任务详情出现「自动批准」记录；如果真实 Claude 对 Read/Edit 不触发 approval，改用 `Bash:pnpm test` 触发一次低风险审批，并在 README 记录实际工具名。
  - 至少一个任务 verify 第一次失败、自动重试一次后进入 `review`。
  - 没有任务被自动验收；全部停在 `review`。

- [ ] **Step 4: 生成并检查 digest**

- 在总管面板点「生成汇报」；截图 `03-digest.png`。
- 断言 digest 的 `ready/blocked/dropped`、变化计数、最长等待与看板一致；任务标题可点击打开详情。
- 标记已读；刷新后未读圆点消失，历史仍可展开。

- [ ] **Step 5: 记录结果**

在 `docs/evidence/2026-11-19-m2-autopilot/README.md` 写：

```md
# M2-2a 无人值守与汇报验收

- 日期：2026-11-19
- 分支：
- 环境：临时 data/workspace；真实 Claude；ego-lite；模型名脱敏
- 结果：3 个任务批量开工 → 自动批准 N 次 → 自动重试 N 次 → 全部 review
- digest：ready/blocked/dropped 与看板一致
- 截图：01-settings.png / 02-batch-start.png / 03-digest.png / 04-review.png
- 残留风险：
```

- [ ] **Step 6: Commit**

```bash
git add docs/evidence/2026-11-19-m2-autopilot
git commit -m "docs(evidence): 记录 M2-2a 无人值守验收"
```

---

## Task 3: kill switch、trust 与人工闸门 adversarial 检查

Blocking: Task 2
Slice type: verification
Seam: 自动化暂停后下一次审批不自动通过；未信任 workspace 不自动；人工验收仍生效

**Files：**

- Modify: `docs/evidence/2026-11-19-m2-autopilot/README.md`
- Create: `docs/evidence/2026-11-19-m2-autopilot/05-kill-switch.png`
- Create: `docs/evidence/2026-11-19-m2-autopilot/06-untrusted.png`

**Interfaces：**

- Consumes: 顶栏 kill switch、`BATON_KILL_SWITCH=1`、untrusted workspace、任务详情审批/验收。
- Produces: adversarial 结果记录。

- [ ] **Step 1: kill switch 检查**

- 在顶栏点「暂停自动化」；断言状态变为「自动化已暂停」，截图 `05-kill-switch.png`。
- 新建第 4 个任务并开工，触发一个低风险审批；断言审批卡停留在待处理，不自动通过。
- 触发 verify 失败；断言任务进入 `review` 而不是自动重试。
- 运行中任务不被中断；人工仍可点「允许/拒绝」。
- 恢复自动化：进设置弹窗确认；断言下一次审批恢复自动。

- [ ] **Step 2: env 强制检查**

- 重启 daemon，带 `BATON_KILL_SWITCH=1`。
- 断言顶栏显示「由环境变量强制暂停」，设置弹窗的关闭按钮禁用/拒绝，任务状态不丢。
- 记录到 README；不记录 env 值以外的敏感信息（env 只有 0/1）。

- [ ] **Step 3: untrusted workspace 检查**

- 新建 workspace，不点信任；手工在 workspace 写 `.baton/policy.json`，`autopilot.enabled=true`、`approval.allow=['Read']`。
- 建任务并开工，触发 Read 审批；断言审批仍为 ask，不自动通过；截图 `06-untrusted.png`。
- 尝试 `PATCH /api/workspaces/:id/automation`（或 UI 保存）；断言 409 `workspace_untrusted`。
- 信任后重试，断言自动批准恢复。

- [ ] **Step 4: 人工闸门检查**

- 对一个 review 任务点「通过」，断言 `done`；对另一个点「打回」，断言进入 queued 并带反馈。
- 对总管说「帮我把这个任务开工/通过」；断言总管拒绝或引导，任务状态不变。
- 记录结果。

- [ ] **Step 5: Commit**

```bash
git add docs/evidence/2026-11-19-m2-autopilot
git commit -m "docs(evidence): 记录 kill switch 与 trust 检查"
```

---

## Task 4: 证据收口与全量验证

Blocking: Tasks 1–3
Slice type: verification
Seam: `pnpm verify:full`、`pnpm pack:check` 退出码 0

**Files：**

- Modify: `docs/evidence/2026-11-19-m2-autopilot/README.md`
- Modify: `docs/README.md`
- Modify: 本计划末尾「完成记录」

- [ ] **Step 1: 检查证据脱敏**

- 截图只保留 UI 区域；确认不含用户名、绝对路径、token、API key、其他窗口、通知内容。
- README 不含 baseUrl/key/账号/本机绝对路径；模型名可写“真实模型”或脱敏名称。

- [ ] **Step 2: 跑全量验证**

```bash
pnpm verify:full
pnpm pack:check
pnpm check:boundaries
pnpm check:protocol
pnpm format:check
```

Expected: 全部退出码 0；记录测试数量与耗时。

- [ ] **Step 3: 检查范围与占位**

```bash
grep -RIn "TODO\|FIXME" packages/protocol/src packages/core/src apps/daemon/src apps/web/src
grep -RIn "enqueue_task" apps/daemon/src/supervisor packages/protocol/src
grep -n "croner" apps/daemon/package.json THIRD_PARTY_NOTICES.md
```

前两条无输出；第三条命中。若 `croner` 未使用，确认 `digestCronUnsupported` 降级路径与文档。

- [ ] **Step 4: 更新索引与完成记录**

- `docs/README.md` 增加 spec/contract/4 个 plan/evidence 的链接。
- 在本计划末尾追加：
  ```md
  ## 完成记录（YYYY-MM-DD）

  - 关键 commit：
  - 测试结果：
  - 与计划的偏差：
  - 未解决风险：
  ```

- [ ] **Step 5: Commit**

```bash
git add docs
git commit -m "docs(evidence): 完成 M2-2a 验收与索引"
```

---

