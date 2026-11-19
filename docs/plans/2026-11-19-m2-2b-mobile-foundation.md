---
spec_ref: ../specs/2026-11-19-m2-2b-mobile-console-design.md
spec_topic: m2-2b-mobile-console
task_count: 9
estimated_phases: [tests, implementation, verification]
dod: "响应式壳与断点、移动导航、<768 无画布、平板压缩布局、桌面不变、check:secrets 生效；pnpm verify 与新增 Playwright 全绿"
depends_on: []
status: completed
---

# M2-2b 移动端响应式控制台：基础壳实施计划（Plan 1/4）

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`（推荐）或 `executing-plans` 逐任务执行。步骤用 `- [ ]` 勾选。

**Goal:** 先把 `<768` 移动壳、三档断点、无画布挂载、平板压缩布局和 `check:secrets` 落定，让后续 tasks/controls 两个 plan 只消费稳定的 `useViewport`、`mobileTab`、`MobileNav` 与移动壳。

**Architecture:** 同一 `App` / `RealtimeProvider` / Query / Zustand / WS；`useViewport` 只用于条件挂载与极少数 JS 分支，布局优先 Tailwind；移动端不渲染 `CanvasPanel`、`BoardRail`、`TaskBoard` 覆盖层与 `RightPanel`，改由底部导航承载看板/总管/汇报。桌面 `≥1024` 结构不变；`768–1023` 只压缩看板与右栏。

**Tech Stack:** React 19、Vite、Tailwind 4、HeroUI v3、Zustand、TanStack Query、vitest + Testing Library、Playwright（系统 Chrome）。

> GDD 显式跳过：本迭代无后端/状态机行为变更；测试设计由 `docs/contracts/M2-2b-mobile-console.contract.md` 的 16 条 DoD + spec §10 多视口矩阵承担。

---

## Execution Map

| Plan | 文件 | 依赖 | 交付 |
|---|---|---|---|
| 1/4 foundation | 本文件 | 无 | `check:secrets`、`useViewport`、移动壳、导航、无画布、平板压缩 |
| 2/4 tasks | `2026-11-19-m2-2b-mobile-tasks.md` | Plan 1 | 待处理优先看板、任务详情、审批/回复/验收、开工/取消/批量、transcript |
| 3/4 controls | `2026-11-19-m2-2b-mobile-controls.md` | Plan 1/2 | 建任务表单、节点选择器/表单、总管 composer、设置/信任/工作区、digest、kill switch |
| 4/4 acceptance | `2026-11-19-m2-2b-mobile-acceptance.md` | Plan 1/2/3 | Playwright 多视口全量、ego-lite H5 真实 Claude、证据与索引 |

Plan 1 覆盖 contract DoD 1、2（导航/壳）、13（设计系统）、16（check:secrets）与 DoD 14 的壳层部分。

---

## File Structure

**Create**

- `scripts/check-secrets.sh` — gitleaks 全历史扫描入口。
- `.github/workflows/secrets.yml` — PR/push 的 gitleaks 检查。
- `apps/web/src/lib/use-viewport.ts` — `mobile | compact | desktop`。
- `apps/web/src/lib/use-viewport.test.tsx` — 三档与回退。
- `apps/web/src/test/match-media.ts` — 可复用 `matchMedia` mock。
- `apps/web/src/features/shared/MobileNav.tsx` — 底部导航。
- `apps/web/src/features/shared/MobileNav.test.tsx` — 导航与 badge。
- `apps/web/src/features/tasks/MobileBoardList.tsx` — 移动看板最小列表。
- `apps/web/src/features/tasks/MobileBoardList.test.tsx` — 分组与空态。
- `apps/web/src/features/tasks/MobileTaskDetail.tsx` — 全屏任务详情壳。
- `apps/web/e2e/mobile-shell.spec.ts` — 手机/平板/桌面壳回归。

**Modify**

- `DESIGN.md` — 响应式断点、触控尺寸、安全区、移动间距。
- `package.json` — `check:secrets` 脚本。
- `THIRD_PARTY_NOTICES.md` — gitleaks（MIT，CI/开发工具）。
- `apps/web/src/stores/app.ts` — `mobileTab` 与 `setMobileTab`。
- `apps/web/src/stores/app.test.ts` — workspace 切换重置 tab。
- `apps/web/src/App.tsx` — viewport 分支、移动导航、无画布、移动详情。
- `apps/web/src/App.test.tsx` — 移动壳断言。
- `apps/web/src/features/right-panel/RightPanel.tsx` — `compact` 覆盖层样式。
- `apps/web/src/features/tasks/TaskBoard.tsx` — `compact` 宽度与覆盖层 testid。
- `apps/web/src/features/right-panel/RightPanel.test.tsx` — compact class。
- `apps/web/src/features/tasks/TaskBoard.batch.test.tsx` — 覆盖层 testid 不受影响。

---

## Task 1: check:secrets（gitleaks）

Blocking: none
Slice type: tracer-bullet
Seam: `pnpm check:secrets` 退出码；临时目录负例

**Files:**

- Create: `scripts/check-secrets.sh`
- Create: `.github/workflows/secrets.yml`
- Modify: `package.json`
- Modify: `THIRD_PARTY_NOTICES.md`

**Interfaces:**

- Produces: `pnpm check:secrets`；CI job `secrets / gitleaks`。

- [ ] **Step 1: 写扫描脚本**

```bash
#!/usr/bin/env bash
set -euo pipefail

