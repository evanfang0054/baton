# 总管模型配置

总管需要调用一个 **OpenAI-compatible Chat Completions** 接口（要求支持 tool calling）。
配置只保存在本机，不经过 web、不写入数据库、不进入日志。

## 配置文件位置

默认：

```text
~/.baton/supervisor.json
```

如果设置了 `BATON_DATA_DIR`，路径是：

```text
$BATON_DATA_DIR/supervisor.json
```

仓库里只保留模板 `docs/runbooks/supervisor-config.example.json`，真实配置文件不要提交。

## 字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `baseUrl` | 是 | OpenAI-compatible API 根地址，通常以 `/v1` 结尾 |
| `apiKey` | 是 | 服务商 key；只保存在本机文件里 |
| `model` | 是 | 支持 tool calling 的模型名 |

示例（填入真实值后才是有效配置）：

```json
{
  "baseUrl": "https://api.example.com/v1",
  "apiKey": "sk-replace-me",
  "model": "replace-with-model-name"
}
```

常见 OpenAI-compatible 服务都可以用，例如 DeepSeek、OpenAI，或本地/自建兼容网关。
总管只需要 `chat/completions`、流式返回和 function/tool calling。

## 初始化

```bash
mkdir -p ~/.baton
cp docs/runbooks/supervisor-config.example.json ~/.baton/supervisor.json
chmod 600 ~/.baton/supervisor.json
${EDITOR:-vi} ~/.baton/supervisor.json
```

`chmod 600` 是必须的：这个文件里有 key，只允许当前用户读写。
不要把 key 贴到聊天、Issue、PR、日志或截图里。

## 生效与检查

- 配置在每次 `GET /api/supervisor/status` 和 `supervisor.send` 时重新读取，不需要重启 daemon。
- 填好后在总管面板点「检查配置」，或刷新状态；`configured` 为 `true` 且显示模型名即可。
- 如果仍显示未配置，检查 JSON 是否是合法对象、三个字段是否都非空、`baseUrl` 是否是完整 URL。

## 没有真实 key 时的模拟调试

以下命令都不需要真实 key：

```bash
# 真实 AI SDK 引擎 + 本地 OpenAI-compatible mock：验证流式文本与 tool call
pnpm --filter @evanfang0054/baton test -- supervisor-engine-mock

# 总管 UI 与 WS 事件回归：REST/WS 全部 mock
pnpm exec playwright test apps/web/e2e/supervisor.spec.ts
```

mock 只用于调通链路，不能替代真实模型验收；真实链路仍需要在填好配置后按
`docs/evidence/2026-11-18-m2-supervisor/README.md` 执行。

## 安全

- 配置文件必须在仓库外，权限 `0600`。
- 轮换 key 时直接替换文件内容，不需要改代码。
- 怀疑泄露时先在服务商侧吊销/轮换，再检查日志与 shell 历史；删除文件不等于 key 失效。
- 不要把 `baseUrl` 或 key 写进 web 代码、测试 fixture 或文档。
