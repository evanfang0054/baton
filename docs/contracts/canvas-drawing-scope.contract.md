# Sprint Contract: 画布与画板收敛

## User-visible Outcome

我打开一个项目，左栏只看到通知、项目和需求树；点需求就进入它唯一的一块画布。画板是主要内容工具：新建后能写文字、画流程、贴图；保存关闭后画布上直接看到缩略图，重新进来内容还在。总管跟着当前需求工作，能看到画板里的全部内容，也能替我创建画板、写说明、画图、插图片，缩略图会自动刷新；它改到我正在编辑的画板时会先提醒我。

## Definition of Done

- [ ] 左栏渲染「通知 N」+ 项目树；不存在「全部项目」「项目画布」入口；项目展开后显示「需求看板」「需求列表」「新建需求」；点项目名或箭头只展开/收起，不切换主区；需求列表按项目懒加载。
- [ ] 点击需求进入该需求画布；未选需求时主区显示空态；顶部无项目切换器，只读面包屑显示「项目 / 需求」；URL 含 `workspaceId + deliveryId`，刷新与深链恢复到同一画布。
- [ ] 用户可见导航/看板/创建对话框/阶段卡/提示语不再用「工作区」「交付」指代项目/需求；代码标识符、协议、文档内部命名不变。
- [ ] 画布工具栏只含画板、文件、分组、Agent、整理画布、投喂、快速标注、视口；不存在添加文本/添加图片按钮；画布不响应拖拽文件/图片；文件按钮仍能创建文件引用节点。
- [ ] 文本节点不能再手动新建；总管 `create_text`、任务结果节点、任务交接节点仍能创建文本节点，且正常显示、投喂与进入任务上下文。
- [ ] 需求画布新建画板 → 编辑文字/图形/图片 → 保存/关闭 → drawing 节点显示 PNG 缩略图；双击重开、刷新页面后内容完整；缩略图 URL 随保存版本更新。
- [ ] 模拟 source 读取失败或 JSON 损坏：画板显示错误与重试，不挂载可保存的空场景；关闭不写盘、不覆盖原文件。
- [ ] 编辑后 2 秒内发起 `mode='source'` 自动保存；保存单飞；失败显示重试并保留编辑内容；自动保存不写审计、不广播 `artifact.updated`、不改 `status/version`。
- [ ] 有未保存修改时关闭画板先执行 `mode='full'` 保存；保存失败不关闭且保留内容；提供「重试」与「放弃并关闭（二次确认）」；Esc 不直接关闭画板。
- [ ] 总管在当前需求画布调用 `get_drawing` 返回全部文字与元素（含元素 id、bounds），不返回 base64、`appState` 或绝对路径；`list_canvas` 默认当前需求，并能按 `deliveryId` 读取同项目其他需求。
- [ ] 总管 `create_drawing` 能创建 drawing 节点与 artifact；`update_drawing` 支持 `add_text`、`add_shape`、`add_arrow`、`add_line`、`add_freedraw`、`update_text`、`move_element`、`resize_element`、`delete_elements`、`set_style`、`set_title`；真实 Excalidraw 编辑器能打开并渲染生成的场景。
- [ ] 总管 `add_image` 能从工作区相对路径插入 png/jpeg/webp/gif/svg；越权路径、敏感路径、超限、不支持 MIME、远程 URL 均返回明确错误。
- [ ] 单次超过 50 个操作、单画板超过 500 个元素、单图片超过 5MB、源文件超过 10MB 时写入被拒绝；每个 artifact 串行写入；每次写入写审计 `drawing.update`。
- [ ] 总管写画板后 `artifact.updated.previewStale=true` 且 drawing 节点 `previewStale=true`；浏览器后台生成 PNG 并以 `mode='preview'` 保存；成功后节点 stale 清除、缩略图刷新；渲染失败显示「缩略图待刷新」，人打开画板后能恢复。
- [ ] 人正在编辑的画板被总管更新时出现冲突横幅；点「加载最新」后编辑器显示总管写入的文字/元素；「保留本地」不会强制覆盖。
- [ ] 画板节点可被选中投喂任务；任务上下文包含画板文字；注入记录与现有文本/文件一致；现有 context 快照除新增 drawing 外不变。
- [ ] 需求级标注、交付阶段、验收的现有测试全部通过；工作区级标注不再出现在 UI，`annotation` 表/API/图片保留。
- [ ] 通知区跨项目聚合注意力项；点击条目切到对应项目、需求、任务现场；无通知时显示「没有需要你处理的」。
- [ ] 不新增破坏性 migration；旧 workspace canvas 不出现在新 UI；未绑定需求的任务不出现在看板与总管；第 10 节重置 runbook 可执行。
- [ ] `pnpm verify`、`pnpm verify:full` 通过；`scripts/check-web-bundles.mjs` 确认 Excalidraw 不在主包；ego-lite 证据覆盖左栏、画板缩略图、重开内容、总管画板卡片、冲突横幅。