if ! command -v gitleaks >/dev/null 2>&1; then
  echo "gitleaks 未安装。macOS: brew install gitleaks；CI 使用 gitleaks-action。" >&2
  exit 1
fi

# 全历史扫描；--redact 避免命中内容出现在 CI/本地日志里。
gitleaks detect --source . --redact --log-opts="--all"
```

Run: `chmod +x scripts/check-secrets.sh`

- [ ] **Step 2: 加 root script**

`package.json` 的 `scripts` 增加：

```json
"check:secrets": "bash scripts/check-secrets.sh"
```

- [ ] **Step 3: 负例验证脚本能失败**

不要把完整密钥写进仓库；在临时目录里生成一个 GitHub PAT 形状的假 token：

```bash
tmp="$(mktemp -d)"
token="ghp_$(LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 36)"
printf 'GITHUB_TOKEN=%s\n' "$token" > "$tmp/leak.txt"
set +e
gitleaks dir "$tmp" --redact
code=$?
set -e
rm -rf "$tmp"
test "$code" -ne 0
```

Expected: `code != 0`（gitleaks 命中 `github-pat`）。

- [ ] **Step 4: 跑仓库全历史基线**

Run: `pnpm check:secrets`

Expected: exit 0。若命中，先报告并 triage；只有确认是假阳性才加**窄范围** `.gitleaks.toml` allowlist，并写注释。不要为了过 CI 放行整个目录。

- [ ] **Step 5: 加 CI job**

`.github/workflows/secrets.yml`：

```yaml
name: secrets

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  gitleaks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 6: 更新第三方声明**

`THIRD_PARTY_NOTICES.md` 增加一条：gitleaks（MIT），仅用于开发/CI 密钥扫描，不作为运行时依赖。

- [ ] **Step 7: 验证并提交**

Run:

```bash
pnpm exec prettier --check package.json THIRD_PARTY_NOTICES.md .github/workflows/secrets.yml
bash -n scripts/check-secrets.sh
```

Expected: 全部通过。

Commit:

```bash
git add scripts/check-secrets.sh .github/workflows/secrets.yml package.json THIRD_PARTY_NOTICES.md
git commit -m "chore(ci): 增加 gitleaks 密钥扫描"
```

---

## Task 2: DESIGN.md 响应式 token

Blocking: none
Slice type: tracer-bullet
Seam: 文档评审 + Prettier

**Files:**

- Modify: `DESIGN.md`

**Interfaces:**

- Produces: 断点、触控尺寸、安全区、移动间距约定；后续任务按此实现。

- [ ] **Step 1: 增加“响应式与移动端”章节**

在 `DESIGN.md` 的 Layout 之后追加：

```markdown
## Responsive and Mobile

- Breakpoints: `<768px` mobile control console；`768–1023px` compact desktop；`≥1024px` desktop.
- Mobile never renders the canvas; it uses list pickers and forms for nodes.
- Touch targets: minimum `44×44px`; no hover-only actions.
- Bottom navigation: `min-height: 64px` plus `env(safe-area-inset-bottom)`.
- Mobile page padding: `12px`; sticky action bar: `56px` plus safe area.
- Status must be conveyed by text/icon in addition to color.
- Do not hardcode hex colors; reuse HeroUI semantic tokens.
```

- [ ] **Step 2: 验证并提交**

Run: `pnpm exec prettier --check DESIGN.md`

Expected: PASS。

Commit:

```bash
git add DESIGN.md
git commit -m "docs(design): 增加移动端响应式约定"
```

---

## Task 3: `useViewport`

Blocking: none
Slice type: tracer-bullet
Seam: `useViewport()` 返回值随 `matchMedia` 变化

**Files:**

- Create: `apps/web/src/lib/use-viewport.ts`
- Create: `apps/web/src/lib/use-viewport.test.tsx`
- Create: `apps/web/src/test/match-media.ts`

**Interfaces:**

- Produces: `type Viewport = 'mobile' | 'compact' | 'desktop'`；`useViewport(): Viewport`。
- Consumes: 浏览器 `window.matchMedia`；测试用 `installMatchMedia(width)`。

- [ ] **Step 1: 写失败测试**

`apps/web/src/lib/use-viewport.test.tsx`：

```tsx
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installMatchMedia } from '../test/match-media'
import { useViewport } from './use-viewport'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useViewport', () => {
  it('maps widths to mobile/compact/desktop and reacts to changes', () => {
    const media = installMatchMedia(390)
    const { result } = renderHook(() => useViewport())

    expect(result.current).toBe('mobile')

    media.resize(800)
    expect(result.current).toBe('compact')

    media.resize(1280)
    expect(result.current).toBe('desktop')
  })

  it('falls back to desktop without matchMedia', () => {
    vi.stubGlobal('matchMedia', undefined)
    const { result } = renderHook(() => useViewport())
    expect(result.current).toBe('desktop')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @baton/web test -- use-viewport`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现 mock 与 hook**

