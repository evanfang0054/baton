# Sprint Contract: M2-2b 移动端响应式控制台

> 关联 spec：`docs/specs/2026-11-19-m2-2b-mobile-console-design.md`
> 关联 ADR：`docs/adr/0007-mobile-control-console.md`
> 文档位置说明：本仓库 contract 落 `docs/contracts/`，不使用 `docs/agent-harness/contracts/`。

## Outcome（用户视角）

我离开电脑后，用手机打开 baton 就能看到哪些任务在等我；我可以审批、回复、验收，也可以开工、批量开工、建任务、和总管对话、改自动化设置、信任/创建工作区。手机上不出现画布，节点只能用列表选择和表单编辑。桌面和平板行为保持不变，手机上的每个动作都走现有状态机、命令和审计。

## Definition of Done

- [ ] **1. 响应式壳与断点**：新增 `apps/web/src/lib/use-viewport.ts`，返回 `mobile`（`<768`）/`compact`（`768–1023`）/`desktop`（`≥1024`）；用 `useSyncExternalStore` 订阅 `matchMedia`，无 `matchMedia` 时回退 `desktop`；单测覆盖三档与断点切换。`<768` 不渲染 `CanvasPanel`；`≥768` 渲染。`≥1024` 桌面结构、快捷键和现有 e2e 行为不变。
- [ ] **2. 移动导航与顶部栏**：`<768` 显示顶栏（workspace 切换、连接状态、自动化状态、更多菜单）和底部导航（看板/总管/汇报，`aria-current`，汇报未读圆点）；任务详情全屏、可返回看板；平板保留 rail + 画布，看板默认收起，右栏覆盖。
- [ ] **3. 移动看板**：待处理优先（`needs_approval`/`needs_reply`/`needs_review`/`needs_attention`）并显示计数与最长等待；进行中/待办/已完成分组（已完成默认折叠）；状态筛选 chips；任务卡显示状态、attention、等待时长；待办支持多选批量开工（单批 ≤20，逐条成功/失败报告）；空态提供“新建任务”和“让总管建任务”。
- [ ] **4. 任务详情与闸门**：审批 allow/deny、提问回复、验收通过/打回（打回必填反馈）；底部操作条支持开工、取消、停滞重新入队；审批/回复/验收动作在对应卡片内完成；transcript 只读、虚拟滚动、长会话尾部加载；上下文快照与自动化记录可见。
- [ ] **5. 建任务表单**：支持选择已有 Agent 或新建 Agent；上下文多选（排除目标）；标题、prompt、verify 命令、引擎、跳过权限（仅信任 workspace）；“创建”进 `todo`，“创建并开工”调用 `task.enqueue`；新建 Agent 走 `node.create` → `task.create`，任务失败保留节点并提示。
- [ ] **6. 节点列表与表单**：更多菜单提供节点列表（按类型分组、搜索）；text 创建/编辑 `content`；file 仅创建 `name`/`path`/可选 `mime`，已有 file 只读；agent 新建 `title`/`engine`，编辑只改 `title`；新节点使用默认网格位置；不提供删除、连线、image/group/review 创建或编辑。
- [ ] **7. 总管**：手机端全屏；composer 提供目标 Agent / 上下文选择器；发送 `supervisor.send` 带 `targetNodeId`/`contextNodeIds`；消息历史、流式文本、工具卡、建任务卡复用现有实现；建任务卡只打开任务，不自动开工；断线/重连流式状态正常。
- [ ] **8. 自动化与 kill switch**：移动端全屏设置弹窗；`autopilot.enabled`/`retryMax`/`autoApproveMaxRisk` 可编辑，allow/deny/verify/digestCron 只读，最近变更可见；未信任返回 409 并有提示；顶栏三态（运行中/已暂停/环境强制暂停）；暂停/恢复调用 `PUT /api/automation/kill-switch`，不杀运行中会话。
- [ ] **9. Workspace 动作**：支持切换、创建、信任/取消信任；信任/取消信任有明确确认与警告；切换后重置任务详情和移动 tab；未信任 workspace 不显示“跳过权限”。
- [ ] **10. 汇报**：底部导航“汇报”显示 digest 列表、未读/已读、历史、手动生成；摘要与桌面一致（待验收/待处理/已放弃、变化计数、最长等待、前 3 个 blocked）；未读圆点与已读状态一致。
- [ ] **11. 认证、远程与隐私**：继续使用 `/auth?token=` HttpOnly cookie；401/WS 4401 显示未认证横幅；不把 token 写入 localStorage；补 runbook（`BATON_HOST=0.0.0.0`、`BATON_TOKEN`、Tailscale/Caddy、token 轮换）；截图/文档不含 token、真实路径、用户名或主机名。
- [ ] **12. 错误与空态**：401、409 `workspace_untrusted`、404、表单校验、Agent 创建成功/任务失败、批量开工部分失败、WS 断线、空 workspace、无 Agent 节点均有明确提示；不引入静默失败。
- [ ] **13. 设计系统与可访问性**：`DESIGN.md` 增加断点、移动端间距、44px 触控尺寸、底部安全区；组件不硬编码 hex；图标按钮有 `aria-label`；底部导航有 `aria-current`；焦点可见；WCAG AA；状态不只靠颜色。
- [ ] **14. Playwright 多视口**：覆盖 `360×800`、`390×844`、`768×1024`、`1280×800`；移动端完成看板→详情→审批/回复/验收→开工/批量→建任务/节点→总管→设置/信任/工作区→digest；断言 `<768` 无画布 DOM；平板画布存在、看板默认收起；桌面现有 e2e 全量通过。
- [ ] **15. 真实链路**：ego-lite H5 视窗（`390×844`）+ 真实 daemon + 真实 Claude，完成“手机建任务（新建 Agent + 上下文）→ 开工 → 审批 → verify → 移动端验收”；截图脱敏，证据存 `docs/evidence/2026-11-19-m2-2b-mobile-console/`，附 README。
- [ ] **16. check:secrets 与收口命令**：gitleaks CLI（MIT）提供 `pnpm check:secrets`；一次性全历史基线 + CI 全历史扫描，命中失败；命中存量先报告/评估轮换，不改写历史后当作没发生；如进入锁文件则更新 `THIRD_PARTY_NOTICES.md`；`pnpm verify`、`pnpm verify:full`、`pnpm pack:check`、`check:boundaries`、`check:protocol`、`format:check` 全绿，CI 六项 checks（含 `secrets`）全绿。

