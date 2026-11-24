---
spec_ref: ../specs/2026-11-24-canvas-drawing-scope-design.md
spec_topic: canvas-drawing-scope
status: active
---

# M9 画布与画板收敛实施执行图

> 对应 spec：`docs/specs/2026-11-24-canvas-drawing-scope-design.md`
> 对应 contract：`docs/contracts/canvas-drawing-scope.contract.md`
> 这是目录级执行图；每个 plan 独立确认、独立验证、独立提交。

## 计划拆分

| #   | Plan | 产出 | 依赖 | 验证门 |
| --- | --- | --- | --- | --- |
| 1 | `2026-11-24-m9-1-canvas-shell-project-tree.md` | 多项目树、需求画布壳、通知收件箱、工具栏收敛、拖拽移除 | 无 | web/daemon 定向测试 + `pnpm verify` |
| 2 | `2026-11-24-m9-2-drawing-editor-thumbnail.md` | 画板三态、自动保存、full/source/preview、节点同步、缩略图、内容抽取 | Plan 1 | core/web 测试 + `pnpm verify` |
| 3 | `2026-11-24-m9-3-supervisor-scope-read.md` | 总管作用域、消息 meta、`list_canvas`、`get_drawing`、prompt | Plan 1 + 2 | daemon 测试 + `pnpm verify` |
| 4 | `2026-11-24-m9-4-supervisor-drawing-write.md` | `create_drawing`/`update_drawing`、图片插入、`previewStale`、后台预览、冲突横幅 | Plan 3 | daemon/web 测试 + `pnpm verify` |
| 5 | `2026-11-24-m9-5-task-context-regression.md` | NodeType、drawing 任务上下文、投喂、contract 回归、`verify:full`、ego-lite 证据 | Plan 2 + 4 | 快照 + `pnpm verify:full` + 证据 |

## 依赖链

```
M9-1 → M9-2 → M9-3 → M9-4 → M9-5
```

- M9-1 先收敛画布壳与内容入口，避免后续画板/总管改动同时碰导航与工具栏。
- M9-2 依赖 M9-1 的需求画布壳；画板缩略图与预览 URL 只在需求画布生效。
- M9-3 依赖 M9-2 的 `extractDrawingContent` 与 Artifact `mode`。
- M9-4 依赖 M9-3 的总管作用域与 `get_drawing`。
- M9-5 最后做任务上下文与 contract 全量回归。

## 确认门

1. 每个 plan 结束：定向测试全绿、`pnpm verify` 全绿、贴真实输出；frontmatter `status` 改为 `completed` 后再创建下一个 plan。
2. M9-1 结束：左栏无「全部项目/项目画布」、需求画布唯一、工具栏无文本/图片按钮、拖拽上传不可用、通知跨项目聚合；附桌面截图。
3. M9-2 结束：画板加载失败不覆盖、自动保存 source-only、关闭 full save、缩略图可见、刷新不丢。
4. M9-3 结束：总管作用域跟随当前需求；`list_canvas`/`get_drawing` 截断与权限正确；无需求时明确报错。
5. M9-4 结束：总管可创建/编辑画板、插入工作区图片、写限制生效；后台预览刷新；冲突横幅出现；真实 Excalidraw 编辑器可渲染生成场景。
6. M9-5 结束：画板可投喂、任务上下文含画板文字；contract 20 条 DoD 逐条核对；`pnpm verify:full`；ego-lite 证据落盘。
7. 同一时间只保留 1 个 active plan。

## GDD

用户明确选择跳过正式 GDD；以 sprint contract 的 20 条 DoD + 每个 task 的 TDD/typecheck/e2e 作为 gate tree。执行中出现跨层契约歧义时，暂停并先补 GDD 或回改 spec。

## 提交策略

- 分支：`feat/canvas-drawing-scope`（已创建）。
- 每个 plan 内的 task 完成测试后提交；plan 完成把 frontmatter `status` 改为 `completed` 并提交。
- 合入前跑 `pnpm verify:full`；squash merge 到 `main`，不 force push。

## 完成记录

- M9-1 已完成（2026-11-24）：项目树、需求画布壳、通知、工具栏收敛、拖拽移除、文案与移动端降级；`pnpm verify` 全绿。
- 12 条 legacy Playwright 仍按工作区画布编写，已列入 M9-5 迁移，不在 M9-1 的 `pnpm verify` 门内。
- M9-2 已完成（2026-11-24）：source/full/preview 保存、drawing 节点同步、编辑器 fail-safe、缩略图与内容抽取；`pnpm verify` + `delivery.spec` 通过。

## 数据重置

- 执行前由用户按 spec 第 10 节手动重置本地测试数据；本执行图不自动删库、不写破坏性 migration。