`apps/web/src/test/match-media.ts`：

```ts
import { act } from '@testing-library/react'
import { vi } from 'vitest'

type Listener = (event: MediaQueryListEvent) => void

export function installMatchMedia(initialWidth: number) {
  let width = initialWidth
  const listeners = new Set<Listener>()

  const matches = (query: string) => {
    if (query.includes('max-width: 767px')) return width < 768
    if (query.includes('max-width: 1023px')) return width >= 768 && width < 1024
    if (query.includes('min-width: 1024px')) return width >= 1024
    return false
  }

  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: matches(query),
      media: query,
      onchange: null,
      addEventListener: (_type: string, listener: Listener) => listeners.add(listener),
      removeEventListener: (_type: string, listener: Listener) => listeners.delete(listener),
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })),
  )

  return {
    resize(nextWidth: number) {
      width = nextWidth
      act(() => {
        for (const listener of listeners) listener({} as MediaQueryListEvent)
      })
    },
  }
}
```

`apps/web/src/lib/use-viewport.ts`：

```ts
import { useSyncExternalStore } from 'react'

export type Viewport = 'mobile' | 'compact' | 'desktop'

const MOBILE_QUERY = '(max-width: 767px)'
const COMPACT_QUERY = '(min-width: 768px) and (max-width: 1023px)'

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {}
  }
  const mobile = window.matchMedia(MOBILE_QUERY)
  const compact = window.matchMedia(COMPACT_QUERY)
  mobile.addEventListener('change', onChange)
  compact.addEventListener('change', onChange)
  return () => {
    mobile.removeEventListener('change', onChange)
    compact.removeEventListener('change', onChange)
  }
}

function getSnapshot(): Viewport {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'desktop'
  if (window.matchMedia(MOBILE_QUERY).matches) return 'mobile'
  if (window.matchMedia(COMPACT_QUERY).matches) return 'compact'
  return 'desktop'
}

export function useViewport(): Viewport {
  return useSyncExternalStore(subscribe, getSnapshot, () => 'desktop')
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @baton/web test -- use-viewport`

Expected: PASS（2 tests）。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/lib/use-viewport.ts apps/web/src/lib/use-viewport.test.tsx apps/web/src/test/match-media.ts
git commit -m "feat(web): 增加响应式 viewport hook"
```

---

## Task 4: `mobileTab` 状态

Blocking: Task 3
Slice type: tracer-bullet
Seam: store 状态与 workspace 切换重置

**Files:**

- Modify: `apps/web/src/stores/app.ts`
- Create: `apps/web/src/stores/app.test.ts`

**Interfaces:**

- Produces: `type MobileTab = 'board' | 'supervisor' | 'digest'`；`mobileTab`、`setMobileTab`。
- Consumes: 现有 `setWorkspace` 重置逻辑。

- [ ] **Step 1: 写失败测试**

`apps/web/src/stores/app.test.ts`：

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { useAppStore } from './app'

beforeEach(() => {
  useAppStore.setState({ mobileTab: 'board' })
})

describe('mobileTab', () => {
  it('switches tabs', () => {
    useAppStore.getState().setMobileTab('digest')
    expect(useAppStore.getState().mobileTab).toBe('digest')
  })

  it('resets to board when workspace changes', () => {
    useAppStore.getState().setMobileTab('supervisor')
    useAppStore.getState().setWorkspace('w2')
    expect(useAppStore.getState().mobileTab).toBe('board')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @baton/web test -- stores/app`

Expected: FAIL，`setMobileTab` 不存在。

- [ ] **Step 3: 实现 store 字段**

`apps/web/src/stores/app.ts`：

```ts
export type MobileTab = 'board' | 'supervisor' | 'digest'
```

`AppState` 增加：

```ts
mobileTab: MobileTab
setMobileTab: (tab: MobileTab) => void
```

初始值与 reset：

```ts
mobileTab: 'board',
setMobileTab: (mobileTab) => set({ mobileTab }),
setWorkspace: (activeWorkspaceId) =>
  set({
    activeWorkspaceId,
    activeTaskId: null,
    selectedNodeId: null,
    selectedNodeIds: [],
    contextNodeIds: [],
    rightPanel: 'supervisor',
    mobileTab: 'board',
  }),
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @baton/web test -- stores/app`

Expected: PASS（2 tests）。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/stores/app.ts apps/web/src/stores/app.test.ts
git commit -m "feat(web): 增加移动端 tab 状态"
```

---

## Task 5: `MobileNav`

Blocking: Task 4
Slice type: tracer-bullet
Seam: 渲染导航、`aria-current`、badge

**Files:**

- Create: `apps/web/src/features/shared/MobileNav.tsx`
- Create: `apps/web/src/features/shared/MobileNav.test.tsx`

**Interfaces:**

- Consumes: `MobileTab`、`attentionCount: number`、`unread: boolean`。
- Produces: `MobileNav({ tab, onChange, attentionCount, unread })`。

- [ ] **Step 1: 写失败测试**

`apps/web/src/features/shared/MobileNav.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MobileNav } from './MobileNav'

