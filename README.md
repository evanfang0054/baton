# baton

它不演奏，只定拍子。

一个本地优先的 Agent 调度驾驶舱：画布是共享内存，看板是状态投影，总管只负责派活与验收。

## 状态

M7 交付工作台与 M8 注意力闭环已收口：一条需求一块画布，需求 → 设计 → 开发 → 验收四阶段；总管负责派活、汇报与会话闸门卡，人只在闸门做决定。真实 Claude + DeepSeek 总管链路已跑通 4/4 阶段。v1 不使用 Docker。

## 本地运行

```bash
pnpm install
pnpm build
npx @evanfang0054/baton
```

打开终端输出的地址；需要 token 时用 `/?token=` 配对。

## 远程访问

v1 默认只监听 `127.0.0.1`。需要从其他设备访问时，自行用 Tailscale / Caddy / Nginx 反向代理 `7317`，并设置 `BATON_TOKEN`。详见 [本地运行与运维](docs/runbooks/local.md)。

## 开发

```bash
pnpm verify       # typecheck + lint + format + 守卫 + 测试 + build
pnpm verify:full  # verify + e2e
pnpm pack:check   # npm pack 安装链路自检
```

## 文档

- [架构设计与工程规范](docs/specs/2026-11-16-baton-architecture-design.md)
- [M7 交付 playbook](docs/specs/2026-11-22-m7-delivery-playbook-design.md)
- [M8 注意力闸门与工作区授权](docs/specs/2026-11-23-m8-attention-gate-authority-design.md)
- [M8 实跑与修复记录](docs/evidence/2026-11-24-dogfood-m8/README.md)
- [项目宪法](docs/constitution.md)
