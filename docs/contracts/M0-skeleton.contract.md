# Sprint Contract: M0 骨架

## Outcome（用户视角）

第一周结束时，我在一台干净机器上只做三件事：`pnpm install`、`pnpm verify`、`npx @evanfang0054/baton`，就能打开一个本地页面，看到左侧看板、中间空画布、右侧总管三栏；换到服务器上，`docker compose up -d` 起的是同一个东西，并且能通过健康检查。之后每加一个功能，都有可运行的壳和一条会真正拦住回归的流水线，而不是先堆代码再补基础设施。

## Definition of Done

- [ ] **1. 安装可复现**：干净目录执行 `pnpm install --frozen-lockfile` 成功，结束后 `git diff --exit-code pnpm-lock.yaml` 为空。
- [ ] **2. 一条命令自检**：`pnpm verify` 完成 typecheck + lint + 单元测试 + build，退出码 0；任一子步骤失败即非 0。
- [ ] **3. 生产构建可启动**：`pnpm build && node apps/daemon/dist/index.js` 启动后，`GET /api/health` 返回 200，body 含 `status: "ok"` 与 `version`。
- [ ] **4. 打包链路可用**：`pnpm pack:check` 完成 `npm pack` → 临时目录安装 tarball → 启动 → `/api/health` 通过 → 退出码 0。
- [ ] **5. 三栏壳可见**：Playwright 断言首屏存在 `data-testid="kanban"`、`data-testid="canvas"`、`data-testid="supervisor"` 三个区域，且页面无 console error。
- [ ] **6. WS 通路与鉴权**：带有效 token 连接 `/ws`，发送 `ping` 收到 `pong`；不带 token 的连接在 5 秒内被服务端以关闭码 `4401` 关闭。
- [ ] **7. 监听地址约束**：默认 `127.0.0.1` 无需 token 即可启动；`--host 0.0.0.0` 且无 token 时进程以退出码 `1` 结束，并打印包含 `BATON_TOKEN` 的错误。
- [ ] **8. 存储初始化幂等**：空数据目录启动时自动建库并应用迁移；连续启动两次均成功，第二次前后 `sqlite_master` 导出完全一致。
- [ ] **9. 分层规则真的会拦人**：`pnpm check:boundaries` 通过；仓库内负向 fixture（临时在 `packages/core` 写入 `import 'node:fs'`）会让该命令以非 0 退出，恢复后再次通过。
- [ ] **10. 协议单一真源**：`packages/protocol` 至少导出 `health` 与 `ws.ping` 两个 zod schema，daemon 与 web 均从该包取类型；手写重复类型会触发 tsc 错误（负向 fixture 验证）。
- [ ] **11. 容器可部署**：`docker build` 成功；容器内 `id -u` 不为 0；容器内健康检查通过；`docker image inspect` 的未压缩体积 ≤ 700MB。
- [ ] **12. CI 三道闸**：PR 上 `verify (22)`、`verify (24)`、`e2e`、`build` 均通过；`main` 的 required checks 包含这四项，以 `gh api` 查询结果为证。
- [ ] **13. 文档能自助**：README 给出 dev / pack / docker 三种启动方式；`docs/runbooks/docker.md` 说明 token、数据卷、工作区挂载与常见失败。

## Boundary Conditions

- **Must support**：本地 Node 22；容器 Linux amd64 与 arm64；单端口 `7317`；SQLite 单文件。
- **Must not break**：M0 无历史版本；但不得引入 spec 的非目标能力（DSH 插件、外部触发器、向量库、真终端、多用户、DAG）。
- **Performance**：冷启动到 `/api/health` 可访问 ≤ 5 秒（本机）；单次 e2e ≤ 60 秒。
- **Security**：默认只听 `127.0.0.1`；容器非 root、根文件系统只读、`cap_drop: ALL`；不挂 docker.sock。

## Acceptance Criteria

- **Computational（全部进 CI，作为 required check）**：`pnpm verify`、`pnpm pack:check`、`pnpm check:boundaries`（含负向 fixture）、`pnpm exec playwright test`、`docker build` + 容器健康检查 + `id -u` 断言。
- **Inferential（人工评审一次）**：新人只读 README 与 docker runbook 能否在 15 分钟内跑起来；三栏布局是否与 spec 2.2 一致。

## Negotiation Record

- **Generator（初版）**：14 条，包含"打开浏览器看到三栏""空画布可缩放拖拽""npx 启动"等表述。
- **Evaluator（挑战）**：
  - "看到三栏"不可判定 → 改为 Playwright 对三个 `data-testid` 的断言，并要求无 console error。
  - "空画布可缩放"无法稳定断言，且不属于 M0 价值 → 降级为"画布区域挂载"，缩放交互留给 M1。
  - "npx 启动"在未发布前不可验证 → 改为 `pnpm pack:check` 的真实安装链路。
  - "首页 200"不够严格 → 改为生产构建启动 + health body 断言，避免 dev server 掩盖问题。
  - 补充三个缺失的失败面：无 token 监听 `0.0.0.0` 必须非 0 退出、迁移必须幂等、分层规则必须有负向 fixture 证明它真的会拦。
  - "安装无 postinstall 网络脚本"无法直接断言 → 改为 lockfile 不变。
- **Final consensus**：13 条，12 条可由命令或 CI 判定，1 条（文档）为人工评审。
