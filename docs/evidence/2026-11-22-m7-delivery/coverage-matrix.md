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
- 交付取消：`POST /api/deliveries/:id/cancel` 成功，交付状态变 `cancelled`，UI 显示「已取消」；当前产品没有交付取消的 UI 控件（已知缺口）。
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
- 任务详情：返回看板、预算、历史、会话记录、底部主操作（立即开工/取消任务/重新打开）。
- 移动端审批允许/拒绝；移动端 diff 查看；移动端 ReviewCard override。
- 移动端总管 tab 显示未配置模型提示与输入框；汇报 tab 显示本轮汇报空态。
- Playwright 另覆盖移动端批量开工、暂停自动化、待验收通过/拒绝。

### 实时与持久化

- `delivery.updated`、`artifact.updated`、`annotation.updated`、`task.status` 触发 React Query 失效，侧栏与画布实时更新。
- 刷新页面后深链接（workspace + delivery）保持当前交付；画板重新打开从服务端加载。
- WebSocket 断线重连后由 `sinceSeq` 恢复（协议/既有 e2e 覆盖）。

### 总管

- 未配置 `supervisor.json` 时 UI 显示 `supervisor_unavailable` 与检查配置入口，不发送消息。
- 总管交付工具（create/list/get/enqueue delivery、list/get annotation）由 `apps/daemon/test/supervisor-delivery-tools.test.ts` 覆盖（4 tests）。
- 总管真实对话未在本环境执行：缺少模型配置，属于环境限制，不是产品分支遗漏。

## 本轮发现并修复

1. 默认 policy 把 `.baton/**` 全部 deny，导致交付产物无法写入 → 收窄为控制面 deny，交付目录 allow。
2. Agent 写出的产物没有登记为 artifact → 任务完成、advance、auto-approve 前统一 sync。
3. 新建交付后任务看板仍显示 0 → 创建后失效 deliveries/tasks/canvas 缓存。
4. Web 不响应 delivery/artifact/annotation 事件 → RealtimeProvider 补齐失效。
5. verify 解析硬编码 `pnpm test`，npm 项目报 package manager 错误 → 按 packageManager 解析。
6. 画布没有 artifact 节点；重复检查产生重复节点 → 创建 artifact 节点并复用 id/去重。
7. 验收矩阵在零 AC + verify 失败时直接发送无理由 approve，且读取了错误的 acceptance 响应结构（`counts` 顶层）→ 改用 `report.acceptance` 与统一 override 规则，并补组件测试。

## 已知限制

- 交付取消只有 API，没有 UI 控件。
- 验收矩阵 override 仍使用 `window.prompt`，交互一致性弱于 ReviewCard 的内联确认区。
- `canvas-group` 拖拽在 headless 下偶发，Playwright retry 通过，仍是已知 flake。
- 总管真实链路已用 deepseek-flash 跑过：能建交付/开工，但工具审批与阶段闸门必须人工在任务详情完成，不能只靠总管闭环；详见 `supervisor-only-flow.md`。
- 阶段任务取消曾让交付推导为 running 并指向未创建的下一阶段；已修复为 cancelled，currentStageKey 为 null。
- 并发与预算耗尽未做压力级真实 Claude 验证；任务预算的预先设置入口已移除，保留全局成本上限与超预算提额恢复。
- 本轮真实验收使用 `BATON_CLAUDE_MAX_TURNS=60`，默认 30 对较重验收仍可能偏紧。

## 回归结果

- `pnpm verify`：通过（typecheck / lint / format / boundaries / protocol / tests / build / bundle）。
- `pnpm exec playwright test`：53 passed，`canvas-group` 1 flaky（retry 通过）。
- 定向 daemon 测试：`supervisor-delivery-tools` 4、`artifact-service` 3、`delivery-advance` 3 全通过。
- 定向 web 测试：`AcceptanceMatrixOverlay` 3、`ReviewCard` 8 全通过。
