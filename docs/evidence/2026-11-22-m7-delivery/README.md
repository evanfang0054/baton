# M7 交付工作台证据（2026-11-22）

## 已通过

- `pnpm verify`：typecheck / lint / format / boundaries / protocol / 单测 / build / bundle 断言全绿。
- daemon：98 test files / 442 tests。
- web：67 test files / 304 tests。
- `pnpm pack:check`：通过。
- `apps/web/e2e/delivery.spec.ts`：交付看板 → 交付画布 → 快速标注层，1 passed。
- bundle 断言：主 chunk 不含 `@excalidraw/excalidraw`，`DrawingEditor-*` 懒加载 chunk 存在。

## 未通过 / 未完成

- `pnpm verify:full`：24 passed / 30 failed。失败为 M7 前旧 e2e 对三栏 shell、`board-rail`、右栏任务 tab 的断言；M7-3 已按 spec 改为“右栏只留总管 + 覆盖层”。
- ego-lite 截图、真实 Claude 需求阶段链路未执行。
- 标注 resolved 默认隐藏、单阶段 200 条上限、验收 overrideReason UI 未完成。

## 命令

```bash
pnpm verify
pnpm check:bundles
pnpm pack:check
pnpm exec playwright test apps/web/e2e/delivery.spec.ts
```
