# M7 交付工作台证据（2026-11-22）

## 已验证

- `pnpm verify`：typecheck / lint / format / boundaries / protocol / 单测 / build / bundle 断言全绿。
- daemon：98 test files / 443 tests。
- web：67 test files / 305 tests。
- Playwright：53 passed + 1 flaky（`canvas-group` 拖拽，失败重试后仍偶发；已计入已知 flake）。
- `pnpm pack:check`：通过。
- bundle 断言：主 chunk 不含 `@excalidraw/excalidraw`，`DrawingEditor-*` 懒加载 chunk 存在。
- 新交付 e2e：交付看板 → 交付画布 → 快速标注层。
- 真实 Claude 全链路：4 阶段全部完成，验收 A1–A8 全 PASS，见 [`real-chain/README.md`](real-chain/README.md)。
- 全场景覆盖矩阵：工作区信任、交付推进/取消、产物/画板、验收矩阵、ReviewCard、审批、自动化、标注、移动端、实时事件，见 [`coverage-matrix.md`](coverage-matrix.md)。

## 已知后置

- `canvas-group` 拖拽在 headless 下偶发，已用 retry 兜底；后续可改成分帧驱动或等待 move 命令稳定。
- Excalidraw 画板的 Playwright 保存链路未单独覆盖；ego-lite 已手工覆盖新建/保存/重开，见 `coverage-matrix.md`。
- 交付取消只有 API，没有 UI 控件。
- 验收矩阵用 `window.prompt` 收集 overrideReason，后续可换 HeroUI Modal。
- 浏览器实测较重的验收阶段会接近默认 `claudeMaxTurns=30`；本次真实验收用 `BATON_CLAUDE_MAX_TURNS=60` 完成。

## 命令

```bash
pnpm verify
pnpm verify:full
pnpm pack:check
```