describe('MobileNav', () => {
  it('marks the active tab and switches', async () => {
    const onChange = vi.fn()
    render(<MobileNav tab="board" onChange={onChange} attentionCount={2} unread />)

    const nav = screen.getByRole('navigation', { name: '移动端导航' })
    expect(nav).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /看板/ })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: /总管/ })).not.toHaveAttribute('aria-current')

    await userEvent.click(screen.getByRole('button', { name: /总管/ }))
    expect(onChange).toHaveBeenCalledWith('supervisor')
  })

  it('shows attention count and unread dot with accessible text', () => {
    render(<MobileNav tab="board" onChange={() => {}} attentionCount={12} unread />)
    expect(screen.getByText('9+')).toBeInTheDocument()
    expect(screen.getByText('有未读汇报')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @baton/web test -- MobileNav`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现组件**

`apps/web/src/features/shared/MobileNav.tsx`：

```tsx
import { Clock, LayoutList, MessageSquare } from 'lucide-react'
import type { MobileTab } from '../../stores/app'

const TABS: Array<{ id: MobileTab; label: string; icon: typeof LayoutList }> = [
  { id: 'board', label: '看板', icon: LayoutList },
  { id: 'supervisor', label: '总管', icon: MessageSquare },
  { id: 'digest', label: '汇报', icon: Clock },
]

const tabClass = [
  'relative flex min-h-16 flex-1 flex-col items-center justify-center gap-1 px-2 py-2 text-xs',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
].join(' ')

export function MobileNav({
  tab,
  onChange,
  attentionCount,
  unread,
}: {
  tab: MobileTab
  onChange: (tab: MobileTab) => void
  attentionCount: number
  unread: boolean
}) {
  return (
    <nav
      aria-label="移动端导航"
      className="fixed inset-x-0 bottom-0 z-30 flex min-h-16 items-stretch border-t border-separator bg-surface pb-[env(safe-area-inset-bottom)]"
    >
      {TABS.map(({ id, label, icon: Icon }) => {
        const current = tab === id
        return (
          <button
            key={id}
            type="button"
            aria-current={current ? 'page' : undefined}
            onClick={() => onChange(id)}
            className={`${tabClass} ${current ? 'text-accent' : 'text-muted'}`}
          >
            <span className="relative">
              <Icon size={20} aria-hidden="true" />
              {id === 'board' && attentionCount > 0 ? (
                <span className="absolute -right-3 -top-2 rounded-full bg-danger px-1 text-[10px] leading-4 text-danger-foreground">
                  {attentionCount > 9 ? '9+' : attentionCount}
                </span>
              ) : null}
              {id === 'digest' && unread ? (
                <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-accent">
                  <span className="sr-only">有未读汇报</span>
                </span>
              ) : null}
            </span>
            <span>{label}</span>
          </button>
        )
      })}
    </nav>
  )
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @baton/web test -- MobileNav`

Expected: PASS（2 tests）。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/features/shared/MobileNav.tsx apps/web/src/features/shared/MobileNav.test.tsx
git commit -m "feat(web): 增加移动端底部导航"
```

---

## Task 6: `MobileBoardList`

Blocking: Task 4
Slice type: tracer-bullet
Seam: 分组顺序与空态

**Files:**

- Create: `apps/web/src/features/tasks/MobileBoardList.tsx`
- Create: `apps/web/src/features/tasks/MobileBoardList.test.tsx`

**Interfaces:**

- Consumes: `TaskSummary[]`、`groupTasks`、`TaskCard`。
- Produces: `MobileBoardList({ tasks, selectedTaskId, onSelectTask, onOpenSupervisor })`。

- [ ] **Step 1: 写失败测试**

`apps/web/src/features/tasks/MobileBoardList.test.tsx`：

```tsx
import type { TaskSummary } from '@baton/protocol'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MobileBoardList } from './MobileBoardList'

function task(overrides: Partial<TaskSummary>): TaskSummary {
  return {
    id: 't1',
    workspaceId: 'w1',
    nodeId: 'n1',
    title: '任务一',
    status: 'todo',
    attention: 'none',
    waitingReason: null,
    waitingSince: null,
    engine: 'fake',
    retryCount: 0,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  } as TaskSummary
}

describe('MobileBoardList', () => {
  it('puts attention tasks first and opens a task', async () => {
    const onSelectTask = vi.fn()
    render(
      <MobileBoardList
        tasks={[
          task({ id: 't1', title: '待办任务', status: 'todo' }),
          task({ id: 't2', title: '待审批', attention: 'needs_approval', status: 'waiting_input' }),
        ]}
        selectedTaskId={null}
        onSelectTask={onSelectTask}
        onOpenSupervisor={() => {}}
      />,
    )

    const headings = screen
      .getAllByRole('heading', { level: 2 })
      .map((node) => (node.textContent ?? '').replace(/\s*\(\d+\)$/, ''))
    expect(headings).toEqual(['需要我处理', '进行中', '待办'])

    await userEvent.click(screen.getByRole('button', { name: /待审批/ }))
    expect(onSelectTask).toHaveBeenCalledWith('t2')
  })

  it('shows empty state actions', () => {
    render(
      <MobileBoardList
        tasks={[]}
        selectedTaskId={null}
        onSelectTask={() => {}}
        onOpenSupervisor={() => {}}
      />,
    )
    expect(screen.getByText('没有需要你处理的任务')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '让总管建任务' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @baton/web test -- MobileBoardList`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现组件**

`apps/web/src/features/tasks/MobileBoardList.tsx`：

```tsx
import type { TaskSummary } from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { groupTasks } from './columns'
import { TaskCard } from './TaskCard'

function Section({
  title,
  tasks,
  selectedTaskId,
  onSelectTask,
  empty,
}: {
  title: string
  tasks: TaskSummary[]
  selectedTaskId: string | null
  onSelectTask: (taskId: string) => void
  empty: string
}) {
  return (
    <section className="mb-4">
      <h2 className="mb-2 text-xs font-medium text-muted">
        {title} {tasks.length > 0 ? `(${tasks.length})` : ''}
      </h2>
      {tasks.length === 0 ? (
        <p className="rounded-lg border border-dashed border-separator p-3 text-xs text-muted">
          {empty}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              selected={task.id === selectedTaskId}
              onSelect={onSelectTask}
            />
          ))}
        </div>
      )}
    </section>
  )
}

export function MobileBoardList({
  tasks,
  selectedTaskId,
  onSelectTask,
  onOpenSupervisor,
}: {
  tasks: TaskSummary[]
  selectedTaskId: string | null
  onSelectTask: (taskId: string) => void
  onOpenSupervisor: () => void
}) {
  const grouped = groupTasks(tasks)
  const attention = tasks.filter((task) => task.attention !== 'none')
  const done = [...grouped.done, ...grouped.closed]

  return (
    <div data-testid="mobile-board" className="min-h-0 flex-1 overflow-y-auto px-3 pb-24 pt-3">
      <header className="mb-4 flex items-center justify-between gap-2">
        <h1 className="text-base font-semibold">任务</h1>
        <Button size="sm" variant="secondary" onPress={onOpenSupervisor}>
          让总管建任务
        </Button>
      </header>

      <Section
        title="需要我处理"
        tasks={attention}
        selectedTaskId={selectedTaskId}
        onSelectTask={onSelectTask}
        empty="没有需要你处理的任务"
      />
      <Section
        title="进行中"
        tasks={grouped.running}
        selectedTaskId={selectedTaskId}
        onSelectTask={onSelectTask}
        empty="没有进行中的任务"
      />
      <Section
        title="待办"
        tasks={grouped.todo}
        selectedTaskId={selectedTaskId}
        onSelectTask={onSelectTask}
        empty="没有待办任务"
      />

      {done.length > 0 ? (
        <details className="mt-4">
          <summary className="cursor-pointer text-xs text-muted">已完成/已取消 ({done.length})</summary>
          <div className="mt-2 flex flex-col gap-2">
            {done.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                selected={task.id === selectedTaskId}
                onSelect={onSelectTask}
              />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @baton/web test -- MobileBoardList`

Expected: PASS（2 tests）。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/features/tasks/MobileBoardList.tsx apps/web/src/features/tasks/MobileBoardList.test.tsx
git commit -m "feat(web): 增加移动端任务列表"
```

---

## Task 7: App 壳接入（移动导航、无画布、移动详情）

Blocking: Task 3、Task 4、Task 5、Task 6
Slice type: tracer-bullet
Seam: `<768` 无 `CanvasPanel`/`BoardRail`/`RightPanel`；移动详情可打开

**Files:**

- Create: `apps/web/src/features/tasks/MobileTaskDetail.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`

**Interfaces:**

- Consumes: `useViewport`、`mobileTab`、`MobileNav`、`MobileBoardList`、`MobileTaskDetail`、`TaskDetailPanel`、`SupervisorPanel`、`DigestCard`。
- Produces: 移动壳；桌面/平板路径保持原结构。

- [ ] **Step 1: 写失败测试**

`apps/web/src/App.test.tsx` 增加：

```tsx
import { installMatchMedia } from './test/match-media'

it('renders the mobile shell without canvas, rail or right panel', async () => {
  installMatchMedia(390)
  stubEmptyApi()
  renderApp()

  expect(await screen.findByRole('navigation', { name: '移动端导航' })).toBeInTheDocument()
  expect(screen.queryByTestId('canvas')).not.toBeInTheDocument()
  expect(screen.queryByTestId('board-rail')).not.toBeInTheDocument()
  expect(screen.queryByTestId('right-panel')).not.toBeInTheDocument()
  expect(screen.getByTestId('mobile-board')).toBeInTheDocument()
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @baton/web test -- App.test`

Expected: FAIL，移动导航不存在。

- [ ] **Step 3: 新建 `MobileTaskDetail`**

`apps/web/src/features/tasks/MobileTaskDetail.tsx`：

```tsx
import { ArrowLeft } from 'lucide-react'
import type { ReactNode } from 'react'

export function MobileTaskDetail({
  children,
  onClose,
}: {
  children: ReactNode
  onClose: () => void
}) {
  return (
    <div data-testid="mobile-task-detail" className="fixed inset-0 z-40 flex flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-separator px-3">
        <button
          type="button"
          aria-label="返回看板"
          onClick={onClose}
          className="inline-flex h-11 w-11 items-center justify-center rounded-md focus-visible:outline-2 focus-visible:outline-accent"
        >
          <ArrowLeft size={18} />
        </button>
        <span className="text-sm font-medium">任务详情</span>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  )
}
```

- [ ] **Step 4: 接入 `App.tsx`**

顶部导入：

```tsx
import { useViewport } from './lib/use-viewport'
import { MobileNav } from './features/shared/MobileNav'
import { MobileBoardList } from './features/tasks/MobileBoardList'
import { MobileTaskDetail } from './features/tasks/MobileTaskDetail'
import { DigestCard } from './features/supervisor/DigestCard'
```

组件内：

```tsx
const viewport = useViewport()
const isMobile = viewport === 'mobile'
const mobileTab = useAppStore((state) => state.mobileTab)
const setMobileTab = useAppStore((state) => state.setMobileTab)
```

根节点：

```tsx
<div className="flex h-screen flex-col bg-background text-foreground" data-viewport={viewport}>
```

顶栏在移动端隐藏桌面动作与自动化设置入口：

```tsx
{!isMobile ? (
  <>
    <AutomationSettingsDialog
      key={activeWorkspaceId}
      workspaceId={activeWorkspaceId}
      open={automationSettingsOpen}
      onOpenChange={setAutomationSettingsOpen}
    />
  </>
) : null}
```

```tsx
{!isMobile ? (
  <AutomationStatus
    summary={automation.data ?? null}
    onPause={() => void pauseAutomation()}
    onOpenSettings={() => setAutomationSettingsOpen(true)}
  />
) : null}
```

```tsx
{!isMobile ? (
  <Button
    variant="secondary"
    isDisabled={!canvas.data}
    onPress={() => canvasRef.current?.addNode('agent')}
  >
    新建 Agent 节点
  </Button>
) : null}
{!isMobile ? (
  <CreateWorkspaceDialog
    onCreated={(id) => {
      setWorkspace(id)
      writeUrlState({ workspaceId: id, taskId: null })
    }}
  />
) : null}
```

移动端同时隐藏 `WorkspaceTrustBadge`，避免顶栏横向溢出；`WorkspaceTrustDialog` 保留（未信任 workspace 仍会自动弹出）。信任状态与入口在 Plan 3 放进“更多菜单”：

```tsx
{activeWorkspace && !isMobile ? (
  <WorkspaceTrustBadge
    workspace={activeWorkspace}
    onTrust={() => setTrustDialogOpen(true)}
    onRevoked={() => setTrustPromptedFor(activeWorkspace.id)}
  />
) : null}
```

内容区改为二分：

```tsx
{isMobile ? (
  <div className="flex min-h-0 flex-1 flex-col">
    {mobileTab === 'board' ? (
      <MobileBoardList
        tasks={tasks.data ?? []}
        selectedTaskId={activeTaskId}
        onSelectTask={(id) => {
          setTask(id)
          writeUrlState({ workspaceId: activeWorkspaceId, taskId: id })
        }}
        onOpenSupervisor={() => setMobileTab('supervisor')}
      />
    ) : null}

    {mobileTab === 'supervisor' ? (
      <div className="min-h-0 flex-1">
        <SupervisorPanel
          workspaceId={activeWorkspaceId}
          contextNodes={contextNodes}
          targetAgent={targetAgent}
        />
      </div>
    ) : null}

    {mobileTab === 'digest' ? (
      <div className="min-h-0 flex-1 overflow-y-auto p-3 pb-24">
        <DigestCard
          workspaceId={activeWorkspaceId ?? undefined}
          onOpenTask={(id) => {
            setTask(id)
            writeUrlState({ workspaceId: activeWorkspaceId, taskId: id })
          }}
        />
      </div>
    ) : null}

    <MobileNav
      tab={mobileTab}
      onChange={setMobileTab}
      attentionCount={
        counts.needs_approval + counts.needs_reply + counts.needs_review
      }
      unread={notices.data?.notices[0]?.readAt === null}
    />

    {activeTaskId ? (
      <MobileTaskDetail
        onClose={() => {
          setTask(null)
          writeUrlState({ workspaceId: activeWorkspaceId, taskId: null })
        }}
      >
        <TaskDetailPanel />
      </MobileTaskDetail>
    ) : null}
  </div>
) : (
  <div id="workspace-body" className="flex min-h-0 flex-1">
    {/* 现有 BoardRail / TaskBoard / main / RightPanel 原样保留 */}
  </div>
)}
```

注释：原 `<div className="flex min-h-0 flex-1">` 的内容整体移入 `else` 分支，结构不变；`RightPanel` 在移动端不渲染。`TaskDetailPanel` 在移动端只通过 `MobileTaskDetail` 渲染一次。

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm --filter @baton/web test -- App.test`

Expected: PASS（新增移动用例 + 现有桌面用例）。

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/App.tsx apps/web/src/App.test.tsx apps/web/src/features/tasks/MobileTaskDetail.tsx
git commit -m "feat(web): 接入移动端壳与无画布分支"
```

---

## Task 8: 平板压缩布局

Blocking: Task 7
Slice type: refactor
Seam: `compact` 时右栏覆盖、看板宽度收窄；桌面 class 不变

**Files:**

- Modify: `apps/web/src/features/right-panel/RightPanel.tsx`
- Modify: `apps/web/src/features/right-panel/RightPanel.test.tsx`
- Modify: `apps/web/src/features/tasks/TaskBoard.tsx`
- Modify: `apps/web/src/features/tasks/TaskBoard.batch.test.tsx`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**

- `RightPanel` 新增 `compact?: boolean`。
- `TaskBoard` 新增 `compact?: boolean`。

- [ ] **Step 1: 写失败测试**

`RightPanel.test.tsx` 增加：

```tsx
it('renders as an overlay when compact', () => {
  render(
    <RightPanel
      compact
      mode="supervisor"
      onModeChange={() => {}}
      hasTask={false}
      hasNode={false}
      supervisor={<div>总管</div>}
      task={null}
      node={null}
    />,
  )
  const panel = screen.getByTestId('right-panel')
  expect(panel.className).toContain('absolute')
  expect(panel.className).toContain('shadow-overlay')
})
```

`TaskBoard.batch.test.tsx` 增加：

```tsx
it('marks the overlay for compact width overrides', () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <TaskBoard
        compact
        tasks={[]}
        agentNodes={[]}
        selectedTaskId={null}
        expanded
        pinned={false}
        onSelectTask={() => {}}
        onClose={() => {}}
      />
    </QueryClientProvider>,
  )
  expect(screen.getByTestId('task-board-overlay').className).toContain('w-[min(760px,88vw)]')
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @baton/web test -- RightPanel TaskBoard.batch`

Expected: FAIL，`compact` 未定义/class 不匹配。

- [ ] **Step 3: 改 `RightPanel`**

```tsx
export function RightPanel({
  compact = false,
  ...props
}: {
  compact?: boolean
  mode: RightPanelMode
  onModeChange: (mode: RightPanelMode) => void
  hasTask: boolean
  hasNode: boolean
  hasUnreadNotice?: boolean
  supervisor: ReactNode
  task: ReactNode
  node: ReactNode
}) {
```

`<aside>` class：

```tsx
className={
  compact
    ? 'absolute inset-y-0 right-0 z-20 flex min-h-0 w-[min(400px,92vw)] shrink-0 flex-col border-l border-separator bg-surface shadow-overlay'
    : 'flex min-h-0 w-[400px] shrink-0 flex-col border-l border-separator bg-surface'
}
```

- [ ] **Step 4: 改 `TaskBoard`**

Props 增加 `compact?: boolean`；外层的固定覆盖层加 testid 与 class：

```tsx
return (
  <div
    data-testid="task-board-overlay"
    className={
      compact
        ? 'fixed bottom-0 left-16 top-14 z-30 w-[min(760px,88vw)] border-r border-separator shadow-overlay'
        : 'fixed bottom-0 left-16 top-14 z-30 w-[min(960px,72vw)] border-r border-separator shadow-overlay'
    }
  >
    {board}
  </div>
)
```

Pinned 分支：

```tsx
if (pinned) {
  return (
    <div className={compact ? 'w-[min(420px,72vw)] shrink-0 border-r border-separator' : 'w-[560px] shrink-0 border-r border-separator'}>
      {board}
    </div>
  )
}
```

- [ ] **Step 5: App 传 compact 与 relative**

```tsx
<div
  id="workspace-body"
  className={viewport === 'compact' ? 'relative flex min-h-0 flex-1' : 'flex min-h-0 flex-1'}
>
```

```tsx
<TaskBoard compact={viewport === 'compact'} ... />
<RightPanel compact={viewport === 'compact'} ... />
```

- [ ] **Step 6: 跑测试确认通过**

Run: `pnpm --filter @baton/web test -- RightPanel TaskBoard.batch`

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add apps/web/src/features/right-panel/RightPanel.tsx apps/web/src/features/right-panel/RightPanel.test.tsx apps/web/src/features/tasks/TaskBoard.tsx apps/web/src/features/tasks/TaskBoard.batch.test.tsx apps/web/src/App.tsx
git commit -m "feat(web): 增加平板压缩布局"
```

---

## Task 9: Playwright 壳回归与收口

Blocking: Task 7、Task 8
Slice type: verification
Seam: 手机/平板/桌面三档 Playwright

**Files:**

- Create: `apps/web/e2e/mobile-shell.spec.ts`

**Interfaces:**

- Consumes: 现有 `page.route` mock 模式；`data-testid`：`mobile-board`、`mobile-nav`（role）、`canvas`、`board-rail`、`right-panel`、`task-board-overlay`。

- [ ] **Step 1: 写 e2e**

`apps/web/e2e/mobile-shell.spec.ts`：

```ts
import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', (route) => route.fulfill({ json: { workspaces: [] } }))
})

test.describe('mobile shell', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('renders navigation and no canvas', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByRole('navigation', { name: '移动端导航' })).toBeVisible()
    await expect(page.getByTestId('mobile-board')).toBeVisible()
    await expect(page.getByTestId('canvas')).toHaveCount(0)
    await expect(page.getByTestId('board-rail')).toHaveCount(0)
    await expect(page.getByTestId('right-panel')).toHaveCount(0)

    await page.getByRole('button', { name: '总管' }).click()
    await expect(page.getByRole('button', { name: '总管' })).toHaveAttribute('aria-current', 'page')

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    )
    expect(overflow).toBe(false)
  })
})

test.describe('compact desktop', () => {
  test.use({ viewport: { width: 820, height: 1180 } })

  test('keeps the canvas and collapses the board by default', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByTestId('canvas')).toBeVisible()
    await expect(page.getByTestId('board-rail')).toBeVisible()
    await expect(page.getByTestId('right-panel')).toBeVisible()
    await expect(page.getByTestId('task-board-overlay')).toHaveCount(0)
    await expect(page.getByRole('navigation', { name: '移动端导航' })).toHaveCount(0)

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    )
    expect(overflow).toBe(false)
  })
})

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('does not render the mobile navigation', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByTestId('canvas')).toBeVisible()
    await expect(page.getByTestId('right-panel')).toBeVisible()
    await expect(page.getByRole('navigation', { name: '移动端导航' })).toHaveCount(0)
  })
})
```

- [ ] **Step 2: 跑新 e2e**

Run: `pnpm exec playwright test apps/web/e2e/mobile-shell.spec.ts`

Expected: 3 passed。

- [ ] **Step 3: 跑全量验证**

Run: `pnpm verify:full`

Expected: `pnpm verify` 全绿；现有 e2e + 新增 3 条全绿。

- [ ] **Step 4: 提交**

```bash
git add apps/web/e2e/mobile-shell.spec.ts
git commit -m "test(web): 增加移动端壳回归"
```

---

## Self-Review

- **Spec coverage**：本 plan 覆盖 spec §5（架构）、§5.5（设计系统）、§6.1（导航）、§10.4（check:secrets）与 contract DoD 1、2、13、16；看板详情/表单/总管/设置分别在 Plan 2/3，Playwright 全量与真实 Claude 在 Plan 4。
- **Placeholder scan**：无 TBD/TODO；每个任务有实际代码/命令。
- **Type consistency**：`Viewport`、`MobileTab`、`MobileNav` props、`MobileBoardList` props、`compact` props 在任务间一致；`TaskSummary` 字段沿用现有协议。
- **Scope check**：本 plan 不触碰 protocol/daemon/DB；不实现 Plan 2/3 的交互；桌面 `≥1024` 结构不变。

## Execution Handoff

Plan 1 已落 `docs/plans/2026-11-19-m2-2b-mobile-foundation.md`。两种执行方式：

1. **Subagent-Driven（推荐）**：每个 task 派一个新 subagent，任务间审查。
2. **Inline Execution**：本会话按 `executing-plans` 批量执行，检查点审查。

## 执行记录（2026-11-19）

- 分支：`feat/m2-2b-mobile-console`（基于 `docs/m2-2b-mobile-console-spec`）。
- 9 个 task 全部完成；每个 task 独立提交。
- 验证：`pnpm verify` exit 0；`pnpm verify:full` exit 0，15 条 Playwright 全绿；web 单测 150。
- 移动壳：`<768` 无 `CanvasPanel` / `BoardRail` / `RightPanel`；390 宽度无横向溢出；平板 820 保留画布、看板默认收起。
- `check:secrets`：gitleaks 8.30.1，164 commits 全历史扫描无泄漏；负例用 GitHub PAT 形状 token 验证命中。
- bundle：web JS 296.41 KB gzip（低于 400KB 触发线）。
- 偏离：
  - `mobileTab` 测试追加到现有 `store.test.ts`，未新建 `app.test.ts`。
  - `MobileBoardList` 标题去掉多余尾随空格，测试按无空格断言。
  - `MobileNav` e2e 使用 `exact: true` 区分“总管”和“让总管建任务”。
  - `check:secrets` 负例从 AWS 示例 key 改为 GitHub PAT；gitleaks 对前者不报。
- 未做：Plan 2/3/4、真实 Claude 验收、移动访问 runbook。
