---
spec_topic: annotation-text-and-acceptance-feedback
decision_summary: "快速标注新增文字工具，文字与笔画同存一条标注并合并进 note；验收清单保存/添加/只读状态补齐可见反馈"
design_approved: true
user_approved_at: 2026-11-24T13:20:00+08:00
gates: [design-approved, user-review-passed]
spec_ref: 2026-11-24-workspace-annotations-canvas-delete-design.md
domain_terms: [quick-annotation, text-annotation, acceptance-editor]
---

# 标注文字与验收清单反馈设计

> 子 spec。回链工作区标注设计：`docs/specs/2026-11-24-workspace-annotations-canvas-delete-design.md`。
> 不改 annotation 协议字段，不改验收契约状态机。

## 1. 背景

快速标注只有笔、高亮、橡皮，用户无法直接写文字备注；底部说明框只在有笔画时出现，纯文字标注无法保存。验收清单的“添加条目 / 重置 / 保存验收清单”缺少可见反馈：保存成功后无提示，冻结状态下按钮只是禁用，用户会以为点击无响应。

## 2. 决策

1. **文字工具**：QuickAnnotationLayer 新增 `text` 工具（工具栏“文字 T”，快捷键 `T`）。
   - 在画布上点击落一个文字锚点，原地输入；回车或失焦提交，Esc 取消。
   - 支持一条标注里多个文字锚点；文字工具下点击已有文字可继续编辑。
   - 橡皮会同时擦除命中区域的笔画和文字；清空会清掉笔画、文字与说明。
2. **持久化**：
   - `strokesJson` 写入 `{ strokes, texts }`，兼容旧数据只含 `strokes`。
   - 文字内容按顺序用“；”合并进 `annotation.note`，保证标注列表与总管 `list_annotations` 能直接读到。
   - 标注 bbox 取笔画与文字锚点的并集；纯文字标注允许保存，空标注仍拒绝。
3. **验收清单反馈**：
   - 保存成功后显示“已保存”并在右上角 toast “验收清单已保存”；保存中按钮显示“保存中…”。
   - 添加条目后自动聚焦新条目的验收条件输入框。
   - 契约非 draft 时显示“验收清单当前为只读，不能再修改。”，解释按钮为何不可用；任何编辑会清除“已保存”状态。

## 3. 非目标

- 不做富文本、文字拖拽、文字旋转或独立文字标注记录。
- 不新增 annotation 数据库字段或迁移。
- 不改变验收项数量/字数限制与 revision 冲突处理。

## 4. 验收

- 工作区/交付画布上可只用文字完成一条标注并保存；列表 note 出现文字内容，总管查询可见。
- 文字与笔画混合标注的 bbox 覆盖两者；橡皮能擦掉文字。
- 验收清单保存后出现“已保存”与成功 toast；添加条目后焦点落到新输入框。
- 冻结契约显示只读说明，按钮禁用原因可见。
- `pnpm verify` 通过；关键路径用 ego-lite 实测。
