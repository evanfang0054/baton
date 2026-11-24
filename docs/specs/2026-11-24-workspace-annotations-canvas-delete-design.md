---
spec_topic: workspace-annotations-canvas-delete
decision_summary: "快速标注从交付扩展到工作区画布：annotation.deliveryId/stageKey 可为空，工作区标注独立成账本并可被总管查询；画布节点与标注支持删除"
design_approved: true
user_approved_at: 2026-11-24T11:45:00+08:00
gates: [design-approved, user-review-passed]
spec_ref: 2026-11-22-m7-delivery-playbook-design.md
domain_terms: [workspace-annotation, annotation-scope, quick-annotation, node-delete]
---

# 工作区标注与画布删除设计

> 子 spec。回链 M7 交付工作台：`docs/specs/2026-11-22-m7-delivery-playbook-design.md`。
> 本次同时修复交付画布拖拽回弹与缺产物验收交互，不改变任务状态机与验收语义。

## 1. 背景

快速标注目前只挂在交付画布，数据模型强制 `annotation.delivery_id`、`stage_key` 非空，因此工作区画布无法标注。与此同时，交付画布拖拽分组后因为前端失效了错误的查询键（workspace canvas 而非 deliveryCanvas）而回弹；画布节点没有删除入口；标注只能“忽略”，不能删除。

## 2. 决策

1. **标注作用域**：`annotation.deliveryId` 与 `annotation.stageKey` 改为可空。
   - 二者都非空 = 交付阶段标注（行为不变）；
   - `deliveryId = null` = 工作区级标注，`stageKey = null`。
2. **API**：
   - `GET/POST /api/workspaces/:workspaceId/annotations`：列出/创建工作区标注；
   - `DELETE /api/annotations/:annotationId`：硬删除标注（交付与工作区通用），写 audit 并广播 `annotation.updated`；
   - 现有 `/api/deliveries/:deliveryId/annotations` 保持不变。
3. **存储**：工作区标注图片落 `.baton/annotations/<workspaceId>/<annotationId>.png`；交付标注仍落原路径。
4. **画布删除**：沿用节点详情面板的“删除节点”入口并二次确认；分组删除只解绑子节点；有任务引用的节点仍由后端拒绝。键盘 Delete 仍只删边，不直接删除节点。
5. **标注删除**：标注列表每行提供“删除”，调用 DELETE；不再用“忽略”冒充删除，忽略保留。
6. **总管可见**：`list_annotations` 工具在不传 deliveryId 时返回当前工作区级 open 标注，便于总管派活时引用。
7. **拖拽回弹**：交付画布刷新必须失效 `deliveryCanvas(workspaceId, deliveryId)`；workspace 画布继续失效 `canvas(workspaceId)`。

## 3. 非目标

- 不把工作区标注自动注入每个任务 prompt；由总管/人在派活时引用。
- 不做标注编辑历史与回收站；删除即删记录（图片文件保留在磁盘）。
- 不做工作区标注的验收矩阵关联。
- 不改变交付阶段标注进入 stage prompt 的既有逻辑。

## 4. 验收

- 迁移 0017 在旧库上升级成功，已有交付标注保持可读。
- 工作区画布可打开快速标注、保存后出现在标注列表；服务端记录 deliveryId/stageKey 为 null。
- 标注列表可删除；删除后列表与计数消失，`annotation.updated` 广播。
- 交付画布拖动分组/画板后位置保持，刷新不回弹。
- 验收缺产物时不再允许重复点“确认通过”，直接给出缺失文件与“打回并重新执行”。
- `pnpm verify` 通过；关键路径用 ego-lite 实测。
