# Docker 部署

## 一键启动

```bash
cp .env.example .env
# 生成 token 并填入 .env
openssl rand -hex 32
docker compose up -d
```

打开 `http://<host>:7317/?token=<BATON_TOKEN>`，首次访问会换取 httpOnly cookie 并跳转。

## 单条命令

```bash
docker run -d --name baton -p 7317:7317 \
  -e BATON_TOKEN=$(openssl rand -hex 32) \
  --read-only --tmpfs /tmp:size=256m \
  --cap-drop ALL --security-opt no-new-privileges:true \
  -v baton-data:/data \
  -v "$PWD/workspace:/workspace" \
  ghcr.io/evanfang0054/baton:latest
```

## 卷与端口

| 项 | 说明 |
|---|---|
| `/data` | SQLite、迁移记录、产物与日志；必须持久化 |
| `/workspace` | 工作区根目录；Agent 只能在这里读写 |
| `/home/node/.claude` | Claude 凭据与会话状态；OAuth 场景需要持久化 |
| `7317` | 唯一端口，HTTP、WS 与前端静态资源共用 |

## 认证

- `BATON_HOST=0.0.0.0` 时 `BATON_TOKEN` 必填，缺失会直接退出。
- 也支持 `BATON_TOKEN_FILE` 指向 Docker secret 文件。
- 容器内不要用 OAuth 交互登录：优先 `ANTHROPIC_API_KEY`；要用已有登录态时，把宿主机的 Claude 凭据目录挂到 `/home/node/.claude`。

## worktree 与文件权限

- 容器以 `node` 用户运行。宿主机目录 uid 不一致时，git 会报 `dubious ownership`；镜像已设置 `safe.directory /workspace`，仍失败时在 compose 里覆盖 `user:` 为宿主机 uid:gid。
- `read_only: true` 下只有 `/data`、`/workspace`、`/home/node/.claude` 与 `/tmp` 可写；新增可写路径时同时改 compose。

## 常见失败

| 现象 | 排查 |
|---|---|
| 启动即退出，日志含 `BATON_TOKEN is required` | 补 `BATON_TOKEN` 或 `BATON_TOKEN_FILE` |
| 容器健康但浏览器 401 | token 不匹配；重新用 `/?token=` 配对 |
| `dubious ownership` | 覆盖 `user:` 或确认 `safe.directory` |
| 健康检查超时 | `docker logs baton`；确认 `/data` 可写、端口未占用 |
| 镜像拉取慢 | 镜像约 500-600MB，主要是 Claude 原生二进制；M3 提供 slim 变体 |

## 镜像构建

```bash
pnpm docker:smoke
```

该命令会构建镜像、启动容器、检查 `/api/health`、确认非 root，并报告体积。
