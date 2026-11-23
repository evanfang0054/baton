# M8 总管会话闸门卡回归证据

日期：2026-11-23

## 自动化用例

`apps/web/e2e/supervisor-gate-cards.spec.ts`

- 审批卡：mock 一条 `needs_approval` 任务，总管栏出现「待我处理 1」，展示任务标题、`Bash`、高风险、命令预览与等待时长；点「允许」后只发送一次 `approval.decide { approvalId: 'a1', decision: 'allow' }`。
- 验收卡：mock 一条 `needs_review` 任务，展示 `AC 2/3`、未过 1、退出码 1、diff 统计；点「通过」必须填写通过理由，确认后发送 `review.decide { reviewId, decision: 'approve', overrideReason: '已知风险' }`。
- 移动端：`390×844` 视口，从底部导航进入「总管」，闸门卡与理由输入可用。

运行命令：

```bash
M8_EVIDENCE_DIR="$PWD/docs/evidence/2026-11-22-m7-delivery" \
  pnpm exec playwright test apps/web/e2e/supervisor-gate-cards.spec.ts
```

结果：2 passed。

## 截图

- `m8-gate-approval-desktop.png`：桌面总管栏审批卡。
- `m8-gate-review-mobile.png`：移动端验收卡 + override 理由输入。

## 约束确认

- 卡片由 tasks/task detail 派生，未写入 supervisor message 表，也未新增 supervisor 工具。
- 动作复用现有 `approval.decide` / `review.decide`；总管仍无 approve/reject/resolve。
- WS 事件失效 tasks/task 查询后卡片自动出现/消失，无新增轮询。
