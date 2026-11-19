---
spec_ref: ../specs/2026-11-19-m3-delivery-acceptance-design.md
contract_ref: ../contracts/M3-1-delivery-acceptance.contract.md
spec_topic: m3-1-delivery-acceptance
task_count: 5
estimated_phases: [tests, implementation, verification]
dod: "真实 Claude 跑通 worktree/diff/重启/清理/并行；retry/reopen 跑通；门禁与文档收口"
depends_on: 2026-11-19-m3-1-aftersales-history.md
---

# M3-1 Slice 4：验收与文档收口实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans. 每任务结束提交，不 push。

**Goal:** 用真实 Claude + ego-lite 验收 M3-1 全链路，补齐 verify 诊断与文档，跑完整门禁。

**Architecture:** 不新增功能；只加诊断、证据、文档同步与回归。真实链路覆盖 worktree/diff/重启/清理/并行；retry/reopen 用 agent-fake 保证确定性。

**Tech Stack:** Playwright、ego-lite、真实 Claude Code、pnpm 脚本、Markdown 文档。

---

### Task 1: verify 失败诊断与 runbook

Blocking: none
Slice type: verification
Seam: verify 以 126/127 或 “command not found” 失败时输出 PATH 诊断提示

**Files:**
- Modify: `apps/daemon/src/verify/executor.ts`
- Modify: `docs/runbooks/local.md`
- Test: `apps/daemon/test/verify-executor.test.ts`

**Interfaces:**
- Consumes: `sanitizeEnv`
- Produces: `diagnoseVerifyFailure(result, command, env)`；不改环境解析

- [ ] **Step 1: 写失败测试**

```ts
it('adds a PATH hint for command-not-found failures', async () => {
  const result = await runVerifyCommand({ command: 'definitely-not-a-command', workspacePath: repo, timeoutSec: 5, maxOutputBytes: 4096 })
  expect(result.output).toContain('命令未找到')
  expect(result.output).toContain('PATH=')
  expect(result.output).not.toContain('ANTHROPIC_API_KEY')
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @evanfang0054/baton exec vitest run test/verify-executor.test.ts -t "PATH hint"`
Expected: FAIL（无提示）

- [ ] **Step 3: 实现**

在 `runVerifyCommand` 返回前，若 `exitCode === 126 || exitCode === 127` 或输出匹配 `/command not found|not found/i`：

```ts
const hint = [
  '',
  '[baton] 命令未找到。请确认 verify 命令在 daemon 的 PATH 中可用。',
  `PATH=${env.PATH ?? ''}`,
  '详见 docs/runbooks/local.md 的“verify 命令与 PATH”一节。',
].join('\n')
```

只拼 PATH，不输出其他环境变量；日志不写完整 env。

- [ ] **Step 4: 更新 runbook**

`docs/runbooks/local.md` 增加：

- verify 在 daemon 的 PATH 中执行；GUI/launchd 启动时可能缺少 shell shim。
- 用 `which pnpm` / `command -v node` 对照；必要时用绝对路径或调整启动方式。
- 诊断输出只包含 PATH，不含 token/API key。

- [ ] **Step 5: 跑测试**

