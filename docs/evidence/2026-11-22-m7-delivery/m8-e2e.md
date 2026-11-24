# M8 自动化门结果（2026-11-24）

## 命令

```bash
pnpm verify:full
```

## `pnpm verify`

逐项通过：

- typecheck：protocol / core / adapters / daemon / web 全部 Done
- lint：ESLint 通过
- format：Prettier `--check` 通过
- boundaries + selftest + protocol：通过
- 单测：

| workspace | 文件 | 用例 |
| --- | --- | --- |
| protocol | 25 passed | 179 passed |
| adapters | 3 passed | 16 passed |
| core | 38 passed | 258 passed |
| daemon | 97 passed | 453 passed |
| web | 68 passed | 322 passed |

- build：daemon / web 构建通过
- bundle：`bundle check ok: main=index-*.js, excalidraw chunk present`
- migration 0016：升级、重开、旧 budget failure 重标记均通过（`migration-0016.test.ts`）

## Playwright

```text
Running 57 tests using 5 workers
57 passed (18.6s)
```

覆盖包括：

- `supervisor-gate-cards.spec.ts`：审批卡允许/拒绝、验收 override、AC/diff 展示、处理后卡片消失、移动端
- `delivery.spec.ts`：交付看板/画布、快速标注、停止交付二次确认与取消请求
- `acceptance-evidence.spec.ts`：ReviewCard 证据 + AC override
- `supervisor-autonomy.spec.ts`：自动驾驶、kill switch、失败摘要
- 交付看板/画布、标注、实时、持久化、worktree、售后等既有场景

本轮无 flake；已知 `canvas-group` headless 拖拽偶发仍保留 retry 兜底。

## 本次修复后的重跑

- 首次 `verify:full` 因 `supervisor-tools.test.ts` 未过 Prettier 失败 → 格式化后重跑。
- 第二次因总管 prompt 长度超预算（3858 > 3840）失败 → 精简规则 20 后重跑。
- 第三次全绿（上述结果）。

## Code Review 后续修复

- 取消交付：done 不可取消；HTTP 先取消阶段任务再落交付；总管检查级联返回值；审计 actor 改为 supervisor。
- 授权：workspace authority 不再受 `maxAutoApprovalsPerTask` 限制；`enqueue_delivery` 补自动化门；交付工具校验 workspace 归属。
- 契约：任务详情/历史 API 使用 `SessionView`，不再返回 `costUsd/turns`；旧 digest 的 budget 计数按忽略兼容。
- 闸门卡：排除 `AskUserQuestion`；计数不再被 slice 截断；动作成功后本地隐藏；拒绝/AC/diff/消失补 Playwright。
- UI/文档：交付卡改为覆盖按钮避免嵌套 button；停止交付改用 HeroUI 确认框；新组件字号改 token；风险映射复用；清理预算/成本残留文案与 runbook。
- 测试：新增 done 取消拒绝、级联保留 artifact/annotation、cap 跳过、旧 digest、归属校验、取消交付 E2E、闸门 deny/消失。

## 第二轮 Review 修复

- 取消态闭环：`enqueueDelivery`/`advanceDelivery`/`maybeAutoApprove` 拒绝 `cancelledAt` 非空的交付；retry/reopen 拒绝已取消交付的任务；级联失败写日志，HTTP/总管可补写 `cancelledAt` 并保留人工/总管审计。
- 旧 digest：`items[].kind='budget'` 降级为 stale，不再让整条摘要解析失败。
- 归属：`list_annotations`/`get_annotation` 校验 workspace；`delivery_not_cancellable` 等错误码映射 409。
- UI：闸门卡计数按实际卡片、失败 toast + 回滚、HeroUI Input/边框；交付卡停止按钮统一 HeroUI；TaskBoard 复用 ConfirmDialog；交付查询失效抽 helper。
- 计划与证据：M8-1/2/3 勾选完成步骤；`m8-gate-cards.md` 更新为 3 passed；`BATON_M8_EVIDENCE_DIR` 统一前缀。
