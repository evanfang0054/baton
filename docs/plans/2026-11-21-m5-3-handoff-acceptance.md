---
spec_ref: ../specs/2026-11-21-m5-3-context-handoff-design.md
spec_topic: m5-3-context-handoff
task_count: 5
estimated_phases: [tests, verification, documentation]
dod: "Playwright UI/总管交接；真实 Claude A→B；证据落库；docs 索引与 contract 收口；全量命令通过"
status: in-progress
depends_on: docs/plans/2026-11-21-m5-3-handoff-core-daemon.md, docs/plans/2026-11-21-m5-3-handoff-web.md
---

# M5-3 Plan 3：验收、真实 Claude 与文档收口

> **For agentic workers:** REQUIRED SUB-SKILL: Use `agent-harness:subagent-driven-development` (recommended) or `agent-harness:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 Playwright 与真实 Claude 证明“任务结果 → 交接节点 → 新任务上下文”可用，并把证据、索引与 contract 收口。

**Architecture:** Playwright 复用 `supervisor-aftersales.spec.ts` 的 REST/WS mock 模式；真实链路用本机 Claude Code 登录态；截图脱敏后落 `docs/evidence/`。

**Tech Stack:** Playwright（系统 Chrome）、ego-lite 浏览器、pnpm。

---

## 文件结构

- Create: `apps/web/e2e/handoff.spec.ts`
- Create: `docs/evidence/<date>-m5-3-context-handoff/README.md` + 脱敏截图。
- Modify: `docs/README.md`
- Modify: `docs/contracts/M5-3-context-handoff.contract.md`

---

### Task 1: Playwright UI 交接

Blocking: Plan 2 Task 1
Slice type: verification
Seam: `apps/web/e2e/handoff.spec.ts`

**Files:**
- Create: `apps/web/e2e/handoff.spec.ts`

**Interfaces:**
- Consumes: `supervisor-aftersales.spec.ts` 的 `mockSupervisorRest` / `workspace` / `canvasNodes` 模式
- Produces: 任务详情按钮 → 节点 → 建任务 → 上下文快照断言

- [ ] **Step 1: 写测试**

mock：
- workspace `w1`；
- canvas 有 agent 节点 `a1` 与 review 任务 `task-1`；
- REST `/api/tasks/task-1` 返回 `status: 'review'`；
- WS `task.handoff` 返回 ack `{ nodeId: 'handoff-1', taskId: 'task-1', warnings: [] }`；
- 之后 canvas 查询返回新增的 text 节点（内容以 `【交接】` 开头）；
- `task.create` ack 返回 `task-2`；
- `/api/tasks/task-2` 返回 `contextJson` 含 `handoff-1`。

断言：
1. 打开任务详情，点击“生成交接节点”；
2. 画布出现 `【交接】` 节点；
3. 选中该节点 + `a1`，创建任务；
4. 任务详情上下文快照显示该节点。

- [ ] **Step 2: 跑测试确认失败/通过**

Run: `pnpm exec playwright test apps/web/e2e/handoff.spec.ts`
Expected: 先 FAIL（按钮/命令未实现），实现后 PASS。

- [ ] **Step 3: 修选择器/mock**

- 按钮可访问名称以实际 UI 为准。
- 不一致时把 mock helper 抽到 `apps/web/e2e/handoff-fixtures.ts`，不依赖测试顺序。
- 不用真实 daemon。

- [ ] **Step 4: 提交**

```bash
git add apps/web/e2e/handoff.spec.ts
git commit -m "test(e2e): 任务详情交接节点"
```

---

### Task 2: Playwright 总管交接、worktree 与重复交接

Blocking: Task 1
Slice type: verification
Seam: `apps/web/e2e/handoff.spec.ts`

**Files:**
- Modify: `apps/web/e2e/handoff.spec.ts`

- [ ] **Step 1: 总管交接**

mock `supervisor.send` 返回：
```ts
{
  id: 'm-handoff',
  role: 'assistant',
  content: '已把结果交给新任务。',
  toolCalls: [
    {
      id: 'tc-handoff',
      name: 'handoff_task',
      ok: true,
      args: { fromTaskId: 'task-1', note: '继续修改登录页' },
      result: {
        task: { taskId: 'task-2', title: '跟进：登录页改造', target: {...}, contextCount: 1, status: 'todo' },
        handoff: {
          nodeId: 'handoff-1',
          fromTaskId: 'task-1',
          fromTitle: '登录页改造',
          fromStatus: 'review',
          worktree: false,
          warnings: [],
        },
      },
    },
  ],
}
```

断言：任务卡可见、`交接自《登录页改造》` 可见、状态 `todo`、没有“已开工”文案。

- [ ] **Step 2: worktree 警告**

`handoff.worktree = true`、`warnings: ['源任务在隔离 worktree，变更文件在主工作区不可读。']`。
断言：警告行可见；回复不出现“B 已读取文件”一类文案（mock 文本固定）。

- [ ] **Step 3: 重复交接**

连续两次 `handoff_task`（或 UI 两次点击），canvas mock 返回两个不同 `nodeId` 的 `【交接】` 节点。
断言：两个节点都可见，内容独立，不覆盖。

- [ ] **Step 4: 跑测试**

Run: `pnpm exec playwright test apps/web/e2e/handoff.spec.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/web/e2e/handoff.spec.ts
git commit -m "test(e2e): 总管交接与 worktree 警告"
```

---

### Task 3: 真实 Claude 交接链路 + ego-lite 证据

Blocking: Task 2
Slice type: verification
Seam: 本机真实 Claude Code

**Files:**
- Create: `docs/evidence/<date>-m5-3-context-handoff/README.md`
- Create: 脱敏截图（桌面 1-2 张）

- [ ] **Step 1: 启动真实环境**

```bash
pnpm build
BATON_WORKSPACES_ROOT="$HOME" pnpm dev
```

打开 Web，确认总管已配置真实模型（`~/.baton/supervisor.json`），workspace 已信任。

- [ ] **Step 2: 跑主工作区交接**

1. 用总管创建任务 A：“在 demo 仓库创建 `hello.txt`，内容写 hello，然后开工。”
2. 人工允许审批，A 进入 `review`。
3. 任务详情点“生成交接节点”；确认画布出现 `【交接】` 节点，内容含变更文件 `hello.txt`。
4. 对总管说：“把 A 的结果交给 B，继续把 `hello.txt` 改成 hello baton，然后开工。”
5. 确认总管调用 `handoff_task`，B 是 `todo` 或 `queued`；B 的上下文含交接节点。
6. 人工允许审批，B 进入 `review`；确认文件已改为 `hello baton`。

- [ ] **Step 3: 采证**

记录：
- taskId A/B（脱敏）；
- 状态变化；
- 审计 `task.handoff.create` / `supervisor.task.handoff`；
- 截图：任务详情交接按钮/节点、B 的上下文快照或总管结果。
- 检查截图没有用户名、主机名、本机绝对路径、token、transcript 正文。

- [ ] **Step 4: 写证据 README**

```md
# M5-3 上下文交接验收