Run: `pnpm --filter @evanfang0054/baton exec vitest run test/verify-executor.test.ts`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add apps/daemon/src/verify/executor.ts apps/daemon/test/verify-executor.test.ts docs/runbooks/local.md
git commit -m "feat(daemon): add verify PATH diagnostics"
```

---

### Task 2: 全量 Playwright 回归

Blocking: Slice 1–3
Slice type: verification
Seam: 现有 e2e + 三个新 spec 全绿

**Files:**
- Modify: `apps/web/e2e/*.spec.ts`（仅在必要时修选择器）
- Run: `pnpm exec playwright test`

- [ ] **Step 1: 跑全量 e2e**

Run: `pnpm exec playwright test`
Expected: 现有 `journey/shell/automation/supervisor/canvas-context/mobile-*` 与新增 `diff/worktree/aftersales` 全绿。

- [ ] **Step 2: 修回归**

若桌面选择器因新增历史区/动作变化而失效，按可访问名称修正；不改断言语义。若移动 footer 条件变化导致旧用例失败，补 status 到断言。

- [ ] **Step 3: 复跑**

Run: `pnpm exec playwright test`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add apps/web/e2e
git commit -m "test(web): m3-1 e2e regression"
```

---

### Task 3: 真实 Claude + ego-lite 验收

Blocking: Task 2
Slice type: verification
Seam: `docs/evidence/2026-11-19-m3-1-delivery-acceptance/README.md` 可复核

**Files:**
- Create: `docs/evidence/2026-11-19-m3-1-delivery-acceptance/README.md`
- Create: `docs/evidence/2026-11-19-m3-1-delivery-acceptance/*.png`（脱敏截图）

**准备**：临时目录起 daemon（`BATON_DATA_DIR`、`BATON_WORKSPACES_ROOT` 指向临时目录），fixture 仓库只含 `README.md` 与一个简单 verify：

```bash
git init
git add README.md
git -c user.name=<user> -c user.email=<email> commit -m "init"
```

verify 命令：`grep -q BATON-OK README.md`（不依赖 pnpm shim）。

- [ ] **Step 1: worktree + diff + 验收**

在 ego-lite 中：创建/信任 workspace → 建任务勾选“独立工作树”，prompt 要求把 `BATON-OK` 写入 README → 开工 → 真实 Claude 执行 → verify 通过 → 打开“查看改动”看到 README patch → 通过。

- [ ] **Step 2: 重启与清理证据**

重启 daemon → 打开同一 review → diff 仍在。执行“清理工作树” → diff 仍在；分支 `baton/<taskId>` 仍存在（`git branch --list`）。

- [ ] **Step 3: 并行隔离**

同一 workspace 建两个 worktree 任务，分别改不同文件；并行开工；两个都进 review；断言主工作区 `git status --short` 为空；两个 review 的 diff 只含各自文件；分支不同。

- [ ] **Step 4: retry / reopen**

用 agent-fake 构造 `failed` 任务：重试 → `queued` → 新 session；断言 `retryCount=0`、历史保留。完成一个任务后“重新打开” → `todo` → 立即开工 → 新 session；历史出现两个 episode。

- [ ] **Step 5: 写证据 README**

包含：环境（不含用户名/路径）、命令、步骤、断言、截图清单、残留风险（如真实 Claude 版本、verify 命令限制）；所有截图检查用户名/路径栏/token。

- [ ] **Step 6: 提交**

```bash
git add docs/evidence/2026-11-19-m3-1-delivery-acceptance
git commit -m "docs: m3-1 acceptance evidence"
```

---

### Task 4: 文档与路线同步

Blocking: Task 3
Slice type: verification
Seam: README/docs 索引/架构 M3 表述一致，无悬挂里程碑

**Files:**
- Modify: `README.md`
- Modify: `docs/README.md`
- Modify: `docs/specs/2026-11-16-baton-architecture-design.md`（§7 M3 事实同步，不改锁定决策）
- Modify: `docs/specs/2026-11-19-m3-delivery-acceptance-design.md`（状态改为已实现）

- [ ] **Step 1: 更新 README 状态**

把“M1-6a 任务控制台已完成”改为当前事实：M2 已收口、M3-1 交付验收增强已实现（分支/PR 状态据实写）。

- [ ] **Step 2: 更新 docs 索引**

`docs/README.md` 增加 4 个 plan 与证据条目；spec/contract 链接已在，无需重复。

- [ ] **Step 3: 架构 §7 同步**

在 M3 行附近加注：ADR 0003 已移除 Docker/slim 镜像；M3 第一阶段为 M3-1 交付验收增强（diff/worktree/retry/reopen/history），分发与 DSH 后置。不删除历史行，保留原实施记录。

- [ ] **Step 4: 标记 spec 状态**

`2026-11-19-m3-delivery-acceptance-design.md` §0 状态改为“已实现并合并”（按实际合并情况）；frontmatter `gates` 保持。

- [ ] **Step 5: 检查依赖通知**

无新运行时依赖；若 lockfile 变化，更新 `THIRD_PARTY_NOTICES.md`。

- [ ] **Step 6: 提交**

```bash
git add README.md docs
git commit -m "docs: sync m3-1 delivery acceptance"
```

---

### Task 5: 最终门禁

Blocking: Task 4
Slice type: verification
Seam: 所有门禁退出码 0，CI 五项全绿

- [ ] **Step 1: 本地门禁**

```bash
pnpm verify:full
pnpm pack:check
pnpm check:boundaries
pnpm check:protocol
pnpm format:check
```

- [ ] **Step 2: CI**

push 前需用户确认；PR 后确认 `verify (22)`、`verify (24)`、`pack-check`、`e2e`、`build` 全绿；`secrets` 若在必需集合内也需全绿。

- [ ] **Step 3: 收口提交**

若门禁修复产生改动，按 scope 提交；无改动则记录到证据 README。

---

## 本片完成门禁

- `pnpm verify:full`、`pnpm pack:check`、`pnpm check:boundaries`、`pnpm check:protocol`、`pnpm format:check`
- `docs/evidence/2026-11-19-m3-1-delivery-acceptance/README.md` 存在且截图脱敏
- CI 五项 checks 全绿（push/PR 需用户确认）
