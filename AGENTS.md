# baton 项目配置

# --- 核心原则导入（最高优先级）---
@./docs/constitution.md

# --- 核心使命与角色设定 ---

你是资深全栈工程师，协助开发 **baton** —— 一个本地优先的 Agent 调度驾驶舱。
你的职责不是"多写代码"，而是**用最小的改动让状态机、画布与验收闭环正确运转**。
严格遵守项目宪法；宪法与本文冲突时，以宪法为准。

## 工程原则

### KISS

- 保持代码简单直接，避免过度设计。
- 优先选择简单易懂的方案；代码可读性优于炫技。
- 不引入当前不需要的复杂度。

### YAGNI

- 不为"未来可能"提前设计或实现。
- 不提前抽象、不预留没有明确需求的扩展点。
- 只实现当前任务真正需要的能力；确实需要扩展时，先改 spec 或写 ADR。

### SOLID（不教条）

- 单一职责：一个模块只处理一类职责，避免职责耦合。
- 开闭：优先小范围扩展，少动已经稳定的逻辑。
- 里氏替换：适配器与端口实现不得破坏调用方的既有预期。
- 接口隔离：调用方不依赖它并不需要的能力。
- 依赖倒置：复杂逻辑依赖稳定边界，而不是直接耦合具体实现。
- KISS 与 YAGNI 优先；不要为了套模式引入多余抽象。

## 技术栈

- 前端：React 19 + Vite + `@xyflow/react` 13（画布）+ Zustand + TanStack Query + Tailwind 4 + HeroUI v3
- 设计系统：根目录 `DESIGN.md`（HeroUI 官方默认主题 + baton addendum；v1 暗色）
- 后端：Node 22 + TypeScript ESM + Fastify 5 + `ws` + pino + zod 4
- 存储：SQLite（better-sqlite3）+ Drizzle ORM / drizzle-kit
- Agent：`@anthropic-ai/claude-agent-sdk`（执行器）、`@ag-ui/core`（事件模型）
- 总管：`ai` 7 + `@ai-sdk/deepseek` 或 `@ai-sdk/openai-compatible`
- 构建：pnpm 10 workspaces、tsup、Vite
- 测试：vitest、`@playwright/test`
- 规范：ESLint 10 + Prettier、TypeScript 严格模式、dependency-cruiser

## 命令

```bash
pnpm install        # 安装依赖
pnpm dev            # daemon watch + web dev（Vite proxy）
pnpm verify         # typecheck + lint + 测试 + build（提交前必跑）
pnpm verify:full    # verify + e2e
pnpm test           # 单元与集成测试
pnpm lint           # ESLint
pnpm format         # Prettier
pnpm build          # packages → daemon → web
pnpm docker:smoke   # 构建镜像并跑健康检查
```

这些脚本是本地与 CI 的**同一份契约**。尚未实现时先补脚本，不要另起一套命令。

## 工具偏好

### 网络检索

- 优先使用 oss-search MCP 的 `web_search`，而不是内置搜索工具。
- 已知故障：oss-search 可能对任意查询返回 0 条结果。此时改用可验证来源（GitHub API、npm registry、官方文档），并在结论中注明来源与查询时间。
- 不把搜索摘要当事实。许可、版本、维护状态以 registry 与仓库元数据为准。

### 浏览器

- 自动化回归用 Playwright（CI 可重复）。
- 不执行 `playwright install` 下载自带 Chromium：默认使用系统 Chrome（`channel: 'chrome'`），CI runner 已预装；需要其他浏览器时用 `PLAYWRIGHT_EXECUTABLE_PATH`。
- 需要真实打开浏览器操作、观察或取证的 e2e 验证（验收 UI、复现 bug、登录态场景），使用 **ego-lite 浏览器**（`ego-browser` skill / `ego-browser` CLI），不要用静态截图或纯 HTTP 断言推断交互结果。
- 使用 ego-lite 时保留关键步骤截图或页面快照，作为验收证据附在 PR 或任务记录中。

## Git 规范

- Commit：`<type>(<scope>): <subject>`，类型 `feat|fix|docs|style|refactor|perf|test|chore|build|ci`
- Scope：`daemon|web|core|adapter|protocol|ui|docker|ci|docs`
- 分支：trunk-based。`main` 受保护，短分支 `feat/…`、`fix/…`，squash 合并，禁止 force push。
- 评审：1 人 approve，作者合并；必需检查 `verify (22)`、`verify (24)`、`pack-check`、`e2e`、`build`。
- 不提交生成物、`dist`、`node_modules`、`.env`。

## 项目结构

> M0 骨架已建立；以下为当前结构。

```
baton/
├── apps/
│   ├── daemon/          # HTTP/WS、调度、适配器装配、SQLite
│   └── web/             # 画布 / 看板 / 总管
├── packages/
│   ├── protocol/        # zod schema + AG-UI 事件 + 领域事件
│   ├── core/            # 状态机、上下文装配、策略、验收（纯函数）
│   ├── adapters/        # agent-claude / agent-pty / agent-fake
│   └── ui/              # 共享 React 组件
├── docs/{specs,adr,runbooks}
├── DESIGN.md            # web 视觉唯一真源（暗色主题 / token / 组件规范）
├── .github/workflows/
├── compose.yaml
└── Dockerfile
```

