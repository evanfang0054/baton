# M7 交付工作台证据（2026-11-22）

## 已验证

- `pnpm verify`：typecheck / lint / format / boundaries / protocol / 单测 / build / bundle 断言全绿。
- daemon：98 test files / 442 tests。
- web：67 test files / 304 tests。
- `pnpm verify:full`：Playwright **54 passed**。
- `pnpm pack:check`：通过。
- bundle 断言：主 chunk 不含 `@excalidraw/excalidraw`，`DrawingEditor-*` 懒加载 chunk 存在。
- 新交付 e2e：交付看板 → 交付画布 → 快速标注层。

## 已知后置

- ego-lite 截图与真实 Claude 需求阶段链路未执行（需要本机 Claude 登录态与人工走查）。
- Excalidraw 画板的 Playwright 保存链路未单独覆盖；目前由 bundle 断言 + 类型/构建覆盖。
- 标注目标仍归当前阶段（未做 bbox 命中节点/产物多选）。
- 验收矩阵用 `window.prompt` 收集 overrideReason，后续可换 HeroUI Modal。

## 命令

```bash
pnpm verify
pnpm verify:full
pnpm pack:check
```
