# 工作区目录选择器

- **状态**：Draft（2026-11-20）
- **范围**：web 新建工作区、daemon 目录浏览 API、protocol 响应契约
- **关联**：`docs/specs/2026-11-16-baton-architecture-design.md` 的 Workspace 章节

## 背景

新建工作区目前要求用户手输“相对路径”。真实使用中用户会粘贴绝对路径（例如 Finder 里复制的目录），
`resolveWithin` 拒绝绝对路径，于是得到“路径不存在或不在工作区根目录内”。手输也容易拼错、不知道
`BATON_WORKSPACES_ROOT` 下有哪些目录。

## 决定

- 新增 `GET /api/workspaces/browse`，在 `BATON_WORKSPACES_ROOT` 内列目录并支持搜索。
- 新建工作区弹窗不再提供可编辑路径输入：用户通过目录选择器选中一个目录，弹窗只展示结果。
- 目录选择器支持面包屑导航、直接选择子目录、按名称搜索；搜索结果直接带完整相对路径。
- 选择目录后，名称为空时自动用目录名填充。
- `POST /api/workspaces` 继续接受相对路径；同时接受位于 root 内的绝对路径，避免旧习惯或外部脚本再次踩坑。

## API

`GET /api/workspaces/browse?path=<相对路径>&q=<搜索词>`

- `path` 省略时表示 root；必须是 root 内真实存在的目录，禁止 `..` 与软链逃逸。
- `q` 非空时从 `path` 开始递归搜索目录名（大小写不敏感），最多 4 层、50 条结果。
- 只返回目录，不返回文件；隐藏目录与非搜索场景下的 `node_modules` 等重目录仍可直接浏览，
  但递归搜索会跳过它们。
- 响应只包含相对路径，不返回本机绝对路径或用户名；UI 的根节点显示为“工作区根目录”。

```ts
{
  path: string
  parent: string | null
  entries: Array<{ name: string; relPath: string; hasGit: boolean }>
  truncated: boolean
  searching: boolean
}
```

## 安全

- 所有路径先过 `resolveWorkspaceDir`/`resolveWithin` 的 realpath jail。
- 列目录时跳过 symlink，避免通过软链读到 root 外。
- 搜索有深度、条目和结果上限，避免在 home 目录下失控。
- 错误统一 `invalid_path`，不回显绝对路径。

## 验收

- 打开弹窗即可看到 root 下的目录；面包屑可进出；搜索能定位嵌套目录并选中。
- 选择后创建的工作区 `relPath` 正确，看板/画布正常加载。
- `path=../`、root 外绝对路径、指向 root 外的软链均返回 400。
- 现有 `POST /api/workspaces` 相对路径行为不变；root 内绝对路径可创建。