## Boundary Conditions

- **必须支持**：`<768` 完整非画布控制面；`768–1023` 压缩桌面保留画布；`≥1024` 桌面不变；同一 `App`/`RealtimeProvider`/Query/Zustand/WS；现有 `/auth` cookie 与同一 token。
- **不得破坏**：桌面布局与快捷键；现有 Playwright e2e；`packages/protocol`、`apps/daemon`、SQLite schema；M2-2a 的 effective autopilot、trust、kill switch 语义；`task.status` 单一写入者与审计。
- **不得引入**：画布渲染/拖拽/连线/节点删除（手机）、image/group/review 节点表单、Web Push/外部通知、PWA/离线队列、只读 token scope、手机端登出端点、localStorage 敏感信息。
- **性能**：记录移动 bundle gzip 体积与 ego-lite H5 首屏表现；若移动 JS > 400KB gzip 或首屏 > 2s，作为 follow-up 触发 `React.lazy`，不作为本迭代阻塞项。
- **安全**：手机 token 拥有完整权限；文档明确手机丢失时轮换 `BATON_TOKEN` 并重启 daemon；截图/日志/文档脱敏。

## Acceptance Criteria

- **Computational**：
  - `pnpm verify`（每片）、`pnpm verify:full`、`pnpm pack:check`、`pnpm check:boundaries`、`pnpm check:protocol`、`pnpm format:check` 退出码 0。
  - `pnpm check:secrets` 退出码 0；CI `verify (22)`、`verify (24)`、`pack-check`、`e2e`、`build` 全绿。
  - Playwright 新增移动端用例通过；`<768` 断言无 `CanvasPanel` DOM；`≥768` 断言存在。
  - `apps/web` 单测覆盖 `useViewport`、移动看板/详情/表单/节点列表/总管 composer/设置/信任。
- **Inferential**：
  - 代码审查：响应式分支不改变 `≥1024` 结构；无协议/daemon/DB diff；无硬编码颜色/尺寸。
  - UX 审查：移动端截图检查触控尺寸、状态可读性、空态、错误提示、长 transcript。
  - 证据审查：`docs/evidence/2026-11-19-m2-2b-mobile-console/README.md` 记录真实 Claude 流程、截图清单、残留风险；截图脱敏。

## Negotiation Record

- **Generator（初稿）**：18 条 DoD，覆盖响应式壳、看板、详情、表单、节点、总管、设置、workspace、digest、认证、错误、设计系统、Playwright、真实 Claude、check:secrets。
- **Evaluator（第 1 轮挑战）**：
  1. “手机不显示画布”不能只靠视觉，必须断言 `<768` 无 `CanvasPanel` DOM、`≥768` 存在。
  2. “完整控制面”必须逐项列出允许/禁止动作，避免“像桌面一样”这种不可判定表述。
  3. “建任务”必须区分已有 Agent/新建 Agent，并定义两步失败后的行为。
  4. “节点表单”必须写清字段与不提供的操作（删除/连线/image/group/review）。
  5. “真实 Claude”必须写清流程、视窗尺寸与证据位置。
  6. “check:secrets”必须写清全历史基线 vs PR diff、命中后的处理，以及不得改写历史掩盖。
  7. “桌面不变”必须有可验证回归：现有 e2e + 多视口断言。
  8. “性能”不能写“明显退化”，必须给出记录项与 follow-up 阈值。
- **Generator（修订）**：合并为 16 条 DoD；补充 DOM 断言、动作白名单、两步失败行为、节点字段、真实链路步骤、gitleaks 范围、桌面回归、性能阈值。
- **Evaluator（第 2 轮）**：无进一步挑战；接受为最终 DoD。
