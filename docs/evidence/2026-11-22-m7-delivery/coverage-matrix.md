# M7 交付工作台全覆盖验收矩阵（2026-11-23）

本文件记录 M7 交付工作台的场景覆盖结果。交互场景使用 ego-lite 在本地 dev 环境执行；纯后端分支由 daemon/core 单测覆盖，避免把不可稳定复现的环境因素伪装成浏览器验收。

## 方法与夹具

- 浏览器：ego-lite，`http://localhost:5173`，真实 daemon（端口 7317）与真实 Claude Code。
- 夹具工作区：`coverage`，npm 项目，自带 `.baton/skills` 与 `.baton/playbooks`；`fail-verify` 标记可切换 verify 失败。
- 其他夹具：`untrusted`（未信任）、`empty`（空工作区）。
- 证据截图：`docs/evidence/2026-11-22-m7-delivery/scenarios/`。

## 场景矩阵

### 工作区与信任

- 未信任工作区打开时弹出「信任此工作区？」；点「取消」后保持未信任。
- 未信任状态下交付画布每个阶段显示 `（未信任）`，API 返回 `skillStatus=disabled_untrusted`。
- 未信任状态下自动化设置显示「先信任工作区，才能启用自动化」，自动驾驶/总管全权/保存均禁用。
- 已信任工作区顶部显示「已信任」与「撤销信任」入口。
- 空工作区显示「还没有交付」与「画布暂无内容」，不出现空态报错。

### 交付生命周期

- 新建交付：从工作区创建，自动生成独立画布与 4 个阶段，只创建第一阶段待办。
- 交付列表/看板：草稿、进行中、待我处理、已交付、已取消分组与计数正确。
- 交付画布：阶段分组、Agent 节点、产物节点、画板节点、标注计数可定位。
- 人工闸门推进：需求阶段人工通过后进入设计；设计阶段人工 override 通过后进入开发。
- 自动闸门：verify exit 0 自动推进；verify exit 1 阻断在评审，不进入下一阶段。
- 必产物守卫：`spec.md` 缺失时 advance/approve 返回 `artifact_missing`，UI 告警；补文件后可继续。
- 交付取消：`POST /api/deliveries/:id/cancel` 成功，交付状态变 `cancelled`；交付卡「停止交付」二次确认后调用同一接口，总管 `cancel_delivery` 首次返回 confirmation_required，阶段任务级联取消。
- 版本覆盖：画板保存两次后 `version=2`，`sourcePath/svgPath` 均落盘。

### 产物

- Agent 完成阶段后自动登记产物（task completion → artifact sync），不依赖手动刷新。
- 产物节点自动创建在对应阶段分组内；重复检查复用同一 artifact id，并按 artifactId/path 去重重复节点（单测）。
- 产物状态随阶段推进同步为 `accepted`，画布节点状态同步。
- Artifact Viewer：Markdown 文本、PNG 图片、HTML iframe 三种预览均可用。
- 画板：新建 → Excalidraw 绘制矩形 → 保存并关闭 → 生成 `.excalidraw + PNG + SVG` → 重新打开场景恢复（`drawing-editor-empty.png`、`drawing-editor-drawn.png`、`drawing-reopen.png`）。

### 验收与评审

- 验收矩阵：无 review 时只有关闭按钮，不展示通过/打回；显示用户故事、AC 空态、verify 命令、产物统计。
- 验收矩阵 overide：review 未决 + AC 为空 + verify exit 1 时，点「通过阶段」必须填写理由；理由写入命令 payload，通过后交付进入下一阶段/完成。
- 验收矩阵打回：发送 `review.decide` reject + `验收矩阵未通过`（单测）。
- 任务详情 ReviewCard：展示退出码、diff 统计、改动文件、验收报告；「查看改动」打开 diff 查看器（桌面与移动端）。
- ReviewCard override：零 AC / verify 失败时「通过」展开确认区，未填理由禁用「确认通过」，填写后可提交。
- ReviewCard 打回：必须先填反馈，确认后发送 reject（单测）。
- 交接节点：「生成交接节点」创建包含任务结果、产物、diff、handoff 事实的文本节点。

### 审批与自动化

- Write 审批：允许后会话继续；审批记录为 `allow/user`。
- Bash 高风险审批：拒绝后会话继续，审批记录为 `deny/user`。
- 移动端待审批：看板顶部计数、待审批分组、任务详情审批卡与拒绝/允许按钮一致。
- 自动驾驶：设置中开启后顶部显示「自动化运行中」；关闭后恢复「自动化关闭」。
- Kill switch：点「暂停自动化」后显示「自动化已暂停」；设置内「恢复自动化」恢复运行。
- 策略默认值：交付目录写入命中 allow；控制面 `.baton/policy.json`、skills、playbooks 写入 deny。
- verify 命令解析：任务命令 > 策略命令 > `package.json verify` > `package.json test` > fallback；npm 项目使用 `npm test`。

### 标注

- 快速标注：矩形高亮、画笔、橡皮、备注、保存；空备注允许保存。
- 标注列表：打开、定位节点、忽略；实时事件刷新计数。
- 标注注入：`task.create` 携带 `annotationIds` 时，任务 prompt 包含 `<annotations>`、bbox、阶段、截图路径；annotation.taskId 回写。
- 验收通过时解析该阶段任务关联的 open 标注（单测）。
- 当前没有 annotation 数量上限；限制是 strokes 2,000,000 字符与单图 10MB。

### 移动端

