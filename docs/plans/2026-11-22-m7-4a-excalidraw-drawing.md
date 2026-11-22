---
spec_ref: ../specs/2026-11-22-m7-delivery-playbook-design.md
spec_topic: m7-delivery-playbook
task_count: 4
dod: "drawing artifact + 节点 + 懒加载 Excalidraw 编辑器 + PNG/SVG 保存 + bundle 断言"
status: active
depends_on: 2026-11-22-m7-3-web-shell-board-canvas.md
---

# M7 Plan 4a：Excalidraw 画板

> 依赖 M7-3 的交付画布与产物覆盖层。

- [x] drawing artifact 创建与 `?variant=source|svg` 内容读取。
- [x] `@excalidraw/excalidraw` 懒加载编辑器，保存 `.excalidraw` + PNG + SVG。
- [x] 交付画布“新建画板”创建 draft artifact + drawing 节点；双击进入编辑器。
- [ ] bundle 断言（主 chunk 不含 `@excalidraw`）与 Playwright 画板链路。
- [ ] 缩略图/自动保存/失败重试细节。

## 已知偏离

- Excalidraw 0.18.1 peer 声明 React 16-18；当前 React 19 仅 pnpm peer warning，构建与类型检查通过，需真实浏览器验证。
- 编辑器先做显式“保存/保存并关闭”，未做关闭自动保存。