## Boundary Conditions

- Must support：桌面端项目树与需求画布；现有 delivery/stage/acceptance/annotation 流程；总管显式/自动模式；工作区路径 jail；单用户本地部署。
- Must not break：需求级标注行为；`task.status` 单写者与状态机；总管审批/验收权限边界；事件表只追加；现有 Playwright 回归；既不新增 DB migration，也不改变已有表结构。
- Performance：预览渲染并发 1、去重、跳过正在编辑的画板；自动保存 2s debounce + 单飞；画板 500 元素内可操作；Excalidraw 只走懒加载 chunk，不进主包；不新增高频轮询。
- Security：图片路径必须过 `resolveWithin` 与 `isSensitivePath`；只允许本地工作区相对路径，不抓远程 URL；MIME 与大小限制；总管输出不包含 base64、appState、绝对路径；日志与审计脱敏。

## Acceptance Criteria

- Computational：
  - `pnpm verify` 退出码 0。
  - `pnpm verify:full` 全部通过。
  - `scripts/check-web-bundles.mjs` 通过，主包不含 `@excalidraw/excalidraw`。
  - 定向测试：core `extractDrawingContent`/`applyDrawingOperations`；daemon artifact `mode` 分支、drawing 写入限制、图片插入 jail、attention 聚合；web ProjectTree、DrawingEditor 三态、预览渲染队列、冲突横幅。
  - e2e：项目 → 需求 → 画板完整链路；刷新持久化；总管创建/编辑画板；stale → preview 刷新。
- Inferential：
  - code review 确认总管写画板工具只落当前需求画布，且 prompt 不含图片 base64/远程抓取指令。
  - ego-lite 证据包含：左栏树、画板缩略图、重开内容、总管画板工具卡、冲突横幅。
  - 用真实 Excalidraw 编辑器打开总管生成的场景，人工确认文字/形状/箭头/图片/标签渲染正常。

## Negotiation Record

- Generator（第 1 轮）：提出六类宽泛标准——左栏导航正确、工具栏收敛、画板不丢内容、总管能读写画板、缩略图自动刷新、回归通过。
- Evaluator（第 1 轮挑战）：
  1. 「左栏正确」不可测 → 必须明确无「全部项目/项目画布」、点击行为、懒加载。
  2. 「画板不丢内容」边界不清 → 必须覆盖加载失败、自动保存、关闭 flush、放弃确认。
  3. 「总管能写画板」不可测 → 必须逐项列出操作、限制、图片路径/MIME、真实编辑器渲染。
  4. 「缩略图自动刷新」不可测 → 必须定义 `previewStale` 状态转换、`mode='preview'`、失败徽标、冲突提示。
  5. 「回归通过」不可复核 → 必须给出 verify 命令、bundle 检查、标注/阶段/验收套件。
  6. 「任务上下文」太模糊 → 必须明确画板文字进入上下文与投喂行为。
- Generator（第 2 轮）：按挑战改写为上方 20 条可二分判定标准，并补 Boundary/Acceptance。
- Evaluator（第 2 轮挑战）：
  1. 「用户可见文案不再用工作区/交付」范围过宽 → 限定为导航/看板/对话框/阶段卡/提示语；代码、协议、文档不算。
  2. 「浏览器后台生成」缺少观测点 → 要求测试队列状态与 e2e 的 stale→ready 转换。
  3. 「真实编辑器能渲染」缺少具体场景 → 要求包含文字、形状、箭头、图片、标签的固定 fixture。
  4. 「不新增破坏性 migration」需要证据 → 要求迁移测试或确认无新 migration 文件。
- Generator（第 3 轮）：把文案范围写入第 3 条；把队列断言写入第 14 条与 Acceptance；把固定 fixture 写入第 11 条；把「无新 migration 文件 + 旧库启动」写入第 19 条与 Acceptance。
- Evaluator（第 3 轮）：逐条可由测试或证据判定 yes/no；接受，无进一步挑战。
- Final consensus：以上 Definition of Done 为「画布与画板收敛」的完成定义。
