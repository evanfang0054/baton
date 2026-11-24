---
spec_topic: annotation-anchoring-display
decision_summary: "标注 bbox 改为 React Flow 世界坐标，保存后常驻画布；保存时按圈选重叠度自动绑定目标节点，总管/任务上下文返回目标标题与相对圈选区域"
design_approved: true
user_approved_at: 2026-11-24T14:20:00+08:00
gates: [design-approved, user-review-passed]
spec_ref: 2026-11-24-annotation-text-and-acceptance-feedback-design.md
domain_terms: [annotation-anchor, coordinate-space, annotation-region, saved-annotation-overlay]
---

# 标注定位与常驻显示设计

> 子 spec。回链标注文字与工作区标注设计：
> `docs/specs/2026-11-24-annotation-text-and-acceptance-feedback-design.md`、
> `docs/specs/2026-11-24-workspace-annotations-canvas-delete-design.md`。

## 1. 背景

标注保存后只在标注列表里可见，画布上完全没有反馈；总管只能拿到抽象 bbox，`targetNodeIds` 又是空数组，所以无法判断用户圈的是图片、文档还是某个 Agent 节点，更不知道圈在节点里的哪一块。

根因有两点：

1. 标注 bbox 是创建时画布视口里的屏幕坐标，平移/缩放后无法还原，也不能直接和节点世界坐标比较。
2. 创建标注时没有把圈选区域与画布节点关联。

## 2. 决策

1. **坐标空间**：新标注的 `bbox` 以 React Flow 世界坐标保存，`strokesJson` 同时保存创建时 `viewport` 与 `coordinateSpace: "flow"`。
   - 服务端从 `strokesJson` 派生 `AnnotationSummary.coordinateSpace`，不改数据库字段。
   - 旧数据没有该字段，按 `screen` 处理，保持可读；旧数据不回溯改坐标。
2. **常驻显示**：`SavedAnnotationOverlay` 挂在画布上，使用当前 React Flow viewport 把 flow bbox 转回屏幕坐标，平移/缩放时跟随节点。
   - 通过 `GET /api/annotations/:id` 读取完整笔画，按保存时的 viewport 投影到当前视口重绘笔画与文字锚点。
   - 没有笔画/文字的旧数据或读取失败时，退化为虚线区域框 + note 文本。
   - 快速标注层内也按同一规则换算已有标注。
3. **目标绑定**：保存时按圈选 bbox 与 `.react-flow__node` 屏幕矩形的重叠面积计算比例，保留重叠 ≥ 35% 的节点，按比例降序最多 5 个。
   - 避免边缘擦到的大分组抢走真正被圈的图片/文档节点。
   - `targetNodeIds` 仍走现有服务端校验。
4. **总管/任务上下文**：
   - `list_annotations` / `get_annotation` 返回 `targets: [{ id, type, title, region }]`。
   - `region` 是圈选区域相对目标节点的百分比（x/y/w/h，0-100），仅在 flow 坐标下计算。
   - 任务 prompt 的 `<annotation>` 增加 `region="x,y,w,h"`，`target` 使用节点标题；图片节点可用 `alt` 作为标题。
5. **兼容**：不改 annotation 表结构、不做迁移；新增只读 `GET /api/annotations/:id` 供画布重绘笔画，总管工具仍只拿 summary。

## 3. 非目标

- 不回溯修正旧标注的坐标或目标节点；旧 screen 数据只按原坐标兜底。
- 不做多个圈选区域拆分为多条标注。

## 4. 验收

- 保存画圈/文字标注后，画布立即出现虚线区域与备注；缩放、平移后位置仍贴合被圈节点。
- 圈选图片时 `targetNodeIds` 命中图片节点，`targets[0]` 返回图片名与相对区域。
- 总管 `list_annotations` 能直接回答“圈的是哪张图/文档的哪一块”，任务 prompt 含 `region`。
- 旧标注仍可显示、删除；不因坐标空间变化报错。
- `pnpm verify` 通过；关键路径用 ego-lite 实测。