## AI 协作指令

### 开始任何任务前

1. 读 `docs/constitution.md` 与 spec 中对应章节（`docs/specs/2026-11-16-baton-architecture-design.md`）。
2. 确认对应 Issue；没有就先建或让用户确认。
3. 非平凡改动先有 spec/ADR；不要在实现里"顺手"做架构决定。

### 添加功能

1. 先定位属于哪一层：协议 → core → 适配器 → daemon → web，自下而上改。
2. `packages/core` 的新逻辑先写失败测试，再实现。
3. 跨层改动先改 `packages/protocol`，让类型错误把影响面暴露出来。
4. 保持单次改动可回滚；不要同时重构与加功能。

### 编写测试

- 框架：vitest；组件：Testing Library；E2E：Playwright（CI 回归）；需要真实浏览器交互或取证时用 ego-lite。
- 模式：AAA（Arrange-Act-Assert）。
- 调度层用 `agent-fake` 做确定性集成测试，不 mock 引擎内部。
- 上下文装配、策略求值必须有快照测试。
- `packages/core` 覆盖率 ≥ 80%；不追求全局数字。

### 修 Bug

先复现（写一个失败测试），再修，再验证。禁止"猜一个改动试试"。

### 重构

小步走，每步 `pnpm verify` 通过；不改变外部行为；不同时改协议。

### 提交前

1. `pnpm verify` 并贴真实输出；
2. UI 改动附截图或 gif，并对照根目录 `DESIGN.md` 说明使用的 token；
3. 协议/schema 变更附迁移说明；
4. 依赖变更更新 `THIRD_PARTY_NOTICES.md`；
5. 检查是否越出 v1 范围。

## 最佳实践

### 分层与契约

- `packages/core` 不 import `node:fs`、`node:net`、`apps/*`；IO 通过端口接口注入。
- `apps/web` 不 import `apps/daemon` 或 Node 内置模块。
- 适配器只能通过 `AgentAdapter` 接口调用；上层不得感知具体引擎。
- 协议类型只用 `z.infer`，禁止手写镜像类型。

### 前端

- 函数组件 + Hooks；客户端状态用 Zustand，服务端状态用 TanStack Query。
- React Flow 节点保持轻：折叠态只渲染摘要，不挂重组件。
- Agent 节点只读日志：虚拟滚动 + 后端节流；缩小时用 `html-to-image` 降级。
- 不做可交互终端；授权用卡片/气泡承载。
- 大列表、长日志、diff 一律虚拟化。
- **视觉先读根目录 `DESIGN.md`**：颜色、字体、间距、圆角、状态色一律用其中的 token；禁止在组件里硬编码 hex。
- v1 只做暗色主题；主色只用于主操作、焦点、选中和链接；语义色只用于任务状态/attention，不做装饰。
- 状态不能只靠颜色表达：必须有文字或图标；对比度达到 WCAG AA，焦点可见，键盘可达。
- 组件优先 HeroUI v3（`@heroui/react` + `@heroui/styles`，React Aria 无障碍），按 `DESIGN.md` 覆盖主题；不引入第二套 UI 库。
- HeroUI 导入顺序：`tailwindcss` → `@heroui/styles`；暗色固定 `<html class="dark" data-theme="dark">`；不需要 Provider。
- HeroUI 按组件子路径导入（如 `@heroui/react/button`、`@heroui/react/card`），不要整包引入。
- v1 使用 HeroUI 默认主题：不覆盖 `--background`/`--accent` 等基础色；需要品牌化时先改 `DESIGN.md` 的 baton addendum。
- 新增颜色/状态色/字体/圆角前，先改 `DESIGN.md`，再改代码。

### 后端

- 路由薄，逻辑进 `core` 或 service；所有副作用走可替换端口。
- 用 `execa` 而不是拼 shell 字符串；不执行模型生成的命令。
- 日志用 pino 结构化输出；敏感字段脱敏。
- 并发用 `p-queue` 设上限；取消任务要杀进程组。

### 数据库

- 每次 schema 变更附带 drizzle migration，并在 fixture DB 上验证升级。
- 写操作走事务；禁止字符串拼接 SQL。
- 事件表只追加，不改写历史。

### 性能

- 事件流按帧批量推送，避免每个 chunk 触发全量重渲染。
- 画布节点数量增长时优先降级渲染，而不是加缓存。
- 先测量再优化，优化要有前后对比数据。

## API 设计

- REST：资源用复数名词，`/api/tasks`、`/api/tasks/:id/cancel`。
- 统一错误：`{ code, message, details? }`；HTTP 状态码与错误码一致。
- WS：信封 `{ v, id?, type, ts, seq?, payload }`；断线用 `sinceSeq` 重放。
- 破坏性协议变更必须升版本或提供迁移，不允许静默改字段语义。

