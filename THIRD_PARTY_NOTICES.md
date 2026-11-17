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
| `fastify` / `@fastify/*` | MIT | HTTP 与 WebSocket 服务 |
| `pino` | MIT | 结构化日志与字段脱敏 |
| `better-sqlite3` | MIT | 本地存储 |
| `execa` / `simple-git` / `chokidar` / `croner` | MIT | 进程、Git、监听、定时 |
| `picomatch` | MIT | core 的 policy glob 匹配（直接依赖） |
| `react` / `react-dom` | MIT | 前端运行时 |
| `zod` | MIT | 契约校验 |

## 非 OSI 许可

| 组件 | 许可 | 说明 |
|---|---|---|
| `@anthropic-ai/claude-agent-sdk` | 见包内 LICENSE.md（非 OSI） | 仅作为运行时依赖使用，不 fork、不再分发其源码；其平台二进制包随 npm 依赖安装 |

## 仅参考、未复制代码

- `BloopAI/vibe-kanban`（Apache-2.0）：参考其 executor、worktree 隔离与 review 流程的设计。项目已进入停服期，不引入依赖、不复制代码。
- `answertsundere/dsh-canvas-plugin`（MIT）、`ljcoder2015/dsh-canvas-flow`（MIT）：参考其会话状态判定、流式渲染与卡片产物组织。
- `VoltAgent/awesome-design-md`（MIT）：参考并改写其 `design-md/linear.app/DESIGN.md` 的色板、排版与表面层级，生成根目录 `DESIGN.md`；未使用 Linear 品牌资产，不代表与 Linear 存在关联或背书。

如后续确实需要复制上述项目的代码片段，必须在提交中标注来源与许可，并更新本文件。
