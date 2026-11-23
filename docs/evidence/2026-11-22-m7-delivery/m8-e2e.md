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
| protocol | 25 passed | 177 passed |
| adapters | 3 passed | 16 passed |
| core | 38 passed | 257 passed |
| daemon | 97 passed | 446 passed |
| web | 68 passed | 316 passed |

- build：daemon / web 构建通过
- bundle：`bundle check ok: main=index-*.js, excalidraw chunk present`
- migration 0016：升级、重开、旧 budget failure 重标记均通过（`migration-0016.test.ts`）

## Playwright

```text
Running 55 tests using 5 workers
55 passed (17.5s)
```

覆盖包括：

- `supervisor-gate-cards.spec.ts`：审批卡、验收 override、移动端
- `acceptance-evidence.spec.ts`：ReviewCard 证据 + AC override
- `supervisor-autonomy.spec.ts`：自动驾驶、kill switch、失败摘要
- 交付看板/画布、标注、实时、持久化、worktree、售后等既有场景

本轮无 flake；已知 `canvas-group` headless 拖拽偶发仍保留 retry 兜底。

## 本次修复后的重跑

- 首次 `verify:full` 因 `supervisor-tools.test.ts` 未过 Prettier 失败 → 格式化后重跑。
- 第二次因总管 prompt 长度超预算（3858 > 3840）失败 → 精简规则 20 后重跑。
- 第三次全绿（上述结果）。
