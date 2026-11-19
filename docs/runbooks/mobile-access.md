# 移动端访问与运维

baton 的移动端是响应式控制台：手机打开同一个地址即可使用；不需要安装 App。

## 视口与能力

| 视口 | 布局 | 画布 | 能力 |
|---|---|---|---|
| `<768px` | 移动控制台 | 不渲染 | 看板、任务详情、审批/回复/验收、开工/取消/批量开工、建任务、节点表单、总管、设置、信任/创建工作区、汇报 |
| `768–1023px` | 压缩桌面 | 渲染 | 桌面能力；看板默认收起，右栏覆盖 |
| `≥1024px` | 桌面 | 渲染 | 现有三栏布局 |

手机端不提供：画布拖拽/缩放、连线、删除节点、image/group/review 节点。

## 本机访问

默认只监听 `127.0.0.1`，手机无法访问。开发模式：

```bash
pnpm dev
# 浏览器访问终端输出的 Vite 地址（默认 http://127.0.0.1:5173）
```

`pnpm dev` 时 7317 只提供 daemon API，不托管 web 静态产物；需要从 7317 访问页面时先构建并启动 daemon：

```bash
pnpm build
node apps/daemon/dist/bin.js
# 浏览器访问 http://127.0.0.1:7317
```

未设置 `BATON_TOKEN` 时不需要认证；仅建议在本机使用。

## 局域网 / 远程访问

必须同时设置监听地址和 token，并使用构建后的 daemon：

```bash
export BATON_HOST=0.0.0.0
export BATON_TOKEN="$(openssl rand -hex 16)"
export BATON_PORT=7317
pnpm build
node apps/daemon/dist/bin.js
```

长期运行建议把 token 写入 `BATON_TOKEN_FILE`，避免每次重启生成新 token 导致所有手机 cookie 失效。

手机与电脑在同一网络时，打开：

```text
http://<host>:7317/auth?token=<token>
```

`/auth` 会设置 HttpOnly、SameSite=Strict 的 cookie 并跳回首页。不要把带 token 的 URL 发到聊天、Issue 或截图里。

推荐用 Tailscale / Caddy / Nginx 提供 HTTPS 反向代理到 `7317`；HTTPS 下同样需要 `BATON_TOKEN`。明文 `http://` 会让 token 进入浏览器历史与反向代理访问日志，远程访问应优先使用 Tailscale 或 HTTPS，并配置代理脱敏 query 日志。

## Token 轮换与手机丢失

手机 token 与桌面 token 权限相同：同一 cookie/token 可调用全部 `/api/*`；手机端不渲染画布只是 UI 限制，不是权限隔离。手机丢失或 token 泄露时：

1. 生成新 token，更新 `BATON_TOKEN`（或 `BATON_TOKEN_FILE`）。
2. 重启 daemon。
3. 旧手机会在下次请求时收到 401；清除其浏览器 cookie。

前端不会把 token 写入 localStorage；cookie 由浏览器管理。

## 截图与证据

截图前检查并遮挡：

- 地址栏中的 token / 主机名 / 内网 IP。
- 用户名、头像、通知内容。
- 工作区绝对路径、仓库名、分支名（如属于未公开项目）。

证据存 `docs/evidence/`，使用 `<workspace>`、`<host>`、`<token>` 等占位符，不写真实值。

## 排障

| 现象 | 检查 |
|---|---|
| 手机打不开 | `BATON_HOST` 是否为 `0.0.0.0`；防火墙/Tailscale 是否放行 7317 |
| 401 / 未认证横幅 | URL 是否带 `/auth?token=...`；token 是否与 daemon 一致 |
| WS 断线 | 手机后台会断连；回到前台会自动重连并按 `sinceSeq` 回放 |
| 设置打不开 | 未信任 workspace 时自动化设置会被拒绝（409 `workspace_untrusted`） |
| 看不到画布 | `<768px` 不渲染画布，这是设计行为；改用桌面/平板 |