- 日期：<date>
- 分支/提交：<branch> / <commit>
- 真实引擎：本机 Claude Code（claude-sdk）；总管模型 <model>
- 任务 A：<脱敏标题>（review → handoff）
- 任务 B：<脱敏标题>（todo → queued → review）
- 交接节点：包含任务目标/变更文件/最后回复；B 的 context_json 含该节点
- 审计：task.handoff.create / supervisor.task.handoff
- worktree：集成测试覆盖，未做真实 Claude
- 截图：desktop-1.png, desktop-2.png
```

- [ ] **Step 5: 提交**

```bash
git add docs/evidence
git commit -m "docs: M5-3 真实 Claude 交接验收证据"
```

---

### Task 4: 文档索引与 contract 收口

Blocking: Task 3
Slice type: documentation
Seam: `docs/README.md` / contract

**Files:**
- Modify: `docs/README.md`
- Modify: `docs/contracts/M5-3-context-handoff.contract.md`

- [ ] **Step 1: 加索引**

- `现行 spec` 加 M5-3。
- `现行 contract` 加 M5-3。
- `现行 plan` 加 3 个 plan。
- `验收证据` 加 M5-3。

- [ ] **Step 2: 勾选 DoD**

已验证条目改 `[x]`；未验证保持 `[ ]` 并写原因。不要伪造勾选。

- [ ] **Step 3: 格式检查**

Run: `pnpm format:check`
Expected: PASS。

- [ ] **Step 4: 提交**

```bash
git add docs/README.md docs/contracts/M5-3-context-handoff.contract.md
git commit -m "docs: M5-3 索引与合同收口"
```

---

### Task 5: 全量验证

Blocking: Task 4
Slice type: verification
Seam: 仓库命令行

- [ ] **Step 1: 跑全量**

```bash
pnpm verify
pnpm verify:full
pnpm pack:check
pnpm check:boundaries
pnpm check:protocol
pnpm format:check
```

Expected: 全部 exit 0。

- [ ] **Step 2: 记录真实输出**

把每条命令的结果与测试数量写进 evidence README；不要只写“已通过”。

- [ ] **Step 3: 提交（如有修正）**

```bash
git add .
git commit -m "chore: M5-3 全量验证收口"
```

---

## 执行记录

- 2026-11-21：Task 1/2 完成，提交 `7a7820a`；`handoff.spec.ts` 2 条（任务详情生成节点并刷新画布；总管交接卡 + worktree 警告）全绿。
- 2026-11-21：Task 5 全量命令通过：`pnpm verify:full`（protocol 119、core 140、adapters 27、web 204、daemon 294 tests；Playwright 37 条全绿）、`pnpm pack:check` 通过。
- Task 3/4（真实 Claude + ego-lite 证据）待执行；证据 README 计划落 `docs/evidence/2026-11-21-m5-3-context-handoff/`。

## 计划自检

- Spec 覆盖：Playwright UI/总管/worktree/重复、真实 Claude、证据、索引、全量命令。
- 无占位符：每个任务都有测试/证据/命令/提交。
- 依赖：Task 1→2→3→4→5；依赖 Plan 1+2。
