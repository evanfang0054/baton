# 0012. 需求画布唯一与总管画板权限

- 状态：已采纳
- 日期：2026-11-24

## 背景

ADR 0011 把交付画布作为需求画布，但 workspace 画布仍作为 inbox/总览存在。实际产品里项目画布没有稳定职责：它和需求画布是两套画布、两套导航、两套总管作用域，导致“项目/需求”归属不可见、总管看不到需求画布、画板内容无法驱动执行。

可选方案：

1. **保留项目画布 + 需求画布（现状）**：两套画布并存，总管需要选择作用域；信息架构复杂，画板只在需求画布可用。
2. **项目画布只读归档，需求画布唯一**：旧 workspace 画布隐藏但保留数据；新工作全部在需求画布；总管只读需求画布。
3. **需求画布唯一 + 总管读写跟随当前需求 + 总管完整编辑画板**：画布是需求的工作面，总管是画板 agent。

## 决策

- **取消项目画布**：项目只是需求的容器；新 UI 不展示 workspace 画布；`canvas.delivery_id IS NULL` 行保留兼容，后续单独清理。
- **需求画布唯一**：每个 delivery 一张画布，沿用 ADR 0011；画板只按 `deliveryId + stageKey` 存储。
- **总管作用域跟随当前需求**：`supervisor.send` 带 `deliveryId/stageKey`；读写都落当前需求画布；任务绑定当前需求+阶段；无需求时只做项目级问答与建需求，画布工具明确报错。
- **总管拥有画板写权限**：新增 `create_drawing`/`update_drawing`/`get_drawing`；支持文字、形状、箭头、线条、自由笔迹、工作区图片插入、移动/缩放/删除/样式；写入串行、审计、限制数量与体积。
- **缩略图由浏览器后台生成**：服务端不引入 Excalidraw 渲染器；总管写源文件后 `previewStale=true`，前端用 `exportToBlob` 后台导出 PNG，以 `mode='preview'` 保存；人打开画板时兜底刷新。
- **旧数据不做迁移**：当前均为测试数据，按 runbook 重置；不写破坏性 migration，不自动删除旧数据。
- **文本节点保留为系统载体**：`create_text`、任务结果、任务交接继续使用文本节点；用户内容一律进画板。
- **标注系统保留**：需求级标注不变；工作区级标注随项目画布失去 UI 入口，表/API/图片保留。

## 后果

- 左栏变成「通知 + 项目树」；项目下只有需求看板、需求、新建需求；无「全部项目」、无项目画布。
- 总管不再有 workspace 画布 fallback；无需求时 canvas 工具返回 `canvas_not_found`。
- 画板成为总管可写的一等对象；prompt、工具 schema、审计、冲突提示都要适配。
- 画板写入与人类编辑按最后写入生效；前端提供冲突横幅，不做合并/锁。
- 预览渲染依赖浏览器；无浏览器时缩略图停留 stale，人打开画板后恢复。
- 该决定改变 ADR 0011 中「workspace 画布作为 inbox/总览」的部分；其余交付拥有画布的语义不变，以本 ADR + 新 spec 为准。

## 相关文档

- spec：`docs/specs/2026-11-24-canvas-drawing-scope-design.md`
- 前序 ADR：`docs/adr/0011-delivery-owned-canvas.md`
- M7 spec：`docs/specs/2026-11-22-m7-delivery-playbook-design.md`
- M2 总管：`docs/specs/2026-11-18-m2-supervisor-design.md`