- 移动端壳：底部看板/总管/汇报导航，工作区与状态折叠到「更多」。
- 任务看板：待审批、待回复、待验收、需关注、进行中、待办、已完成、已取消分组。
- 任务详情：返回看板、历史、会话记录、底部主操作（立即开工/取消任务/重新打开）。
- 移动端审批允许/拒绝；移动端 diff 查看；移动端 ReviewCard override。
- 移动端总管 tab 显示未配置模型提示与输入框；汇报 tab 显示本轮汇报空态。
- Playwright 另覆盖移动端批量开工、暂停自动化、待验收通过/拒绝。

### 实时与持久化

- `delivery.updated`、`artifact.updated`、`annotation.updated`、`task.status` 触发 React Query 失效，侧栏与画布实时更新。
- 刷新页面后深链接（workspace + delivery）保持当前交付；画板重新打开从服务端加载。
- WebSocket 断线重连后由 `sinceSeq` 恢复（协议/既有 e2e 覆盖）。

### 总管

- 未配置 `supervisor.json` 时 UI 显示 `supervisor_unavailable` 与检查配置入口，不发送消息。
- 总管交付工具（create/list/get/enqueue/cancel delivery、list/get annotation）由 daemon 测试覆盖。
- 真实 deepseek-flash 总管已跑通完整链路：建交付、逐阶段开工、确认终态；审批与阶段闸门由人在总管栏闸门卡处理，总管 toolCalls 无 approve/reject/resolve。见 `m8-real-chain.md`。
- daemon 重启后 `waiting_input(stalled)` 任务可由总管 `enqueue_task` 重新入队；`question` 等待仍必须用 `reply_task`。

### M8 注意力与授权

- 工作区授权：已信任 + 自动驾驶开启 + kill switch 关闭时，`Write`/`Bash`/MCP 等非 deny 工具自动 allow，审计 `authority=workspace`；`rm -rf` 命中 deny 被拒。
- 审批闸门卡：`approval.request` 出现时总管栏展示工具、风险、输入预览，可允许/拒绝并写备注；动作只发送一次 `approval.decide`。
- 验收闸门卡：`review` 未决时展示 AC 计数、退出码、diff 统计；零 AC 或 verify 未过时必须填写理由，「确认通过」才可用。
- 交付取消：UI 停止交付 + 总管确认制工具 + 任务级联；取消后交付 `cancelled`，阶段不再推导为 running。
- Playwright：`supervisor-gate-cards.spec.ts` 覆盖桌面审批卡、验收 override、移动端布局；`m8-gate-cards.md` 附截图。

## 本轮发现并修复

1. 默认 policy 把 `.baton/**` 全部 deny，导致交付产物无法写入 → 收窄为控制面 deny，交付目录 allow。
2. Agent 写出的产物没有登记为 artifact → 任务完成、advance、auto-approve 前统一 sync。
3. 新建交付后任务看板仍显示 0 → 创建后失效 deliveries/tasks/canvas 缓存。
4. Web 不响应 delivery/artifact/annotation 事件 → RealtimeProvider 补齐失效。
5. verify 解析硬编码 `pnpm test`，npm 项目报 package manager 错误 → 按 packageManager 解析。
6. 画布没有 artifact 节点；重复检查产生重复节点 → 创建 artifact 节点并复用 id/去重。
7. 验收矩阵在零 AC + verify 失败时直接发送无理由 approve，且读取了错误的 acceptance 响应结构（`counts` 顶层）→ 改用 `report.acceptance` 与统一 override 规则，并补组件测试。

## 已知限制

- 验收矩阵 override 在任务详情入口仍使用 `window.prompt`；总管闸门卡已是内联输入区，交互尚未统一。
- `canvas-group` 拖拽在 headless 下偶发，Playwright retry 通过，仍是已知 flake。
- 闸门卡由前端从 task attention 派生，不写入总管消息/模型上下文；刷新后由查询重建。
- 阶段任务取消曾让交付推导为 running 并指向未创建的下一阶段；已修复为 cancelled，currentStageKey 为 null。
- 并发与预算耗尽未做压力级真实 Claude 验证；M8 已彻底移除金钱预算（任务预算、等待/提额、SDK 上限、成本展示），仅保留内部 session cost/turn 采集；migration 0016 删除 `task.budget_usd` 并把旧的预算等待任务恢复为 todo。
- 本轮真实验收使用 `BATON_CLAUDE_MAX_TURNS=60`，默认 30 对较重验收仍可能偏紧。
- 工作区授权是“所有非 deny”语义，host MCP 工具（如 chrome MCP，high risk）也会自动批准；按工具域收窄后置。
- REST 交付路由（cancel/enqueue/artifacts）没有 workspace 维度，仍按本地单工作区假设；总管工具已校验归属。
- `packageManager` 缺失时 verify runner 默认 pnpm；corepack 不可用的环境会失败，可后续按 lockfile 推断默认包管理器。
- 外部提醒推送（系统通知/IM）后置；本迭代只做应用内提醒。

## 回归结果

- `pnpm verify`：通过（typecheck / lint / format / boundaries / protocol / tests / build / bundle）。
- 单测：protocol 179、adapters 16、core 258、daemon 453、web 322，全部通过。
- `pnpm exec playwright test`：57 passed（本轮无 flake）。
- 定向 daemon 测试：`supervisor-tools` 含 stalled 重新入队、`migration-0016`、`delivery-advance` 全通过。
- 定向 web 测试：`SupervisorGateCards`、`AcceptanceMatrixOverlay`、`ReviewCard` 全通过。
- 真实链路：见 `m8-real-chain.md`；自动化门见 `m8-e2e.md`。