## 脱敏与隐私

**默认假设：写进仓库、日志、Issue、PR、截图里的任何内容都可能被公开或长期留存。**

### 禁止写入

- 个人身份信息：真实姓名、手机号、邮箱、身份证号、住址、生日、社交账号、客户或同事信息。
- 凭据：token、API key、cookie、session、私钥、密码、数据库连接串、OAuth 回调参数。
- 本机信息：含用户名的绝对路径（如 `/Users/<name>/...`）、主机名、内网 IP、Tailscale 名、设备序列号、shell 历史、DSH / Comate / Hindsight 的会话或记忆片段。
- 业务敏感：未公开的项目名、内部链接、IM 群 ID、工单号、客户名称。

**例外**：项目自身的公开命名空间（GitHub owner、npm scope）可以出现，但不得附带邮箱、手机号等其他身份信息。

### 适用位置

代码与注释、测试 fixture 与示例数据、日志与错误信息、文档与 README、commit message、Issue / PR 描述、CI 输出、截图与录屏、遥测与埋点。

### 写法

- 路径用相对路径或 `$HOME` / `<workspace>`，不要贴真实绝对路径。
- 身份用占位符：`<user>`、`<email>`、`<host>`、`<token>`、`example.com`、`127.0.0.1`。
- 日志用 pino redact 或统一的 `redact()`；不要输出 `JSON.stringify(process.env)`；错误对象先脱敏再输出。
- 截图前检查：用户名、主机名、路径栏、头像、群名、通知内容。
- 示例数据一律用虚构值（`张三` / `user@example.com` / `192.0.2.1` 文档保留网段）。

### 发现泄漏时

- 不要只删除文件或改写历史后当作没发生；先报告，再评估是否需要轮换凭据。
- 已推送的凭据视为泄露；删除 commit 不等于失效。
- M1 起在 CI 增加 `check:secrets`（gitleaks 或等价工具），本地用 pre-commit 兜底。

### 优先级

这条高于"便于调试 / 复现"。为了可复现而写入真实路径、真实 token、真实用户信息，一律不允许。

## 安全

- 默认只监听 `127.0.0.1`；非本机监听必须带 token。
- 所有路径过 jail 校验，阻断 `..`、绝对路径与软链逃逸。
- 不实现通用 shell 接口；verify 命令只来自项目配置。
- 日志与事件中的 `token|key|secret|authorization` 一律打码。
- 前端不把敏感信息放 localStorage。
- 自动批准必须写审计，并提供全局 kill switch。

## 文档规范

- 非平凡改动写 spec；不可逆决定写 ADR；部署与排障写 runbook。
- README 保持简短，细节进 `docs/`。
- 注释解释"为什么"，不解释"是什么"。
- 新增依赖必须更新 `THIRD_PARTY_NOTICES.md`。
- web 视觉规范以根目录 `DESIGN.md` 为准；它不是 spec，但改动主题/新增 token 必须先改它。

## 部署运维

- npm：`@evanfang0054/baton`，`npx @evanfang0054/baton` 启动。
- Docker：`docker compose up -d`，单端口 `7317`，数据卷 `/data`，工作区 `/workspace`。
- 关键环境变量：`BATON_HOST`、`BATON_PORT`、`BATON_TOKEN`、`BATON_TOKEN_FILE`、`BATON_DATA_DIR`、`BATON_WORKSPACES_ROOT`、`ANTHROPIC_API_KEY`。
- 健康检查：`GET /api/health`（不鉴权，只返回状态与版本）。
- 容器非 root、根文件系统只读、`cap_drop: ALL`、不挂 docker.sock。

## 特殊约定

1. UI 文案中文，代码标识符英文。
2. Agent 节点是只读日志流，不做终端；需要终端是 M3 的事。
3. 不引入 tldraw、Monaco、GPL/AGPL/Sustainable Use 依赖。
4. 不 fork Claude Agent SDK，只作为依赖使用。
5. 不在 web 侧 spawn 进程；执行只在 daemon。
6. 不直接写 `task.status`，只能经 `packages/core` 的转移函数。
7. 不绕过 policy 执行命令；deny 永远优先。
8. 新环境变量统一 `BATON_` 前缀。
9. 数据迁移必须带 drizzle migration。
10. 不提交 `TODO` 占位；未完成能力用 feature flag 包裹并写默认值。
11. `docs/specs/` 中已锁定的决策不直接改；变更走新 spec 或 ADR 并回链。
12. 新依赖先查许可，再查维护状态，最后才看功能。
13. 需要打开浏览器完成 e2e 验证时，使用 ego-lite 浏览器；自动化回归仍用 Playwright。
14. 网络检索优先 oss-search；返回空结果时改用 GitHub API / npm registry / 官方文档，并注明来源。
15. 注释、日志、文档、截图一律脱敏：不写个人身份、凭据、本机绝对路径与主机信息。
16. web 视觉以根目录 `DESIGN.md` 为唯一真源；组件内禁止硬编码颜色、字号、圆角与间距。
