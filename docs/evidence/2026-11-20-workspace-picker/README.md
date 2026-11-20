# 工作区目录选择器验收（2026-11-20）

## 环境

- 使用构建产物在 `127.0.0.1:7318` 启动独立 daemon。
- `BATON_DATA_DIR` 与 `BATON_WORKSPACES_ROOT` 指向临时目录，未使用真实用户目录或数据库。
- 临时根目录包含：
  - `alpha/`
  - `projects/baton-demo/`（带 `.git`）
  - `projects/other/`

## 步骤与结果

1. 打开「新建工作区」→「选择目录」：默认列出根目录下的 `alpha`、`projects`。
2. 在搜索框输入 `baton`：返回 `projects/baton-demo`，并标记 `git`。
3. 点击搜索结果：路径显示为 `projects/baton-demo`，名称自动填为 `baton-demo`。
4. 点击「创建」：工作区创建成功并自动选中，画布正常加载。

截图：

- `search.png`：搜索目录并显示结果。
- `created.png`：选择后创建成功，工作区画布加载。

## 备注

- 截图只包含临时 fixture 的相对路径，不含本机绝对路径或用户名。
- 目录选择器根节点显示为「工作区根目录」，避免暴露用户名。
