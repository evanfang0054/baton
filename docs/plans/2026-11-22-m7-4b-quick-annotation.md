---
spec_ref: ../specs/2026-11-22-m7-delivery-playbook-design.md
spec_topic: m7-delivery-playbook
task_count: 4
dod: "画布快速标注层：笔/高亮/橡皮/颜色/粗细/清空、快捷键、note/target、合成 PNG、创建标注"
status: active
depends_on: 2026-11-22-m7-3-web-shell-board-canvas.md, 2026-11-22-m7-4a-excalidraw-drawing.md
---

# M7 Plan 4b：快速标注层

- [x] `perfect-freehand` 笔迹路径 + bbox。
- [x] 画布内标注层：笔/高亮/橡皮、颜色、粗细、清空；`P/H/E`、`Esc`。
- [x] note 输入、合成 PNG（`html-to-image`，失败退化 1×1 PNG）、`POST annotations`。
- [x] 已有标注 bbox 叠加显示。
- [ ] resolved 默认隐藏开关、单阶段 200 条上限、debounce 更新、标注列表标记已处理/忽略。
- [ ] Playwright 标注链路。

## 已知偏离

- 标注目标暂归当前阶段（`targetNodeIds: []`），未做 bbox 命中节点/产物多选。
- 合成图失败时用 1×1 PNG 占位，保证服务端校验通过。
