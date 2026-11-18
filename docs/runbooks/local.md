# 本地运行与运维

v1 只提供 npm / host-native 运行方式；不使用 Docker。真实引擎（Claude Code，后续 Codex/DSH）直接复用本机登录态与配置。

## 启动

```bash
pnpm install
pnpm build
npx @evanfang0054/baton
```

或开发模式：

```bash
pnpm dev
```

默认监听 `127.0.0.1:7317`，浏览器打开终端输出的地址。

## 认证

- 默认只监听 `127.0.0.1`，本机访问不强制 token。
- 绑定非 loopback 地址时必须设置 `BATON_TOKEN`，否则 daemon 拒绝启动。
- 浏览器用 `/?token=<BATON_TOKEN>` 换取 httpOnly cookie；非浏览器用 `Authorization: Bearer`。
- 不要把 token 写进前端 localStorage。

## 数据与工作区

| 路径 | 说明 |
|---|---|
| `BATON_DATA_DIR`（默认 `~/.baton`） | SQLite、迁移记录、产物与日志 |
| `BATON_WORKSPACES_ROOT`（默认 `$HOME`） | 工作区根目录；workspace 存相对路径，路径经过 jail 校验 |
| `~/.claude` | Claude Code 登录态、settings、skills 与历史；由本机 Claude Code 直接使用 |

备份时至少覆盖 `BATON_DATA_DIR` 与需要保留的工作区；`~/.claude` 由 Claude Code 自己管理。

## 真实 Claude Code

- 直接使用本机已登录的 Claude Code；daemon 以当前用户身份 spawn，不需要在别处重新登录。
- 如果不用本机登录态，可设置 `ANTHROPIC_API_KEY`；这会走 API key 计费，而不是本机订阅。
- 项目级 `.claude/settings.json`、`.mcp.json`、hooks 是否加载由 workspace trust 决定；默认不信任、不加载。
- 引擎探测：`GET /api/engines` 返回 `claude-sdk` 的 `available | unknown | unavailable`；`unknown` 表示无法读取 macOS Keychain，但仍允许尝试。
- 预算：默认 `BATON_CLAUDE_MAX_TURNS=30`、`BATON_CLAUDE_MAX_BUDGET_USD=2`。
- hooks：`BATON_CLAUDE_PROJECT_HOOKS=off` 可强制关闭所有项目 hooks，优先于 workspace 设置。

## 远程访问

v1 不自带 TLS 或远程网关。需要从其他设备访问时：

1. 用 Tailscale / Caddy / Nginx 把 `127.0.0.1:7317` 反代出去；
2. 设置强随机 `BATON_TOKEN`；
3. 确认反代正确转发 WebSocket 与 `Authorization` / cookie；
4. 不要把 daemon 直接暴露到公网。

## 常见失败

| 现象 | 排查 |
|---|---|
| 启动即退出，日志含 `BATON_TOKEN is required` | 绑定非 loopback 时必须设置 `BATON_TOKEN` |
| 浏览器 401 | token 不匹配；重新用 `/?token=` 配对 |
| 工作区路径报错 | `relPath` 必须是 `BATON_WORKSPACES_ROOT` 下的子目录；检查软链与权限 |
| 端口占用 | 用 `BATON_PORT` 或 `--port` 换端口 |
| Claude 引擎不可用 | 确认本机 `claude` 已登录，或设置 `ANTHROPIC_API_KEY`；查看 daemon 日志中的 engine preflight 结果 |
