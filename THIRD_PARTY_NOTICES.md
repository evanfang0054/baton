# Third-Party Notices

baton 以 MIT 许可发布。运行时会依赖下列第三方组件，其许可与版权归各自作者所有。
本文件随依赖变更同步更新；发布前由 `pnpm notices:check` 校验完整性。

## 需要保留声明的主要依赖

| 组件 | 许可 | 用途 |
|---|---|---|
| `ai` / `@ai-sdk/*`（Vercel） | Apache-2.0 | 总管 tool-calling 循环与模型接入 |
| `streamdown`（Vercel） | Apache-2.0 | 流式 Markdown 渲染 |
| `drizzle-orm` | Apache-2.0 | ORM |
| `@openai/codex-sdk` | Apache-2.0 | Codex 适配器（M2） |
| `@playwright/test` | Apache-2.0 | 端到端测试（仅开发依赖） |
| `@vitest/coverage-v8` | MIT | 单元测试覆盖率（仅开发依赖） |
| `@types/picomatch` | MIT | picomatch 类型声明（仅开发依赖） |
| `@ag-ui/core` | MIT | Agent 事件模型 |
| `@assistant-ui/react` | MIT | 总管聊天界面 |
| `@xyflow/react` | MIT | 画布引擎 |
| `@heroui/react` / `@heroui/styles` | Apache-2.0 | React 19 组件库、Tailwind 4 主题与样式 |
| `react-aria` / `react-aria-components` / `@react-aria/*` / `@internationalized/date` | Apache-2.0 | HeroUI 的无障碍交互与日期基础（传递依赖） |
| `@radix-ui/react-avatar` / `input-otp` / `tailwind-variants` / `tw-animate-css` | MIT | HeroUI 的传递依赖 |
| `fastify` / `@fastify/*` | MIT | HTTP 与 WebSocket 服务 |
| `pino` | MIT | 结构化日志与字段脱敏 |
| `better-sqlite3` | MIT | 本地存储 |
| `execa` / `simple-git` / `chokidar` | MIT | 进程、Git、监听 |
| `picomatch` | MIT | core 的 policy glob 匹配（直接依赖） |
| `@modelcontextprotocol/sdk` | MIT | in-process MCP server（`baton_report`），与 Claude Agent SDK 配套 |
| `react` / `react-dom` | MIT | 前端运行时 |
| `@tanstack/react-query` | MIT | 服务端状态与缓存 |
| `@tanstack/react-virtual` | MIT | transcript 长列表虚拟滚动 |
| `zustand` | MIT | 客户端 UI 状态 |
| `lucide-react` | ISC | 图标 |
| `tailwindcss` / `@tailwindcss/vite` | MIT | Tailwind 4 样式与 Vite 插件 |
| `@testing-library/react` / `@testing-library/jest-dom` / `@testing-library/user-event` | MIT | 组件测试（仅开发依赖） |
| `jsdom` | MIT | 组件测试 DOM（仅开发依赖） |
| `zod` | MIT | 契约校验 |

## 非 OSI 许可

| 组件 | 许可 | 说明 |
|---|---|---|
| `@anthropic-ai/claude-agent-sdk@0.3.327` | 见包内 LICENSE.md（非 OSI） | 仅作为运行时依赖使用，不 fork、不再分发其源码；其平台二进制包随 npm 依赖安装 |

## 开发与 CI 工具

| 组件 | 许可 | 用途 |
|---|---|---|
| `gitleaks` | MIT | 仓库密钥扫描；仅开发/CI 使用，不随包分发 |

## 文档与设计资产

| 资产 | 许可 | 说明 |
|---|---|---|
| HeroUI 官方 `DESIGN.md` | Apache-2.0 | 根目录 `DESIGN.md` 的官方部分来自 HeroUI v3 DESIGN.md；baton addendum 为自研 |

## 仅参考、未复制代码

- `BloopAI/vibe-kanban`（Apache-2.0）：参考其 executor、worktree 隔离与 review 流程的设计。项目已进入停服期，不引入依赖、不复制代码。
- `answertsundere/dsh-canvas-plugin`（MIT）、`ljcoder2015/dsh-canvas-flow`（MIT）：参考其会话状态判定、流式渲染与卡片产物组织。

如后续确实需要复制上述项目的代码片段，必须在提交中标注来源与许可，并更新本文件。
