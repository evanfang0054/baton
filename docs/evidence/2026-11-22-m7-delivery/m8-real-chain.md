# M8 真实链路证据：总管会话卡完成交付

日期：2026-11-24（跨机器休眠，实际连续操作约 25 分钟）
环境：真实 daemon + 真实 web + deepseek-flash 总管 + 本机 Claude Code 执行器

## 环境

```bash
BATON_DATA_DIR=/tmp/baton-m8-data \
BATON_WORKSPACES_ROOT=/tmp/baton-m8-workspaces \
BATON_CLAUDE_MAX_TURNS=60 \
pnpm dev
```

- 工作区 `demo` 已信任；autopilot 开启（`maxAutoApprovalsPerTask=100`）；kill switch 关闭。
- `GET /api/health` → `{"status":"ok"}`。
- `GET /api/supervisor/status` → `configured=true, model=deepseek-flash, mode=explicit`。
- fixture：`package.json` 提供 `verify` 脚本；`.baton/skills` 含 requirement-grooming / hi-fi-design / implement / acceptance。

## 第一次尝试（取消，保留为故障证据）

1. 总管创建交付 `6839cfd1` 并开工需求阶段。
2. 需求 agent 完成 spec 后进入 verify；fixture 未声明 `packageManager`，verify runner 默认 `pnpm run verify`，命中本机 corepack shim：corepack 试图拉取 pnpm 12.11.2 失败，verify 退出码 1，任务自动重试。
3. 期间 daemon 被宿主进程终止，任务停在 `verifying`；重启后 boot reconcile 正确收敛（`verifying → review(verify_fail 124)`）。
4. 处理：fixture 显式声明 `"packageManager": "npm@10.9.8"`，避免 corepack 下载；通过交付取消接口取消该条交付（同时验证了任务级联取消）。

## 第二次尝试（成功）

交付：`d76d6d73-ddd1-45d2-a7f8-eb7e3527c707`「极简登录页」
工作区：`2b371c78-38d8-4041-8e25-6500d3e88f6e`（demo）

### 时间线

| 时间 | 事件 | 证据 |
| --- | --- | --- |
| 16:17 | 总管 `create_delivery` + `enqueue_delivery`，需求阶段开工 | supervisor messages，2 个工具卡“完成” |
| 02:15:18 | daemon 重启对账后，需求任务为 `waiting_input(stalled)` | audit `approval.auto_allow`；任务历史 |
| 02:15:57 | 人工在总管栏通过需求验收（填 override 理由） | 截图 `m8-real-chain-requirement-gate.png` |
| 02:16 | 总管 `enqueue_delivery` 开工设计 | 交付进度 1/4 |
| 02:21:03 | 人工在总管栏通过设计验收 | 截图 `m8-real-chain-design-gate.png` |
| 02:21 | 总管 `enqueue_delivery` 开工开发 | 交付进度 2/4 |
| 02:23:41 | 开发阶段（自动闸门）verify 通过并自动通过 | audit `delivery.stage.auto_approve` |
| 02:24 | 总管 `enqueue_delivery` 开工验收 | 交付进度 3/4 |
| 02:28:54 | 人工在总管栏通过最终验收 | 截图 `m8-real-chain-acceptance-gate.png` |
| 02:29 | 总管确认终态：`status=done`，4/4，`attention=none` | 截图 `m8-real-chain-delivery-done.png` |

### 人只在总管栏操作

- 3 个人工闸门动作全部通过总管面板的「待我处理」卡片完成：`通过 → 填写通过理由 → 确认通过`；开发阶段由自动闸门放行。
- 未打开任务看板、任务详情或审批中心；未使用 API 代批。
- 阶段推进由总管 `enqueue_delivery` 完成；人在每阶段结束后只说一句“开工下一阶段”。

### 终态

```text
delivery d76d6d73「极简登录页」 status=done  progress=4/4  attention=none
  requirement done  (0b499a43)
  design      done  (1e870a3a)
  build       done  (4391950d, auto gate)
  acceptance  done  (b7b5a6c5)
```

产物：`spec.md`、`prototype.html`、`design.png`、`build-report.md`、`acceptance.md`（均 accepted）。

### 总管没有闸门权力

`GET /api/supervisor/messages?workspaceId=...` 汇总本工作区全部 assistant `toolCalls`：

```text
create_delivery, enqueue_delivery, list_deliveries, get_task,
get_task_history, reply_task, enqueue_task, get_delivery
```

- 不含 `approve` / `reject` / `resolve` / `review_decide` / `approval_decide`。
- 总管没有审批/验收工具；闸门只能由人通过卡片触发。

### 工作区授权审计

```text
approval.auto_allow  46 条，全部 authority=workspace
approval.auto_deny    1 条，matchedRule="Bash:rm -rf *"
```

- 自动批准覆盖 `Write`、`Bash`、`mcp__chrome-mcp-server__*` 等，包括 high risk。
- deny 规则仍然优先：设计 agent 尝试 `rm -rf` 被拒，未进入执行。
- 审计字段含 `approvalId` / `taskId` / `toolName` / `risk` / `policyVersion` / `authority`。

## 本次暴露并修复的问题

1. **stalled 任务无法由总管重新入队**：`enqueue_task` 只接受 `todo`，但重启对账会把运行中任务收敛为 `waiting_input(stalled)`；总管按提示调用 `reply_task` 失败后无路可走。
   - 修复：`enqueue_task` 接受 `todo` 或 `waiting_input(stalled)`；prompt 规则 20 明确 stalled 必须用 `enqueue_task`。
   - 测试：`supervisor-tools.test.ts` 新增 stalled 可入队、question 不可入队两条。
2. **fixture 默认包管理器触发 corepack 下载**：见第一次尝试；通过 fixture 显式 `packageManager` 规避，未改产品默认策略。
3. **测试环境进程被宿主回收**：真实链路跨了两段操作；daemon 重启对账把 `running → waiting_input(stalled)`、`verifying → review(verify_fail 124)`，没有产生僵尸任务。

## 已知限制

- 闸门卡是前端从 task attention 派生的视图，不写入总管消息/模型上下文；刷新后仍由查询重建。
- fixture 的 acceptance skill 只产出 `acceptance.md`，未填充机器验收清单；因此三处人工闸门都需要填写 override 理由。真实项目可用验收矩阵减少 override。
- 工作区授权是“所有非 deny”语义，host MCP 工具（如 chrome MCP，high risk）也会被自动批准；这是本迭代的明确选择，后续若需按工具域收窄，应新增策略维度。
- `packageManager` 缺失时 verify runner 默认 pnpm；在 corepack 不可用的环境会失败。建议后续按 lockfile 推断默认包管理器（未在本迭代实现）。

## 复现命令

```bash
# 环境
BATON_DATA_DIR=/tmp/baton-m8-data \
BATON_WORKSPACES_ROOT=/tmp/baton-m8-workspaces \
BATON_CLAUDE_MAX_TURNS=60 pnpm dev

# 状态
curl -s 'http://127.0.0.1:7317/api/deliveries?workspaceId=<workspace>'
curl -s 'http://127.0.0.1:7317/api/supervisor/messages?workspaceId=<workspace>'

# 审计
sqlite3 /tmp/baton-m8-data/baton.db \
  "select action, json_extract(detail_json,'\$.authority'), count(*) from audit where action like 'approval%' group by 1,2;"
```
