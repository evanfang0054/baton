import {
  ArrowRightLeft,
  Ban,
  CheckCircle2,
  ChevronDown,
  FileSearch,
  History,
  LayoutGrid,
  ListChecks,
  ListPlus,
  Loader2,
  MessageSquare,
  PlusCircle,
  RefreshCw,
  RotateCcw,
  Wrench,
  XCircle,
} from 'lucide-react'
import { useState, type ComponentType } from 'react'

export interface SupervisorToolView {
  id: string
  name: string
  phase: 'start' | 'end'
  ok?: boolean
  summary?: string
  args?: unknown
  result?: unknown
  error?: string
}

const icons: Record<string, ComponentType<{ size?: number; className?: string }>> = {
  list_canvas: LayoutGrid,
  list_tasks: ListChecks,
  get_task: FileSearch,
  get_task_history: History,
  create_task: PlusCircle,
  create_tasks: ListPlus,
  handoff_task: ArrowRightLeft,
  retry_task: RefreshCw,
  reopen_task: RotateCcw,
  cancel_task: Ban,
  reply_task: MessageSquare,
}

function preview(value: unknown): string {
  if (value === undefined) return ''
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return text.length > 4000 ? `${text.slice(0, 4000)}\n…` : text
}

const FOCUS_RING = 'focus-visible:outline-2 focus-visible:outline-accent'

export function SupervisorToolCard({ tool }: { tool: SupervisorToolView }) {
  const [open, setOpen] = useState(false)
  const Icon = icons[tool.name] ?? Wrench
  const running = tool.phase === 'start'
  const status = running ? '进行中' : tool.ok === false ? '失败' : tool.ok ? '完成' : '已结束'
  const statusClass = running
    ? 'text-muted'
    : tool.ok === false
      ? 'text-danger'
      : tool.ok
        ? 'text-success'
        : 'text-muted'

  return (
    <div className="rounded-lg border border-separator bg-background">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={`flex w-full items-center gap-2 rounded-lg p-2 text-left text-xs ${FOCUS_RING}`}
      >
        <Icon size={14} className="shrink-0 text-muted" />
        <span className="min-w-0 truncate font-mono text-foreground">{tool.name}</span>
        <span className={`ml-auto flex shrink-0 items-center gap-1 ${statusClass}`}>
          {running ? (
            <Loader2 size={12} className="animate-spin" aria-hidden="true" />
          ) : tool.ok === false ? (
            <XCircle size={12} aria-hidden="true" />
          ) : tool.ok ? (
            <CheckCircle2 size={12} aria-hidden="true" />
          ) : null}
          {status}
        </span>
        <ChevronDown
          size={14}
          aria-hidden="true"
          className={`shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open ? (
        <div className="max-h-48 overflow-auto border-t border-separator p-2 font-mono text-xs text-muted">
          {tool.args !== undefined ? (
            <>
              <p className="text-foreground">参数</p>
              <pre className="mt-1 whitespace-pre-wrap break-all">{preview(tool.args)}</pre>
            </>
          ) : null}
          {tool.result !== undefined ? (
            <>
              <p className="mt-2 text-foreground">结果</p>
              <pre className="mt-1 whitespace-pre-wrap break-all">{preview(tool.result)}</pre>
            </>
          ) : null}
          {tool.error ? (
            <>
              <p className="mt-2 text-foreground">错误</p>
              <pre className="mt-1 whitespace-pre-wrap break-all text-danger">{tool.error}</pre>
            </>
          ) : null}
          {tool.summary ? <p className="mt-2 text-danger">{tool.summary}</p> : null}
        </div>
      ) : null}
    </div>
  )
}
