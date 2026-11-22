---
spec_ref: ../specs/2026-11-22-m7-delivery-playbook-design.md
spec_topic: m7-delivery-playbook
status: active
---

# M7 交付工作台实施执行图

> 对应 spec：`docs/specs/2026-11-22-m7-delivery-playbook-design.md`
> 对应 contract：`docs/contracts/M7-delivery-playbook.contract.md`
> 这是目录级执行图；每个 plan 独立确认、独立验证、独立提交。

## 计划拆分

| #   | Plan | 产出 | 依赖 | 验证门 |
| --- | --- | --- | --- | --- |
| 1 | `2026-11-22-m7-1-protocol-core-migration.md` | protocol entities、playbook/status/prompt/layout 纯函数、migration 0015、node/task 兼容 | 无 | protocol/core/daemon 测试 + `pnpm verify` |
| 2 | `2026-11-22-m7-2-daemon-delivery-artifact-annotation.md` | delivery/artifact/annotation service、REST、事件、总管 6 工具、闸门推进 | Plan 1 | daemon 集成 + fake 全流程 + `pnpm verify` |
| 3 | `2026-11-22-m7-3-web-shell-board-canvas.md` | 左栏/交付看板/交付画布/阶段分组/产物卡/闸门卡/右栏只留总管/覆盖层 | Plan 1、2 | web 组件 + Playwright + 截图 |
| 4 | `2026-11-22-m7-4a-excalidraw-drawing.md` | drawing 节点/artifact、全屏懒加载画板、保存/缩略图/查看器 | Plan 3 | lazy chunk 断言 + Playwright |
| 5 | `2026-11-22-m7-4b-quick-annotation.md` | 标注层、工具条、note/target、合成图、持久化、标注列表 | Plan 3、4a | Playwright 标注链路 + 性能上限 |
| 6 | `2026-11-22-m7-5-acceptance-skills.md` | 必产物检查、验收矩阵、交付报告、`.baton/skills` 注入/trust | Plan 2、3 | 真实 Claude + ego-lite |
| 7 | `2026-11-22-m7-6-e2e-docs-evidence.md` | fake 全流程、ego-lite 证据、文档/索引/notices | Plan 4b、5 | `pnpm verify:full` + `pack:check` |

## 依赖链

```
M7-1 → M7-2 → M7-3 → M7-4a → M7-4b → M7-5 → M7-6
```

- M7-2 依赖 M7-1 的 protocol 类型、playbook/status/prompt/layout 纯函数与 migration 0015。
- M7-3 依赖 M7-1/2 的 REST/事件/delivery 数据；可以先做空状态/骨架，但不能跳过 Plan 2 的契约。
- M7-4a/M7-4b 依赖 M7-3 的画布对象/覆盖层；两者可并行，但标注层复用 artifact/overlay 基础设施。
- M7-5 依赖 M7-2 的 artifact/annotation 与 M7-3 的验收矩阵卡。
- M7-6 最后做，汇总证据与文档。

## 确认门

1. 每个 plan 结束：`pnpm verify` 全绿；本 plan 的测试与验收点通过；贴真实输出。
2. M7-3/M7-4 UI 结束：附 Playwright/ego-lite 截图或 gif；对照 `DESIGN.md` 说明使用的 token；不新增颜色/字号/圆角。
3. M7-5 结束：真实 Claude + ego-lite 一条需求阶段 + 一条标注链路；截图脱敏。
4. M7-6 结束：`pnpm verify:full`、`pnpm pack:check`、`check:boundaries`、`check:protocol`、`format:check`；证据落 `docs/evidence/2026-11-22-m7-delivery/`。
5. 每个 plan 完成后把 frontmatter `status` 改为 `completed`，再创建下一个 plan；同一时间只保留 1 个 active plan。

## GDD

本迭代没有单独的 GDD 产物；以 sprint contract 的 23 条 DoD + 每个 task 的 TDD/typecheck/e2e 作为 gate tree。如果执行前需要正式 GDD，暂停并先跑 `agent-harness:gate-driven-test-design`。

## 当前状态

- M7 spec / ADR / contract：已完成并提交。
- M7-1 plan：已完成并验证（`pnpm verify` 全绿）；分支 `feat/m7-1-protocol-core`。
- M7-2 plan：进行中；已落 delivery/artifact/annotation repositories、playbook loader、delivery/artifact/annotation service、REST 与测试；剩余阶段推进/auto 闸门、总管 6 工具、最终验证。
- M7-3 ~ M7-6：未创建；等前一个 plan 通过确认门后再写，避免一次堆 7 个 active plan。
